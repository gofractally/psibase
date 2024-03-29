#define CATCH_CONFIG_MAIN

#include <psibase/DefaultTestChain.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/AuthAny.hpp>
#include <services/system/AuthK1.hpp>
#include <services/system/VerifyK1.hpp>
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

   auto thrdPub  = publicKeyFromString("PUB_K1_5R5oQcBRmfm1kT2C9DNYbWyNP9hM9CEaVi15KNYW6dvxA1UvAP");
   auto thrdPriv = privateKeyFromString("PVT_K1_M2spo9Hx4a8Un8MsxZ1SEcqunTKVyv9ZctpEPvKQ6jQbXG8xT");
}  // namespace

// - Auth
//    - Alice cannot use AuthInviteSys
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

      THEN("Alice cannot use AuthInviteSys")
      {
         auto setAuthServ = a.setAuthServ(AuthInviteSys::service);
         CHECK(setAuthServ.failed(notWhitelisted));
      }
      THEN("Accounts can still create new accounts")
      {
         auto newAcc = accounts.newAccount("bob", AuthAny::service, true);
         CHECK(newAcc.succeeded());
      }
      THEN("A regular user cannot create a new account")
      {
         auto newAcc = a.newAccount("bob", AuthAny::service, true);
         CHECK(newAcc.failed("unauthorized account creation"));
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
      auto invited = t.from(InviteSys::payerAccount).with({{invPub, invPriv}});

      auto a = alice.to<InviteSys>();
      auto b = bob.to<InviteSys>();
      auto i = invited.to<InviteSys>();

      THEN("Alice can create an invite")
      {
         auto createInvite = a.createInvite(invPub);
         CHECK(createInvite.succeeded());

         AND_THEN("Alice cannot create another invite with the same key")
         {
            auto createInvite2 = a.createInvite(invPub);
            CHECK(createInvite2.failed(inviteAlreadyExists));
         }
         AND_THEN("Alice can create another invite with a different key")
         {
            auto createInvite2 = a.createInvite(thrdPub);
            CHECK(createInvite2.succeeded());
         }
      }
      THEN("Invited-sys cannot create an invite")
      {
         auto createInvite = i.createInvite(userPub);
         CHECK(createInvite.failed(restrictedActions));
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
      auto invited = t.from(InviteSys::payerAccount);

      t.setAuthK1(alice, userPub);
      t.setAuthK1(bob, userPub);

      WHEN("Alice creates an invite")
      {
         alice.with({{userPub, userPriv}}).to<InviteSys>().createInvite(invPub);

         THEN("Invitee can reject an invite as invited-sys")
         {
            KeyList keys   = {{invPub, invPriv}};
            auto    reject = invited.with(keys).to<InviteSys>().reject(invPub);
            CHECK(reject.succeeded());
         }
         THEN("Invitee can reject an invite as a normal user")
         {
            KeyList keys   = {{userPub, userPriv}, {invPub, invPriv}};
            auto    reject = bob.with(keys).to<InviteSys>().reject(invPub);
            CHECK(reject.succeeded());
         }
         THEN("Reject fails if it is already rejected")
         {
            KeyList keys = {{invPub, invPriv}};
            invited.with(keys).to<InviteSys>().reject(invPub);
            auto reject = invited.with(keys).to<InviteSys>().reject(invPub);
            CHECK(reject.failed(alreadyRejected));
         }
         THEN("Reject fails if it is already accepted")
         {
            KeyList keys   = {{userPub, userPriv}, {invPub, invPriv}};
            auto    accept = bob.with(keys).to<InviteSys>().accept(invPub);
            CHECK(accept.succeeded());
            auto reject = bob.with(keys).to<InviteSys>().reject(invPub);
            CHECK(reject.failed(alreadyAccepted));
         }
         THEN("Reject fails if transaction isn't signed with the invite public key")
         {
            KeyList keys   = {{userPub, userPriv}};
            auto    reject = bob.with(keys).to<InviteSys>().reject(invPub);
            CHECK(reject.failed(missingInviteSig));

            auto reject2 = invited.with({}).to<InviteSys>().reject(invPub);
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
      auto a     = alice.to<InviteSys>();
      auto b     = bob.to<InviteSys>();

      WHEN("Alice creates an invite")
      {
         a.createInvite(invPub);

         THEN("Only alice can delete the invite")
         {
            auto delete1 = b.delInvite(invPub);
            CHECK(delete1.failed(unauthDelete));
            auto delete2 = a.delInvite(invPub);
            CHECK(delete2.succeeded());
         }
         AND_WHEN("Alice deletes the invite")
         {
            a.delInvite(invPub);

            THEN("The invite no longer exists")
            {
               auto ret             = a.getInvite(invPub).returnVal();
               bool inviteIsDeleted = not ret.has_value();
               CHECK(inviteIsDeleted);
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

      auto alice = t.from(t.addAccount("alice"_a));
      auto bob   = t.from(t.addAccount("bob"_a));
      t.setAuthK1(bob, userPub);

      auto a = alice.to<InviteSys>();
      auto b = bob.with({{userPub, userPriv}}).to<InviteSys>();

      WHEN("Alice creates an invite and it isn't expired")
      {
         a.createInvite(invPub);

         int64_t oneWeek  = (60 * 60 * 24 * 7);
         int64_t passTime = oneWeek - 2;  // 2 seconds before expiration
         t.startBlock(passTime * 1000);

         // Add another invite that is not close to expiring
         b.createInvite(thrdPub);

         THEN("It can be rejected")
         {
            KeyList keys   = {{userPub, userPriv}, {invPub, invPriv}};
            auto    reject = bob.with(keys).to<InviteSys>().reject(invPub);
            CHECK(reject.succeeded());
         }

         AND_WHEN("It expires")
         {
            t.startBlock(1000);

            THEN("It cannot be rejected")
            {
               KeyList keys   = {{userPub, userPriv}, {invPub, invPriv}};
               auto    reject = bob.with(keys).to<InviteSys>().reject(invPub);
               CHECK(reject.failed(inviteExpired));
            }
            THEN("It cannot be accepted")
            {
               KeyList keys   = {{userPub, userPriv}, {invPub, invPriv}};
               auto    accept = bob.with(keys).to<InviteSys>().accept(invPub);
               CHECK(accept.failed(inviteExpired));
            }
            THEN("It can be deleted by the creator")
            {
               auto delInvite = a.delInvite(invPub);
               CHECK(delInvite.succeeded());
            }
            THEN("It can be deleted by anyone")
            {
               KeyList keys       = {{userPub, userPriv}};
               auto    delExpired = bob.with(keys).to<InviteSys>().delExpired(5);
               CHECK(delExpired.succeeded());

               AND_THEN("Only the expired invite was deleted")
               {
                  auto expiredInvite = a.getInvite(invPub).returnVal();
                  auto invDNE        = not expiredInvite.has_value();
                  CHECK(invDNE);

                  auto validInvExists2 = a.getInvite(thrdPub).returnVal().has_value();
                  CHECK(validInvExists2);
               }
            }
         }
      }
   }
}

// - Setting a whitelist
//    - A whitelist can be set by invite-sys
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
      auto a     = alice.to<InviteSys>();
      auto b     = bob.to<InviteSys>();

      auto inviteSys = t.from(InviteSys::service).to<InviteSys>();

      using ListType = std::vector<psibase::AccountNumber>;

      THEN("A whitelist can only be set on the Invite service by Invite-sys")
      {
         auto setWhitelist = a.setWhitelist(ListType{"alice"_a});
         CHECK(setWhitelist.failed(missingRequiredAuth));

         auto setWhitelist2 = inviteSys.setWhitelist(ListType{"alice"_a});
         CHECK(setWhitelist2.succeeded());
      }
      THEN("A nonexistent account cannot be added to the whitelist")
      {
         auto setWhitelist = inviteSys.setWhitelist(ListType{"asdfg"_a});
         CHECK(setWhitelist.failed("Account asdfg does not exist"));
      }
      THEN("Duplicate accounts cannot be added to the whitelist")
      {
         auto setWhitelist = inviteSys.setWhitelist(ListType{"alice"_a, "alice"_a});
         CHECK(setWhitelist.failed("Account alice duplicated"));
      }
      THEN("A blacklist can be set on the invite service")
      {
         auto setBlacklist = inviteSys.setBlacklist(ListType{"alice"_a});
         CHECK(setBlacklist.succeeded());
      }
      WHEN("A blacklisted account is set")
      {
         inviteSys.setBlacklist(ListType{"alice"_a});

         THEN("The blacklisted account cannot then be added to the whitelist")
         {
            auto setWhitelist = inviteSys.setWhitelist(ListType{"alice"_a});
            CHECK(setWhitelist.failed("Account alice already on blacklist"));
         }
         THEN("The blacklist can be cleared")
         {
            auto setBlacklist = inviteSys.setBlacklist(ListType{});
            CHECK(setBlacklist.succeeded());

            AND_THEN("The formerly blacklisted account can be added to the whitelist")
            {
               auto setWhitelist = inviteSys.setWhitelist(ListType{"alice"_a});
               CHECK(setWhitelist.succeeded());
            }
         }
      }
      WHEN("A whitelist is set")
      {
         inviteSys.setWhitelist(ListType{"alice"_a});

         THEN("A non-whitelisted account cannot create an invite")
         {
            auto createInvite = b.createInvite(invPub);
            CHECK(createInvite.failed(onlyWhitelisted));
         }
         THEN("A whitelisted account can create an invite")
         {
            auto createInvite = a.createInvite(invPub);
            CHECK(createInvite.succeeded());
         }
         THEN("The whitelist can be cleared")
         {
            auto setWhitelist = inviteSys.setWhitelist(ListType{});
            AND_THEN("A formerly non-whitelisted account can create an invite")
            {
               auto createInvite = b.createInvite(invPub);
               CHECK(createInvite.succeeded());
            }
         }
      }
   }
}

// - Setting a blacklist
//    - A blacklist can be set by invite-sys, only if there is no whitelist
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
      auto a     = alice.to<InviteSys>();
      auto b     = bob.to<InviteSys>();

      auto inviteSys = t.from(InviteSys::service).to<InviteSys>();

      using ListType = std::vector<psibase::AccountNumber>;

      THEN("A whitelist can be set")
      {
         auto setWhitelist = inviteSys.setWhitelist(ListType{"alice"_a});
         CHECK(setWhitelist.succeeded());
      }
      WHEN("A whitelist is set")
      {
         inviteSys.setWhitelist(ListType{"alice"_a});

         THEN("A blacklist cannot be set or cleared")
         {
            auto setBlacklist = inviteSys.setBlacklist(ListType{"bob"_a});
            CHECK(setBlacklist.failed(whitelistIsSet));
            auto clearBlacklist = inviteSys.setBlacklist(ListType{});
            CHECK(clearBlacklist.failed(whitelistIsSet));
         }
         THEN("The whitelist can be cleared")
         {
            auto clearWhitelist = inviteSys.setWhitelist(ListType{});
            CHECK(clearWhitelist.succeeded());

            AND_THEN("A blacklist can be set")
            {
               auto setBlacklist = inviteSys.setBlacklist(ListType{"bob"_a});
               CHECK(setBlacklist.succeeded());
            }
         }
      }
      THEN("A nonexistent account cannot be added to the blacklist")
      {
         auto setBlacklist = inviteSys.setBlacklist(ListType{"asdfg"_a});
         CHECK(setBlacklist.failed("Account asdfg does not exist"));
      }
      THEN("A duplicate account cannot be added to the blacklist")
      {
         auto setBlacklist = inviteSys.setBlacklist(ListType{"bob"_a, "bob"_a});
         CHECK(setBlacklist.failed("Account bob duplicated"));
      }
      WHEN("An account is blacklisted")
      {
         inviteSys.setBlacklist(ListType{"bob"_a});

         THEN("A nonblacklisted account can create an invite")
         {
            auto createInvite = a.createInvite(invPub);
            CHECK(createInvite.succeeded());
         }
         THEN("A blacklisted account cannot create an invite")
         {
            auto createInvite = b.createInvite(invPub);
            CHECK(createInvite.failed(noBlacklisted));
         }
         THEN("A blacklist can be cleared")
         {
            auto clearBlacklist = inviteSys.setBlacklist(ListType{});
            CHECK(clearBlacklist.succeeded());

            AND_THEN("A formerly blacklisted account can create an invite")
            {
               auto createInvite = b.createInvite(invPub);
               CHECK(createInvite.succeeded());
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
      auto invited = t.from(InviteSys::payerAccount);
      t.setAuthK1(bob, userPub);
      t.setAuthK1(charlie, userPub);

      WHEN("Alice creates an invite")
      {
         alice.to<InviteSys>().createInvite(invPub);

         THEN("The invite can be accepted by a normal user")
         {
            KeyList keys{{userPub, userPriv}, {invPub, invPriv}};
            auto    accept = bob.with(keys).to<InviteSys>().accept(invPub);
            CHECK(accept.succeeded());
         }
         THEN("An invite can be accepted by invited-sys in order to create a new account")
         {
            KeyList keys{{invPub, invPriv}};
            auto    acceptCreate =
                invited.with(keys).to<InviteSys>().acceptCreate(invPub, "rebecca"_a, userPub);
            CHECK(acceptCreate.succeeded());
         }
         THEN("A normal user may not create a new account")
         {
            KeyList keys{{userPub, userPriv}, {invPub, invPriv}};
            auto    acceptCreate =
                bob.with(keys).to<InviteSys>().acceptCreate(invPub, "rebecca"_a, userPub);
            CHECK(acceptCreate.failed(mustUseInvitedSys));
         }
         THEN("Invited-sys may not accept without also creating a new account")
         {
            KeyList keys{{invPub, invPriv}};
            auto    accept = invited.with(keys).to<InviteSys>().accept(invPub);
            CHECK(accept.failed(restrictedActions));
         }
         WHEN("An invite is accepted with an existing account")
         {
            KeyList keys{{userPub, userPriv}, {invPub, invPriv}};
            bob.with(keys).to<InviteSys>().accept(invPub);

            THEN("An accepted invite can be accepted again with a different account")
            {
               auto accept = charlie.with(keys).to<InviteSys>().accept(invPub);
               CHECK(accept.succeeded());
            }
            THEN("An accepted invite can be accepted again with a created account")
            {
               KeyList invitedKeys{{invPub, invPriv}};
               auto    acceptCreate = invited.with(invitedKeys)
                                       .to<InviteSys>()
                                       .acceptCreate(invPub, "rebecca"_a, userPub);
               CHECK(acceptCreate.succeeded());
            }
         }
         THEN("Accepting fails if the inviteKey doesn't exist")
         {
            KeyList keys{{userPub, userPriv}, {invPub, invPriv}};
            auto    accept = bob.with(keys).to<InviteSys>().accept(thrdPub);
            CHECK(accept.failed(inviteDNE));
         }
         THEN("Accepting fails if the transaction is missing the specified invite pubkey claim")
         {
            KeyList keys{{userPub, userPriv}};
            auto    accept = bob.with(keys).to<InviteSys>().accept(invPub);
            CHECK(accept.failed(missingInviteSig));
         }
         THEN("Accepting fails if the transaction is missing the specified invite pubkey proof")
         {
            KeyList keys{{userPub, userPriv}, {invPub, invPriv}};

            // Manually constructing the transaction to avoid adding the proper proof
            transactor<InviteSys> service(bob, InviteSys::service);
            auto                  trx = t.makeTransaction({service.accept(invPub)});
            for (const auto& key : keys)
            {
               trx.claims.push_back({
                   .service = VerifyK1::service,
                   .rawData = psio::convert_to_frac(key.first),
               });
            }
            SignedTransaction signedTrx;
            signedTrx.transaction = trx;
            auto hash = sha256(signedTrx.transaction.data(), signedTrx.transaction.size());
            auto key  = keys[0];
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
            KeyList invitedKeys{{invPub, invPriv}};
            invited.with(invitedKeys).to<InviteSys>().reject(invPub);

            // Try accept with create
            auto acceptCreate = invited.with(invitedKeys)
                                    .to<InviteSys>()
                                    .acceptCreate(invPub, "rebecca"_a, userPub);
            CHECK(acceptCreate.failed(alreadyRejected));

            // Try accept with existing user
            KeyList keys{{userPub, userPriv}, {invPub, invPriv}};
            auto    accept = bob.with(keys).to<InviteSys>().accept(invPub);
            CHECK(accept.failed(alreadyRejected));
         }
         THEN("Accepting with create fails if the inviteKey matches the newAccountKey")
         {
            KeyList keys{{invPub, invPriv}};
            auto    acceptCreate =
                invited.with(keys).to<InviteSys>().acceptCreate(invPub, "rebecca"_a, invPub);
            CHECK(acceptCreate.failed(needUniquePubkey));
         }
         THEN("Accepting fails if it would attempt to create 2 accounts from the same invite")
         {
            KeyList keys{{invPub, invPriv}};
            invited.with(keys).to<InviteSys>().acceptCreate(invPub, "rebecca"_a, userPub);
            auto acceptCreate =
                invited.with(keys).to<InviteSys>().acceptCreate(invPub, "jonathan"_a, userPub);
            CHECK(acceptCreate.failed(noNewAccToken));
         }
      }
   }
}
