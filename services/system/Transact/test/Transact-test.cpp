#define CATCH_CONFIG_MAIN

#include <psibase/DefaultTestChain.hpp>
#include <services/system/AuthAny.hpp>
#include <services/system/AuthSig.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/RTransact.hpp>
#include <services/system/SetCode.hpp>
#include <services/system/Transact.hpp>
#include <services/system/VerifySig.hpp>

#include "RemoveCode.hpp"

using namespace psibase;
using namespace SystemService;

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
      signedTrx.transaction = trx;
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
      SignedTransaction strx{trx};

      auto token = t.post<LoginReply>(Transact::service, "/login", FracPackBody{std::move(strx)})
                       .access_token;
      auto req = t.makeGet(getUser, "/");
      req.headers.push_back({"Authorization", "Bearer " + token});
      auto user = t.http<std::optional<AccountNumber>>(req);
      CHECK(user == std::optional{alice});
   }

   t.setAuth<AuthSig::AuthSig>(alice, aliceKeys.first);
   // Missing signature
   {
      SignedTransaction strx{trx};
      auto              reply = t.post(Transact::service, "/login", FracPackBody{std::move(strx)});
      CHECK(static_cast<int>(reply.status) >= 400);
   }
   // Claim without signature
   {
      SignedTransaction strx{t.signTransaction(trx, {aliceKeys})};
      strx.proofs.clear();
      auto reply = t.post(Transact::service, "/login", FracPackBody{std::move(strx)});
      CHECK(static_cast<int>(reply.status) >= 400);
   }
   // Correct signature
   {
      SignedTransaction strx{t.signTransaction(trx, {aliceKeys})};

      auto token = t.post<LoginReply>(Transact::service, "/login", FracPackBody{std::move(strx)})
                       .access_token;
      auto req = t.makeGet(getUser, "/");
      req.headers.push_back({"Authorization", "Bearer " + token});
      auto user = t.http<std::optional<AccountNumber>>(req);
      CHECK(user == std::optional{alice});
   }
}

TEST_CASE("Test push_transaction")
{
   DefaultTestChain t;

   auto httpPush = [&](const SignedTransaction& trx)
   {
      return Result<void>(t.post<TransactionTrace>(Transact::service, "/push_transaction",
                                                   FracPackBody{std::move(trx)}));
   };

   SECTION("No signature")
   {
      auto accounts = transactor<Accounts>{Accounts::service, Accounts::service};
      auto act      = accounts.newAccount("alice"_a, AuthAny::service, true);
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
      SECTION("Missing")
      {
         trx.proofs.pop_back();
         auto reply = t.post(Transact::service, "/push_transaction", FracPackBody{std::move(trx)});
         CHECK(reply.status == HttpStatus::internalServerError);
         CHECK(t.from(Accounts::service).to<Accounts>().getAuthOf(alice).returnVal() ==
               AuthSig::AuthSig::service);
      }
      SECTION("Extra")
      {
         trx.proofs.push_back({});
         auto reply = t.post(Transact::service, "/push_transaction", FracPackBody{std::move(trx)});
         CHECK(reply.status == HttpStatus::internalServerError);
         CHECK(t.from(Accounts::service).to<Accounts>().getAuthOf(alice).returnVal() ==
               AuthSig::AuthSig::service);
      }
   }

   SECTION("Not verify service")
   {
      auto accounts = transactor<Accounts>{Accounts::service, Accounts::service};
      auto act      = accounts.newAccount("alice"_a, AuthAny::service, true);
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
      auto reply =
          t.asyncPost(Transact::service, "/push_transaction", FracPackBody{std::move(trx)});
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
      auto reply =
          t.asyncPost(Transact::service, "/push_transaction", FracPackBody{std::move(trx)});

      // Count items in queue
      std::size_t                       queueSize = 0;
      TableIndex<RunRow, std::uint64_t> runIndex{RunRow::db, psio::convert_to_key(runPrefix()),
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
         replies.push_back(t.asyncPost(Transact::service, "/push_transaction", FracPackBody{trx}));
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
      auto flags =
          GENERATE(values({CodeRow::allowSudo, CodeRow::allowWriteNative, CodeRow::isSubjective,
                           CodeRow::canSetTimeLimit, (CodeRow::isSubjective | CodeRow::allowSocket),
                           (CodeRow::isSubjective | CodeRow::allowNativeSubjective)}));
      INFO("flags: " << std::hex << flags);
      auto verifyFlags = t.addService(AccountNumber{"verify-flags"}, "VerifyFlagsService.wasm",
                                      flags | CodeRow::isAuthService);
      t.startBlock();
      static_assert(std::same_as<decltype(flags), std::uint64_t>);

      Action nop{.sender = alice, .service = AccountNumber{"nop"}};
      auto   trx = t.makeTransaction({nop}, 5);
      trx.claims.push_back({.service = verifyFlags});
      auto strx =
          SignedTransaction{psio::shared_view_ptr<Transaction>{trx}, {psio::to_frac(flags)}};

      SECTION("keep flags")
      {
         CHECK(httpPush(strx).failed(""));
      }
      SECTION("cancel flags")
      {
         t.setAutoRun(false);
         auto reply = t.asyncPost(Transact::service, "/push_transaction", FracPackBody{strx});
         while (t.runQueueItem())
         {
         }

         REQUIRE(t.from(SetCode::service)
                     .to<SetCode>()
                     .setFlags(verifyFlags, CodeRow::isAuthService)
                     .succeeded());
         t.startBlock();

         t.runAll();

         auto trace = reply.get<TransactionTrace>();
         CHECK(trace.error.value_or("") != "");
      }
   }
}
