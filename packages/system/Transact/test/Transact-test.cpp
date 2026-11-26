#include <catch2/catch_all.hpp>
#include <chrono>
#include <cstdio>
#include <psibase/DefaultTestChain.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/testerApi.hpp>
#include <services/system/AuthAny.hpp>
#include <services/system/AuthNone.hpp>
#include <services/system/AuthSig.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/RTransact.hpp>
#include <services/system/SetCode.hpp>
#include <services/system/Transact.hpp>
#include <services/system/VerifySig.hpp>
#include <services/test/AuthTest.hpp>
#include <services/test/RemoveCode.hpp>
#include <services/user/Nop.hpp>

using namespace psibase;
using namespace SystemService;
using namespace TestService;
using namespace UserService;

namespace
{
   auto pubFromPem = [](std::string param) {  //
      return AuthSig::SubjectPublicKeyInfo{AuthSig::parseSubjectPublicKeyInfo(param)};
   };

   auto privFromPem = [](std::string param) {  //
      return AuthSig::PrivateKeyInfo{AuthSig::parsePrivateKeyInfo(param)};
   };

   auto aliceKeys =
       KeyPair{pubFromPem("-----BEGIN PUBLIC KEY-----\n"
                          "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEWdALpn+cGuD1klsSRXTdapYlG5mu\n"
                          "WgoALofZYufL838GRUo43UuoGzxu/mW5T6r9Ix4/qc4gH2B+Zc6VYw/pKQ==\n"
                          "-----END PUBLIC KEY-----\n"),
               privFromPem("-----BEGIN PRIVATE KEY-----\n"
                           "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg9h35bFuOZyB8i+GT\n"
                           "HEfwKktshavRCyzHq3X55sdfgs6hRANCAARZ0Aumf5wa4PWSWxJFdN1qliUbma5a\n"
                           "CgAuh9li58vzfwZFSjjdS6gbPG7+ZblPqv0jHj+pziAfYH5lzpVjD+kp\n"
                           "-----END PRIVATE KEY-----\n")};

   auto bobKeys =
       KeyPair{pubFromPem("-----BEGIN PUBLIC KEY-----\n"
                          "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEjfORN+7dsPa5EocZN+jUEYFwqNNH\n"
                          "C+Tk1RRTUNauVE0SGP+6UMK2QDQyjBjka6XheCyaKjaFQNP87v32zildTA==\n"
                          "-----END PUBLIC KEY-----\n"),
               privFromPem("-----BEGIN PRIVATE KEY-----\n"
                           "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQggslLlsITfk40AloZ\n"
                           "LIBPQ6CIYjeRapOKRdm/M3Olx16hRANCAASN85E37t2w9rkShxk36NQRgXCo00cL\n"
                           "5OTVFFNQ1q5UTRIY/7pQwrZANDKMGORrpeF4LJoqNoVA0/zu/fbOKV1M\n"
                           "-----END PRIVATE KEY-----\n")};

   struct KeyWithAccount
   {
      AccountNumber service;
      KeyPair       key;
   };

   SignedTransaction signTransaction(Transaction trx, const std::vector<KeyWithAccount>& keys)
   {
      for (auto& [account, key] : keys)
         trx.claims.push_back({
             .service = account,
             .rawData = {key.first.data.begin(), key.first.data.end()},
         });
      SignedTransaction signedTrx;
      signedTrx.transaction = psio::shared_pssz<Transaction>{trx};
      auto hash             = sha256(signedTrx.transaction.data(), signedTrx.transaction.size());
      for (auto& [account, key] : keys)
      {
         auto proof = sign(key.second, hash);
         signedTrx.proofs.push_back({proof.begin(), proof.end()});
      }
      return signedTrx;
   }

}  // namespace

struct LoginInterface
{
   void loginSys(std::string rootHost);
};
PSIO_REFLECT(LoginInterface, method(loginSys, rootHost))

namespace
{
   // A request body given as its bytes
   struct RawBody
   {
      std::string       type;
      std::vector<char> bytes;
      std::string       contentType() const { return type; }
      std::vector<char> body() const { return bytes; }
   };
}  // namespace

TEST_CASE("Test login")
{
   DefaultTestChain t;

   auto alice   = t.addAccount("alice"_a);
   auto getUser = t.addService("get-user", "GetUser.wasm");
   t.from(getUser).to<HttpServer>().registerServer(getUser);

   transactor<LoginInterface> login{alice, getUser};
   Tapos       tapos{.expiration = std::chrono::time_point_cast<std::chrono::seconds>(
                                 std::chrono::system_clock::now()) +
                             std::chrono::seconds(10),
                     .flags = Tapos::do_not_broadcast_flag};
   Transaction trx{.tapos = tapos, .actions = {login.loginSys("psibase.io")}};

   // User with no key
   {
      SignedTransaction strx{psio::shared_pssz<Transaction>{trx}};

      auto token = t.post<LoginReply>(Transact::service, "/login", PsszBody{std::move(strx)})
                       .access_token;
      auto client = t.http(getUser).auth_bearer(token);
      auto user   = client.get<std::optional<AccountNumber>>("/");
      CHECK(user == std::optional{alice});
   }

   // The same as JSON
   {
      SignedTransaction strx{psio::shared_pssz<Transaction>{trx}};

      auto token = t.post<LoginReply>(Transact::service, "/login", JsonBody{std::move(strx)})
                       .access_token;
      auto client = t.http(getUser).auth_bearer(token);
      auto user   = client.get<std::optional<AccountNumber>>("/");
      CHECK(user == std::optional{alice});
   }
   // A body that is not a packed SignedTransaction, and a JSON body whose
   // transaction is not a packed Transaction, are refused
   {
      auto refused = [&](const auto& body)
      {
         try
         {
            auto reply = t.post(Transact::service, "/login", body);
            return static_cast<int>(reply.status) >= 400;
         }
         catch (std::exception&)
         {
            return true;
         }
      };
      auto packed = psio::to_pssz(SignedTransaction{psio::shared_pssz<Transaction>{trx}});
      CHECK(refused(RawBody{"application/octet-stream", {}}));
      CHECK(refused(RawBody{"application/octet-stream", {'\x01', '\x02', '\x03'}}));
      CHECK(refused(RawBody{"application/octet-stream",
                            std::vector<char>(packed.begin(), packed.begin() + packed.size() / 2)}));
      for (std::string_view hex : {"", "00", "FFFFFFFF", "0800FFFFFFFFFFFFFFFF"})
      {
         auto json = "{\"transaction\":\"" + std::string{hex} + "\",\"proofs\":[]}";
         CHECK(refused(RawBody{"application/json", {json.begin(), json.end()}}));
      }
   }

   t.setAuth<AuthSig::AuthSig>(alice, aliceKeys.first);
   // Missing signature
   {
      SignedTransaction strx{psio::shared_pssz<Transaction>{trx}};
      auto              reply = t.post(Transact::service, "/login", PsszBody{std::move(strx)});
      CHECK(static_cast<int>(reply.status) >= 400);
   }
   // Claim without signature
   {
      SignedTransaction strx{t.signTransaction(trx, {aliceKeys})};
      strx.proofs.clear();
      auto reply = t.post(Transact::service, "/login", PsszBody{std::move(strx)});
      CHECK(static_cast<int>(reply.status) >= 400);
   }
   // Correct signature
   {
      SignedTransaction strx{t.signTransaction(trx, {aliceKeys})};

      auto token = t.post<LoginReply>(Transact::service, "/login", PsszBody{std::move(strx)})
                       .access_token;
      auto client = t.http(getUser).auth_bearer(token);
      auto user   = client.get<std::optional<AccountNumber>>("/");
      CHECK(user == std::optional{alice});
   }
}

TEST_CASE("Test push_transaction")
{
   DefaultTestChain t;

   auto httpPush = [&](const SignedTransaction& trx)
   {
      return Result<void>(t.post<TransactionTrace>(
          Transact::service, "/push_transaction?wait_for=applied", PsszBody{std::move(trx)}));
   };

   SECTION("No signature")
   {
      auto accounts = transactor<Accounts>{Accounts::service, Accounts::service};
      auto act      = accounts.newAccount("alice"_a, AuthAny::service, NewAccountMode::requireNew);
      auto trx      = t.signTransaction(t.makeTransaction({std::move(act)}));
      CHECK(httpPush(trx).succeeded());
      CHECK(t.from("alice"_a).to<Accounts>().exists("alice"_a).returnVal() == true);
   }

   SECTION("With signature")
   {
      auto alice    = t.addAccount("alice", aliceKeys.first);
      auto accounts = transactor<Accounts>{alice, Accounts::service};
      auto act      = accounts.setAuthServ(AuthAny::service);
      auto trx      = t.signTransaction(t.makeTransaction({std::move(act)}), {aliceKeys});
      SECTION("Valid")
      {
         CHECK(httpPush(trx).succeeded());
         CHECK(t.from("alice"_a).to<Accounts>().getAuthOf(alice).returnVal() == AuthAny::service);
      }
      SECTION("Invalid")
      {
         trx.proofs[0].clear();
         CHECK(httpPush(trx).failed("signature invalid"));
         CHECK(t.from(Accounts::service).to<Accounts>().getAuthOf(alice).returnVal() ==
               AuthSig::AuthSig::service);
      }
      SECTION("Invalid final")
      {
         trx.proofs[0].clear();
         auto expiration = trx.transaction->tapos().expiration().unpack();
         auto reply      = t.asyncPost(Transact::service, "/push_transaction?wait_for=final",
                                       PsszBody{std::move(trx)});
         // skip to the transaction expiration
         t.startBlock(expiration);
         t.finishBlock();
         CHECK(Result<void>(reply.get<TransactionTrace>()).failed("signature invalid"));
         CHECK(t.from(Accounts::service).to<Accounts>().getAuthOf(alice).returnVal() ==
               AuthSig::AuthSig::service);
      }
      SECTION("Missing")
      {
         trx.proofs.pop_back();
         auto reply = t.post(Transact::service, "/push_transaction?wait_for=applied",
                             PsszBody{std::move(trx)});
         CHECK(reply.status == HttpStatus::internalServerError);
         CHECK(t.from(Accounts::service).to<Accounts>().getAuthOf(alice).returnVal() ==
               AuthSig::AuthSig::service);
      }
      SECTION("Extra")
      {
         trx.proofs.push_back({});
         auto reply = t.post(Transact::service, "/push_transaction?wait_for=applied",
                             PsszBody{std::move(trx)});
         CHECK(reply.status == HttpStatus::internalServerError);
         CHECK(t.from(Accounts::service).to<Accounts>().getAuthOf(alice).returnVal() ==
               AuthSig::AuthSig::service);
      }
   }

   SECTION("Not verify service")
   {
      auto accounts = transactor<Accounts>{Accounts::service, Accounts::service};
      auto act      = accounts.newAccount("alice"_a, AuthAny::service, NewAccountMode::requireNew);
      auto trx      = signTransaction(t.makeTransaction({std::move(act)}, 5),
                                      {{AccountNumber{"nop"}, aliceKeys}});

      CHECK(httpPush(trx).failed("cannot be used in verify"));
      CHECK(t.from(Accounts::service).to<Accounts>().exists("alice"_a).returnVal() == false);
   }

   SECTION("Change verify service")
   {
      auto           alice    = t.addAccount("alice", aliceKeys.first);
      auto           accounts = transactor<Accounts>{alice, Accounts::service};
      auto           act      = accounts.setAuthServ(AuthAny::service);
      auto           trx = t.signTransaction(t.makeTransaction({std::move(act)}, 5), {aliceKeys});
      constexpr auto verifysig = VerifySig::service;

      t.setAutoRun(false);
      auto reply = t.asyncPost(Transact::service, "/push_transaction?wait_for=applied",
                               PsszBody{std::move(trx)});
      // Verify signatures
      while (t.runQueueItem())
      {
      }

      const char* expectMsg = "";
      SECTION("Remove service")
      {
         REQUIRE(t.from(verifysig)
                     .to<SetCode>()
                     .setCode(verifysig, 0, 0, std::vector<char>())
                     .succeeded());
         t.startBlock();
         expectMsg = "service account has no code";
      }
      SECTION("Remove code")
      {
         auto row        = t.kvGet<CodeRow>(CodeRow::db, codeKey(verifysig)).value();
         auto removeCode = t.addService("rm-code", "RemoveCode.wasm");
         REQUIRE(t.from(SetCode::service)
                     .to<SetCode>()
                     .setFlags(removeCode, RemoveCode::serviceFlags)
                     .succeeded());
         REQUIRE(t.from(removeCode)
                     .to<RemoveCode>()
                     .removeCode(row.codeHash, row.vmType, row.vmVersion)
                     .succeeded());
         t.startBlock();
         expectMsg = "service code record is missing";
      }

      // Now push the transaction
      t.runAll();

      auto trace = reply.get<TransactionTrace>();
      CHECK(Result<void>(std::move(trace)).failed(expectMsg));
   }
   SECTION("Change verify service 2 keys")
   {
      constexpr auto verifysig = VerifySig::service;

      // make a second verify service
      auto verify2 = t.addService("verify2", "VerifySig.wasm");
      REQUIRE(t.from(SetCode::service)
                  .to<SetCode>()
                  .setFlags(verify2, VerifySig::serviceFlags)
                  .succeeded());

      auto alice    = t.addAccount("alice", aliceKeys.first);
      auto accounts = transactor<Accounts>{alice, Accounts::service};
      auto act      = accounts.setAuthServ(AuthAny::service);
      auto trx      = signTransaction(t.makeTransaction({std::move(act)}, 5),
                                      {{verifysig, aliceKeys}, {verify2, bobKeys}});

      t.startBlock();

      t.setAutoRun(false);
      auto reply = t.asyncPost(Transact::service, "/push_transaction?wait_for=applied",
                               PsszBody{std::move(trx)});

      // Count items in queue
      std::size_t                       queueSize = 0;
      TableIndex<RunRow, std::uint64_t> runIndex{RunRow::db, psio::encode(psio::key{}, runPrefix()),
                                                 false};
      for (auto _ : runIndex)
      {
         ++queueSize;
      }

      auto n = GENERATE_COPY(range(std::size_t{0}, queueSize + 1));
      // We expect queueSize to be the same every time
      REQUIRE(n <= queueSize);

      INFO(std::format("queue processed: {}/{}", n, queueSize));

      // Verify some signatures
      for (std::size_t i = 0; i < n; ++i)
         t.runQueueItem();

      // If there were more items pushed onto the queue,
      // we need to rethink how to test this.
      if (n == queueSize)
         CHECK(runIndex.empty());

      auto removedService = GENERATE_COPY(verifysig, verify2);
      INFO("removed: " << removedService.str());
      // Remove the verify service
      REQUIRE(t.from(removedService)
                  .to<SetCode>()
                  .setCode(removedService, 0, 0, std::vector<char>())
                  .succeeded());
      t.startBlock();

      // Now push the transaction
      t.runAll();

      auto trace = reply.get<TransactionTrace>();
      CHECK(Result<void>(std::move(trace)).failed("service account has no code"));
   }
   SECTION("Duplicate push 2 keys error")
   {
      constexpr auto verifysig = VerifySig::service;

      auto alice    = t.addAccount("alice", aliceKeys.first);
      auto accounts = transactor<Accounts>{alice, Accounts::service};
      auto act      = accounts.setAuthServ(AuthAny::service);
      auto trx      = signTransaction(t.makeTransaction({std::move(act)}, 5),
                                      {{verifysig, aliceKeys}, {verifysig, bobKeys}});

      // make the signatures invalid
      for (auto& proof : trx.proofs)
         proof.clear();

      t.setAutoRun(false);

      std::vector<AsyncHttpReply> replies;
      std::size_t                 remaining = 8;
      do
      {
         replies.push_back(t.asyncPost(Transact::service, "/push_transaction?wait_for=applied",
                                       PsszBody{trx}));
      } while (t.runQueueItem() && --remaining != 0);

      t.runAll();

      for (auto& reply : replies)
      {
         auto trace = reply.poll<TransactionTrace>();
         REQUIRE(trace.has_value());
         CHECK(trace->error.has_value());
      }
   }
   SECTION("verify flags")
   {
      // TODO: Should we allow any flags in verify mode? A few
      // would make sense, but we would need to add a flags
      // field to BlockHeaderAuthAccount.
      //
      // - allowSudo
      // - canSetTimeLimit
      auto alice = t.addAccount("alice");
      auto flags = GENERATE(values({CodeRow::isPrivileged}));
      INFO("flags: " << std::hex << flags);
      t.startBlock();
      auto verifyFlags = t.addService(AccountNumber{"verify-flg"}, "VerifyFlagsService.wasm",
                                      flags | CodeRow::isVerify);
      t.startBlock();
      static_assert(std::same_as<decltype(flags), std::uint64_t>);

      Action nop{.sender = alice, .service = AccountNumber{"nop"}};
      auto   trx = t.makeTransaction({nop}, 5);
      trx.claims.push_back({.service = verifyFlags});
      auto strx =
          SignedTransaction{psio::shared_pssz<Transaction>{trx}, {psio::to_pssz(flags)}};

      SECTION("run in transact mode")
      {
         // Sanity check to ensure that the action fails because
         // it's forbidden in verify, not because of other errors.
         auto act = makeVerify(strx, sha256(strx.transaction.data(), strx.transaction.size()), 0);
         // We need a valid sender when running in a transaction.
         // The sender is irrelevant for this particular test, so
         // just pick alice.
         act.sender = alice;
         CHECK(Result<void>{t.pushTransaction(t.makeTransaction({act}))}.succeeded());
      }
      SECTION("keep flags")
      {
         CHECK(httpPush(strx).failed(""));
      }
      SECTION("cancel flags")
      {
         t.setAutoRun(false);
         auto reply = t.asyncPost(Transact::service, "/push_transaction?wait_for=applied",
                                  PsszBody{strx});
         while (t.runQueueItem())
         {
         }

         REQUIRE(t.from(SetCode::service)
                     .to<SetCode>()
                     .setFlags(verifyFlags, CodeRow::isVerify)
                     .succeeded());
         t.startBlock();

         t.runAll();

         auto trace = reply.get<TransactionTrace>();
         CHECK(trace.error.value_or("") != "");
      }
   }
}

// The project owner's rule (gofractally/psibase#2256): "the speculative run must
// pass... dependent transactions cannot pre-validate unless separated by a
// block boundary... it rate limits the user to 1 per second dependent... or
// forces them to group it into one transaction."
TEST_CASE("A pushed transaction is included only after its speculative run has passed")
{
   DefaultTestChain t;
   auto             newAccount = [&](AccountNumber name)
   {
      auto accounts = transactor<Accounts>{Accounts::service, Accounts::service};
      return accounts.newAccount(name, AuthAny::service, NewAccountMode::requireNew);
   };
   auto push = [&](SignedTransaction trx)
   {
      return t.asyncPost(Transact::service, "/push_transaction?wait_for=applied",
                         PsszBody{std::move(trx)});
   };
   auto exists = [&](AccountNumber name)
   { return t.from(Accounts::service).to<Accounts>().exists(name).returnVal(); };
   t.setAutoRun(false);

   SECTION("not offered while the run is in flight, offered once it has passed")
   {
      // No signatures to check: only the speculative run stands between the
      // transaction and a block.
      auto reply = push(t.signTransaction(t.makeTransaction({newAccount("alice"_a)})));
      CHECK_FALSE(t.pushNextTransaction().has_value());
      CHECK_FALSE(exists("alice"_a));
      // The speculative run, and its continuation.
      REQUIRE(t.runQueueItem());
      CHECK_FALSE(t.runQueueItem());
      auto trace = t.pushNextTransaction();
      REQUIRE(trace.has_value());
      CHECK_FALSE(trace->error.has_value());
      CHECK(exists("alice"_a));
      CHECK(Result<void>(reply.get<TransactionTrace>()).succeeded());
   }
   SECTION("with signatures, both the run and the checks must have finished")
   {
      t.setAutoRun(true);
      auto alice = t.addAccount("alice", aliceKeys.first);
      t.setAutoRun(false);
      auto accounts = transactor<Accounts>{alice, Accounts::service};
      auto reply    = push(t.signTransaction(
          t.makeTransaction({accounts.setAuthServ(AuthAny::service)}), {aliceKeys}));
      // Two items are queued, the run and one signature check. After
      // either alone the transaction is not offered.
      CHECK_FALSE(t.pushNextTransaction().has_value());
      REQUIRE(t.runQueueItem());
      CHECK_FALSE(t.pushNextTransaction().has_value());
      REQUIRE(t.runQueueItem());
      CHECK_FALSE(t.runQueueItem());
      auto trace = t.pushNextTransaction();
      REQUIRE(trace.has_value());
      CHECK_FALSE(trace->error.has_value());
      CHECK(Result<void>(reply.get<TransactionTrace>()).succeeded());
   }
   SECTION("dropped, with the failure reported, when the run fails")
   {
      t.setAutoRun(true);
      t.addAccount("alice");
      t.setAutoRun(false);
      auto reply = push(t.signTransaction(t.makeTransaction({newAccount("alice"_a)})));
      REQUIRE(t.runQueueItem());
      // Never offered to a block; the submitter is told.
      CHECK_FALSE(t.pushNextTransaction().has_value());
      CHECK(reply.get<TransactionTrace>().error.has_value());
      t.startBlock();
      CHECK_FALSE(t.pushNextTransaction().has_value());
   }
   SECTION("of two dependent transactions sent together the second fails")
   {
      // The first creates an account, the second needs it. Intended: the
      // second is judged against the chain as it is, where the first is not
      // in a block yet. Whoever sends them waits for the first to be
      // applied, or puts both actions in one transaction.
      const auto bob      = "bob"_a;
      auto       system   = transactor<Accounts>{Accounts::service, Accounts::service};
      auto       accounts = transactor<Accounts>{bob, Accounts::service};
      auto firstReply = push(t.signTransaction(t.makeTransaction({newAccount(bob)})));
      // Sent by the new account: refused where it is submitted, before any
      // speculative run, because its sender does not exist.
      auto refused =
          t.post(Transact::service, "/push_transaction?wait_for=applied",
                 PsszBody{t.signTransaction(
                     t.makeTransaction({accounts.setAuthServ(AuthAny::service)}))});
      CHECK(refused.status == HttpStatus::internalServerError);
      // Sent by an existing account and reading the new one: accepted, and
      // dropped when its speculative run fails.
      auto secondReply = push(t.signTransaction(t.makeTransaction({system.getAuthOf(bob)})));
      while (t.runQueueItem())
      {
      }
      CHECK(secondReply.get<TransactionTrace>().error.has_value());
      auto trace = t.pushNextTransaction();
      REQUIRE(trace.has_value());
      CHECK_FALSE(trace->error.has_value());
      CHECK_FALSE(t.pushNextTransaction().has_value());
      CHECK(Result<void>(firstReply.get<TransactionTrace>()).succeeded());
      CHECK(exists(bob));

      // Sent again once the first is in a block, both pass and are included.
      t.startBlock();
      auto again = push(t.signTransaction(t.makeTransaction({system.getAuthOf(bob)}, 6)));
      auto byBob = push(t.signTransaction(
          t.makeTransaction({accounts.setAuthServ(AuthAny::service)}, 6)));
      while (t.runQueueItem())
      {
      }
      for (int i = 0; i < 2; ++i)
      {
         trace = t.pushNextTransaction();
         REQUIRE(trace.has_value());
         CHECK_FALSE(trace->error.has_value());
      }
      CHECK(Result<void>(again.get<TransactionTrace>()).succeeded());
      CHECK(Result<void>(byBob.get<TransactionTrace>()).succeeded());

      // Or both in one transaction, with no block between.
      const auto carol   = "carol"_a;
      auto       grouped = push(t.signTransaction(
          t.makeTransaction({newAccount(carol), system.getAuthOf(carol)}, 7)));
      while (t.runQueueItem())
      {
      }
      trace = t.pushNextTransaction();
      REQUIRE(trace.has_value());
      CHECK_FALSE(trace->error.has_value());
      CHECK(Result<void>(grouped.get<TransactionTrace>()).succeeded());
   }
}

TEST_CASE("Test firstAuth")
{
   DefaultTestChain t;
   t.setAutoBlockStart(false);
   t.startBlock();
   auto alice = t.addAccount("alice");
   auto trx   = t.signTransaction(
       t.makeTransaction({Action{.sender = alice, .service = AccountNumber{"nop"}}}));
   auto reply = t.post(Transact::service, "/push_transaction?wait_for=applied", PsszBody{trx});
   if (static_cast<int>(reply.status) < 400)
   {
      CHECK(TraceResult{unpackReply<TransactionTrace>(std::move(reply))}.failed(""));
   }
}

TEST_CASE("Test stats")
{
   DefaultTestChain t;

   auto alice = t.addAccount("alice");
   auto trx   = t.signTransaction(
       t.makeTransaction({Action{.sender = alice, .service = AccountNumber{"nop"}}}));
   CHECK(
       Result<void>(t.post<TransactionTrace>(
                        Transact::service, "/push_transaction?wait_for=applied", PsszBody{trx}))
           .succeeded());

   t.startBlock();

   auto stats = t.get<TxStatsRecord>(Transact::service, "/stats");
   CHECK(stats.unprocessed == 0);
   CHECK(stats.total == 1);
   CHECK(stats.failed == 0);
   CHECK(stats.succeeded == 1);
   CHECK(stats.expired == 0);
}

TEST_CASE("Test runAs")
{
   DefaultTestChain t;
   auto             alice = t.addAccount("alice");
   // define some accounts.
   auto bob   = AccountNumber{"bob45678"};
   auto carol = AccountNumber{"carol678"};
   auto dave  = AccountNumber{"dave5678"};
   auto eliza = AccountNumber{"eliza678"};
   auto frank = AccountNumber{"frank678"};
   auto grace = AccountNumber{"grace678"};
   auto henry = AccountNumber{"henry678"};
   t.addService<AuthTest>("AuthTest.wasm");
   SECTION("subaccount can be authorized by base account")
   {
      auto alice1 = AccountNumber("alice+1");
      REQUIRE(t.from(alice)
                  .to<Accounts>()
                  .newAccount(alice1, AuthNone::service, NewAccountMode::requireNew)
                  .succeeded());
      auto act = transactor<Accounts>().from(alice1).setAuthServ(AuthAny::service);
      REQUIRE(t.from(alice)
                  .to<Transact>()
                  .runAs(std::move(act), std::vector<ServiceMethod>{})
                  .succeeded());
      CHECK(t.from(alice1).to<Nop>().nop().succeeded());
   }
   SECTION("multisig pass")
   {
      // dave is always the authorized account
      SECTION("and 2")
      {
         REQUIRE(t.to<AuthTest>().newAccount(bob, std::vector{alice}, 1).succeeded());
         REQUIRE(t.to<AuthTest>().newAccount(carol, std::vector{alice}, 1).succeeded());
         REQUIRE(t.to<AuthTest>().newAccount(dave, std::vector{bob, carol}, 2).succeeded());
      }
      SECTION("or 2")
      {
         REQUIRE(t.to<AuthTest>().newAccount(bob, std::vector{alice}, 1).succeeded());
         REQUIRE(t.to<AuthTest>().newAccount(carol, std::vector{alice}, 1).succeeded());
         REQUIRE(t.to<AuthTest>().newAccount(dave, std::vector{bob, carol}, 1).succeeded());
      }
      SECTION("or left")
      {
         REQUIRE(t.to<AuthTest>().newAccount(bob, std::vector{alice}, 1).succeeded());
         t.addAccount(carol, AuthNone::service);
         REQUIRE(t.to<AuthTest>().newAccount(dave, std::vector{bob, carol}, 1).succeeded());
      }
      SECTION("or right")
      {
         t.addAccount(bob, AuthNone::service);
         REQUIRE(t.to<AuthTest>().newAccount(carol, std::vector{alice}, 1).succeeded());
         REQUIRE(t.to<AuthTest>().newAccount(dave, std::vector{bob, carol}, 1).succeeded());
      }
      SECTION("or loop right")
      {
         REQUIRE(t.to<AuthTest>().newAccount(carol, std::vector{alice}, 1).succeeded());
         REQUIRE(t.to<AuthTest>().newAccount(dave, std::vector{carol, dave}, 1).succeeded());
      }
      SECTION("or loop left")
      {
         REQUIRE(t.to<AuthTest>().newAccount(carol, std::vector{alice}, 1).succeeded());
         REQUIRE(t.to<AuthTest>().newAccount(dave, std::vector{dave, carol}, 1).succeeded());
      }
      SECTION("regression: refcount management")
      {
         REQUIRE(t.to<AuthTest>().newAccount(eliza, std::vector{alice}, 1).succeeded());
         REQUIRE(t.to<AuthTest>().newAccount(bob, std::vector{eliza, alice}, 1).succeeded());
         REQUIRE(t.to<AuthTest>().newAccount(carol, std::vector{eliza, bob}, 2).succeeded());
         REQUIRE(t.to<AuthTest>().newAccount(dave, std::vector{carol, bob}, 2).succeeded());
      }
      SECTION("regression: refcount tree")
      {
         REQUIRE(t.to<AuthTest>().newAccount(henry, std::vector{alice}, 1).succeeded());
         REQUIRE(t.to<AuthTest>().newAccount(grace, std::vector{alice}, 1).succeeded());
         REQUIRE(t.to<AuthTest>().newAccount(eliza, std::vector{alice, grace}, 2).succeeded());
         REQUIRE(t.to<AuthTest>().newAccount(frank, std::vector{eliza}, 1).succeeded());
         REQUIRE(t.to<AuthTest>().newAccount(bob, std::vector{henry, frank}, 1).succeeded());
         REQUIRE(t.to<AuthTest>().newAccount(carol, std::vector{frank}, 1).succeeded());
         REQUIRE(t.to<AuthTest>().newAccount(dave, std::vector{grace, carol, bob}, 3).succeeded());
      }

      auto act = transactor<Accounts>().from(dave).setAuthServ(AuthAny::service);
      REQUIRE(t.from(alice)
                  .to<Transact>()
                  .runAs(std::move(act), std::vector<ServiceMethod>{})
                  .succeeded());
      CHECK(t.from(dave).to<Nop>().nop().succeeded());
   }

   SECTION("multisig fail")
   {
      SECTION("simple loop")
      {
         REQUIRE(t.to<AuthTest>().newAccount(dave, std::vector{dave}, 1).succeeded());
      }

      auto act = transactor<Accounts>().from(dave).setAuthServ(AuthAny::service);
      REQUIRE(t.from(alice)
                  .to<Transact>()
                  .runAs(std::move(act), std::vector<ServiceMethod>{})
                  .failed("caller is not authorized"));
   }
}

TEST_CASE("Test isAuth")
{
   auto t     = DefaultTestChain{};
   auto alice = t.addAccount("alice");
   auto bob   = t.addAccount("bob");
   auto carol = AccountNumber{"carol678"};
   auto dave  = AccountNumber{"dave5678"};
   t.addService<AuthTest>("AuthTest.wasm");
   auto nop  = ServiceMethod{Nop::service, MethodNumber{"nop"}};
   auto nop2 = ServiceMethod{Nop::service, MethodNumber{"nop2"}};
   SECTION("simple method")
   {
      REQUIRE(t.to<AuthTest>().newAccount(carol, std::vector{bob}, 1).succeeded());
      REQUIRE(t.to<AuthTest>().setAuth(carol, std::vector{alice}, 1, nop).succeeded());
      CHECK(t.to<Transact>()
                .isAuth(std::vector<AuthTarget>{{carol, nop}}, std::vector{alice})
                .returnVal() == true);
      CHECK(t.to<Transact>()
                .isAuth(std::vector<AuthTarget>{{carol, nop}}, std::vector{bob})
                .returnVal() == false);
   }
   SECTION("multiple")
   {
      REQUIRE(t.to<AuthTest>().newAccount(carol, std::vector{bob}, 1).succeeded());
      REQUIRE(t.to<AuthTest>().setAuth(carol, std::vector{alice}, 1, nop).succeeded());
      REQUIRE(t.to<AuthTest>().newAccount(dave, std::vector{bob}, 1).succeeded());
      REQUIRE(t.to<AuthTest>().setAuth(dave, std::vector{alice}, 1, nop2).succeeded());
      CHECK(t.to<Transact>()
                .isAuth(std::vector<AuthTarget>{{carol, nop}, {dave, nop2}}, std::vector{alice})
                .returnVal() == true);
      CHECK(t.to<Transact>()
                .isAuth(std::vector<AuthTarget>{{carol, nop}, {dave, nop}}, std::vector{alice})
                .returnVal() == false);
      CHECK(t.to<Transact>()
                .isAuth(std::vector<AuthTarget>{{carol, nop2}, {dave, nop2}}, std::vector{alice})
                .returnVal() == false);
   }
}

TEST_CASE("Test work")
{
   DefaultTestChain t;

   auto alice = t.addAccount("alice");
   auto bob   = t.addAccount("bob");

   SECTION("incomplete")
   {
      CHECK(t.to<Transact>().setWork(true).failed("Work not completed: transact"));
   }

   auto transact = transactor<Transact>();

   SECTION("complete")
   {
      expect(t.pushTransaction(t.makeTransaction(
          {transact.from(alice).setWork(true), transact.from(alice).setWork(false)})));
   }
   SECTION("double work")
   {
      expect(t.pushTransaction(
          t.makeTransaction({transact.from(alice).setWork(true), transact.from(alice).setWork(true),
                             transact.from(alice).setWork(false)})));
   }
   SECTION("wrong complete")
   {
      expect(t.pushTransaction(t.makeTransaction(
                 {transact.from(alice).setWork(true), transact.from(bob).setWork(false)})),
             "Work not completed: alice");
   }
   SECTION("complete + incomplete")
   {
      expect(t.pushTransaction(t.makeTransaction({transact.from(alice).setWork(true),
                                                  transact.from(bob).setWork(true),
                                                  transact.from(alice).setWork(false)})),
             "Work not completed: bob");
   }
   SECTION("complete overlapping")
   {
      expect(t.pushTransaction(t.makeTransaction(
          {transact.from(alice).setWork(true), transact.from(bob).setWork(true),
           transact.from(alice).setWork(false), transact.from(bob).setWork(false)})));
   }
}

namespace
{
   // A transaction of one action for `nop` (a service that reads nothing)
   // whose argument bytes are `size` bytes. `salt` makes transactions of
   // one size differ.
   SignedTransaction makeLargeTransaction(DefaultTestChain& t,
                                          AccountNumber     sender,
                                          std::size_t       size,
                                          std::uint32_t     salt = 0)
   {
      std::vector<char> data(size, 'x');
      for (std::size_t i = 0; i < sizeof(salt) && i < size; ++i)
         data[i] = static_cast<char>(salt >> (8 * i));
      return t.signTransaction(t.makeTransaction({Action{.sender  = sender,
                                                         .service = Nop::service,
                                                         .method  = MethodNumber{"nop"},
                                                         .rawData = std::move(data)}}));
   }

   // A transaction of `count` actions for `nop`, each with `argSize` bytes
   // of arguments: the shape whose trace is mostly member names as JSON.
   SignedTransaction makeManyActionsTransaction(DefaultTestChain& t,
                                                AccountNumber     sender,
                                                std::size_t       count,
                                                std::size_t       argSize,
                                                std::uint32_t     salt = 0)
   {
      std::vector<Action> actions;
      actions.reserve(count);
      for (std::size_t i = 0; i < count; ++i)
      {
         std::vector<char> data(argSize, 'x');
         auto              n = static_cast<std::uint32_t>(i) ^ (salt << 24);
         for (std::size_t b = 0; b < sizeof(n) && b < argSize; ++b)
            data[b] = static_cast<char>(n >> (8 * b));
         actions.push_back(Action{.sender  = sender,
                                  .service = Nop::service,
                                  .method  = MethodNumber{"nop"},
                                  .rawData = std::move(data)});
      }
      return t.signTransaction(t.makeTransaction(std::move(actions)));
   }
}  // namespace

// Transact checks a transaction where it lies (psio::validate_strict walks
// the packed bytes) and reads it through views: the service holds the
// transaction once, so what it can process is bounded by its memory
// (WasmConfigRow: 512 pages, 32 MiB). r-transact, which takes a transaction
// from a client, hands it on and answers it, has two limits of its own: a
// body of push_transaction is at most 5 MiB, and a trace of more than
// 3.25 MiB is answered by its outcome alone. See
// doc/migrations/2026-11-fracpack-to-pssz/pssz-conversion.md 7.9.
TEST_CASE("Test transaction size")
{
   DefaultTestChain t;
   auto             alice = t.addAccount("alice");

   constexpr std::size_t MiB = 1024 * 1024;

   SECTION("pushed to the block")
   {
      // 4.5 MiB is above what Transact could process while the check
      // made a second copy of the transaction; 16 MiB is half its memory.
      for (std::size_t size : {MiB, 9 * MiB / 2, 8 * MiB, 16 * MiB})
      {
         INFO("size: " << size);
         auto trx = makeLargeTransaction(t, alice, size);
         REQUIRE(trx.transaction.size() > size);
         CHECK(TraceResult{t.pushTransaction(trx)}.succeeded());
         t.startBlock();
      }
   }

   SECTION("posted to push_transaction")
   {
      auto post = [&](std::size_t size, std::string_view waitFor = "applied")
      {
         return t.asyncPost(Transact::service, "/push_transaction?wait_for=" + std::string{waitFor},
                            PsszBody{makeLargeTransaction(t, alice, size)});
      };
      // The arguments of the actions in a trace
      auto argumentBytes = [](const TransactionTrace& trace)
      {
         std::size_t result = 0;
         auto        add    = [&](this auto&& self, const ActionTrace& at) -> void
         {
            result += at.action.rawData.size();
            for (const auto& inner : at.innerTraces)
               if (auto* nested = std::get_if<ActionTrace>(&inner.inner))
                  self(*nested);
         };
         for (const auto& at : trace.actionTraces)
            add(at);
         return result;
      };
      // What r-transact sends in place of a trace it does not keep: the
      // outcome, and one action trace of its own that says so.
      auto isReduced = [](const TransactionTrace& trace)
      {
         if (trace.actionTraces.size() != 1)
            return false;
         const auto& note = trace.actionTraces[0];
         if (note.action.service != RTransact::service || note.innerTraces.size() != 1)
            return false;
         auto* console = std::get_if<ConsoleTrace>(&note.innerTraces[0].inner);
         return console && console->console.contains("its action traces are omitted");
      };

      SECTION("1 MiB: the client gets the trace")
      {
         auto trace = post(MiB).get<TransactionTrace>();
         CHECK(!isReduced(trace));
         CHECK(argumentBytes(trace) >= 2 * MiB);
         CHECK(Result<void>(std::move(trace)).succeeded());
      }
      SECTION("1.6 MiB: the client gets the trace")
      {
         // A trace of 3.2 MiB, 6.4 MiB as JSON: about the largest that is
         // sent whole.
         auto size  = 16 * MiB / 10;
         auto trace = post(size).get<TransactionTrace>();
         CHECK(!isReduced(trace));
         CHECK(argumentBytes(trace) >= 2 * size);
         CHECK(Result<void>(std::move(trace)).succeeded());
      }
      SECTION("8000 small actions: the client gets the trace")
      {
         // A trace of 3.2 MiB whose JSON text is 2.3 times its bytes
         // (7.7 MB): member names, not hex.
         std::size_t count = 8000;
         auto        trace = t.asyncPost(Transact::service, "/push_transaction?wait_for=applied",
                                         PsszBody{makeManyActionsTransaction(t, alice, count, 8)})
                                 .get<TransactionTrace>();
         CHECK(!isReduced(trace));
         std::size_t called = 0;
         auto        visit  = [&](this auto&& self, const ActionTrace& at) -> void
         {
            if (at.action.service == Nop::service)
               ++called;
            for (const auto& inner : at.innerTraces)
               if (auto* nested = std::get_if<ActionTrace>(&inner.inner))
                  self(*nested);
         };
         for (const auto& at : trace.actionTraces)
            visit(at);
         CHECK(called == count);
         CHECK(psio::to_pssz(trace).size() > 3 * MiB);
         CHECK(Result<void>(std::move(trace)).succeeded());
      }
      SECTION("12000 small actions: the client gets the outcome")
      {
         auto reply = t.asyncPost(Transact::service, "/push_transaction?wait_for=applied",
                                  PsszBody{makeManyActionsTransaction(t, alice, 12000, 8)})
                          .get();
         CHECK(reply.status == HttpStatus::ok);
         auto trace = unpackReply<TransactionTrace>(std::move(reply));
         CHECK(isReduced(trace));
         CHECK(Result<void>(std::move(trace)).succeeded());
      }
      SECTION("2 MiB: the client gets the outcome")
      {
         auto reply = post(2 * MiB).get();
         CHECK(reply.status == HttpStatus::ok);
         auto trace = unpackReply<TransactionTrace>(std::move(reply));
         CHECK(isReduced(trace));
         CHECK(Result<void>(std::move(trace)).succeeded());
      }
      SECTION("4.5 MiB: accepted, queued, applied and answered")
      {
         // The trace, 9 MiB, is more than a row holds (ConfigRow's
         // maxValueSize, 8 MiB): r-transact keeps and sends the outcome.
         t.setAutoRun(false);
         auto reply = post(9 * MiB / 2);
         CHECK(!reply.poll());
         while (t.runQueueItem())
         {
         }
         auto trace = t.pushNextTransaction();
         REQUIRE(!!trace);
         CHECK(TraceResult{std::move(*trace)}.succeeded());
         auto answer = reply.poll<TransactionTrace>();
         REQUIRE(!!answer);
         CHECK(isReduced(*answer));
         CHECK(Result<void>(std::move(*answer)).succeeded());
      }
      SECTION("4.5 MiB: a client that waits for finality gets the outcome")
      {
         auto                            reply = post(9 * MiB / 2, "final");
         std::optional<TransactionTrace> answer;
         for (int i = 0; i < 8 && !answer; ++i)
         {
            t.startBlock();
            t.finishBlock();
            answer = reply.poll<TransactionTrace>();
         }
         REQUIRE(!!answer);
         CHECK(isReduced(*answer));
         CHECK(Result<void>(std::move(*answer)).succeeded());
      }
      SECTION("4.5 MiB that fails: the client gets the error")
      {
         auto trx = t.signTransaction(
             t.makeTransaction({Action{.sender  = alice,
                                       .service = AccountNumber{"no-such-svc"},
                                       .rawData = std::vector<char>(9 * MiB / 2, 'x')}}));
         auto trace = t.post<TransactionTrace>(
             Transact::service, "/push_transaction?wait_for=applied", PsszBody{std::move(trx)});
         CHECK(isReduced(trace));
         CHECK(trace.error.value_or("") != "");
      }
      SECTION("5 MiB less 1 KiB: the largest body")
      {
         auto trace = post(5 * MiB - 1024).get<TransactionTrace>();
         CHECK(isReduced(trace));
         CHECK(Result<void>(std::move(trace)).succeeded());
      }
      SECTION("above 5 MiB: refused, with the limit")
      {
         // (8 and 10 MiB reach r-transact since a call is packed into
         // one buffer: http-server held 8 MiB four times before.)
         for (std::size_t size : {5 * MiB, 6 * MiB, 15 * MiB / 2, 8 * MiB, 10 * MiB})
         {
            INFO("size: " << size);
            auto reply = post(size).poll();
            REQUIRE(!!reply);
            CHECK(reply->status == HttpStatus::contentTooLarge);
            CHECK(std::string_view{reply->body.data(), reply->body.size()}.contains(
                "push_transaction accepts at most 5242880 bytes"));
         }
      }
   }

   SECTION("the service's memory is the limit")
   {
      // A transaction that cannot fit in the service's memory is refused
      // by the service's allocator, with its message.
      auto trx = makeLargeTransaction(t, alice, 32 * MiB);
      CHECK(TraceResult{t.pushTransaction(trx)}.failed("service exceeded its memory limit"));
   }
}

// Measurements behind doc/migrations/2026-11-fracpack-to-pssz/pssz-conversion.md 7.9,
// 7.11 and 7.12. Not part of the suite:
// psitest Transact-test.wasm "[.measure]"
TEST_CASE("Measure transaction size", "[.measure]")
{
   DefaultTestChain t;
   auto             alice = t.addAccount("alice");

   constexpr std::size_t MiB  = 1024 * 1024;
   std::uint32_t         salt = 1;
   auto                  ms   = [](auto d)
   { return std::chrono::duration_cast<std::chrono::milliseconds>(d).count(); };

   auto push = [&](std::size_t size)
   {
      auto trx   = makeLargeTransaction(t, alice, size, salt++);
      auto start = std::chrono::steady_clock::now();
      auto trace = t.pushTransaction(trx);
      auto time  = std::chrono::steady_clock::now() - start;
      return std::pair{std::move(trace.error), ms(time)};
   };

   SECTION("pushed to the block")
   {
      for (std::size_t size : {MiB, 9 * MiB / 2, 8 * MiB, 16 * MiB, 24 * MiB, 30 * MiB, 31 * MiB,
                               63 * MiB / 2, 32 * MiB})
      {
         auto [error, time] = push(size);
         t.startBlock();
         std::printf("push %zu bytes: %s, %lld ms\n", size, error ? error->c_str() : "ok",
                     static_cast<long long>(time));
      }
   }

   SECTION("memory beside the transaction")
   {
      // The service never frees: the largest payload it processes in its
      // 512 pages tells how much it allocates beside the transaction.
      for (std::size_t pages = 1; pages <= 8; ++pages)
      {
         auto size          = 32 * MiB - pages * 65536;
         auto [error, time] = push(size);
         t.startBlock();
         std::printf("32 MiB less %zu pages (%zu bytes): %s\n", pages, size,
                     error ? error->c_str() : "ok");
      }
   }

   // The rest of a post that was accepted: the queue, the block, the reply.
   // Prints the outcome, the packed size of the trace, the reply and the time.
   auto finish = [&](auto& reply, std::chrono::steady_clock::time_point start)
   {
      std::fflush(stdout);
      while (t.runQueueItem())
      {
      }
      auto trace = t.pushNextTransaction();
      auto time  = std::chrono::steady_clock::now() - start;
      std::printf("%s, ", !trace ? "not pushed" : trace->error ? trace->error->c_str() : "ok");
      if (trace)
         std::printf("trace %zu bytes packed, ", psio::to_pssz(*trace).size());
      if (auto answer = reply.poll())
      {
         std::printf("reply HTTP %d %s (%zu bytes)", static_cast<int>(answer->status),
                     answer->contentType.c_str(), answer->body.size());
         if (answer->status != HttpStatus::ok)
            std::printf(" %.*s", static_cast<int>(std::min<std::size_t>(answer->body.size(), 200)),
                        answer->body.data());
      }
      else
         std::printf("no reply");
      std::printf(", %lld ms\n", static_cast<long long>(ms(time)));
      t.startBlock();
   };

   SECTION("posted to push_transaction")
   {
      // Step by step, as psinode does: the request (r-transact), the
      // queued verification and speculative run, the transaction pushed
      // to the block (transact), the reply (r-transact's onTransaction).
      // A failed continuation ends the run (the tester aborts).
      t.setAutoRun(false);
      for (std::size_t size : {MiB, 3 * MiB / 2, 16 * MiB / 10, 7 * MiB / 4, 2 * MiB, 4 * MiB - 200,
                               9 * MiB / 2, 5 * MiB - 1024, 5 * MiB, 6 * MiB, 13 * MiB / 2, 7 * MiB,
                               15 * MiB / 2, 8 * MiB, 9 * MiB, 10 * MiB, 21 * MiB / 2, 11 * MiB,
                               12 * MiB, 14 * MiB, 15 * MiB, 31 * MiB / 2, 16 * MiB, 20 * MiB})
      {
         auto trx   = makeLargeTransaction(t, alice, size, salt++);
         auto start = std::chrono::steady_clock::now();
         auto reply = t.asyncPost(Transact::service, "/push_transaction?wait_for=applied",
                                  PsszBody{std::move(trx)});
         std::printf("post %zu bytes: ", size);
         if (auto refused = reply.poll())
         {
            std::printf("refused, HTTP %d %.*s\n", static_cast<int>(refused->status),
                        static_cast<int>(std::min<std::size_t>(refused->body.size(), 700)),
                        refused->body.data());
            t.startBlock();
            continue;
         }
         finish(reply, start);
      }
   }

   SECTION("posted to push_transaction: many small actions")
   {
      // The trace of an action with few arguments is mostly member names
      // as JSON: the text is several times the packed bytes.
      t.setAutoRun(false);
      for (std::size_t argSize : {std::size_t{8}, std::size_t{64}})
         for (std::size_t count : {1000, 4000, 8000, 12000, 16000, 20000, 24000, 32000})
         {
            auto trx   = makeManyActionsTransaction(t, alice, count, argSize, salt++);
            auto start = std::chrono::steady_clock::now();
            std::printf("post %zu actions of %zu bytes (%zu bytes): ", count, argSize,
                        psio::to_pssz(trx).size());
            auto reply = t.asyncPost(Transact::service, "/push_transaction?wait_for=applied",
                                     PsszBody{std::move(trx)});
            if (auto refused = reply.poll())
            {
               std::printf("refused, HTTP %d %.*s\n", static_cast<int>(refused->status),
                           static_cast<int>(std::min<std::size_t>(refused->body.size(), 700)),
                           refused->body.data());
               t.startBlock();
               continue;
            }
            finish(reply, start);
         }
   }
}
