// x-ipfs: files stored by content id in the node's file store, and files and
// directories served from them. The content ids used here are the ones the IPFS tools give the
// same bytes (CIDv1, sha2-256, raw leaves).
#include <services/local/IpfsFormat.hpp>
#include <services/local/XIpfs.hpp>

#include <catch2/catch_test_macros.hpp>
#include <psibase/DefaultTestChain.hpp>

using namespace psibase;
using namespace LocalService;
using namespace LocalService::ipfs;

namespace
{
   struct Bytes
   {
      static std::string contentType() { return "application/octet-stream"; }
      std::vector<char>  body() const { return value; }
      std::vector<char>  value;
   };

   std::vector<char> chars(std::string_view s)
   {
      return {s.begin(), s.end()};
   }

   Cid idOf(std::uint64_t codec, const std::vector<char>& data)
   {
      return Cid{.codec = codec, .digest = sha256(data.data(), data.size())};
   }

   void field(std::vector<unsigned char>& out, unsigned number, std::span<const unsigned char> bytes)
   {
      writeVarint(out, (number << 3) | 2);
      writeVarint(out, bytes.size());
      out.insert(out.end(), bytes.begin(), bytes.end());
   }

   // A dag-pb node as the IPFS tools write it: links first, then the data.
   std::vector<char> node(const std::vector<Link>& links, UnixFsType type)
   {
      std::vector<unsigned char> out;
      for (const auto& link : links)
      {
         std::vector<unsigned char> inner;
         auto                       id = cidBytes(link.cid);
         field(inner, 1, id);
         field(inner, 2,
               {reinterpret_cast<const unsigned char*>(link.name.data()), link.name.size()});
         writeVarint(inner, (3 << 3) | 0);
         writeVarint(inner, link.size);
         field(out, 2, inner);
      }
      std::vector<unsigned char> fs;
      writeVarint(fs, (1 << 3) | 0);
      writeVarint(fs, static_cast<std::uint64_t>(type));
      field(out, 1, fs);
      return {out.begin(), out.end()};
   }

   struct Store
   {
      DefaultTestChain t;
      auto             client() { return t.http(XIpfs::service); }
      HttpStatus       put(const Cid& cid, const std::vector<char>& data)
      {
         return client().put<HttpReply>("/block/" + cidToString(cid), Bytes{data}).status;
      }
      Cid add(std::uint64_t codec, const std::vector<char>& data)
      {
         auto cid = idOf(codec, data);
         REQUIRE(put(cid, data) == HttpStatus::created);
         return cid;
      }
      HttpReply get(const std::string& path) { return client().get<HttpReply>(path); }
      std::string header(const HttpReply& reply, std::string_view name)
      {
         for (const auto& h : reply.headers)
            if (h.matches(name))
               return h.value;
         return {};
      }
   };
}  // namespace

TEST_CASE("x-ipfs: content ids match the IPFS tools")
{
   // `echo "hello world" | ipfs add --cid-version=1 --raw-leaves`
   auto hello = idOf(codecRaw, chars("hello world\n"));
   CHECK(cidToString(hello) == "bafkreifjjcie6lypi6ny7amxnfftagclbuxndqonfipmb64f2km2devei4");
   // The empty directory
   auto empty = idOf(codecDagPb, node({}, UnixFsType::directory));
   CHECK(cidToString(empty) == "bafybeiczsscdsbs7ffqz55asqdf3smv6klcw3gofszvwlyarci47bgf354");

   CHECK(parseCid(cidToString(hello)) == hello);
   CHECK(parseCid(cidToString(empty)) == empty);
   // Not ours: version 0, upper case, another base, trailing bits, wrong length
   CHECK(!parseCid("QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn"));
   CHECK(!parseCid("BAFKREIFJJCIE6LYPI6NY7AMXNFFTAGCLBUXNDQONFIPMB64F2KM2DEVEI4"));
   CHECK(!parseCid("bafkreifjjcie6lypi6ny7amxnfftagclbuxndqonfipmb64f2km2devei5"));
   CHECK(!parseCid("bafkreifjjcie6lypi6ny7amxnfftagclbuxndqonfipmb64f2km2devei"));
   CHECK(!parseCid(""));
}

TEST_CASE("x-ipfs: a block is stored only under the id of its bytes")
{
   Store s;
   auto  data = chars("hello world\n");
   auto  cid  = idOf(codecRaw, data);

   CHECK(s.get("/block/" + cidToString(cid)).status == HttpStatus::notFound);
   CHECK(s.put(cid, chars("something else")) == HttpStatus::badRequest);
   CHECK(s.get("/block/" + cidToString(cid)).status == HttpStatus::notFound);
   CHECK(s.put(cid, data) == HttpStatus::created);
   // Again: already here, nothing changes
   CHECK(s.put(cid, data) == HttpStatus::ok);

   auto reply = s.get("/block/" + cidToString(cid));
   CHECK(reply.status == HttpStatus::ok);
   CHECK(reply.body == data);
   CHECK(s.header(reply, "cache-control").find("immutable") != std::string::npos);

   CHECK(s.client().put<HttpReply>("/block/not-a-cid", Bytes{data}).status ==
         HttpStatus::badRequest);
   // A block that says it is a node has to be one
   auto junk = chars("\xff\xff\xff");
   CHECK(s.put(idOf(codecDagPb, junk), junk) == HttpStatus::badRequest);
   // A file larger than one part does not go in as one block
   std::vector<char> big(XIpfs::partSize + 1, 'x');
   CHECK(s.put(idOf(codecRaw, big), big) == HttpStatus::contentTooLarge);
}

TEST_CASE("x-ipfs: a larger file is uploaded in parts, in order, each checked")
{
   Store             s;
   std::vector<char> partA(XIpfs::partSize, 'a');
   auto              partB = chars("tail");
   auto              idA   = idOf(codecRaw, partA);
   auto              idB   = idOf(codecRaw, partB);
   auto              root  = node({{idA, "", partA.size()}, {idB, "", partB.size()}}, UnixFsType::file);
   auto              cid   = idOf(codecDagPb, root);
   auto              base  = "/file/" + cidToString(cid);
   auto part = [&](unsigned i, const std::vector<char>& data)
   { return s.client().put<HttpReply>(base + "/" + std::to_string(i), Bytes{data}); };
   auto textOf = [](const HttpReply& r) { return std::string(r.body.begin(), r.body.end()); };

   // Nothing can be said about a file whose list of parts is not here
   CHECK(s.get(base).status == HttpStatus::notFound);
   CHECK(part(0, partA).status == HttpStatus::notFound);
   CHECK(s.put(cid, root) == HttpStatus::created);
   CHECK(textOf(s.get(base)) == "0");
   CHECK(s.get("/ipfs/" + cidToString(cid)).status == HttpStatus::notFound);

   // Out of order, and wrong bytes
   auto reply = part(1, partB);
   CHECK(reply.status == HttpStatus::conflict);
   CHECK(textOf(reply) == "0");
   CHECK(part(0, std::vector<char>(XIpfs::partSize, 'b')).status == HttpStatus::badRequest);
   CHECK(part(0, chars("short")).status == HttpStatus::badRequest);
   CHECK(part(2, partB).status == HttpStatus::badRequest);
   CHECK(textOf(s.get(base)) == "0");

   reply = part(0, partA);
   CHECK(reply.status == HttpStatus::ok);
   CHECK(textOf(reply) == "1");
   CHECK(textOf(s.get(base)) == "1");
   // The same part again is not the next one
   CHECK(part(0, partA).status == HttpStatus::conflict);
   // Not served until it is whole
   CHECK(s.get("/ipfs/" + cidToString(cid)).status == HttpStatus::notFound);

   reply = part(1, partB);
   CHECK(reply.status == HttpStatus::created);
   CHECK(textOf(s.get(base)) == "complete");
   CHECK(part(1, partB).status == HttpStatus::ok);

   reply = s.get("/ipfs/" + cidToString(cid));
   CHECK(reply.status == HttpStatus::ok);
   REQUIRE(reply.body.size() == partA.size() + partB.size());
   CHECK(std::equal(partA.begin(), partA.end(), reply.body.begin()));
   CHECK(std::string(reply.body.end() - 4, reply.body.end()) == "tail");
   CHECK(s.header(reply, "accept-ranges") == "bytes");

   // A range across the two parts
   auto ranged = s.client();
   auto range  = s.t.http(XIpfs::service, {{"Range", "bytes=1048574-1048577"}})
                    .get<HttpReply>("/ipfs/" + cidToString(cid));
   CHECK(range.status == HttpStatus::partialContent);
   CHECK(std::string(range.body.begin(), range.body.end()) == "aata");
   CHECK(s.header(range, "content-range") == "bytes 1048574-1048577/1048580");
   range = s.t.http(XIpfs::service, {{"Range", "bytes=-4"}})
              .get<HttpReply>("/ipfs/" + cidToString(cid));
   CHECK(std::string(range.body.begin(), range.body.end()) == "tail");

   // Parts of another size are not this node's layout
   std::vector<char> quarter(262144, 'q');
   auto              idQ = idOf(codecRaw, quarter);
   auto other = node({{idQ, "", quarter.size()}, {idQ, "", quarter.size()}}, UnixFsType::file);
   CHECK(s.put(idOf(codecDagPb, other), other) == HttpStatus::badRequest);
}

TEST_CASE("x-ipfs: files and directories are served from the file store")
{
   Store s;
   auto  hello = s.add(codecRaw, chars("hello world\n"));

   // A file by itself
   auto reply = s.get("/ipfs/" + cidToString(hello));
   CHECK(reply.status == HttpStatus::ok);
   CHECK(reply.body == chars("hello world\n"));

   // Directories
   auto page = s.add(codecRaw, chars("<html>index</html>"));
   auto sub  = s.add(codecDagPb,
                     node({{hello, "copy.txt", 12}, {page, "index.html", 18}},
                          UnixFsType::directory));
   auto root = s.add(codecDagPb,
                     node({{hello, "hello.txt", 12}, {sub, "sub", 0}}, UnixFsType::directory));
   auto base = "/ipfs/" + cidToString(root);

   reply = s.get(base + "/hello.txt");
   CHECK(reply.status == HttpStatus::ok);
   CHECK(reply.body == chars("hello world\n"));
   CHECK(reply.contentType == "text/plain");
   CHECK(s.header(reply, "cache-control") == "public, max-age=31536000, immutable");
   CHECK(s.header(reply, "access-control-allow-origin") == "*");
   // The header that asks the node to send the file does not reach the client
   CHECK(s.header(reply, "x-psibase-send-file").empty());

   CHECK(s.get(base + "/sub/copy.txt").body == chars("hello world\n"));
   // A directory stands for its index.html
   reply = s.get(base + "/sub/");
   CHECK(reply.body == chars("<html>index</html>"));
   CHECK(reply.contentType == "text/html");
   CHECK(s.get(base + "/sub").body == chars("<html>index</html>"));

   CHECK(s.get(base + "/missing.txt").status == HttpStatus::notFound);
   CHECK(s.get(base + "/hello.txt/more").status == HttpStatus::notFound);
   CHECK(s.get(base).status == HttpStatus::notFound);  // no index.html at the top
   CHECK(s.get("/ipfs/nonsense").status == HttpStatus::badRequest);

   // A directory whose entry was never uploaded says which block is missing
   auto absent = idOf(codecRaw, chars("never uploaded"));
   auto holey  = s.add(codecDagPb, node({{absent, "gone.txt", 14}}, UnixFsType::directory));
   reply       = s.get("/ipfs/" + cidToString(holey) + "/gone.txt");
   CHECK(reply.status == HttpStatus::notFound);
   CHECK(std::string(reply.body.begin(), reply.body.end()).find(cidToString(absent)) !=
         std::string::npos);
}
