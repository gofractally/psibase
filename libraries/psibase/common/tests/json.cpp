// The JSON of psibase's types: I-JSON through PSIO (psio::to_ijson,
// psio::from_ijson, psio::decode_json_checked). Pins the text forms that
// psibase adds to PSIO's rules — the types with a text adapter, the
// reflected enums — and the rules that clients meet: number forms, missing
// and unknown members, optional members of request records, the JSON of a
// signed transaction. Runs natively and in a WASM guest.
#include <catch2/catch_all.hpp>

#include <psibase/Rpc.hpp>
#include <psibase/SocketInfo.hpp>
#include <psibase/block.hpp>
#include <psibase/db.hpp>
#include <psibase/pem.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/Spki.hpp>

#include <psio/json.hpp>
#include <psio/json_value.hpp>
#include <psio/key.hpp>
#include <psio/to_hex.hpp>
#include <psio/untagged.hpp>

#include <cstdint>
#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <tuple>
#include <variant>
#include <vector>

using namespace psibase;

namespace json_test
{
   // The outcome of reading `text` as a T: the value written back, or
   // "error: " and the reader's message.
   template <typename T>
   std::string reread(std::string_view text)
   {
      T value;
      if (auto status = psio::decode_json_checked(
              psio::ijson{}, std::span<const char>{text.data(), text.size()}, value);
          !status.ok())
         return "error: " + std::string(status.error().what);
      return psio::to_ijson(value);
   }

   template <typename T>
   bool rejects(std::string_view text)
   {
      return reread<T>(text).starts_with("error: ");
   }

   struct Peer
   {
      IPAddress                     address;
      std::optional<SocketEndpoint> endpoint;
      PSIO_REFLECT(Peer, address, endpoint)
   };

   // A request record as psinode and x-admin declare them: what a client
   // may leave out is optional.
   struct Shutdown
   {
      std::optional<bool> restart;
      std::optional<bool> force;
      std::string         reason;
      PSIO_REFLECT(Shutdown, restart, force, reason)
   };

   // The value of a service-defined option of psinode's configuration
   using Extra = std::variant<std::string, std::vector<std::string>>;

   struct Numbers
   {
      std::uint64_t u64 = 0;
      std::int64_t  i64 = 0;
      std::uint32_t u32 = 0;
      PSIO_REFLECT(Numbers, u64, i64, u32)
   };

   struct PassThrough
   {
      std::string      name;
      psio::json_value data;
      PSIO_REFLECT(PassThrough, name, data)
   };

   constexpr std::string_view publicKeyPem =
       "-----BEGIN PUBLIC KEY-----\n"
       "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEWdALpn+cGuD1klsSRXTdapYlG5mu\n"
       "WgoALofZYufL838GRUo43UuoGzxu/mW5T6r9Ix4/qc4gH2B+Zc6VYw/pKQ==\n"
       "-----END PUBLIC KEY-----\n";
}  // namespace json_test

namespace psio
{
   constexpr bool psio_is_untagged(const json_test::Extra*)
   {
      return true;
   }
}  // namespace psio

using namespace json_test;

TEST_CASE("json: an IP address is one string", "[json]")
{
   const IPAddress v4 = IPV4Address{{127, 0, 0, 1}};
   const IPAddress v6 = *parseIPAddress("::1");
   CHECK(psio::to_ijson(v4) == R"("127.0.0.1")");
   CHECK(psio::to_ijson(v6) == R"("::1")");
   CHECK(psio::from_ijson<IPAddress>(R"("127.0.0.1")") == v4);
   CHECK(psio::from_ijson<IPAddress>(R"("::1")") == v6);
   CHECK(reread<IPAddress>(R"("10.1.2.3")") == R"("10.1.2.3")");

   // Text that is not an address is reported, not aborted on.
   CHECK(reread<IPAddress>(R"("300.1.1.1")") == "error: IPAddress: not an IP address");
   CHECK(reread<IPAddress>(R"("localhost")") == "error: IPAddress: not an IP address");
   CHECK(reread<IPAddress>(R"("")") == "error: IPAddress: not an IP address");
   CHECK(reread<IPAddress>(R"("127.0.0.1:80")") == "error: IPAddress: not an IP address");
   // The variant's own text is not accepted: the adapter replaces it.
   CHECK(rejects<IPAddress>(R"({"IPV4Address":{"bytes":"7F000001"}})"));
   CHECK(rejects<IPAddress>("2130706433"));

   // On the wire it stays the variant.
   CHECK(psio::to_pssz(v4) ==
         psio::to_pssz(std::variant<IPV4Address, IPV6Address>{IPV4Address{{127, 0, 0, 1}}}));
   CHECK(psio::from_pssz<IPAddress>(psio::to_pssz(v6)) == v6);
}

TEST_CASE("json: every IPv6 text that is written is read back", "[json]")
{
   // (text, what to_string writes for the address it denotes)
   const std::pair<std::string_view, std::string_view> cases[] = {
       {"::", "::"},
       {"::1", "::1"},
       {"1::", "1::"},
       {"fe80::", "fe80::"},
       {"2001:db8::1", "2001:db8::1"},
       {"2001:0DB8:0000:0000:0000:0000:0000:0001", "2001:db8::1"},
       // The first longest run of zero groups is elided; one group is not.
       {"1:0:0:2:0:0:0:3", "1:0:0:2::3"},
       {"1:0:0:2:0:0:3:4", "1::2:0:0:3:4"},
       {"1:0:2:3:4:5:6:7", "1:0:2:3:4:5:6:7"},
       {"1:2:3:4:5:6:7::", "1:2:3:4:5:6:7:0"},
       {"fe80::1%3", "fe80::1%3"},
       {"fe80::%3", "fe80::%3"},
       {"ff02::1:ff00:42", "ff02::1:ff00:42"},
       // IPv4-mapped
       {"::ffff:192.168.1.2", "::ffff:192.168.1.2"},
       {"::ffff:c0a8:102", "::ffff:192.168.1.2"},
       {"::ffff:1.2.3.4%7", "::ffff:1.2.3.4%7"},
   };
   for (const auto& [text, written] : cases)
   {
      INFO(text);
      const auto address = parseIPV6Address(text);
      REQUIRE(address.has_value());
      CHECK(to_string(*address) == written);
      CHECK(parseIPV6Address(written) == address);
      // through the text adapters, as an address and in an endpoint
      const std::string json = '"' + std::string(written) + '"';
      CHECK(psio::to_ijson(IPAddress{*address}) == json);
      CHECK(psio::from_ijson<IPAddress>(json) == IPAddress{*address});
      const SocketEndpoint endpoint = IPV6Endpoint{*address, 80};
      const std::string    endpointJson = "\"[" + std::string(written) + "]:80\"";
      CHECK(psio::to_ijson(endpoint) == endpointJson);
      CHECK(psio::from_ijson<SocketEndpoint>(endpointJson) == endpoint);
   }
   CHECK(parseIPV6Address("2001:db8::1")->bytes[1] == 0x01);
   CHECK(parseIPV6Address("1::2")->bytes[1] == 1);
   CHECK(parseIPV6Address("1::2")->bytes[15] == 2);
   CHECK(psio::from_ijson<SocketEndpoint>(R"("[::]:80")") ==
         SocketEndpoint{IPV6Endpoint{IPV6Address{{}, 0}, 80}});
   CHECK(reread<SocketEndpoint>(R"("[fe80::1%2]:443")") == R"("[fe80::1%2]:443")");

   for (std::string_view wrong :
        {":", ":::", "1:2", "1:", "1:2:3:4:5:6:7", "1:2:3:4:5:6:7:8:9", "1:2:3:4:5:6:7:8::",
         "1::2::3", "12345::", "g::", "1::x", "1:2:3:4:5:6:7:8%", "::1%x", "::1]", "[::1]",
         "::ffff:1.2.3", "::ffff:1.2.3.4.5", "::ffff:1.2.3.4:5", "1:2:3:4:5:6:7:1.2.3.4",
         "1.2.3", "1.2.3.4.5", "1.2.3.256", " 1.2.3.4", "1.2.3.4 ", "+1.2.3.4"})
   {
      INFO(wrong);
      CHECK(!parseIPAddress(wrong));
      CHECK(reread<IPAddress>('"' + std::string(wrong) + '"') ==
            "error: IPAddress: not an IP address");
   }
   // Text that is not an IP endpoint is the path of a local socket
   CHECK(psio::from_ijson<SocketEndpoint>(R"("[::1]")") == SocketEndpoint{LocalEndpoint{"[::1]"}});
   CHECK(psio::from_ijson<SocketEndpoint>(R"("[:::]:80")") ==
         SocketEndpoint{LocalEndpoint{"[:::]:80"}});
}

TEST_CASE("json: a socket endpoint is one string", "[json]")
{
   const SocketEndpoint v4    = IPV4Endpoint{IPV4Address{{127, 0, 0, 1}}, 8080};
   const SocketEndpoint v6    = *parseIPV6Endpoint("[::1]:8080");
   const SocketEndpoint local = LocalEndpoint{"/run/psinode.sock"};
   CHECK(psio::to_ijson(v4) == R"("127.0.0.1:8080")");
   CHECK(psio::to_ijson(v6) == R"("[::1]:8080")");
   CHECK(psio::to_ijson(local) == R"("/run/psinode.sock")");
   CHECK(psio::from_ijson<SocketEndpoint>(R"("127.0.0.1:8080")") == v4);
   CHECK(psio::from_ijson<SocketEndpoint>(R"("[::1]:8080")") == v6);
   CHECK(psio::from_ijson<SocketEndpoint>(R"("/run/psinode.sock")") == local);
   // Text that is not an IP endpoint is the path of a local socket: no
   // string is refused.
   CHECK(psio::from_ijson<SocketEndpoint>(R"("127.0.0.1")") ==
         SocketEndpoint{LocalEndpoint{"127.0.0.1"}});
   CHECK(psio::from_ijson<SocketEndpoint>(R"("127.0.0.1:99999")") ==
         SocketEndpoint{LocalEndpoint{"127.0.0.1:99999"}});
   // Anything but a string is.
   CHECK(rejects<SocketEndpoint>("8080"));
   CHECK(rejects<SocketEndpoint>(R"({"LocalEndpoint":{"path":"x"}})"));

   // As members of a record, the optional one null or left out.
   CHECK(psio::to_ijson(Peer{IPV4Address{{10, 0, 0, 1}}, v4}) ==
         R"({"address":"10.0.0.1","endpoint":"127.0.0.1:8080"})");
   CHECK(reread<Peer>(R"({"address":"10.0.0.1"})") == R"({"address":"10.0.0.1","endpoint":null})");
   CHECK(reread<Peer>(R"({"address":"nowhere"})") == "error: IPAddress: not an IP address");

   CHECK(psio::to_pssz(v4) == psio::to_pssz(std::variant<IPV4Endpoint, IPV6Endpoint, LocalEndpoint>{
                                  IPV4Endpoint{IPV4Address{{127, 0, 0, 1}}, 8080}}));
}

TEST_CASE("json: a public key is its PEM text", "[json]")
{
   using SystemService::AuthSig::SubjectPublicKeyInfo;

   const auto der = pemDecode(publicKeyPem, "PUBLIC KEY");
   REQUIRE(der.has_value());
   CHECK(der->size() == 91);
   CHECK(hasSubjectPublicKeyInfoShape(*der));
   CHECK(pemEncode(*der, "PUBLIC KEY") == publicKeyPem);

   const SubjectPublicKeyInfo key{*der};
   const std::string          json = psio::to_ijson(std::string{publicKeyPem});
   CHECK(psio::to_ijson(key) == json);
   CHECK(psio::from_ijson<SubjectPublicKeyInfo>(json) == key);
   // White space around the armor and inside the body is not significant.
   CHECK(
       psio::from_ijson<SubjectPublicKeyInfo>(
           R"("  -----BEGIN PUBLIC KEY-----MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEWdALpn+cGuD1klsSRXTdapYlG5mu\r\n)"
           R"(WgoALofZYufL838GRUo43UuoGzxu/mW5T6r9Ix4/qc4gH2B+Zc6VYw/pKQ==-----END PUBLIC KEY-----")") ==
       key);

   // Packed, it is its DER bytes, whatever they are.
   CHECK(psio::to_pssz(key) == psio::to_pssz(*der));

   // Text that is not a PEM public key is reported with a message.
   constexpr std::string_view notPem = "error: SubjectPublicKeyInfo: not a PEM encoded public key";
   constexpr std::string_view notKey =
       "error: SubjectPublicKeyInfo: the PEM content is not a SubjectPublicKeyInfo";
   CHECK(reread<SubjectPublicKeyInfo>(R"("")") == notPem);
   CHECK(reread<SubjectPublicKeyInfo>(R"("garbage")") == notPem);
   CHECK(reread<SubjectPublicKeyInfo>(R"("-----BEGIN PUBLIC KEY-----")") == notPem);
   CHECK(reread<SubjectPublicKeyInfo>(
             R"("-----BEGIN PRIVATE KEY-----\nMFkw\n-----END PRIVATE KEY-----\n")") == notPem);
   CHECK(reread<SubjectPublicKeyInfo>(
             R"("-----BEGIN PUBLIC KEY-----\n!!!!\n-----END PUBLIC KEY-----\n")") == notPem);
   CHECK(reread<SubjectPublicKeyInfo>(
             R"("-----BEGIN PUBLIC KEY-----\nMFkw\n-----END PUBLIC KEY-----\ntrailing")") ==
         notPem);
   // The hex of the DER bytes (the JSON of the wire type) is not the text.
   CHECK(reread<SubjectPublicKeyInfo>(R"("3059")") == notPem);
   // Valid armor around bytes that are not SEQUENCE { SEQUENCE { OID … }, BIT STRING }
   CHECK(reread<SubjectPublicKeyInfo>(
             R"("-----BEGIN PUBLIC KEY-----\nAQID\n-----END PUBLIC KEY-----\n")") == notKey);
   auto reencode = [&](std::vector<unsigned char> bytes)
   { return psio::to_ijson(pemEncode(bytes, "PUBLIC KEY")); };
   auto truncated = *der;
   truncated.pop_back();
   CHECK(reread<SubjectPublicKeyInfo>(reencode(truncated)) == notKey);
   auto extended = *der;
   extended.push_back(0);
   CHECK(reread<SubjectPublicKeyInfo>(reencode(extended)) == notKey);
   auto noBitString = *der;
   noBitString[23]  = 0x04;  // the key as an OCTET STRING
   CHECK(reread<SubjectPublicKeyInfo>(reencode(noBitString)) == notKey);
   CHECK(!hasSubjectPublicKeyInfoShape({}));
}

TEST_CASE("json: DbId is its name; its bytes are a u32", "[json]")
{
   CHECK(psio::to_ijson(DbId::service) == R"("service")");
   CHECK(psio::to_ijson(DbId::writeOnly) == R"("writeOnly")");
   CHECK(psio::to_ijson(DbId::native) == R"("native")");
   CHECK(psio::to_ijson(DbId::blockLog) == R"("blockLog")");
   CHECK(psio::to_ijson(DbId::blockProof) == R"("blockProof")");
   CHECK(psio::to_ijson(DbId::prevAuthServices) == R"("prevAuthServices")");
   CHECK(psio::to_ijson(DbId::subjective) == R"("subjective")");
   CHECK(psio::to_ijson(DbId::nativeSubjective) == R"("nativeSubjective")");
   CHECK(psio::to_ijson(DbId::session) == R"("session")");
   CHECK(psio::to_ijson(DbId::nativeSession) == R"("nativeSession")");
   CHECK(psio::to_ijson(DbId::temporary) == R"("temporary")");
   // The range markers are the databases they alias; the count has no name.
   CHECK(psio::to_ijson(DbId::beginIndependent) == R"("subjective")");
   CHECK(psio::to_ijson(DbId::endPersistent) == R"("session")");
   CHECK(psio::to_ijson(DbId::endIndependent) == R"("temporary")");
   CHECK(psio::to_ijson(DbId::numChainDatabases) == "6");

   // The name or the number is read.
   CHECK(psio::from_ijson<DbId>(R"("subjective")") == DbId::subjective);
   CHECK(psio::from_ijson<DbId>("64") == DbId::subjective);
   CHECK(psio::from_ijson<DbId>("0") == DbId::service);
   CHECK(psio::from_ijson<DbId>(R"("temporary")") == DbId::temporary);
   CHECK(rejects<DbId>(R"("numChainDatabases")"));
   CHECK(rejects<DbId>(R"("endPersistent")"));
   CHECK(rejects<DbId>(R"("Service")"));
   CHECK(rejects<DbId>("-1"));

   // PSSZ and key: the u32, as before.
   CHECK(psio::to_pssz(DbId::subjective) == psio::to_pssz(std::uint32_t{64}));
   CHECK(psio::to_pssz(std::tuple{DbId::temporary, std::uint8_t{1}}) ==
         psio::to_pssz(std::tuple{std::uint32_t{68}, std::uint8_t{1}}));
   CHECK(psio::to_key(DbId::nativeSession) == psio::to_key(std::uint32_t{67}));
   CHECK(psio::from_pssz<DbId>(psio::to_pssz(std::uint32_t{6})) == DbId::numChainDatabases);
}

TEST_CASE("json: NewAccountMode is its name and one of three values", "[json]")
{
   using SystemService::NewAccountMode;
   CHECK(psio::to_ijson(NewAccountMode::keepExisting) == R"("keepExisting")");
   CHECK(psio::to_ijson(NewAccountMode::matchExisting) == R"("matchExisting")");
   CHECK(psio::to_ijson(NewAccountMode::requireNew) == R"("requireNew")");
   CHECK(psio::from_ijson<NewAccountMode>(R"("requireNew")") == NewAccountMode::requireNew);
   CHECK(psio::from_ijson<NewAccountMode>("1") == NewAccountMode::matchExisting);
   CHECK(reread<NewAccountMode>("3") == "error: mode out of range");
   CHECK(rejects<NewAccountMode>(R"("other")"));

   // Its byte is unchanged; a value that is no mode is not valid packed either.
   CHECK(psio::to_pssz(NewAccountMode::requireNew) == psio::to_pssz(std::uint8_t{2}));
   CHECK(psio::validate_pssz<NewAccountMode>(psio::to_pssz(std::uint8_t{2})).ok());
   CHECK(!psio::validate_pssz<NewAccountMode>(psio::to_pssz(std::uint8_t{3})).ok());

   // An enum that is not reflected is its number.
   CHECK(psio::to_ijson(HttpStatus::notFound) == "404");
   CHECK(psio::from_ijson<HttpStatus>("200") == HttpStatus::ok);
   CHECK(rejects<HttpStatus>(R"("ok")"));
}

TEST_CASE("json: a request record with members a client may leave out", "[json]")
{
   CHECK(reread<Shutdown>(R"({"reason":"x"})") == R"({"restart":null,"force":null,"reason":"x"})");
   CHECK(reread<Shutdown>(R"({"restart":true,"reason":"x","force":null})") ==
         R"({"restart":true,"force":null,"reason":"x"})");
   const auto request = psio::from_ijson<Shutdown>(R"({"reason":"x","force":false})");
   CHECK(!request.restart.value_or(false));
   CHECK(request.force.has_value());
   // A member that is not optional must be there; the error names it.
   CHECK(reread<Shutdown>("{}") == R"(error: json: missing required member "reason" of Shutdown)");
   // A member the record does not know is skipped, whatever it holds.
   CHECK(reread<Shutdown>(R"({"later":[1,{"a":null}],"reason":"x"})") ==
         R"({"restart":null,"force":null,"reason":"x"})");
   // A member of the wrong kind is an error.
   CHECK(rejects<Shutdown>(R"({"restart":"true","reason":"x"})"));
}

TEST_CASE("json: a string or a list of strings, untagged", "[json]")
{
   using Options = std::map<std::string, Extra>;
   const Options options{{"host", Extra{std::vector<std::string>{"a.example", "b.example"}}},
                         {"p2p", Extra{"on"}}};
   CHECK(psio::to_ijson(options) == R"({"host":["a.example","b.example"],"p2p":"on"})");
   CHECK(psio::from_ijson<Options>(R"({"p2p":"on","host":["a.example","b.example"]})") == options);
   CHECK(psio::from_ijson<Extra>(R"("s")") == Extra{"s"});
   CHECK(psio::from_ijson<Extra>("[]") == Extra{std::vector<std::string>{}});
   // Neither a string nor a list of strings
   CHECK(rejects<Extra>("true"));
   CHECK(rejects<Extra>("1"));
   CHECK(rejects<Extra>(R"(["a",true])"));
   CHECK(rejects<Extra>(R"({"string":"s"})"));
}

TEST_CASE("json: number forms", "[json]")
{
   // 64-bit integers are bare up to 2^53 - 1 and decimal strings beyond.
   CHECK(psio::to_ijson(Numbers{9007199254740991u, -9007199254740991, 4294967295u}) ==
         R"({"u64":9007199254740991,"i64":-9007199254740991,"u32":4294967295})");
   CHECK(psio::to_ijson(Numbers{9007199254740992u, -9007199254740992, 0}) ==
         R"({"u64":"9007199254740992","i64":"-9007199254740992","u32":0})");
   CHECK(psio::to_ijson(Numbers{18446744073709551615u, 0, 0}) ==
         R"({"u64":"18446744073709551615","i64":0,"u32":0})");
   // Both forms are read for a 64-bit integer, whatever the value.
   CHECK(reread<Numbers>(R"({"u64":"7","i64":"-7","u32":7})") == R"({"u64":7,"i64":-7,"u32":7})");
   CHECK(reread<Numbers>(R"({"u64":"18446744073709551615","i64":0,"u32":0})") ==
         R"({"u64":"18446744073709551615","i64":0,"u32":0})");
   // A bare number beyond 2^53 - 1 could not have been written exactly.
   CHECK(rejects<Numbers>(R"({"u64":9007199254740992,"i64":0,"u32":0})"));
   CHECK(rejects<Numbers>(R"({"u64":"18446744073709551616","i64":0,"u32":0})"));
   // A narrower integer is a number only.
   CHECK(rejects<Numbers>(R"({"u64":0,"i64":0,"u32":"7"})"));
   CHECK(rejects<Numbers>(R"({"u64":0,"i64":0,"u32":4294967296})"));
   CHECK(rejects<Numbers>(R"({"u64":0,"i64":0,"u32":1.0})"));
}

TEST_CASE("json: any JSON passes through with its number text", "[json]")
{
   constexpr std::string_view text =
       R"({"name":"n","data":{"a":1.50,"big":18446744073709551616,"e":1e3,"list":[true,null,"s",-0],"o":{}}})";
   auto value = psio::from_ijson<PassThrough>(text);
   CHECK(psio::to_ijson(value) == text);
   CHECK(value.data.find("a")->as_number()->text == "1.50");
   CHECK(!value.data.find("big")->as_number()->as_uint64().has_value());
   CHECK(value.data.find("e")->as_number()->as_double() == 1000.0);
   value.data.set("added", std::uint32_t{7});
   value.data.erase("list");
   CHECK(psio::to_ijson(value.data) ==
         R"({"a":1.50,"big":18446744073709551616,"e":1e3,"o":{},"added":7})");
   // Members keep the order they were written in.
   CHECK(reread<psio::json_value>(R"({"z":1,"a":2})") == R"({"z":1,"a":2})");
   CHECK(rejects<psio::json_value>(R"({"z":1,)"));
   // The member itself is required; null is a value.
   CHECK(rejects<PassThrough>(R"({"name":"n"})"));
   CHECK(reread<PassThrough>(R"({"name":"n","data":null})") == R"({"name":"n","data":null})");
}

TEST_CASE("json: a signed transaction holds its transaction as an object", "[json]")
{
   Transaction trx{
       .tapos   = {.expiration     = TimePointSec{Seconds{1700000000}},
                   .refBlockSuffix = 0x01020304,
                   .flags          = 0,
                   .refBlockIndex  = 7},
       .actions = {Action{.sender  = AccountNumber{"alice"},
                          .service = AccountNumber{"tokens"},
                          .method  = MethodNumber{"credit"},
                          .rawData = {1, 2, 0x7f}}},
       .claims  = {Claim{.service = AccountNumber{"verify-sig"}, .rawData = {5, 6}}},
   };
   constexpr std::string_view trxText =
       R"({"tapos":{"expiration":"2023-11-14T22:13:20Z","refBlockSuffix":16909060,"flags":0,"refBlockIndex":7},)"
       R"("actions":[{"sender":"alice","service":"tokens","method":"credit","rawData":"01027F"}],)"
       R"("claims":[{"service":"verify-sig","rawData":"0506"}]})";
   CHECK(psio::to_ijson(trx) == trxText);
   CHECK(psio::to_pssz(psio::from_ijson<Transaction>(trxText)) == psio::to_pssz(trx));

   SignedTransaction signedTrx{.transaction = psio::shared_pssz<Transaction>{trx},
                               .proofs      = {{7, 7}}};
   const std::string signedText =
       R"({"transaction":)" + std::string{trxText} + R"(,"proofs":["0707"],"subjectiveData":null})";
   CHECK(psio::to_ijson(signedTrx) == signedText);
   CHECK(psio::to_pssz(psio::from_ijson<SignedTransaction>(signedText)) ==
         psio::to_pssz(signedTrx));
   // `subjectiveData` may be left out; lower-case hex is read.
   CHECK(psio::to_pssz(psio::from_ijson<SignedTransaction>(
             R"({"transaction":)" + std::string{trxText} + R"(,"proofs":["0707"]})")) ==
         psio::to_pssz(signedTrx));
   CHECK(psio::to_pssz(psio::from_ijson<Claim>(R"({"service":"verify-sig","rawData":"0a0B"})")) ==
         psio::to_pssz(Claim{AccountNumber{"verify-sig"}, {0x0a, 0x0b}}));
   // The hex of the packed transaction, which the legacy JSON held, is not
   // the member's text any more.
   const std::string legacy =
       R"({"transaction":")" + psio::to_hex(psio::to_pssz(trx)) + R"(","proofs":["0707"]})";
   CHECK(rejects<SignedTransaction>(legacy));
   // `Tapos` is a fixed record: each of its members must be given.
   CHECK(
       reread<Transaction>(
           R"({"tapos":{"expiration":"2023-11-14T22:13:20Z","refBlockSuffix":1,"refBlockIndex":7},"actions":[],"claims":[]})") ==
       R"(error: json: missing required member "flags" of Tapos)");
   // Account names are strict: one text per account.
   CHECK(rejects<Claim>(R"({"service":"Verify-Sig","rawData":""})"));
}
