#define CATCH_CONFIG_MAIN

#include <psibase/DefaultTestChain.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/AuthAny.hpp>
#include <services/system/AuthSig.hpp>
#include <services/system/PrivateKeyInfo.hpp>
#include <services/system/Spki.hpp>
#include <services/system/VerifySig.hpp>
#include <services/system/commonErrors.hpp>

#include "services/user/AuthInvite.hpp"
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
}  // namespace

// Helper functions for tests
auto createInvite = [](auto& user, const auto& pubKey)
{ return user.createInvite(pubKey, std::nullopt, std::nullopt, std::nullopt, std::nullopt); };

// - Auth
//    - Alice cannot use AuthInvite
//    - Accounts can still create new accounts
//    - A regular user cannot create a new account
SCENARIO("Auth")
{
   GIVEN("Chain with initialized invite system")
   {
      DefaultTestChain t;

      auto alice    = t.from(t.addAccount("alice"_a));
      auto a        = alice.to<Accounts>();
      auto accounts = t.from(Accounts::service).to<Accounts>();

      THEN("Alice cannot use AuthInvite")
      {
         auto setAuthServ = a.setAuthServ(AuthInvite::service);
         CHECK(setAuthServ.failed(notWhitelisted));
      }
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
      auto invited = t.from(Invite::payerAccount);

      auto a = alice.to<Invite>();
      auto b = bob.to<Invite>();
      auto i = invited.to<Invite>();

      THEN("Alice can create an invite")
      {
         auto result = createInvite(a, invPub);
         CHECK(result.succeeded());

         AND_THEN("Alice cannot create another invite with the same key")
         {
            auto result2 = createInvite(a, invPub);
            CHECK(result2.failed(inviteAlreadyExists));
         }
         AND_THEN("Alice can create another invite with a different key")
         {
            auto result2 = createInvite(a, thrdPub);
            CHECK(result2.succeeded());
         }
      }
      THEN("Invited-sys cannot create an invite")
      {
         auto result = createInvite(i, userPub);
         CHECK(result.failed(restrictedActions));
      }
   }
}

// - Rejecting an invite
//    - Invitee can reject an invite as invited-sys
//    - Invitee can reject an invite as a normal user
//    - Reject fails if:
//       - It is already rejected
//       - It is already accepted
//       - Transaction is not signed with invite pubkey
SCENARIO("Rejecting an invite")
{
   GIVEN("Chain with initialized invite system")
   {
      DefaultTestChain t;

      auto alice   = t.from(t.addAccount("alice"_a));
      auto bob     = t.from(t.addAccount("bob"_a));
      auto invited = t.from(Invite::payerAccount);

      // Define KeyList objects at the top level for reuse
      auto userKeyList     = KeyList{{userPub, userPriv}};
      auto invKeyList      = KeyList{{invPub, invPriv}};
      auto thrdKeyList     = KeyList{{thrdPub, thrdPriv}};
      auto combinedKeyList = KeyList{{userPub, userPriv}, {invPub, invPriv}};

      t.setAuth<AuthSig::AuthSig>(alice.id, userPub);
      t.setAuth<AuthSig::AuthSig>(bob.id, userPub);

      auto a = alice.with(userKeyList).to<Invite>();
      auto b = bob.with(userKeyList).to<Invite>();
      auto i = invited.with(invKeyList).to<Invite>();

      WHEN("Alice creates an invite")
      {
         createInvite(a, invPub);

         THEN("Invitee can reject an invite as invited-sys")
         {
            CHECK(i.reject(invPub).succeeded());
         }
         THEN("Invitee can reject an invite as a normal user")
         {
            CHECK(b.reject(invPub).succeeded());
         }
         THEN("Reject fails if it is already rejected")
         {
            i.reject(invPub);
            CHECK(i.reject(invPub).failed(alreadyRejected));
         }
         THEN("Reject fails if it is already accepted")
         {
            CHECK(b.accept(invPub).succeeded());
            CHECK(b.reject(invPub).failed(alreadyAccepted));
         }
         THEN("Reject fails if transaction isn't signed with the invite public key")
         {
            auto reject = bob.with({}).to<Invite>().reject(invPub);
            CHECK(reject.failed(missingInviteSig));

            auto reject2 = invited.with({}).to<Invite>().reject(invPub);
            CHECK(reject2.failed(missingInviteSig));
         }
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
         createInvite(a, invPub);

         THEN("Only alice can delete the invite")
         {
            CHECK(b.delInvite(invPub).failed(unauthDelete));
            CHECK(a.delInvite(invPub).succeeded());
         }
         AND_WHEN("Alice deletes the invite")
         {
            a.delInvite(invPub);

            THEN("The invite no longer exists")
            {
               CHECK(not a.getInvite(invPub).returnVal().has_value());
            }
         }
      }
   }
}

// - Expired invites
//    - Expired invites can no longer be rejected or accepted
//    - Expired invites can be specifically deleted by the creator
//    - Anyone can call an action to delete a batch of expired invites
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
         createInvite(a, invPub);

         int64_t oneWeek  = (60 * 60 * 24 * 7);
         int64_t passTime = oneWeek - 2;  // 2 seconds before expiration
         t.startBlock(passTime * 1000);

         // Add another invite that is not close to expiring
         createInvite(b, thrdPub);

         THEN("It can be rejected")
         {
            CHECK(b.reject(invPub).succeeded());
         }

         AND_WHEN("It expires")
         {
            t.startBlock(1000);

            THEN("It cannot be rejected")
            {
               CHECK(b.reject(invPub).failed(inviteExpired));
            }
            THEN("It cannot be accepted")
            {
               CHECK(b.accept(invPub).failed(inviteExpired));
            }
            THEN("It can be deleted by the creator")
            {
               CHECK(a.delInvite(invPub).succeeded());
            }
            THEN("It can be deleted by anyone")
            {
               CHECK(charlie.to<Invite>().delExpired(5).succeeded());

               AND_THEN("Only the expired invite was deleted")
               {
                  CHECK(not a.getInvite(invPub).returnVal().has_value());
                  CHECK(b.getInvite(thrdPub).returnVal().has_value());
               }
            }
         }
      }
   }
}

// - Setting a whitelist
//    - A whitelist can be set by invite
//    - All whitelisted accounts must exist
//    - All whitelisted accounts must be unique
//    - No whitelisted accounts may already be on the blacklist
//    - Then only whitelisted accounts can create invites
//    - Setting the whitelist to an empty array should delete the whitelist from the db
SCENARIO("Setting a whitelist", "[whiteblack]")
{
   GIVEN("Chain with initialized invite system")
   {
      DefaultTestChain t;

      auto alice = t.from(t.addAccount("alice"_a));
      auto bob   = t.from(t.addAccount("bob"_a));
      auto a     = alice.to<Invite>();
      auto b     = bob.to<Invite>();

      auto invite = t.from(Invite::service).to<Invite>();

      using Accounts = std::vector<psibase::AccountNumber>;

      THEN("A whitelist can only be set on the Invite service by invite")
      {
         CHECK(a.setWhitelist(Accounts{"alice"_a}).failed(missingRequiredAuth));
         CHECK(invite.setWhitelist(Accounts{"alice"_a}).succeeded());
      }
      THEN("A nonexistent account cannot be added to the whitelist")
      {
         CHECK(invite.setWhitelist(Accounts{"asdfg"_a}).failed("Account asdfg does not exist"));
      }
      THEN("Duplicate accounts cannot be added to the whitelist")
      {
         CHECK(invite.setWhitelist(Accounts{"alice"_a, "alice"_a})
                   .failed("Account alice duplicated"));
      }
      THEN("A blacklist can be set on the invite service")
      {
         CHECK(invite.setBlacklist(Accounts{"alice"_a}).succeeded());
      }
      WHEN("A blacklisted account is set")
      {
         invite.setBlacklist(Accounts{"alice"_a});

         THEN("The blacklisted account cannot then be added to the whitelist")
         {
            CHECK(invite.setWhitelist(Accounts{"alice"_a})
                      .failed("Account alice already on blacklist"));
         }
         THEN("The blacklist can be cleared")
         {
            CHECK(invite.setBlacklist(Accounts{}).succeeded());

            AND_THEN("The formerly blacklisted account can be added to the whitelist")
            {
               CHECK(invite.setWhitelist(Accounts{"alice"_a}).succeeded());
            }
         }
      }
      WHEN("A whitelist is set")
      {
         invite.setWhitelist(Accounts{"alice"_a});

         THEN("A non-whitelisted account cannot create an invite")
         {
            CHECK(createInvite(b, invPub).failed(onlyWhitelisted));
         }
         THEN("A whitelisted account can create an invite")
         {
            CHECK(createInvite(a, invPub).succeeded());
         }
         THEN("The whitelist can be cleared")
         {
            CHECK(invite.setWhitelist(Accounts{}).succeeded());

            AND_THEN("A formerly non-whitelisted account can create an invite")
            {
               CHECK(createInvite(b, invPub).succeeded());
            }
         }
      }
   }
}

// - Setting a blacklist
//    - A blacklist can be set by invite, only if there is no whitelist
//    - All blacklisted accounts must exist
//    - All blacklisted accounts must be unique
//    - Blacklisted accounts cannot create invites
//    - Setting the blacklist to an empty array should delete the whitelist from the db
SCENARIO("Setting a blacklist", "[whiteblack]")
{
   GIVEN("Chain with initialized invite system")
   {
      DefaultTestChain t;

      auto alice = t.from(t.addAccount("alice"_a));
      auto bob   = t.from(t.addAccount("bob"_a));
      auto a     = alice.to<Invite>();
      auto b     = bob.to<Invite>();

      auto invite = t.from(Invite::service).to<Invite>();

      using ListType = std::vector<psibase::AccountNumber>;

      THEN("A whitelist can be set")
      {
         CHECK(invite.setWhitelist(ListType{"alice"_a}).succeeded());
      }
      WHEN("A whitelist is set")
      {
         invite.setWhitelist(ListType{"alice"_a});

         THEN("A blacklist cannot be set or cleared")
         {
            CHECK(invite.setBlacklist(ListType{"bob"_a}).failed(whitelistIsSet));
            CHECK(invite.setBlacklist(ListType{}).failed(whitelistIsSet));
         }
         THEN("The whitelist can be cleared")
         {
            CHECK(invite.setWhitelist(ListType{}).succeeded());

            AND_THEN("A blacklist can be set")
            {
               CHECK(invite.setBlacklist(ListType{"bob"_a}).succeeded());
            }
         }
      }
      THEN("A nonexistent account cannot be added to the blacklist")
      {
         CHECK(invite.setBlacklist(ListType{"asdfg"_a}).failed("Account asdfg does not exist"));
      }
      THEN("A duplicate account cannot be added to the blacklist")
      {
         CHECK(invite.setBlacklist(ListType{"bob"_a, "bob"_a}).failed("Account bob duplicated"));
      }
      WHEN("An account is blacklisted")
      {
         invite.setBlacklist(ListType{"bob"_a});

         THEN("A nonblacklisted account can create an invite")
         {
            CHECK(createInvite(a, invPub).succeeded());
         }
         THEN("A blacklisted account cannot create an invite")
         {
            CHECK(createInvite(b, invPub).failed(noBlacklisted));
         }
         THEN("A blacklist can be cleared")
         {
            CHECK(invite.setBlacklist(ListType{}).succeeded());

            AND_THEN("A formerly blacklisted account can create an invite")
            {
               CHECK(createInvite(b, invPub).succeeded());
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
      auto invited = t.from(Invite::payerAccount);

      t.setAuth<AuthSig::AuthSig>(bob.id, userPub);
      t.setAuth<AuthSig::AuthSig>(charlie.id, userPub);

      auto userKeys        = KeyList{{userPub, userPriv}};
      auto combinedKeyList = KeyList{{userPub, userPriv}, {invPub, invPriv}};
      auto invitedKeys     = KeyList{{invPub, invPriv}};

      auto a = alice.to<Invite>();
      auto b = bob.with(combinedKeyList).to<Invite>();
      auto c = charlie.with(combinedKeyList).to<Invite>();
      auto i = invited.with(invitedKeys).to<Invite>();
      WHEN("Alice creates an invite")
      {
         createInvite(a, invPub);

         THEN("The invite can be accepted by a normal user")
         {
            CHECK(b.accept(invPub).succeeded());
         }
         THEN("An invite can be accepted by invited-sys in order to create a new account")
         {
            CHECK(i.acceptCreate(invPub, "rebecca"_a, userPub).succeeded());
         }
         THEN("A normal user may not create a new account")
         {
            CHECK(b.acceptCreate(invPub, "rebecca"_a, userPub).failed(mustUseInvitedSys));
         }
         THEN("Invited-sys may not accept without also creating a new account")
         {
            CHECK(i.accept(invPub).failed(restrictedActions));
         }
         WHEN("An invite is accepted with an existing account")
         {
            b.accept(invPub);

            THEN("An accepted invite can be accepted again with a different account")
            {
               CHECK(c.accept(invPub).succeeded());
            }
            THEN("An accepted invite can be accepted again with a created account")
            {
               CHECK(i.acceptCreate(invPub, "rebecca"_a, userPub).succeeded());
            }
         }
         THEN("Accepting fails if the inviteKey doesn't exist")
         {
            CHECK(a.accept(thrdPub).failed(inviteDNE));
         }
         THEN("Accepting fails if the transaction is missing the specified invite pubkey claim")
         {
            CHECK(b.accept(invPub).failed(missingInviteSig));
         }
         THEN("Accepting fails if the transaction is missing the specified invite pubkey proof")
         {
            // Manually constructing the transaction to avoid adding the proper proof
            transactor<Invite> service(bob, Invite::service);
            auto               trx = t.makeTransaction({service.accept(invPub)});
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
         THEN("Accepting fails if the invite is rejected")
         {
            // Reject the invite
            i.reject(invPub);

            // Try accept with create
            CHECK(i.acceptCreate(invPub, "rebecca"_a, userPub).failed(alreadyRejected));

            // Try accept with existing user
            CHECK(b.accept(invPub).failed(alreadyRejected));
         }
         THEN("Accepting with create fails if the inviteKey matches the newAccountKey")
         {
            CHECK(i.acceptCreate(invPub, "rebecca"_a, invPub).failed(needUniquePubkey));
         }
         THEN("Accepting fails if it would attempt to create 2 accounts from the same invite")
         {
            i.acceptCreate(invPub, "rebecca"_a, userPub);
            CHECK(i.acceptCreate(invPub, "jonathan"_a, userPub).failed(noNewAccToken));
         }
      }
   }
}
