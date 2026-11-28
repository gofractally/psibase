#include <services/local/XIpfs.hpp>

#include <psibase/dispatch.hpp>
#include <services/local/IpfsFormat.hpp>
#include <services/local/XAdmin.hpp>
#include <services/local/XHttp.hpp>
#include <services/system/RTransact.hpp>

#include <charconv>

using namespace psibase;
using namespace LocalService;
using namespace LocalService::ipfs;
using SystemService::RTransact;

namespace
{
   // --- the node's file store, as this service uses it -------------------
   //
   // Names: "f" + hash is a file's bytes, "n" + hash a node as uploaded,
   // "p" + hash a file while it is being written. The hash is the digest in
   // the content id.

   std::string nameOf(char kind, const Checksum256& digest)
   {
      static constexpr char hex[] = "0123456789abcdef";
      std::string           out(1, kind);
      for (unsigned char b : digest)
      {
         out += hex[b >> 4];
         out += hex[b & 15];
      }
      return out;
   }

   std::optional<std::uint64_t> fileSize(const std::string& name, bool pending = false)
   {
      auto n = raw::fileSize(name.data(), name.size(), pending);
      if (n == 0xffffffffu)
         return std::nullopt;
      auto          bytes = getResult(n);
      std::uint64_t size  = 0;
      for (int i = 0; i < 8 && i < static_cast<int>(bytes.size()); ++i)
         size |= std::uint64_t(static_cast<unsigned char>(bytes[i])) << (8 * i);
      return size;
   }

   std::optional<std::vector<char>> fileRead(const std::string& name,
                                             std::uint64_t      offset,
                                             std::uint32_t      length)
   {
      auto n = raw::fileRead(name.data(), name.size(), offset, length);
      if (n == 0xffffffffu)
         return std::nullopt;
      return getResult(n);
   }

   bool fileAppend(const std::string& name, const std::vector<char>& data)
   {
      return raw::fileAppend(name.data(), name.size(), data.data(), data.size()) == 0;
   }

   bool fileCommit(const std::string& pending, const std::string& name)
   {
      return raw::fileCommit(pending.data(), pending.size(), name.data(), name.size()) == 0;
   }

   // --- replies ------------------------------------------------------------

   // Content here is public and never changes, so any page may read it.
   std::vector<HttpHeader> publicHeaders()
   {
      return {{"Access-Control-Allow-Origin", "*"},
              {"Access-Control-Allow-Methods", "GET, HEAD, PUT, OPTIONS"},
              {"Access-Control-Allow-Headers", "Authorization, Content-Type, Range"},
              {"Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, ETag"}};
   }

   HttpReply text(HttpStatus status, std::string_view message)
   {
      return HttpReply{.status      = status,
                       .contentType = "text/plain",
                       .body        = std::vector(message.begin(), message.end()),
                       .headers     = publicHeaders()};
   }

   ByteView bytesOf(const std::vector<char>& v)
   {
      return {reinterpret_cast<const unsigned char*>(v.data()), v.size()};
   }

   std::string_view contentTypeOf(std::string_view name)
   {
      auto dot = name.rfind('.');
      auto ext = dot == std::string_view::npos ? std::string_view{} : name.substr(dot + 1);
      static constexpr std::pair<std::string_view, std::string_view> types[] = {
          {"html", "text/html"},      {"js", "text/javascript"},  {"mjs", "text/javascript"},
          {"css", "text/css"},        {"json", "application/json"}, {"wasm", "application/wasm"},
          {"svg", "image/svg+xml"},   {"png", "image/png"},       {"jpg", "image/jpeg"},
          {"jpeg", "image/jpeg"},     {"ico", "image/x-icon"},    {"txt", "text/plain"},
          {"map", "application/json"}, {"woff2", "font/woff2"},
      };
      for (const auto& [e, type] : types)
         if (e == ext)
            return type;
      return "application/octet-stream";
   }

   // What a content id names cannot change: a reply may be kept for ever.
   void immutableHeaders(std::vector<HttpHeader>& headers, const Cid& cid)
   {
      headers.push_back({"Cache-Control", "public, max-age=31536000, immutable"});
      headers.push_back({"ETag", "\"" + cidToString(cid) + "\""});
   }

   // One range, "bytes=a-b", "bytes=a-" or "bytes=-n". Anything else is
   // answered with the whole file, which a client must accept.
   struct Range
   {
      std::uint64_t offset;
      std::uint64_t length;
   };
   std::optional<Range> rangeOf(const HttpRequest& req, std::uint64_t size)
   {
      auto header = req.getHeader("range");
      if (!header || !header->starts_with("bytes=") || header->find(',') != std::string_view::npos)
         return std::nullopt;
      auto spec = header->substr(6);
      auto dash = spec.find('-');
      if (dash == std::string_view::npos)
         return std::nullopt;
      auto number = [](std::string_view s) -> std::optional<std::uint64_t>
      {
         std::uint64_t v{};
         auto [end, ec] = std::from_chars(s.data(), s.data() + s.size(), v);
         if (s.empty() || ec != std::errc{} || end != s.data() + s.size())
            return std::nullopt;
         return v;
      };
      auto first = number(spec.substr(0, dash));
      auto last  = number(spec.substr(dash + 1));
      if (!first && last)  // the final n bytes
      {
         auto n = std::min(*last, size);
         return Range{size - n, n};
      }
      if (!first || *first >= size)
         return std::nullopt;
      auto end = last ? std::min(*last, size - 1) : size - 1;
      if (end < *first)
         return std::nullopt;
      return Range{*first, end - *first + 1};
   }

   // The reply that has the node send (part of) one of this service's files.
   HttpReply sendFile(const HttpRequest& req,
                      const std::string& name,
                      std::uint64_t      size,
                      std::string_view   contentType,
                      const Cid&         cid)
   {
      auto headers = publicHeaders();
      immutableHeaders(headers, cid);
      headers.push_back({"Accept-Ranges", "bytes"});
      auto  range  = rangeOf(req, size);
      auto  offset = range ? range->offset : 0;
      auto  length = range ? range->length : size;
      HttpReply reply{.status      = range ? HttpStatus::partialContent : HttpStatus::ok,
                      .contentType = std::string{contentType}};
      if (range)
         headers.push_back({"Content-Range", "bytes " + std::to_string(offset) + "-" +
                                                 std::to_string(offset + length - 1) + "/" +
                                                 std::to_string(size)});
      // HEAD: the headers of the same reply, and no bytes
      if (req.method != "HEAD")
         headers.push_back({std::string{sendFileHeader}, name + ";" + std::to_string(offset) + ";" +
                                                             std::to_string(length)});
      reply.headers = std::move(headers);
      return reply;
   }

   // --- what is stored -----------------------------------------------------

   std::optional<std::vector<char>> loadNode(const Cid& cid)
   {
      return fileRead(nameOf('n', cid.digest), 0, XIpfs::maxNodeSize);
   }

   // A larger file's root node: its parts, each `partSize` but the last.
   struct Parts
   {
      std::vector<Link> links;
      std::uint64_t     size = 0;
   };
   std::optional<Parts> partsOf(const Node& node, const UnixFs& fs)
   {
      if (fs.type != UnixFsType::file || node.links.empty())
         return std::nullopt;
      Parts parts{.links = node.links};
      for (std::size_t i = 0; i < parts.links.size(); ++i)
      {
         const auto& link = parts.links[i];
         bool        last = i + 1 == parts.links.size();
         if (link.cid.codec != codecRaw || link.size == 0 || link.size > XIpfs::partSize ||
             (!last && link.size != XIpfs::partSize))
            return std::nullopt;
         parts.size += link.size;
      }
      return parts;
   }

   bool mayStore(const HttpRequest& req, std::optional<std::int32_t> socket)
   {
      // Storing is for an account that is signed in, or the node's
      // administrator. (Charging the account for it is not built yet.)
      // The administrator first: that check works on a node whose chain
      // has not been started, where there are no accounts to ask about.
      if (!to<XAdmin>().checkAuth(req, socket))
         return true;
      return to<RTransact>().getSession(req).user.has_value();
   }

   // Writes a whole small file under `name` if it is not there yet.
   bool storeWhole(const std::string& name, const Checksum256& digest, const std::vector<char>& data)
   {
      if (fileSize(name))
         return true;
      auto pending = nameOf('p', digest);
      // What an interrupted attempt left behind is not continued.
      raw::fileRemove(pending.data(), pending.size(), 1);
      return fileAppend(pending, data) && fileCommit(pending, name);
   }

   std::optional<HttpReply> serveBlock(const HttpRequest&          req,
                                       std::optional<std::int32_t> socket,
                                       std::string_view            id)
   {
      auto cid = parseCid(id);
      if (!cid)
         return text(HttpStatus::badRequest, "not a content id this node stores");
      auto name = nameOf(cid->codec == codecRaw ? 'f' : 'n', cid->digest);
      if (req.method == "GET" || req.method == "HEAD")
      {
         auto size = fileSize(name);
         if (!size)
            return text(HttpStatus::notFound, "no such block");
         return sendFile(req, name, *size, "application/vnd.ipld.raw", *cid);
      }
      if (req.method != "PUT")
         return HttpReply::methodNotAllowed(req);
      if (!mayStore(req, socket))
         return text(HttpStatus::unauthorized, "Sign in to store files on this node.");

      auto limit = cid->codec == codecRaw ? XIpfs::partSize : XIpfs::maxNodeSize;
      if (req.body.size() > limit)
         return text(HttpStatus::contentTooLarge,
                     cid->codec == codecRaw
                         ? "a file larger than one part is uploaded as its root node and its parts"
                         : "a node is at most 2 MiB");
      if (sha256(req.body.data(), req.body.size()) != cid->digest)
         return text(HttpStatus::badRequest, "the bytes do not match the content id");
      if (cid->codec == codecDagPb)
      {
         // A node has to be one this service can serve from: a directory, a
         // small file, or the list of a larger file's parts.
         auto node = parseDagPb(bytesOf(req.body));
         auto fs   = node ? parseUnixFs(node->data) : std::nullopt;
         if (!fs)
            return text(HttpStatus::badRequest, "not a file or directory node");
         if (fs->type == UnixFsType::hamtShard)
            return text(HttpStatus::badRequest, "very large directories are not supported");
         if (fs->type == UnixFsType::file && !node->links.empty() && !partsOf(*node, *fs))
            return text(HttpStatus::badRequest,
                        "this node stores files in parts of exactly 1 MiB (the last may be "
                        "shorter), each a raw block");
      }
      bool existed = fileSize(name).has_value();
      if (!existed && !storeWhole(name, cid->digest, req.body))
         return text(HttpStatus::internalServerError, "could not store the block");
      return text(existed ? HttpStatus::ok : HttpStatus::created, cidToString(*cid));
   }

   // The parts of a larger file, in order.
   std::optional<HttpReply> servePart(const HttpRequest&          req,
                                      std::optional<std::int32_t> socket,
                                      std::string_view            rest)
   {
      auto slash = rest.find('/');
      auto cid   = parseCid(rest.substr(0, slash));
      if (!cid || cid->codec != codecDagPb)
         return text(HttpStatus::badRequest, "not the content id of a file in parts");
      auto block = loadNode(*cid);
      if (!block)
         return text(HttpStatus::notFound, "upload the file's root node first");
      auto node  = parseDagPb(bytesOf(*block));
      auto fs    = node ? parseUnixFs(node->data) : std::nullopt;
      auto parts = fs ? partsOf(*node, *fs) : std::nullopt;
      if (!parts)
         return text(HttpStatus::badRequest, "not a file in parts");

      auto final_  = nameOf('f', cid->digest);
      auto pending = nameOf('p', cid->digest);
      auto done    = fileSize(final_).has_value();
      auto have    = done ? parts->size : fileSize(pending, true).value_or(0);
      // Whole parts only: a part that was cut short is written again.
      auto next = static_cast<std::size_t>(have / XIpfs::partSize);

      if (slash == std::string_view::npos)
      {
         if (req.method != "GET")
            return HttpReply::methodNotAllowed(req);
         return text(HttpStatus::ok, done ? "complete" : std::to_string(next));
      }
      if (req.method != "PUT")
         return HttpReply::methodNotAllowed(req);
      if (!mayStore(req, socket))
         return text(HttpStatus::unauthorized, "Sign in to store files on this node.");
      if (done)
         return text(HttpStatus::ok, "complete");

      std::size_t index{};
      auto        indexText   = rest.substr(slash + 1);
      auto [end, ec]          = std::from_chars(indexText.data(), indexText.data() + indexText.size(), index);
      if (ec != std::errc{} || end != indexText.data() + indexText.size() ||
          index >= parts->links.size())
         return text(HttpStatus::badRequest, "no such part");
      if (have % XIpfs::partSize != 0)
      {
         // An append that was cut short: start the file again.
         raw::fileRemove(pending.data(), pending.size(), 1);
         next = 0;
      }
      if (index != next)
         return text(HttpStatus::conflict, std::to_string(next));
      const auto& link = parts->links[index];
      if (req.body.size() != link.size ||
          sha256(req.body.data(), req.body.size()) != link.cid.digest)
         return text(HttpStatus::badRequest, "the bytes do not match this part's content id");
      if (!fileAppend(pending, req.body))
         return text(HttpStatus::internalServerError, "could not store the part");
      if (index + 1 == parts->links.size())
      {
         if (!fileCommit(pending, final_))
            return text(HttpStatus::internalServerError, "could not finish the file");
         return text(HttpStatus::created, "complete");
      }
      return text(HttpStatus::ok, std::to_string(index + 1));
   }

   std::optional<HttpReply> serveFile(const HttpRequest& req, std::string_view rest)
   {
      if (req.method != "GET" && req.method != "HEAD")
         return HttpReply::methodNotAllowed(req);
      auto slash = rest.find('/');
      auto cid   = parseCid(rest.substr(0, slash));
      if (!cid)
         return text(HttpStatus::badRequest, "not a content id this node stores");
      auto        path = slash == std::string_view::npos ? std::string_view{} : rest.substr(slash + 1);
      std::string name{rest.substr(0, slash)};

      // Walk down directories, one path segment at a time.
      auto current = *cid;
      while (true)
      {
         if (current.codec == codecRaw)
         {
            if (!path.empty())
               return text(HttpStatus::notFound, "no such file");
            auto file = nameOf('f', current.digest);
            auto size = fileSize(file);
            if (!size)
               return text(HttpStatus::notFound, "missing block " + cidToString(current));
            return sendFile(req, file, *size, contentTypeOf(name), current);
         }
         auto block = loadNode(current);
         if (!block)
            return text(HttpStatus::notFound, "missing block " + cidToString(current));
         auto node = parseDagPb(bytesOf(*block));
         auto fs   = node ? parseUnixFs(node->data) : std::nullopt;
         if (!fs)
            return text(HttpStatus::badRequest, "not a file or directory");
         if (fs->type != UnixFsType::directory)
         {
            if (!path.empty())
               return text(HttpStatus::notFound, "no such file");
            if (node->links.empty())
            {
               // A small file whose bytes are in the node itself
               auto headers = publicHeaders();
               immutableHeaders(headers, current);
               return HttpReply{.contentType = std::string{contentTypeOf(name)},
                                .body        = req.method == "HEAD"
                                                   ? std::vector<char>{}
                                                   : std::vector<char>(fs->data.begin(), fs->data.end()),
                                .headers     = std::move(headers)};
            }
            auto parts = partsOf(*node, *fs);
            auto file  = nameOf('f', current.digest);
            if (!parts || fileSize(file) != parts->size)
               return text(HttpStatus::notFound,
                           "the upload of " + cidToString(current) + " is not complete");
            return sendFile(req, file, parts->size, contentTypeOf(name), current);
         }
         // A directory: the next segment names an entry; with no segment
         // left, its index.html stands for it.
         while (!path.empty() && path.front() == '/')
            path.remove_prefix(1);
         auto        end     = path.find('/');
         auto        segment = path.empty() ? std::string_view{"index.html"} : path.substr(0, end);
         const Link* found   = nullptr;
         for (const auto& link : node->links)
            if (link.name == segment)
               found = &link;
         if (!found)
            return text(HttpStatus::notFound, "no such file");
         name    = std::string{segment};
         current = found->cid;
         path    = (path.empty() || end == std::string_view::npos) ? std::string_view{}
                                                                    : path.substr(end + 1);
      }
   }
}  // namespace

std::optional<HttpReply> XIpfs::serveSys(HttpRequest req, std::optional<std::int32_t> socket)
{
   check(getSender() == XHttp::service, "Wrong sender");

   if (req.method == "OPTIONS")
      return HttpReply{.headers = publicHeaders()};

   auto                       target      = req.path();
   std::string_view           view{target};
   constexpr std::string_view blockPrefix = "/block/";
   constexpr std::string_view partPrefix  = "/file/";
   constexpr std::string_view filePrefix  = "/ipfs/";
   if (view.starts_with(blockPrefix))
      return serveBlock(req, socket, view.substr(blockPrefix.size()));
   if (view.starts_with(partPrefix))
      return servePart(req, socket, view.substr(partPrefix.size()));
   if (view.starts_with(filePrefix))
      return serveFile(req, view.substr(filePrefix.size()));
   return {};
}

PSIBASE_DISPATCH(XIpfs)
