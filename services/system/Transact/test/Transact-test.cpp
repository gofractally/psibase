#define CATCH_CONFIG_MAIN

#include <psibase/DefaultTestChain.hpp>
#include <services/system/AuthAny.hpp>
#include <services/system/AuthSig.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/RTransact.hpp>
#include <services/system/Transact.hpp>

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
}
