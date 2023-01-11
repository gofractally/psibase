#define CATCH_CONFIG_MAIN

#include <psibase/DefaultTestChain.hpp>
#include <services/system/AccountSys.hpp>
#include <services/system/AuthAnySys.hpp>
#include <services/system/AuthEcSys.hpp>
#include <services/system/VerifyEcSys.hpp>
#include <services/system/commonErrors.hpp>

#include "services/user/AuthInviteSys.hpp"
#include "services/user/InviteSys.hpp"

using namespace UserService;
using namespace UserService::Errors;
using namespace UserService::Invite;
using namespace psibase;
using namespace SystemService;

namespace
{
   auto invPub  = publicKeyFromString("PUB_K1_7jTdMYEaHi66ZEcrh7To9XKingVkRdBuz6abm3meFbGw8zFFve");
   auto invPriv = privateKeyFromString("PVT_K1_ZGRNZ4qwN1Ei9YEyVBr1aBGekAxC5FKVPR3rQA2HnEhvqviF2");

   auto userPub  = publicKeyFromString("PUB_K1_5Dcj42CYrYpPMpCPWPzBSpM9gThV5ywAPdbYgiL2JUxGrnVUbn");
   auto userPriv = privateKeyFromString("PVT_K1_SjmZ1DKTPNZFnfPEPwGb9rt3CAuwAoqYjZf5UoM4Utwm5dJW3");
}  // namespace

template <typename T>
bool pushSigned(auto&             chain,
                AccountNumber     pusher,
                const PublicKey&  pubKey,
                const PrivateKey& privKey,
                auto              func)
{
   transactor<T> service(pusher, T::service);

   auto trx = chain.makeTransaction({func(service)});
   trx.claims.push_back({
       .service = VerifyEcSys::service,
       .rawData = psio::convert_to_frac(pubKey),
   });
   SignedTransaction signedTrx;
   signedTrx.transaction = trx;
   auto hash             = sha256(signedTrx.transaction.data(), signedTrx.transaction.size());
   signedTrx.proofs.push_back(psio::convert_to_frac(sign(privKey, hash)));
   auto trace = chain.pushTransaction(signedTrx);
   return not trace.error.has_value();
}

SCENARIO("Creating an invite")
{
   GIVEN("Chain with initialized invite system")
   {
      DefaultTestChain t;

      auto alice   = t.from("alice"_a);
      auto a       = alice.to<InviteSys>();
      auto charlie = t.from(t.add_account("charlie"_a));
      auto payer   = t.from(InviteSys::payerAccount);

      THEN("Alice cannot use AuthInviteSys")
      {
         auto setAuthCntr = alice.to<AccountSys>().setAuthCntr(AuthInviteSys::service);
         CHECK(setAuthCntr.failed(notWhitelisted));
      }
      THEN("No one other than the specified account creator can create a new account")
      {
         auto newAccCreated = alice.to<AccountSys>().newAccount("bob", AuthAnySys::service, true);
         CHECK(newAccCreated.failed("Only invite-sys is authorized to create new accounts."));
      }
      THEN("Alice can create an invite")
      {
         auto createInvite = a.createInvite(invPub, alice);

         CHECK(createInvite.succeeded());
      }
      WHEN("Alice creates an invite")
      {
         auto createInvite = a.createInvite(invPub, alice);
         CHECK(createInvite.succeeded());

         // New account info
         psibase::AccountNumber bob{"bob"};

         THEN("Payer cannot accept an invite without a custom signature")
         {
            auto acceptCreate = payer.to<InviteSys>().acceptCreate(invPub, "bob"_a, userPub);
            CHECK(acceptCreate.failed(inviteDNE));
         }
         THEN("Payer can accept the invite if transaction is properly signed")
         {
            // Manually sign the acceptCreate transaction with the invite private key
            //   in order for the payer auth service (AuthInviteSys) to allow it.
            bool succeeded =
                pushSigned<InviteSys>(t, payer, invPub, invPriv, [&](auto service) {  //
                   return service.acceptCreate(invPub, bob, userPub);
                });

            CHECK(succeeded);
         }
         WHEN("The invite is accepted")
         {
            pushSigned<InviteSys>(t, payer, invPub, invPriv, [&](auto service) {  //
               return service.acceptCreate(invPub, bob, userPub);
            });

            THEN("It cannot be accepted with create again by payer")
            {
               bool acceptCreate2 =
                   pushSigned<InviteSys>(t, payer, invPub, invPriv, [&](auto service) {  //
                      return service.acceptCreate(invPub, "laura"_a, userPub);
                   });

               CHECK(!acceptCreate2);
            }
            THEN("It cannot be accepted with create again by another existing account")
            {
               auto acceptCreate2 =
                   t.from(charlie).to<InviteSys>().acceptCreate(invPub, "laura"_a, userPub);
               CHECK(acceptCreate2.failed(noNewAccToken));
            }
            THEN("It can be accepted again *without create* ")
            {
               auto accept2 = t.from(charlie).to<InviteSys>().accept(invPub);
               CHECK(accept2.succeeded());
            }
         }
         THEN("A user with auth-ec should also be able to accept the invite")
         {
            // An existing user with a keypair may not need to accept an invite to create a new account.
            // They can just create new accounts directly. But if they want to for some reason, there's no technical reason why they can't.
            auto setKey = alice.to<AuthEcSys>().setKey(userPub);
            CHECK(setKey.succeeded());

            auto setAuthCntr = alice.to<AccountSys>().setAuthCntr(AuthEcSys::service);
            CHECK(setAuthCntr.succeeded());

            bool createSucceeded =
                pushSigned<InviteSys>(t, alice.id, userPub, userPriv, [&](auto service) {  //
                   return service.acceptCreate(invPub, bob, userPub);
                });
            CHECK(createSucceeded);
         }
      }
   }
}

// Invite sys -> Needs to restrict so only fractalsys can call it
// Fractally service -> pass in ID of the account invite object
