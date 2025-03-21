#include <services/system/Accounts.hpp>
#include <services/system/AuthAny.hpp>
#include <services/system/AuthSig.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/Transact.hpp>
#include <services/system/commonErrors.hpp>
#include <services/user/AuthInvite.hpp>
#include <services/user/Events.hpp>
#include <services/user/Invite.hpp>
#include <services/user/Nft.hpp>
#include <services/user/REvents.hpp>
#include <services/user/Tokens.hpp>

#include <psibase/Bitset.hpp>
#include <vector>

using namespace psibase;
using namespace UserService;
using namespace UserService::InviteNs;
using namespace UserService::Errors;
using namespace SystemService;
using psio::view;
using std::begin;
using std::end;
using std::find;
using std::optional;
using std::string;
using std::vector;

Invite::Invite(psio::shared_view_ptr<Action> action)
{
   MethodNumber m{action->method()};
   if (m != MethodNumber{"init"})
   {
      auto initRecord = Tables().open<InitTable>().get(SingletonKey{});
      check(initRecord.has_value(), UserService::Errors::uninitialized);
   }
}

void Invite::init()
{
   auto initTable = Tables().open<InitTable>();
   auto init      = (initTable.get(SingletonKey{}));
   initTable.put(InitializedRecord{});

   // Configure manual debit for self on Token and NFT
   auto manualDebit = psibase::EnumElement{"manualDebit"};
   to<Tokens>().setUserConf(manualDebit, true);
   to<Nft>().setUserConf(manualDebit, true);

   // Create the invite payer account and set its auth contract
   to<Accounts>().newAccount(payerAccount, AuthInvite::service, false);

   // Register event indices and schema
   to<EventIndex>().setSchema(ServiceSchema::make<Invite>());
   to<EventIndex>().addIndex(DbId::historyEvent, Invite::service, "updated"_m, 0);
}

uint32_t Invite::createInvite(Spki                         inviteKey,
                              std::optional<uint32_t>      secondaryId,
                              std::optional<std::string>   secret,
                              std::optional<AccountNumber> app,
                              std::optional<std::string>   appDomain)
{
   auto inviteTable = Tables().open<InviteTable>();
   auto isNew       = inviteTable.getIndex<3>()
                    .subindex<uint32_t>(SystemService::AuthSig::keyFingerprint(inviteKey))
                    .empty();
   check(isNew, inviteAlreadyExists.data());
   auto inviter = getSender();

   auto secondsInWeek = std::chrono::duration_cast<Seconds>(std::chrono::weeks(1));
   auto now           = to<Transact>().currentBlock().time;

   auto     idx      = inviteTable.getIndex<0>();
   uint32_t inviteId = (idx.empty()) ? 0 : (*(--idx.end())).inviteId + 1;

   InviteRecord newInvite{
       .inviteId        = inviteId,
       .pubkey          = inviteKey,
       .secondaryId     = secondaryId,
       .inviter         = inviter,
       .app             = app,
       .appDomain       = appDomain,
       .expiry          = std::chrono::time_point_cast<Seconds>(now) + secondsInWeek,
       .newAccountToken = true,
       .state           = InviteStates::pending,
       .secret          = secret,
   };
   inviteTable.put(newInvite);

   emit().history().updated(inviteId, inviter, now, InviteEventType::created);

   return inviteId;
}

void Invite::accept(uint32_t inviteId)
{
   auto inviteTable = Tables().open<InviteTable>();
   auto invite      = inviteTable.get(inviteId);
   check(invite.has_value(), inviteDNE.data());

   to<AuthInvite>().requireAuth(invite->pubkey);

   auto acceptedBy = getSender();
   check(acceptedBy != Invite::payerAccount,
         "Call 'accept' with the accepting account as the sender.");
   check(invite->state != InviteStates::rejected, "This invite was already rejected");

   auto now = to<Transact>().currentBlock().time;
   check(invite->expiry > now, inviteExpired.data());

   invite->actor = acceptedBy;
   invite->state = InviteStates::accepted;
   inviteTable.put(*invite);

   emit().history().updated(inviteId, acceptedBy, now, InviteEventType::accepted);
}

void Invite::acceptCreate(uint32_t inviteId, AccountNumber acceptedBy, Spki newAccountKey)
{
   auto sender      = getSender();
   auto inviteTable = Tables().open<InviteTable>();
   auto invite      = inviteTable.get(inviteId);
   check(invite.has_value(), inviteDNE.data());
   auto inviteKey = invite->pubkey;

   to<AuthInvite>().requireAuth(inviteKey);

   auto now = to<Transact>().currentBlock().time;
   check(invite->expiry > now, inviteExpired.data());

   check(invite->state != InviteStates::rejected, alreadyRejected.data());

   bool accountExists = to<Accounts>().exists(acceptedBy);
   check(not accountExists, "The acceptedBy account already exists");

   check(sender == Invite::payerAccount, mustUseInvitedSys.data());
   check(inviteKey != newAccountKey, needUniquePubkey.data());
   check(invite->newAccountToken, noNewAccToken.data());
   invite->newAccountToken = false;

   // Create new account, and set key & auth
   to<AuthSig::AuthSig>().newAccount(acceptedBy, newAccountKey);

   invite->state = InviteStates::accepted;
   invite->actor = acceptedBy;
   inviteTable.put(*invite);

   // Remember which account is responsible for inviting the new account
   auto newAccTable = Tables().open<NewAccTable>();
   auto newAcc      = newAccTable.get(acceptedBy);
   check(not newAcc.has_value(), accAlreadyExists.data());
   newAccTable.put(NewAccountRecord{acceptedBy, invite->inviter});

   emit().history().updated(inviteId, acceptedBy, now, InviteEventType::accepted);
}

void Invite::reject(uint32_t inviteId)
{
   auto table  = Tables().open<InviteTable>();
   auto invite = table.get(inviteId);
   check(invite.has_value(), inviteDNE);
   auto inviteKey = invite->pubkey;

   to<AuthInvite>().requireAuth(inviteKey);
   check(invite->state != InviteStates::accepted, alreadyAccepted.data());
   check(invite->state != InviteStates::rejected, alreadyRejected.data());

   auto now = to<Transact>().currentBlock().time;
   check(invite->expiry > now, inviteExpired.data());

   auto sender = getSender();
   if (sender == Invite::payerAccount)
   {
      check(invite->newAccountToken == true,
            "Only an existing account can be used to reject this invite");
      invite->newAccountToken = false;
   }

   invite->state = InviteStates::rejected;
   invite->actor = sender;
   table.put(*invite);

   emit().history().updated(inviteId, sender, now, InviteEventType::rejected);
}

void Invite::delInvite(uint32_t inviteId)
{
   auto sender      = getSender();
   auto inviteTable = Tables().open<InviteTable>();
   auto invite      = inviteTable.get(inviteId);
   check(invite.has_value(), inviteDNE.data());
   check(invite->inviter == sender, unauthDelete.data());
   inviteTable.remove(*invite);

   auto now = to<Transact>().currentBlock().time;
   emit().history().updated(inviteId, sender, now, InviteEventType::deleted);
}

void Invite::delExpired(uint32_t maxDeleted)
{
   auto sender = getSender();
   auto now    = to<Transact>().currentBlock().time;

   auto table = Tables().open<InviteTable>();

   uint32_t numChecked = 0;
   uint32_t numDeleted = 0;
   for (auto invite : table.getIndex<0>())
   {
      if (now >= invite.expiry)
      {
         table.remove(invite);
         ++numDeleted;

         emit().history().updated(invite.inviteId, sender, now, InviteEventType::deletedExpired);

         if (numDeleted >= maxDeleted)
            break;
      }
      ++numChecked;
   }
}

optional<InviteRecord> Invite::getInvite(uint32_t inviteId)
{
   return Tables().open<InviteTable>().get(inviteId);
}

bool Invite::isExpired(uint32_t inviteId)
{
   auto inviteTable = Tables().open<InviteTable>();
   auto invite      = inviteTable.get(inviteId);
   check(invite.has_value(), inviteDNE.data());

   auto now = to<Transact>().currentBlock().time;
   return now >= invite->expiry;
}

void Invite::checkClaim(AccountNumber actor, uint32_t inviteId)
{
   auto invite = getInvite(inviteId);
   check(invite.has_value(), "This invite does not exist. It may have been deleted after expiry.");
   check(invite->state == InviteStates::accepted, "invite is not in accepted state");
   check(invite->actor == actor, "only " + invite->actor.str() + " may accept this invite");
   check(not isExpired(inviteId), "this invite is expired");
}

PSIBASE_DISPATCH(UserService::InviteNs::Invite)
