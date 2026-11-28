#include <services/local/XIpfs.hpp>

#include <psibase/dispatch.hpp>
#include <services/local/IpfsFormat.hpp>
#include <services/local/XAdmin.hpp>
#include <services/local/XHttp.hpp>
#include <services/system/RTransact.hpp>

using namespace psibase;
using namespace LocalService;
using namespace LocalService::ipfs;
using SystemService::RTransact;

namespace
{
   // Content here is public and never changes, so any page may read it.
   std::vector<HttpHeader> publicHeaders()
   {
      return {{"Access-Control-Allow-Origin", "*"},
              {"Access-Control-Allow-Methods", "GET, HEAD, PUT, OPTIONS"},
              {"Access-Control-Allow-Headers", "Authorization, Content-Type"}};
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

   std::optional<std::vector<char>> loadBlock(const Cid& cid)
   {
      auto row = XIpfs{}.open<IpfsBlockTable>().get(cid.digest);
      if (!row)
         return std::nullopt;
      return std::move(row->data);
   }

   // What went wrong while putting a file together.
   struct Problem
   {
      HttpStatus  status;
      std::string message;
   };

   // Appends the bytes of the file at `cid` to `out`.
   std::optional<Problem> appendFile(const Cid& cid, std::vector<char>& out, unsigned depth)
   {
      if (depth > 16)
         return Problem{HttpStatus::badRequest, "file is nested too deeply"};
      auto block = loadBlock(cid);
      if (!block)
         return Problem{HttpStatus::notFound, "missing block " + cidToString(cid)};
      auto fits = [&](std::size_t more)
      { return out.size() + more <= XIpfs::maxServedFile; };
      if (cid.codec == codecRaw)
      {
         if (!fits(block->size()))
            return Problem{HttpStatus::contentTooLarge, "file is too large to serve in one piece"};
         out.insert(out.end(), block->begin(), block->end());
         return std::nullopt;
      }
      auto node = parseDagPb(bytesOf(*block));
      auto fs   = node ? parseUnixFs(node->data) : std::nullopt;
      if (!fs || (fs->type != UnixFsType::file && fs->type != UnixFsType::raw))
         return Problem{HttpStatus::badRequest, "not a file: " + cidToString(cid)};
      if (node->links.empty())
      {
         if (!fits(fs->data.size()))
            return Problem{HttpStatus::contentTooLarge, "file is too large to serve in one piece"};
         out.insert(out.end(), fs->data.begin(), fs->data.end());
         return std::nullopt;
      }
      for (const auto& link : node->links)
         if (auto problem = appendFile(link.cid, out, depth + 1))
            return problem;
      return std::nullopt;
   }

   std::string_view contentTypeOf(std::string_view name)
   {
      auto dot = name.rfind('.');
      auto ext = dot == std::string_view::npos ? std::string_view{} : name.substr(dot + 1);
      static constexpr std::pair<std::string_view, std::string_view> types[] = {
          {"html", "text/html"},
          {"js", "text/javascript"},
          {"mjs", "text/javascript"},
          {"css", "text/css"},
          {"json", "application/json"},
          {"wasm", "application/wasm"},
          {"svg", "image/svg+xml"},
          {"png", "image/png"},
          {"jpg", "image/jpeg"},
          {"jpeg", "image/jpeg"},
          {"ico", "image/x-icon"},
          {"txt", "text/plain"},
          {"map", "application/json"},
          {"woff2", "font/woff2"},
      };
      for (const auto& [e, type] : types)
         if (e == ext)
            return type;
      return "application/octet-stream";
   }

   // A reply that may be kept for ever: what a content id names cannot change.
   HttpReply immutable(const HttpRequest& req,
                       std::string_view   contentType,
                       std::vector<char>  body,
                       const Cid&         cid)
   {
      auto headers = publicHeaders();
      headers.push_back({"Cache-Control", "public, max-age=31536000, immutable"});
      headers.push_back({"ETag", "\"" + cidToString(cid) + "\""});
      if (req.method == "HEAD")
         body.clear();
      return HttpReply{.contentType = std::string{contentType},
                       .body        = std::move(body),
                       .headers     = std::move(headers)};
   }

   std::optional<HttpReply> serveBlock(const HttpRequest&          req,
                                       std::optional<std::int32_t> socket,
                                       std::string_view            id)
   {
      auto cid = parseCid(id);
      if (!cid)
         return text(HttpStatus::badRequest, "not a content id this node stores");
      if (req.method == "GET" || req.method == "HEAD")
      {
         auto block = loadBlock(*cid);
         if (!block)
            return text(HttpStatus::notFound, "no such block");
         return immutable(req, "application/vnd.ipld.raw", std::move(*block), *cid);
      }
      if (req.method != "PUT")
         return HttpReply::methodNotAllowed(req);

      // Storing is for an account that is signed in, or the node's
      // administrator. (Charging the account for it is not built yet.)
      if (!to<RTransact>().getSession(req).user)
         if (auto refusal = to<XAdmin>().checkAuth(req, socket))
            return text(HttpStatus::unauthorized, "Sign in to store files on this node.");

      if (req.body.size() > XIpfs::maxBlockSize)
         return text(HttpStatus::contentTooLarge, "a block is at most 2 MiB");
      if (sha256(req.body.data(), req.body.size()) != cid->digest)
         return text(HttpStatus::badRequest, "the bytes do not match the content id");
      // A block that claims to be a node has to be one, or nothing could be
      // served from it.
      if (cid->codec == codecDagPb && !parseDagPb(bytesOf(req.body)))
         return text(HttpStatus::badRequest, "not a dag-pb node");

      auto table = XIpfs{}.open<IpfsBlockTable>();
      bool isNew = false;
      PSIBASE_SUBJECTIVE_TX
      {
         isNew = !table.get(cid->digest).has_value();
         if (isNew)
            table.put(IpfsBlockRow{.digest = cid->digest, .data = req.body});
      }
      auto reply   = text(isNew ? HttpStatus::created : HttpStatus::ok, cidToString(*cid));
      return reply;
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
            break;
         auto block = loadBlock(current);
         if (!block)
            return text(HttpStatus::notFound, "missing block " + cidToString(current));
         auto node = parseDagPb(bytesOf(*block));
         auto fs   = node ? parseUnixFs(node->data) : std::nullopt;
         if (!fs)
            return text(HttpStatus::badRequest, "not a file or directory");
         if (fs->type == UnixFsType::hamtShard)
            return text(HttpStatus::badRequest, "very large directories are not supported");
         if (fs->type != UnixFsType::directory)
            break;
         // A directory: the next segment names an entry; with no segment
         // left, its index.html stands for it.
         while (!path.empty() && path.front() == '/')
            path.remove_prefix(1);
         auto end     = path.find('/');
         auto segment = path.empty() ? std::string_view{"index.html"} : path.substr(0, end);
         const Link* found = nullptr;
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
      if (!path.empty())
         return text(HttpStatus::notFound, "no such file");

      std::vector<char> body;
      if (auto problem = appendFile(current, body, 0))
         return text(problem->status, problem->message);
      return immutable(req, contentTypeOf(name), std::move(body), current);
   }
}  // namespace

std::optional<HttpReply> XIpfs::serveSys(HttpRequest req, std::optional<std::int32_t> socket)
{
   check(getSender() == XHttp::service, "Wrong sender");

   if (req.method == "OPTIONS")
      return HttpReply{.headers = publicHeaders()};

   auto target = req.path();
   constexpr std::string_view blockPrefix = "/block/";
   constexpr std::string_view filePrefix  = "/ipfs/";
   if (std::string_view{target}.starts_with(blockPrefix))
      return serveBlock(req, socket, std::string_view{target}.substr(blockPrefix.size()));
   if (std::string_view{target}.starts_with(filePrefix))
      return serveFile(req, std::string_view{target}.substr(filePrefix.size()));
   return {};
}

PSIBASE_DISPATCH(XIpfs)
