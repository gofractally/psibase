#include <services/system/Accounts.hpp>
#include <services/system/AuthAny.hpp>
#include <services/system/AuthSig.hpp>
#include <services/system/Credentials.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/Transact.hpp>
#include <services/system/commonErrors.hpp>
#include <services/user/Events.hpp>
#include <services/user/Invite.hpp>
#include <services/user/Nft.hpp>
#include <services/user/REvents.hpp>
#include <services/user/Tokens.hpp>

#include <psibase/Actor.hpp>
#include <psibase/Bitset.hpp>
#include "psibase/db.hpp"
#include "psibase/nativeTables.hpp"
#include "psibase/serviceState.hpp"
#include "services/user/InviteErrors.hpp"

using namespace psibase;
using namespace UserService;
using namespace UserService::InviteNs;
using namespace UserService::Errors;
using namespace SystemService;
using std::optional;
using std::string;
using std::chrono::duration_cast;
using std::chrono::seconds;
using std::chrono::weeks;

namespace
{
   constexpr seconds ONE_WEEK = duration_cast<Seconds>(weeks(1));

   void hookOnInvAccept(const InviteRecord& invite, AccountNumber accepter)
   {
      if (invite.useHooks)
      {
         Actor<InviteHooks>{Invite::service, invite.inviter}.onInvAccept(invite.id, accepter);
      }
   }

   void hookOnInvDelete(const InviteRecord& invite)
   {
      if (invite.useHooks)
      {
         Actor<InviteHooks>{Invite::service, invite.inviter}.onInvDelete(invite.id);
      }
   }

}  // namespace

Invite::Invite(psio::shared_view_ptr<Action> action)
{
   MethodNumber m{action->method()};
   if (m != MethodNumber{"init"})
   {
      auto initRecord = Tables(getReceiver(), KvMode::read).open<InitTable>().get({});
      check(initRecord.has_value(), UserService::Errors::uninitialized);
   }

   if (getSender() != Credentials::CREDENTIAL_SENDER)
   {
      if (m == "createAccount"_m)
      {
         string error = "Only " + Credentials::CREDENTIAL_SENDER.str() + " can call createAccount";
         abortMessage(error);
      }
   }
}

void Invite::init()
{
   auto initTable = Tables().open<InitTable>();
   auto init      = (initTable.get({}));
   initTable.put(InitializedRecord{});

   // Configure manual debit for self on Token and NFT
   auto manualDebit = psibase::EnumElement{"manualDebit"};
   to<Nft>().setUserConf(manualDebit, true);
   to<Tokens>().setUserConf(Tokens::manualDebit, true);

   // Register event indices
   to<EventConfig>().addIndex(DbId::historyEvent, Invite::service, "updated"_m, 0);
   to<EventConfig>().addIndex(DbId::historyEvent, Invite::service, "updated"_m, 1);
}

uint32_t Invite::createInvite(uint32_t    inviteId,
                              Spki        inviteKey,
                              uint16_t    numAccounts,
                              bool        useHooks,
                              std::string secret)
{
   auto sender = getSender();

   // TODO: Debit from the sender according to how many
   // new accounts are being authorized by the invite

   auto         inviteTable = Tables().open<InviteTable>();
   InviteRecord invite{
       .id          = inviteId,
       .cid         = to<Credentials>().create(inviteKey, ONE_WEEK.count(),
                                               std::vector<psibase::MethodNumber>{"createAccount"_m}),
       .inviter     = getSender(),
       .numAccounts = numAccounts,
       .useHooks    = useHooks,
       .secret      = secret,
   };
   inviteTable.put(invite);

   if (useHooks)
   {
      auto service = Native::tables(KvMode::read).open<CodeTable>().get(invite.inviter);
      check(service.has_value(), inviteHooksRequired.data());
   }

   emit().history().updated(invite.id, invite.inviter, InviteEventType::created);

   return invite.id;
}

void Invite::createAccount(AccountNumber newAccount, Spki newAccountKey)
{
   auto cid_opt = to<Credentials>().get_active();
   check(cid_opt.has_value(), noActiveCredential.data());
   uint32_t cid = cid_opt.value();

   auto inviteTable = Tables().open<InviteTable>();
   auto invite      = inviteTable.getIndex<2>().get(cid);
   check(invite.has_value(), inviteDNE.data());
   check(invite->numAccounts > 0, outOfNewAccounts.data());
   invite->numAccounts -= 1;
   inviteTable.put(*invite);

   Spki pubkey = to<Credentials>().get_pubkey(cid);
   check(pubkey != newAccountKey, needUniquePubkey.data());
   to<AuthSig::AuthSig>().newAccount(newAccount, newAccountKey);

   emit().history().updated(invite->id, newAccount, InviteEventType::accountRedeemed);
}

void Invite::accept(uint32_t inviteId)
{
   auto cid_opt = to<Credentials>().get_active();
   check(cid_opt.has_value(), noActiveCredential.data());
   uint32_t cid = cid_opt.value();

   auto inviteTable = Tables().open<InviteTable>();
   auto invite      = inviteTable.getIndex<2>().get(cid);
   check(invite.has_value(), inviteDNE.data());
   check(invite->id == inviteId, credentialMismatch.data());

   auto accepter = getSender();
   emit().history().updated(invite->id, accepter, InviteEventType::accepted);
   hookOnInvAccept(*invite, accepter);
}

void Invite::delInvite(uint32_t inviteId)
{
   auto sender      = getSender();
   auto inviteTable = Tables().open<InviteTable>();
   auto invite      = inviteTable.get(inviteId);
   check(invite.has_value(), inviteDNE.data());
   check(invite->inviter == sender, unauthDelete.data());

   inviteTable.remove(*invite);
   to<Credentials>().consume(invite->cid);
   emit().history().updated(invite->id, getSender(), InviteEventType::deleted);
   hookOnInvDelete(*invite);
}

optional<InviteRecord> Invite::getInvite(uint32_t inviteId)
{
   return Tables(getReceiver(), KvMode::read).open<InviteTable>().get(inviteId);
}

PSIBASE_DISPATCH(UserService::InviteNs::Invite)