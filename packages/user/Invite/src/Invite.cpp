#include <limits>
#include <services/system/Accounts.hpp>
#include <services/system/AuthAny.hpp>
#include <services/system/AuthSig.hpp>
#include <services/system/Credentials.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/Transact.hpp>
#include <services/system/VirtualServer.hpp>
#include <services/system/commonErrors.hpp>
#include <services/user/Events.hpp>
#include <services/user/Invite.hpp>
#include <services/user/Nft.hpp>
#include <services/user/REvents.hpp>
#include <services/user/Tokens.hpp>

#include <psibase/Actor.hpp>
#include <psibase/Bitset.hpp>
#include "psibase/crypto.hpp"
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
   to<Nft>().setUserConf(Nft::manualDebit, true);
   to<Tokens>().setUserConf(Tokens::manualDebit, true);

   // Register event indices
   to<EventConfig>().addIndex(DbId::historyEvent, Invite::service, "updated"_m, 0);
   to<EventConfig>().addIndex(DbId::historyEvent, Invite::service, "updated"_m, 1);
}

namespace
{
   Quantity get_create_action_reserve()
   {
      // The basic `createAccount` action (manually measured):
      // * 293 bytes of network bandwidth -> Round up to 300
      // * 6.7MS of CPU time              -> Round up to 7ms
      const uint64_t CREATE_ACTION_NET_BYTES = 300;
      const uint64_t CREATE_ACTION_CPU_NS    = 7000000;

      auto net_cost        = to<VirtualServer>().get_net_cost(CREATE_ACTION_NET_BYTES);
      auto cpu_cost        = to<VirtualServer>().get_cpu_cost(CREATE_ACTION_CPU_NS);
      auto create_act_cost = (net_cost + cpu_cost);
      create_act_cost += create_act_cost / 10;  // 10% buffer for additional net/cpu leeway
      create_act_cost += create_act_cost / 2;   // 50% buffer to allow resource cost increase
      return create_act_cost;
   }

   Quantity get_std_buffer_reserve()
   {
      auto gas_tank_cost = to<VirtualServer>().std_buffer_cost();
      gas_tank_cost += gas_tank_cost / 2;  // 50% buffer to allow resource cost increase
      return gas_tank_cost;
   }

}  // namespace

Quantity Invite::getInvCost(uint16_t numAccounts)
{
   auto create_action_reserve = get_create_action_reserve();
   auto buffer_reserve        = get_std_buffer_reserve();

   Quantity reserve_per_account = create_action_reserve + buffer_reserve;
   return reserve_per_account * numAccounts;
}

TID getSysToken()
{
   auto sys_record = to<Tokens>().getSysToken();
   check(sys_record.has_value(), systemTokenDNE.data());
   return sys_record->id;
}

uint32_t Invite::createInvite(uint32_t    inviteId,
                              Checksum256 fingerprint,
                              uint16_t    numAccounts,
                              bool        useHooks,
                              std::string secret,
                              Quantity    resources)
{
   auto sender    = getSender();
   auto isBilling = to<VirtualServer>().is_billing_enabled();

   auto cid = to<Credentials>().issue(fingerprint,       //
                                      ONE_WEEK.count(),  //
                                      std::vector<MethodNumber>{"createAccount"_m});

   if (isBilling)
   {
      auto sys                   = getSysToken();
      auto create_action_reserve = get_create_action_reserve();
      auto gas_tank_reserve      = get_std_buffer_reserve();
      auto sum                   = create_action_reserve + gas_tank_reserve;
      if (numAccounts > 0)
      {
         check(
             sum.value <= std::numeric_limits<uint64_t>::max() / static_cast<uint64_t>(numAccounts),
             tooManyAccounts.data());
      }
      auto needed = sum.value * static_cast<uint64_t>(numAccounts);
      check(resources >= needed, notEnoughResources.data());

      if (needed > 0)
      {
         to<Tokens>().debit(sys, sender, resources, "");

         // Reserve the exact amount needed for basic resource buffering for new accounts)
         auto resource_buffers_reserve =
             Quantity{gas_tank_reserve * static_cast<uint64_t>(numAccounts)};
         to<Tokens>().toSub(sys, std::to_string(inviteId), resource_buffers_reserve);

         // The rest of the resources go to the credential, to subsidize the `create` action,
         // which could (via hooks) require more resources than the simple default `createAccount` action.
         auto credential_resources = resources - resource_buffers_reserve;
         to<Tokens>().credit(sys, Credentials::service, credential_resources, "");
         to<Credentials>().resource(cid, credential_resources);
      }
   }

   auto inviteTable = open<InviteTable>(KvMode::readWrite);
   check(!inviteTable.get(inviteId).has_value(), inviteIdTaken.data());
   InviteRecord invite{
       .id          = inviteId,
       .cid         = cid,
       .inviter     = sender,
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

   auto credential_key  = to<Credentials>().getFingerprint(cid);
   auto new_account_key = keyFingerprint(newAccountKey);

   check(credential_key != new_account_key, needUniquePubkey.data());
   to<AuthSig::AuthSig>().newAccount(newAccount, newAccountKey);

   if (to<VirtualServer>().is_billing_enabled())
   {
      auto sys         = getSysToken();
      auto sub_account = std::to_string(invite->id);

      auto balance = to<Tokens>().getSubBal(sys, sub_account);
      check(balance.has_value(), inviteCorrupted.data());

      // If the amount needed to fill a standard buffer is less than the amount available
      // for the new account, only use what's needed - This leaves more resources available per
      // account for the rest.
      auto     per_account     = (*balance) / (invite->numAccounts + 1);
      auto     std_buffer_cost = to<VirtualServer>().std_buffer_cost().value;
      uint64_t amount          = std::min(per_account, std_buffer_cost);

      to<Tokens>().fromSub(sys, sub_account, amount);
      to<Tokens>().credit(sys, VirtualServer::service, amount, "");
      to<VirtualServer>().buy_res_for(amount, newAccount, "");

      if (invite->numAccounts == 0)
      {
         // Refund when there is still excess after the invite cannot create any accounts
         auto remainder = balance->value - amount;
         if (remainder > 0)
         {
            to<Tokens>().fromSub(sys, sub_account, remainder);
            to<Tokens>().credit(sys, invite->inviter, remainder,
                                "Excess invite resources refunded");
         }
      }
   }

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

   auto sysRecord = to<Tokens>().getSysToken();
   if (sysRecord.has_value())
   {
      auto sys           = sysRecord->id;
      auto sub_account   = std::to_string(invite->id);
      auto balanceRecord = to<Tokens>().getSubBal(sys, sub_account);

      if (balanceRecord.has_value())
      {
         if (balanceRecord->value > 0)
         {
            to<Tokens>().fromSub(sys, sub_account, balanceRecord->value);
            to<Tokens>().credit(sys, invite->inviter, balanceRecord->value,
                                "Unused invite tokens refunded");
         }
      }
   }

   inviteTable.remove(*invite);
   to<Credentials>().consume(invite->cid);
   emit().history().updated(invite->id, getSender(), InviteEventType::deleted);
}

optional<InviteRecord> Invite::getInvite(uint32_t inviteId)
{
   return Tables(getReceiver(), KvMode::read).open<InviteTable>().get(inviteId);
}

PSIBASE_DISPATCH(UserService::InviteNs::Invite)