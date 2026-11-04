#include <services/system/Credentials.hpp>

#include <catch2/catch_test_macros.hpp>
#include <psibase/DefaultTestChain.hpp>
#include <psibase/checkSchema.hpp>
#include <services/system/AuthSig.hpp>
#include <services/system/Credentials.hpp>
#include <services/test/CredResThief.hpp>
#include <services/user/Invite.hpp>
#include <services/user/Tokens.hpp>

using namespace SystemService;
using namespace TestService;
using namespace UserService;
using namespace InviteNs;
using namespace psibase;
using SystemService::AuthSig::PrivateKeyInfo;
using SystemService::AuthSig::SubjectPublicKeyInfo;

TEST_CASE("schema")
{
   CHECK_SCHEMA(Credentials);
}

TEST_CASE("Steal resources")
{
   DefaultTestChain t{{"TestDefault", "TokenUsers", "Invite"}};
   t.addService<CredResThief>("CredResThief.wasm");

   auto alice  = AccountNumber{"alice"};
   auto bob    = AccountNumber{"bob"};
   auto sys    = t.from(alice).to<Tokens>().getSysToken().returnVal().value().id;
   auto faucet = AccountNumber{"faucet-tok"};

   auto alicePriv = PrivateKeyInfo::create();
   auto alicePub  = getSubjectPublicKeyInfo(alicePriv);
   auto aliceKeys = KeyList{{alicePub, alicePriv}};

   auto bobPriv = PrivateKeyInfo::create();
   auto bobPub  = getSubjectPublicKeyInfo(bobPriv);

   t.from(alice).to<Tokens>().debit(sys, faucet, 100'000'0000, "");
   t.setAuth<AuthSig::AuthSig>(alice, alicePub);

   t.from(bob).to<Tokens>().debit(sys, faucet, 100'000'0000, "");

   REQUIRE(t.to<VirtualServer>().init_billing(Tokens::service).succeeded());
   REQUIRE(t.from(alice)
               .with(aliceKeys)
               .to<Tokens>()
               .credit(sys, VirtualServer::service, 100'0000, "")
               .succeeded());
   REQUIRE(t.from(alice).with(aliceKeys).to<VirtualServer>().buy_res(100'0000).succeeded());
   REQUIRE(t.from(bob).to<Tokens>().credit(sys, VirtualServer::service, 120'0000, "").succeeded());
   REQUIRE(t.from(bob).to<VirtualServer>().buy_res(100'0000).succeeded());
   REQUIRE(t.from(bob)
               .to<VirtualServer>()
               .buy_res_for(10'0000, VirtualServer::service, "")
               .succeeded());
   REQUIRE(t.from(bob)
               .to<VirtualServer>()
               .buy_res_for(10'0000, Credentials::CREDENTIAL_SENDER, "")
               .succeeded());
   REQUIRE(t.to<VirtualServer>().enable_billing().succeeded());

   REQUIRE(t.from(alice).with(aliceKeys).to<CredResThief>().create().succeeded());
   REQUIRE(t.from(alice)
               .with(aliceKeys)
               .to<Tokens>()
               .credit(sys, CredResThief::service, 1'0000, "")
               .succeeded());
   REQUIRE(t.from(alice).with(aliceKeys).to<CredResThief>().buyRes(1'0000).succeeded());

   // Create an invite using bobPub
   auto invRes      = std::uint64_t{10'000'0000};
   auto fingerprint = bobPub.fingerprint();
   auto payload     = InvPayload{.fingerprint{fingerprint.begin(), fingerprint.end()}};
   auto payloadData = psio::to_frac(payload);
   REQUIRE(t.from(bob).to<Tokens>().credit(sys, Invite::service, invRes, "").succeeded());
   REQUIRE(t.from(bob)
               .to<Invite>()
               .createInvite(42, std::vector<std::uint8_t>{payloadData.begin(), payloadData.end()},
                             1, false, invRes)
               .succeeded());

   auto expensiveAction = transactor<CredResThief>().from(alice).useDisk(100'000);

   expect(t.pushTransaction(t.makeTransaction({expensiveAction}), aliceKeys),
          "alice has insufficient resource balance");

   auto tx = t.makeTransaction(
       {transactor<CredResThief>()
            .from(Credentials::CREDENTIAL_SENDER)
            .bill(bobPub, ServiceMethod{Invite::service, MethodNumber{"createAccount"}}),
        expensiveAction});
   expect(t.pushTransaction(std::move(tx), aliceKeys),
          "cred-sys.0 has insufficient resource balance");
}
