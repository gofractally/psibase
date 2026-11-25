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
#include <psibase/crypto.hpp>
#include <psibase/db.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/schema.hpp>
#include <psibase/trace.hpp>
#include <services/local/XAdmin.hpp>
#include <services/local/XDb.hpp>
#include <services/local/XHttp.hpp>
#include <services/local/XKeys.hpp>
#include <services/local/XPackages.hpp>
#include <services/local/XPeers.hpp>
#include <services/local/XProxy.hpp>
#include <services/local/XSites.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/AuthAny.hpp>
#include <services/system/AuthDelegate.hpp>
#include <services/system/AuthNone.hpp>
#include <services/system/AuthSig.hpp>
#include <services/system/CpuLimit.hpp>
#include <services/system/Credentials.hpp>
#include <services/system/Db.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/Producers.hpp>
#include <services/system/Spki.hpp>
#include <services/system/SetCode.hpp>
#include <services/system/StagedTx.hpp>
#include <services/system/Transact.hpp>
#include <services/system/VerifyK1.hpp>
#include <services/system/VerifyR1.hpp>
#include <services/system/VirtualServer.hpp>
#include <services/system/WsAuth.hpp>
#include <services/user/DynLd.hpp>
#include <services/user/Nft.hpp>
#include <services/user/Packages.hpp>
#include <services/user/Sites.hpp>
#include <services/user/Symbol.hpp>
#include <services/user/Tokens.hpp>
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

// A sample call of `Service::method`, for the fixture `f`.
#define CALL(Service, account, method, ...)                                           \
   f.call<Service, *psio::reflect<Service>::index_of_method(#method)>(account, #method \
                                                                      __VA_OPT__(, ) __VA_ARGS__)

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

   struct Fixture
   {
      psio::SchemaBuilder builder;
      std::string         vectors;
      std::string         calls;
      std::string         names;
      std::string         transactions;

      // The methods of a service with the names of their parameters, as
      // `PSIO_REFLECT(Service, method(name, params...))` states them: the
      // names of an action's arguments in JSON.
      template <typename Service>
      void interfaceNames(std::string_view account)
      {
         using R = psio::reflect<Service>;
         std::string methods;
         R::for_each_method(
             [&](auto index, std::string_view name)
             {
                constexpr std::size_t I = decltype(index)::value;
                if (!methods.empty())
                   methods += ",";
                methods += jsonString(name) + ":[";
                bool first = true;
                for (std::string_view param : R::template method_param_names<I>)
                {
                   if (!first)
                      methods += ",";
                   first = false;
                   methods += jsonString(param);
                }
                methods += "]";
             });
         if (!names.empty())
            names += ",\n";
         names += "{\"service\":" + jsonString(account) + ",\"methods\":{" + methods + "}}";
      }

      // The arguments of a call of method `I` of `Service`, as psibase packs
      // them (`Actor`, `transactor`, the tester): the method's argument list,
      // with the cap the method declares.
      template <typename Service, std::size_t I, typename... Args>
      void call(std::string_view interface, std::string_view method, Args&&... args)
      {
         if (!calls.empty())
            calls += ",\n";
         calls += "{\"interface\":" + jsonString(interface) + ",\"method\":" + jsonString(method) +
                  ",\"pssz\":" +
                  jsonString(hex(psio::method_args_to_pssz<Service, I>(std::forward<Args>(args)...))) +
                  "}";
      }

      template <typename T>
      void add(std::string_view name, const std::vector<T>& values)
      {
         builder.insert<T>(std::string{name});
         for (const auto& value : values)
            vector(name, value, jsonString(hex(psio::to_key(value))));
      }

      // A type that is never a key (a transaction, a schema).
      template <typename T>
      void addWithoutKey(std::string_view name, const std::vector<T>& values)
      {
         builder.insert<T>(std::string{name});
         for (const auto& value : values)
            vector(name, value, "null");
      }

      template <typename T>
      void vector(std::string_view name, const T& value, const std::string& key)
      {
         if (!vectors.empty())
            vectors += ",\n";
         vectors += "{\"type\":" + jsonString(name) +
                    ",\"pssz\":" + jsonString(hex(psio::to_pssz(value))) + ",\"key\":" + key +
                    ",\"ijson\":" + jsonString(psio::to_ijson(value)) + "}";
      }

      // A transaction as a client sends it, and its id: the SHA-256 of the
      // packed `Transaction` (the content of `SignedTransaction::transaction`).
      void transaction(std::string_view name, const psibase::Transaction& trx)
      {
         psibase::SignedTransaction signedTrx{psio::shared_pssz<psibase::Transaction>{trx}};
         const auto id = psibase::sha256(signedTrx.transaction.data(), signedTrx.transaction.size());
         if (!transactions.empty())
            transactions += ",\n";
         transactions += "{\"name\":" + jsonString(name) +
                         ",\"signed\":" + jsonString(hex(psio::to_pssz(signedTrx))) +
                         ",\"id\":" + jsonString(hex(id)) +
                         ",\"ijson\":" + jsonString(psio::to_ijson(signedTrx)) + "}";
      }

      std::string text() &&
      {
         return "{\n\"schema_ir\":" + jsonString(hex(psio::emit_pssz(std::move(builder).build()))) +
                ",\n\"vectors\":[\n" + vectors + "\n],\n\"calls\":[\n" + calls +
                "\n],\n\"transactions\":[\n" + transactions + "\n],\n\"names\":[\n" + names +
                "\n]\n}\n";
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
      const Claim  claim{AccountNumber{"verify-k1"}, bytes};
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
          {BlockHeaderAuthAccount{}, BlockHeaderAuthAccount{AccountNumber{"verify-k1"}, digest, 1, 1}});
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

      // Enums that are their name in JSON, and the types that are one string
      // there (a PEM key, an address, an endpoint).
      using SystemService::NewAccountMode;
      using SystemService::AuthSig::SubjectPublicKeyInfo;
      f.add<DbId>("DbId", {DbId::service, DbId::writeOnly, DbId::native, DbId::blockLog,
                           DbId::blockProof, DbId::prevAuthServices, DbId::subjective,
                           DbId::nativeSubjective, DbId::session, DbId::nativeSession,
                           DbId::temporary});
      f.add<NewAccountMode>("NewAccountMode", {NewAccountMode::keepExisting,
                                               NewAccountMode::matchExisting,
                                               NewAccountMode::requireNew});
      // A P-256 key: the DER header of such a key and 64 bytes for the point.
      SubjectPublicKeyInfo spki{{0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48,
                                 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48,
                                 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00, 0x04}};
      for (unsigned char i = 1; i <= 64; ++i)
         spki.data.push_back(i);
      f.addWithoutKey<SubjectPublicKeyInfo>("SubjectPublicKeyInfo", {spki});
      const IPV6Address loopback6{{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1}, 0};
      f.addWithoutKey<IPAddress>("IPAddress", {IPAddress{IPV4Address{{127, 0, 0, 1}}},
                                               IPAddress{loopback6}, IPAddress{IPV6Address{}}});
      f.addWithoutKey<SocketEndpoint>(
          "SocketEndpoint",
          {SocketEndpoint{IPV4Endpoint{IPV4Address{{127, 0, 0, 1}}, 8080}},
           SocketEndpoint{IPV6Endpoint{loopback6, 8080}},
           SocketEndpoint{LocalEndpoint{"/run/psinode.sock"}}});

      // The schema of a service: the record itself (its bytes are the
      // argument of `packages::setSchema` and the installed row, its text
      // the schema files) for a service both languages declare.
      const ServiceSchema setcodeSchema = ServiceSchema::make<SystemService::SetCode>();
      f.addWithoutKey<ServiceSchema>("ServiceSchema", {ServiceSchema{}, setcodeSchema});

      // Transactions. The first is a genesis transaction (one action whose
      // arguments are the services to install); the second is a boot
      // transaction: `transact::startBoot` with the ids of the transactions
      // that follow, then calls of the services the boot sets up.
      const Tapos        tapos{TimePointSec{Seconds{1700000000}}, 0x01020304, 0, 7};
      const Transaction  genesis{Tapos{tapos.expiration, 0, 0, 0},
                                 {Action{AccountNumber{}, AccountNumber{}, MethodNumber{"boot"},
                                         psio::to_pssz(GenesisActionData{"", {genesisService}})}},
                                 {}};
      f.add<Tapos>("Tapos", {Tapos{}, tapos});
      f.addWithoutKey<Transaction>("Transaction", {Transaction{}, genesis});
      f.addWithoutKey<SignedTransaction>(
          "SignedTransaction",
          {SignedTransaction{psio::shared_pssz<Transaction>{Transaction{}}},
           SignedTransaction{psio::shared_pssz<Transaction>{genesis}},
           SignedTransaction{psio::shared_pssz<Transaction>{genesis},
                             {bytes, {}},
                             std::vector<std::vector<char>>{bytes}}});
      f.transaction("genesis", genesis);

      // Services: the interface (functions, parameter names and types,
      // results) and the arguments of sample calls.
      using SystemService::AuthDelegate;
      using SystemService::SetCode;
      const AccountNumber alice{"alice"}, bob{"bob"};
      f.builder.insert_interface<twins::SetCode>();
      f.builder.insert_interface<twins::AuthDelegate>();
      CALL(SetCode, "setcode", init);
      CALL(SetCode, "setcode", setCode, alice, 1, 1, bytes);
      CALL(SetCode, "setcode", stageCode, alice, 7, 1, 1, bytes);
      CALL(SetCode, "setcode", unstageCode, alice, 7);
      CALL(SetCode, "setcode", setCodeStaged, alice, 7, 1, 1, digest);
      CALL(SetCode, "setcode", setFlags, alice, CodeRow::isPrivileged);
      CALL(SetCode, "setcode", verifySeq);
      CALL(SetCode, "setcode", defaultVmVersion);
      CALL(SetCode, "setcode", setDefaultVmVersion, 1);
      CALL(AuthDelegate, "auth-delg", checkAuthSys, 3, alice,
          ServiceMethod{AccountNumber{"tokens"}, MethodNumber{"credit"}}, std::vector{claim, Claim{}});
      CALL(AuthDelegate, "auth-delg", canAuthUserSys, alice);
      CALL(AuthDelegate, "auth-delg", getDlgsSys, alice);
      CALL(AuthDelegate, "auth-delg", isAuthSys, alice, std::vector{alice, bob});
      CALL(AuthDelegate, "auth-delg", isRejectSys, alice,
                                         std::vector<AccountNumber>{});
      CALL(AuthDelegate, "auth-delg", setOwner, bob);
      CALL(AuthDelegate, "auth-delg", newAccount, alice, bob,
                                        NewAccountMode::requireNew);
      CALL(AuthDelegate, "auth-delg", getOwner, alice);
      CALL(AuthDelegate, "auth-delg", checkOwner, alice);

      // What a boot packs, for services implemented in C++ ...
      using LocalService::XPeers;
      using LocalService::XProxy;
      using SystemService::Accounts;
      using SystemService::HttpServer;
      using SystemService::Producers;
      using SystemService::Sites;
      using SystemService::Transact;
      using UserService::Nft;
      using UserService::Packages;
      using UserService::Tokens;
      using AuthSigService = SystemService::AuthSig::AuthSig;
      const UserService::PackageMeta meta{"Tokens",
                                          "1.0.0",
                                          "network",
                                          "Token service",
                                          {PackageRef{"Nft", "^1.0.0"}},
                                          {AccountNumber{"tokens"}, AccountNumber{"r-tokens"}},
                                          {AccountNumber{"tokens"}},
                                          {PackageExport{"tokens", AccountNumber{"tokens"}}}};
      CALL(Transact, "transact", startBoot, std::vector<Checksum256>{digest, Checksum256{}});
      CALL(Accounts, "accounts", newAccount, alice, AccountNumber{"auth-sig"},
           NewAccountMode::requireNew);
      CALL(AuthSigService, "auth-sig", newAccount, alice, spki);
      CALL(Packages, "packages", postinstall, meta, bytes);
      CALL(Packages, "packages", setSchema, setcodeSchema);
      CALL(Sites, "sites", storeSys, "/index.html", "text/html", std::optional<std::string>{"gzip"},
           bytes);
      CALL(Sites, "sites", storeSys, "/app.js", "text/javascript", std::optional<std::string>{},
           std::vector<char>{});
      CALL(Producers, "producers", setProducers, std::vector{producer});
      CALL(HttpServer, "http", registerServer, AccountNumber{"r-tokens"});
      // ... and for services implemented in Rust, through their C++ headers.
      // `credit` holds a memo (a bounded string: narrow offsets); `recall`
      // ends in an unbounded optional (wide offsets); `mint` in a bounded one.
      CALL(Tokens, "tokens", credit, 1, bob, quantity(5), Memo{"thanks"});
      CALL(Tokens, "tokens", recall, 1, alice, quantity(5), Memo{},
           std::optional<std::string>{"savings"});
      CALL(Tokens, "tokens", recall, 1, alice, quantity(5), Memo{"back"}, std::optional<std::string>{});
      CALL(Nft, "nft", mint, std::optional<UserService::NID>{});
      CALL(Nft, "nft", mint, std::optional<UserService::NID>{7});
      // The two callbacks whose argument list declares a cap.
      const HttpReply notFound{HttpStatus::notFound, "text/html", {'n', 'o'}, {}};
      CALL(XProxy, "x-proxy", onError, 7, std::optional<HttpReply>{});
      CALL(XProxy, "x-proxy", onError, 7, std::optional<HttpReply>{notFound});
      CALL(XPeers, "x-peers", errP2P, 7, std::optional<HttpReply>{});
      CALL(XPeers, "x-peers", errP2P, 7, std::optional<HttpReply>{notFound});

      // The boot transaction that follows a genesis transaction.
      {
         auto action = [](AccountNumber sender, AccountNumber service, std::string_view method,
                          std::vector<char> arguments)
         { return Action{sender, service, MethodNumber{method}, std::move(arguments)}; };
         const AccountNumber transact{"transact"}, producers{"producers"}, accounts{"accounts"};
         f.transaction(
             "boot",
             Transaction{
                 tapos,
                 {action(transact, transact, "startBoot",
                         psio::method_args_to_pssz<
                             Transact, *psio::reflect<Transact>::index_of_method("startBoot")>(
                             std::vector<Checksum256>{digest})),
                  action(producers, producers, "setProducers",
                         psio::method_args_to_pssz<
                             Producers, *psio::reflect<Producers>::index_of_method("setProducers")>(
                             std::vector{producer})),
                  action(accounts, accounts, "newAccount",
                         psio::method_args_to_pssz<
                             Accounts, *psio::reflect<Accounts>::index_of_method("newAccount")>(
                             alice, AccountNumber{"auth-any"}, NewAccountMode::requireNew))},
                 {claim}});
      }

      // Every service that has a Rust view: its methods and their parameter
      // names. The first group is implemented in C++ (C++ is the authority
      // and the Rust view mirrors it); the second is implemented in Rust and
      // mirrored by a C++ header (the Rust view is checked against the
      // header, which was renamed to the Rust service's names). Not here:
      // brotli-svc, chainmail and subgroups, whose C++ headers are not on
      // this target's include path.
      f.interfaceNames<SystemService::Accounts>("accounts");
      f.interfaceNames<SystemService::AuthAny>("auth-any");
      f.interfaceNames<SystemService::AuthDelegate>("auth-delg");
      f.interfaceNames<SystemService::AuthNone>("auth-none");
      f.interfaceNames<SystemService::AuthSig::AuthSig>("auth-sig");
      f.interfaceNames<SystemService::CpuLimit>("cpu-limit");
      f.interfaceNames<SystemService::Db>("db");
      f.interfaceNames<UserService::DynLd>("dyn-ld");
      f.interfaceNames<SystemService::HttpServer>("http");
      f.interfaceNames<UserService::Packages>("packages");
      f.interfaceNames<SystemService::Producers>("producers");
      f.interfaceNames<SystemService::SetCode>("setcode");
      f.interfaceNames<SystemService::Sites>("sites");
      f.interfaceNames<SystemService::Transact>("transact");
      f.interfaceNames<SystemService::VerifyK1>("verify-k1");
      f.interfaceNames<SystemService::VerifyR1>("verify-r1");
      f.interfaceNames<LocalService::XAdmin>("x-admin");
      f.interfaceNames<LocalService::XDb>("x-db");
      f.interfaceNames<LocalService::XHttp>("x-http");
      f.interfaceNames<LocalService::XKeys>("x-keys");
      f.interfaceNames<LocalService::XPackages>("x-packages");
      f.interfaceNames<LocalService::XSites>("x-sites");

      f.interfaceNames<SystemService::Credentials>("credential");
      f.interfaceNames<UserService::Nft>("nft");
      f.interfaceNames<SystemService::StagedTxService>("staged-tx");
      f.interfaceNames<UserService::Symbol>("symbol");
      f.interfaceNames<UserService::Tokens>("tokens");
      f.interfaceNames<SystemService::VirtualServer>("vserver");
      f.interfaceNames<SystemService::WsAuth>("wsauth");

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
