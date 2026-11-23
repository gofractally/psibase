// The types that psibase declares in both C++ and Rust, as C++ declares them:
// their Schema IR and sample values in pSSZ, key and I-JSON form, written as
// one fixture, `rust-twins.json`, beside this file.
//
// This test fails when the fixture is not what the C++ declarations give
// (set PSIBASE_WRITE_RUST_TWINS=1 to rewrite it). The Rust test
// `rust/psibase/tests/psio_twins.rs` reads the same file and requires the
// Rust declaration of each type to have the same schema, to read every
// value, and to write the same bytes, key and text. The two languages are
// therefore compared through one file that neither can change alone.
//
// Native only (it reads and writes a file of the source tree).
#include <psibase/AccountNumber.hpp>
#include <psibase/Memo.hpp>
#include <psibase/MethodNumber.hpp>
#include <psibase/Rpc.hpp>
#include <psibase/SnapshotHeader.hpp>
#include <psibase/SocketInfo.hpp>
#include <psibase/block.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/trace.hpp>
#include <services/system/AuthDelegate.hpp>
#include <services/system/SetCode.hpp>
#include <services/system/StagedTx.hpp>
#include <services/user/Packages.hpp>
#include <services/user/tokenTypes.hpp>

#include <psio/emit_pssz.hpp>
#include <psio/helpers.hpp>
#include <psio/json.hpp>
#include <psio/key.hpp>
#include <psio/pssz.hpp>
#include <psio/schema_builder.hpp>

#include <catch2/catch_all.hpp>

#include <cstdlib>
#include <fstream>
#include <limits>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

// Services that are declared in both languages, as interfaces: their
// functions are the methods PSIO_REFLECT lists. The name is the account the
// service runs on, which is what the Rust service macro knows it by.
namespace twins
{
   using SetCode      = SystemService::SetCode;
   using AuthDelegate = SystemService::AuthDelegate;
   PSIO_INTERFACE(SetCode, types(), name("setcode"))
   PSIO_INTERFACE(AuthDelegate, types(), name("auth-delg"))
}  // namespace twins

namespace
{
   template <typename Bytes>
   std::string hex(const Bytes& bytes)
   {
      static const char digits[] = "0123456789abcdef";
      std::string       out;
      for (unsigned char c : bytes)
      {
         out += digits[c >> 4];
         out += digits[c & 15];
      }
      return out;
   }

   // A JSON string holding `text`.
   std::string jsonString(std::string_view text)
   {
      std::string out = "\"";
      for (char c : text)
      {
         if (c == '"' || c == '\\')
            out += '\\';
         out += c;
      }
      return out + "\"";
   }

   // The arguments of a method as they are packed: each parameter as the
   // type it is on the wire.
   template <typename... P>
   std::tuple<psio::wire_type_t<P>...> wireTuple(std::tuple<P...>*);

   struct Fixture
   {
      psio::SchemaBuilder builder;
      std::string         vectors;
      std::string         calls;

      // The arguments of a call of `Method`, as psibase packs them: the
      // tuple of the method's parameter types.
      template <auto Method, typename... Args>
      void call(std::string_view interface, std::string_view method, Args&&... args)
      {
         decltype(wireTuple((typename psio::method_traits<decltype(Method)>::params*)nullptr))
             tuple{std::forward<Args>(args)...};
         if (!calls.empty())
            calls += ",\n";
         calls += "{\"interface\":" + jsonString(interface) + ",\"method\":" + jsonString(method) +
                  ",\"pssz\":" + jsonString(hex(psio::to_pssz(tuple))) + "}";
      }

      template <typename T>
      void add(std::string_view name, const std::vector<T>& values)
      {
         builder.insert<T>(std::string{name});
         for (const auto& value : values)
         {
            if (!vectors.empty())
               vectors += ",\n";
            vectors += "{\"type\":" + jsonString(name) +
                       ",\"pssz\":" + jsonString(hex(psio::to_pssz(value))) +
                       ",\"key\":" + jsonString(hex(psio::to_key(value))) +
                       ",\"ijson\":" + jsonString(psio::to_ijson(value)) + "}";
         }
      }

      std::string text() &&
      {
         return "{\n\"schema_ir\":" + jsonString(hex(psio::emit_pssz(std::move(builder).build()))) +
                ",\n\"vectors\":[\n" + vectors + "\n],\n\"calls\":[\n" + calls + "\n]\n}\n";
      }
   };

   std::string build()
   {
      using namespace psibase;
      using UserService::Decimal;
      using UserService::PackageExport;
      using UserService::PackageRef;
      using UserService::Precision;
      using UserService::Quantity;
      constexpr auto max64 = std::numeric_limits<std::uint64_t>::max();

      Fixture f;

      // Names.
      f.add<AccountNumber>("AccountNumber", {AccountNumber{}, AccountNumber{"alice"},
                                             AccountNumber{"a-b-c"}, AccountNumber{"zzzzzzzzzz"},
                                             AccountNumber{"alice+7"}, AccountNumber{"alice+255"}});
      f.add<MethodNumber>("MethodNumber",
                          {MethodNumber{}, MethodNumber{"transfer"}, MethodNumber{"setcode"},
                           MethodNumber{"someVeryLongMethodNameThatHashes"}});

      // Wrappers and token amounts.
      f.add<Memo>("Memo", {Memo{}, Memo{"hello"}, Memo{std::string(80, 'm')},
                           Memo{"gr\xc3\xbc\xc3\x9f dich"}});
      f.add<Precision>("Precision", {Precision{0}, Precision{4}, Precision{8}});
      auto quantity = [](std::uint64_t value) { return Quantity{value}; };
      f.add<Quantity>("Quantity", {quantity(0), quantity(1), quantity(1'0000), quantity(max64)});
      f.add<Decimal>(
          "Decimal",
          {Decimal{quantity(0), Precision{0}}, Decimal{quantity(15), Precision{1}},
           Decimal{quantity(1'0000), Precision{4}}, Decimal{quantity(max64), Precision{8}}});

      // Core records.
      f.add<BlockHeaderCode>("BlockHeaderCode",
                             {BlockHeaderCode{}, BlockHeaderCode{1, 2, {0x00, 0x61, 0x73, 0x6d}}});
      f.add<HttpHeader>("HttpHeader",
                        {HttpHeader{}, HttpHeader{"Content-Type", "application/json"}});
      f.add<VMOptions>("VMOptions", {VMOptions{}, VMOptions{1, 2, 3, 4}});
      f.add<WasmConfigRow>("WasmConfigRow",
                           {WasmConfigRow{}, WasmConfigRow{32, VMOptions{1, 2, 3, 4}}});
      f.add<ConsensusChangeRow>("ConsensusChangeRow",
                                {ConsensusChangeRow{}, ConsensusChangeRow{1, 2, 0xfffffffe}});
      f.add<ScheduledSnapshotRow>("ScheduledSnapshotRow",
                                  {ScheduledSnapshotRow{}, ScheduledSnapshotRow{77}});
      f.add<LogTruncateRow>("LogTruncateRow", {LogTruncateRow{}, LogTruncateRow{9}});
      f.add<IPV4Address>("IPV4Address", {IPV4Address{}, IPV4Address{{127, 0, 0, 1}}});
      f.add<IPV6Address>(
          "IPV6Address",
          {IPV6Address{}, IPV6Address{{0xfe, 0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1}, 3}});
      f.add<IPV4Endpoint>("IPV4Endpoint",
                          {IPV4Endpoint{}, IPV4Endpoint{IPV4Address{{10, 0, 0, 2}}, 8080}});
      f.add<IPV6Endpoint>(
          "IPV6Endpoint",
          {IPV6Endpoint{},
           IPV6Endpoint{IPV6Address{{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1}, 0}, 443}});
      f.add<LocalEndpoint>("LocalEndpoint", {LocalEndpoint{}, LocalEndpoint{"/tmp/psinode.sock"}});
      f.add<TLSInfo>("TLSInfo", {TLSInfo{}});
      f.add<ServiceMethod>("ServiceMethod",
                           {ServiceMethod{}, ServiceMethod{AccountNumber{"transact"},
                                                           MethodNumber{"startsession"}}});
      f.add<EnvRow>("EnvRow", {EnvRow{}, EnvRow{"PATH", "/usr/bin"}});
      f.add<HostConfigRow>("HostConfigRow", {HostConfigRow{}, HostConfigRow{"1.2.3", "{\"a\":1}"}});
      f.add<PendingShutdownRow>("PendingShutdownRow",
                                {PendingShutdownRow{}, PendingShutdownRow{"[\"restart\"]"}});
      f.add<PackageRef>("PackageRef", {PackageRef{}, PackageRef{"Tokens", "^1.0.0"}});
      f.add<PackageExport>("PackageExport",
                           {PackageExport{}, PackageExport{"tokens", AccountNumber{"tokens"}}});
      f.add<ConsoleTrace>("ConsoleTrace", {ConsoleTrace{}, ConsoleTrace{"hello\n"}});

      // Byte sequences: what Rust's `Hex<T>` wraps. `Bytes` is the member type
      // most C++ records use, a `std::vector<char>`; `Octets` holds
      // `unsigned char`, as `CodeByHashRow::code` does.
      const Checksum256 digest = {0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a,
                                  0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0xf0, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5,
                                  0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xfb, 0xfc, 0xfd, 0xfe, 0xff};
      const std::vector<char> bytes = {'\x00', '\x01', '\x7f', '\x80', '\xff'};
      f.add<Checksum256>("Checksum256", {Checksum256{}, digest});
      f.add<std::vector<char>>("Bytes", {{}, bytes});
      f.add<std::vector<std::uint8_t>>("Octets", {{}, {0x00, 0x01, 0x7f, 0x80, 0xff}});

      // Core records that hold byte sequences.
      const Action action{AccountNumber{"alice"}, AccountNumber{"tokens"}, MethodNumber{"credit"},
                          bytes};
      const Claim  claim{AccountNumber{"verify-sig"}, bytes};
      const GenesisService genesisService{AccountNumber{"transact"}, 3, 1, 1, bytes};
      const Producer       producer{AccountNumber{"prod1"}, claim};
      f.add<Action>("Action", {Action{}, action});
      f.add<GenesisService>("GenesisService", {GenesisService{}, genesisService});
      f.add<GenesisActionData>("GenesisActionData",
                               {GenesisActionData{}, GenesisActionData{"boot", {genesisService}}});
      f.add<Claim>("Claim", {Claim{}, claim});
      f.add<Producer>("Producer", {Producer{}, producer});
      f.add<CftConsensus>("CftConsensus", {CftConsensus{}, CftConsensus{{producer, Producer{}}}});
      f.add<BftConsensus>("BftConsensus", {BftConsensus{}, BftConsensus{{producer}}});
      f.add<BlockHeaderAuthAccount>(
          "BlockHeaderAuthAccount",
          {BlockHeaderAuthAccount{}, BlockHeaderAuthAccount{AccountNumber{"verify-sig"}, digest, 1, 1}});
      f.add<HttpRequest>(
          "HttpRequest",
          {HttpRequest{},
           HttpRequest{"psibase.localhost", "POST", "/graphql?x=1", "application/json",
                       {HttpHeader{"Accept", "*/*"}}, {'{', '}'}}});
      f.add<HttpReply>("HttpReply",
                       {HttpReply{}, HttpReply{HttpStatus::notFound, "text/html", {'n', 'o'},
                                               {HttpHeader{"Cache-Control", "no-store"}}}});
      f.add<CodeRow>("CodeRow", {CodeRow{}, CodeRow{AccountNumber{"transact"}, CodeRow::isPrivileged,
                                                    digest, 1, 1}});
      f.add<CodeByHashRow>("CodeByHashRow",
                           {CodeByHashRow{}, CodeByHashRow{digest, 1, 1, {0x00, 0x61, 0x73, 0x6d}}});
      f.add<BlockDataRow>("BlockDataRow",
                          {BlockDataRow{}, BlockDataRow{digest, std::nullopt},
                           BlockDataRow{digest, bytes}});
      const snapshot::StateChecksum  stateChecksum{digest, Checksum256{}};
      const snapshot::StateSignature stateSignature{AccountNumber{"prod1"}, claim, bytes};
      const SnapshotStateItem        stateItem{stateChecksum, {stateSignature}};
      f.add<snapshot::StateChecksum>("StateChecksum", {snapshot::StateChecksum{}, stateChecksum});
      f.add<snapshot::StateSignature>("StateSignature",
                                      {snapshot::StateSignature{}, stateSignature});
      f.add<SnapshotStateItem>("SnapshotStateItem", {SnapshotStateItem{}, stateItem});
      f.add<SnapshotRow>("SnapshotRow",
                         {SnapshotRow{}, SnapshotRow{digest, stateItem, {stateItem, SnapshotStateItem{}}}});

      // Rows whose Rust declaration had fallen behind this one.
      f.add<ConfigRow>("ConfigRow", {ConfigRow{}, ConfigRow{1, 2, 3}});
      f.add<LogMessage>("LogMessage",
                        {LogMessage{}, LogMessage{.message  = "started",
                                                  .severity = LogMessage::Severity::warning,
                                                  .service  = AccountNumber{"transact"}}});
      f.add<NotifyRow>("NotifyRow", {NotifyRow{}, NotifyRow{NotifyType::acceptTransaction, {action}}});
      f.add<RunMode>("RunMode", {RunMode::verify, RunMode::speculative, RunMode::rpc,
                                 RunMode::callback});

      // Records of services that are implemented in Rust and mirrored in a C++
      // header.
      f.add<SystemService::Response>(
          "Response",
          {SystemService::Response{},
           SystemService::Response{7, AccountNumber{"alice"}, 0x0102030405060708, true}});

      // Services: the interface (functions, parameter names and types,
      // results) and the arguments of sample calls.
      using SystemService::AuthDelegate;
      using SystemService::NewAccountMode;
      using SystemService::SetCode;
      const AccountNumber alice{"alice"}, bob{"bob"};
      f.builder.insert_interface<twins::SetCode>();
      f.builder.insert_interface<twins::AuthDelegate>();
      f.call<&SetCode::init>("setcode", "init");
      f.call<&SetCode::setCode>("setcode", "setCode", alice, 1, 1, bytes);
      f.call<&SetCode::stageCode>("setcode", "stageCode", alice, 7, 1, 1, bytes);
      f.call<&SetCode::unstageCode>("setcode", "unstageCode", alice, 7);
      f.call<&SetCode::setCodeStaged>("setcode", "setCodeStaged", alice, 7, 1, 1, digest);
      f.call<&SetCode::setFlags>("setcode", "setFlags", alice, CodeRow::isPrivileged);
      f.call<&SetCode::verifySeq>("setcode", "verifySeq");
      f.call<&SetCode::defaultVmVersion>("setcode", "defaultVmVersion");
      f.call<&SetCode::setDefaultVmVersion>("setcode", "setDefaultVmVersion", 1);
      f.call<&AuthDelegate::checkAuthSys>(
          "auth-delg", "checkAuthSys", 3, alice,
          ServiceMethod{AccountNumber{"tokens"}, MethodNumber{"credit"}}, std::vector{claim, Claim{}});
      f.call<&AuthDelegate::canAuthUserSys>("auth-delg", "canAuthUserSys", alice);
      f.call<&AuthDelegate::getDlgsSys>("auth-delg", "getDlgsSys", alice);
      f.call<&AuthDelegate::isAuthSys>("auth-delg", "isAuthSys", alice, std::vector{alice, bob});
      f.call<&AuthDelegate::isRejectSys>("auth-delg", "isRejectSys", alice,
                                         std::vector<AccountNumber>{});
      f.call<&AuthDelegate::setOwner>("auth-delg", "setOwner", bob);
      f.call<&AuthDelegate::newAccount>("auth-delg", "newAccount", alice, bob,
                                        NewAccountMode::requireNew);
      f.call<&AuthDelegate::getOwner>("auth-delg", "getOwner", alice);
      f.call<&AuthDelegate::checkOwner>("auth-delg", "checkOwner", alice);

      return std::move(f).text();
   }
}  // namespace

TEST_CASE("The fixture of the types Rust also declares is current", "[twins]")
{
   const std::string path     = PSIBASE_RUST_TWINS_FIXTURE;
   const std::string expected = build();
   if (std::getenv("PSIBASE_WRITE_RUST_TWINS"))
   {
      std::ofstream{path, std::ios::binary} << expected;
   }
   std::ifstream     in{path, std::ios::binary};
   std::stringstream committed;
   committed << in.rdbuf();
   // Not CHECK(a == b): on a mismatch Catch would print both files.
   const bool current = committed.str() == expected;
   INFO(
       "rust-twins.json is not what the C++ declarations give; run this test with "
       "PSIBASE_WRITE_RUST_TWINS=1 and run the Rust test psio_twins");
   CHECK(current);
}
