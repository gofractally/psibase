#include <catch2/catch_all.hpp>
#include <psibase/DefaultTestChain.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/AuthAny.hpp>
#include <services/system/AuthSig.hpp>
#include <services/system/Credentials.hpp>
#include <services/system/PrivateKeyInfo.hpp>
#include <services/system/Spki.hpp>
#include <services/system/VerifySig.hpp>
#include <services/system/commonErrors.hpp>
#include "services/user/InviteErrors.hpp"

#include "services/user/Invite.hpp"

using namespace UserService;
using namespace UserService::Errors;
using namespace UserService::InviteNs;
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

   auto invPub = pubFromPem(
       "-----BEGIN PUBLIC KEY-----\n"
       "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEWdALpn+cGuD1klsSRXTdapYlG5mu\n"
       "WgoALofZYufL838GRUo43UuoGzxu/mW5T6r9Ix4/qc4gH2B+Zc6VYw/pKQ==\n"
       "-----END PUBLIC KEY-----\n");
   auto invPriv = privFromPem(
       "-----BEGIN PRIVATE KEY-----\n"
       "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg9h35bFuOZyB8i+GT\n"
       "HEfwKktshavRCyzHq3X55sdfgs6hRANCAARZ0Aumf5wa4PWSWxJFdN1qliUbma5a\n"
       "CgAuh9li58vzfwZFSjjdS6gbPG7+ZblPqv0jHj+pziAfYH5lzpVjD+kp\n"
       "-----END PRIVATE KEY-----\n");

   auto userPub = pubFromPem(
       "-----BEGIN PUBLIC KEY-----\n"
       "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEM3slPkmtyksK3oqx2FX8gdIzTGjV\n"
       "rRo8o1cU24xxx8qven95ahpWwKSHvbtQlA54P6pY9Ixm7s+bDnniGPw1iQ==\n"
       "-----END PUBLIC KEY-----\n");
   auto userPriv = privFromPem(
       "-----BEGIN PRIVATE KEY-----\n"
       "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgEbcmTuUFGjyAn0zd\n"
       "7VKhIDZpswsI3m/5bMV+XoBQNTGhRANCAAQzeyU+Sa3KSwreirHYVfyB0jNMaNWt\n"
       "GjyjVxTbjHHHyq96f3lqGlbApIe9u1CUDng/qlj0jGbuz5sOeeIY/DWJ\n"
       "-----END PRIVATE KEY-----\n");

   auto thrdPub = pubFromPem(
       "-----BEGIN PUBLIC KEY-----"
       "\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEBIYTdIExsSGzMU+mShjxDeF7vpvj"
       "\nsXBpMtw4lcaB5DxXxqPNWZCAwZNzTjEhYsOYWYrHKsLWOOuExQSnXPHr6g=="
       "\n-----END PUBLIC KEY-----\n");
   auto thrdPriv = privFromPem(
       "-----BEGIN PRIVATE KEY-----\n"
       "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgbiTVSRup/IaLXIvH\n"
       "qgsA/4UaAk39mbIe9/5Cx3m+A4ihRANCAAQEhhN0gTGxIbMxT6ZKGPEN4Xu+m+Ox\n"
       "cGky3DiVxoHkPFfGo81ZkIDBk3NOMSFiw5hZiscqwtY464TFBKdc8evq\n"
       "-----END PRIVATE KEY-----\n");

   uint32_t inviteId = 1;
}  // namespace

// Helper functions for tests
auto createInvite = [](auto& user, const auto& pubKey)
{ return user.createInvite(++inviteId, pubKey, 1, false, ""); };

// - Auth
//    - Accounts can still create new accounts
SCENARIO("Auth")
{
   GIVEN("Chain with initialized invite system")
   {
      DefaultTestChain t;

      auto alice    = t.from(t.addAccount("alice"_a));
      auto a        = alice.to<Accounts>();
      auto accounts = t.from(Accounts::service).to<Accounts>();

      THEN("Accounts can still create new accounts")
      {
         auto newAcc = accounts.newAccount("bob", AuthAny::service, true);
         CHECK(newAcc.succeeded());
      }
   }
}

// - Creating an invite
//    - Alice can create an invite
//    - Alice cannot create another invite with the same key
//    - invited-sys cannot create an invite
SCENARIO("Creating an invite")
{
   GIVEN("Chain with initialized invite system")
   {
      DefaultTestChain t;

      auto alice   = t.from(t.addAccount("alice"_a));
      auto bob     = t.from(t.addAccount("bob"_a));
      auto invited = t.from(Credentials::CREDENTIAL_SENDER);

      auto a = alice.to<Invite>();
      auto b = bob.to<Invite>();

      auto invitedKeys = KeyList{{invPub, invPriv}};
      auto i           = invited.with(invitedKeys).to<Invite>();

      THEN("Alice can create an invite")
      {
         CHECK(createInvite(a, invPub).succeeded());

         AND_THEN("Alice cannot create another invite with the same key")
         {
            CHECK(createInvite(a, invPub).failed("Credential already exists"));
         }
         AND_THEN("Alice can create another invite with a different key")
         {
            CHECK(createInvite(a, thrdPub).succeeded());
         }
      }
      THEN("Credential account cannot create an invite")
      {
         CHECK(createInvite(a, invPub).succeeded());
         CHECK(createInvite(i, userPub).failed("not allowed using this credential"));
      }
   }
}

// - Deleting an invite
//    - An invite can only be deleted by the creator
//    - A deleted invite no longer exists
SCENARIO("Deleting an invite")
{
   GIVEN("Chain with initialized invite system")
   {
      DefaultTestChain t;

      auto alice = t.from(t.addAccount("alice"_a));
      auto bob   = t.from(t.addAccount("bob"_a));
      auto a     = alice.to<Invite>();
      auto b     = bob.to<Invite>();

      WHEN("Alice creates an invite")
      {
         auto id = createInvite(a, invPub).returnVal();

         THEN("Only alice can delete the invite")
         {
            CHECK(b.delInvite(id).failed(unauthDelete));
            CHECK(a.delInvite(id).succeeded());
         }
         AND_WHEN("Alice deletes the invite")
         {
            a.delInvite(id);

            THEN("The invite no longer exists")
            {
               CHECK(not a.getInvite(id).returnVal().has_value());
            }
         }
      }
   }
}

// - Expired invites
//    - Expired invites can no longer be accepted
//    - Expired invites can be specifically deleted by the creator
//       - In this case, only actually expired invites get deleted
SCENARIO("Expired invites")
{
   GIVEN("Chain with initialized invite system")
   {
      DefaultTestChain t;
      t.setAutoBlockStart(false);

      auto alice   = t.from(t.addAccount("alice"_a));
      auto bob     = t.from(t.addAccount("bob"_a));
      auto charlie = t.from(t.addAccount("charlie"_a));

      t.setAuth<AuthSig::AuthSig>(bob.id, userPub);

      auto combinedKeyList = KeyList{{userPub, userPriv}, {invPub, invPriv}};

      auto a = alice.to<Invite>();
      auto b = bob.with(combinedKeyList).to<Invite>();

      WHEN("Alice creates an invite and it isn't expired")
      {
         auto id = createInvite(a, invPub).returnVal();

         int64_t oneWeek  = (60 * 60 * 24 * 7);
         int64_t passTime = oneWeek - 2;  // 2 seconds before expiration
         t.startBlock(passTime * 1000);

         // Add another invite that is not close to expiring
         auto id2 = createInvite(b, thrdPub).returnVal();

         AND_WHEN("It expires")
         {
            t.startBlock(1000);

            THEN("It cannot be accepted")
            {
               CHECK(b.accept().failed("Credential expired"));
            }
            THEN("It can be deleted by the creator")
            {
               CHECK(a.delInvite(id).succeeded());

               AND_THEN("Only the expired invite was deleted")
               {
                  CHECK(not a.getInvite(id).returnVal().has_value());
                  CHECK(b.getInvite(id2).returnVal().has_value());
               }
            }
         }
      }
   }
}

// - Accepting invites
//    - An invite can be accepted by a normal user
//    - An invite can be accepted by invited-sys in order to create a new account
//    - A normal user may not create a new account
//    - Invited-sys may not accept except by also creating a new account
//    - An accepted invite can be accepted again with a different account
//    - An accepted invite can be accepted again with a created account
//    - Accepting fails if:
//       - the invitekey doesn't exist
//       - the transaction is missing the specified invite pubkey claim
//       - the transaction is missing the specified invite pubkey proof
//       - the invite is rejected
//       - the inviteKey matches the newAccountKey
//       - it attempts to create 2 accounts from the same invite
SCENARIO("Accepting an invite")
{
   GIVEN("Chain with initialized invite system")
   {
      DefaultTestChain t;

      auto alice   = t.from(t.addAccount("alice"_a));
      auto bob     = t.from(t.addAccount("bob"_a));
      auto charlie = t.from(t.addAccount("charlie"_a));
      auto invited = t.from(Credentials::CREDENTIAL_SENDER);
      auto rebecca = t.from(t.addAccount("rebecca"_a));

      t.setAuth<AuthSig::AuthSig>(bob.id, userPub);
      t.setAuth<AuthSig::AuthSig>(charlie.id, userPub);
      t.setAuth<AuthSig::AuthSig>(rebecca.id, userPub);

      auto userKeys        = KeyList{{userPub, userPriv}};
      auto combinedKeyList = KeyList{{userPub, userPriv}, {invPub, invPriv}};
      auto invitedKeys     = KeyList{{invPub, invPriv}};

      auto a = alice.to<Invite>();
      auto b = bob.with(combinedKeyList).to<Invite>();
      auto c = charlie.with(combinedKeyList).to<Invite>();
      auto i = invited.with(invitedKeys).to<Invite>();
      auto r = rebecca.with(combinedKeyList).to<Invite>();
      WHEN("Alice creates an invite")
      {
         auto id = createInvite(a, invPub).returnVal();

         THEN("The invite can be accepted by a normal user")
         {
            CHECK(b.accept().succeeded());
         }
         THEN("An invite can be used to create a new account")
         {
            CHECK(i.createAccount("alexandria"_a, userPub).succeeded());
            AND_THEN(
                "The invite can be accepted by the new account (tx also signed using credential)")
            {
               CHECK(r.accept().succeeded());
            }
         }
         THEN("A normal user may not create a new account")
         {
            std::string error =
                "Only " + Credentials::CREDENTIAL_SENDER.str() + " can call createAccount";
            CHECK(b.createAccount("alexandria"_a, userPub).failed(error));
         }
         THEN("Credential account may not accept an invite")
         {
            CHECK(i.accept().failed(canOnlyCallCreateAccount));
         }
         WHEN("An invite is accepted with an existing account")
         {
            b.accept();

            THEN("An accepted invite can be accepted again with a different account")
            {
               CHECK(c.accept().succeeded());
            }
            THEN("An accepted invite can be accepted again with a created account")
            {
               CHECK(i.createAccount("alexandria"_a, userPub).succeeded());
               CHECK(r.accept().succeeded());
            }
         }
         THEN("Accepting fails if the transaction is missing the specified invite pubkey claim")
         {
            CHECK(bob.with(userKeys).to<Invite>().accept().failed(noActiveCredential));
         }
         THEN("Accepting fails if the transaction is missing the specified invite pubkey proof")
         {
            // Manually constructing the transaction to avoid adding the proper proof
            transactor<Invite> service(bob, Invite::service);
            auto               trx = t.makeTransaction({service.accept()});
            for (const auto& key : combinedKeyList)
            {
               trx.claims.push_back({
                   .service = VerifySig::service,
                   .rawData = psio::convert_to_frac(key.first),
               });
            }
            SignedTransaction signedTrx;
            signedTrx.transaction = trx;
            auto hash = sha256(signedTrx.transaction.data(), signedTrx.transaction.size());
            auto key  = combinedKeyList[0];
            signedTrx.proofs.push_back(psio::convert_to_frac(sign(key.second, hash)));
            auto accept = t.pushTransaction(signedTrx);

            auto failed = [&](TransactionTrace& _t, std::string_view expected) -> bool
            {
               bool failed = (_t.error != std::nullopt);
               if (!failed)
               {
                  UNSCOPED_INFO("transaction succeeded, but was expected to fail");
                  return false;
               }

               bool hasException = (failed && _t.error.has_value());
               if (hasException)
               {
                  if (_t.error->find(expected.data()) != std::string::npos)
                  {
                     return true;
                  }
                  else
                  {
                     UNSCOPED_INFO("transaction was expected to fail with: \""
                                   << expected << "\", but it failed with: \"" << *_t.error
                                   << "\"\n");
                  }
               }

               return false;
            };

            CHECK(failed(accept, "proofs and claims must have same size"));
         }
         THEN("Accepting with create fails if the inviteKey matches the newAccountKey")
         {
            CHECK(i.createAccount("alexandria"_a, invPub).failed(needUniquePubkey));
         }
         THEN("Accepting fails if it would attempt to create 2 accounts from the same invite")
         {
            i.createAccount("alexandria"_a, userPub);
            CHECK(i.createAccount("christopher"_a, userPub).failed(outOfNewAccounts));
         }
      }
   }
}
