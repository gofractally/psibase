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
using std::chrono::milliseconds;
using std::chrono::nanoseconds;
using std::chrono::seconds;
using std::chrono::weeks;

namespace
{
   constexpr seconds ONE_WEEK = duration_cast<Seconds>(weeks(1));

   // Measured `createAccount` redemption (billing on, nonzero subsidy):
   // * 293 bytes network -> 300
   // * 11.4–11.7 ms CPU -> 12 ms
   // * 656 bytes disk written -> 700 (ignore freed-row refunds)
   constexpr uint64_t CREATE_ACTION_NET_BYTES  = 300;
   constexpr uint64_t CREATE_ACTION_CPU_NS =
       duration_cast<nanoseconds>(milliseconds{12}).count();
   constexpr uint64_t CREATE_ACTION_DISK_BYTES = 700;

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

   // Configure auto debit for self on Token and NFT
   to<Nft>().setUserConf(Nft::autoDebit, false);
   to<Tokens>().setUserConf(Tokens::autoDebit, false);

   // Register event indices
   to<EventConfig>().addIndex(EventDb::historyEvent, Invite::service, "updated"_m, 0);
   to<EventConfig>().addIndex(EventDb::historyEvent, Invite::service, "updated"_m, 1);
}

namespace
{
   Quantity get_create_action_reserve()
   {
      auto virtualServer = to<VirtualServer>();
      auto net_cost      = virtualServer.get_net_cost(CREATE_ACTION_NET_BYTES);
      auto cpu_cost      = virtualServer.get_cpu_cost(CREATE_ACTION_CPU_NS);
      auto disk_cost     = virtualServer.get_disk_cost(CREATE_ACTION_DISK_BYTES);

      auto create_act_cost = (net_cost + cpu_cost + disk_cost);
      create_act_cost += create_act_cost / 10;  // 10% buffer for additional resource leeway
      return create_act_cost;
   }

   Quantity get_std_buffer_reserve()
   {
      return to<VirtualServer>().std_buffer_cost();
   }

   Quantity per_account_subsidy_for_invite(std::optional<Quantity> subsidy, bool isBilling)
   {
      if (!isBilling)
      {
         // With billing disabled, stored per-account subsidy is always zero.
         return 0;
      }
      return subsidy.value_or(get_std_buffer_reserve());
   }

   template <typename Fn>
   void for_redeemed_accounts_on_invite(RedeemedAccountTable& table,
                                        uint32_t              inviteId,
                                        Fn&&                  fn)
   {
      auto index = table.getIndex<0>();
      for (auto iter = index.lower_bound(inviteId), end = index.upper_bound(inviteId); iter != end;)
      {
         auto row = *iter;
         ++iter;
         fn(row);
      }
   }

   InviteRecord require_invite_from_inviter(InviteTable&        table,
                                            uint32_t            inviteId,
                                            AccountNumber       sender,
                                            std::string_view    unauthError)
   {
      auto invite = table.get(inviteId);
      check(invite.has_value(), inviteDNE.data());
      check(invite->inviter == sender, unauthError.data());
      return *invite;
   }

}  // namespace

Quantity Invite::getInvCost(uint16_t numAccounts, std::optional<Quantity> subsidy)
{
   if (!to<VirtualServer>().is_billing_enabled())
   {
      return 0;
   }

   auto per_account_subsidy = per_account_subsidy_for_invite(subsidy, true);
   return (get_create_action_reserve() + per_account_subsidy) * numAccounts;
}

TID getSysToken()
{
   auto sys_record = to<Tokens>().getSysToken();
   check(sys_record.has_value(), systemTokenDNE.data());
   return sys_record->id;
}

uint32_t Invite::createInvite(uint32_t             inviteId,
                              std::vector<uint8_t> payload,
                              uint16_t             numAccounts,
                              bool                 useHooks,
                              Quantity             resources,
                              std::optional<Quantity> subsidy)
{
   std::vector<char> payloadChars(payload.begin(), payload.end());
   auto              invPayload  = psio::from_frac<InvPayload>(payloadChars);
   auto              fingerprint = invPayload.fingerprint;

   auto sender    = getSender();
   auto isBilling = to<VirtualServer>().is_billing_enabled();

   check(fingerprint.size() == 32, fprintInvalid.data());
   Checksum256 fingerprint_checksum;
   std::memcpy(fingerprint_checksum.data(), fingerprint.data(), 32);

   auto resolved_subsidy = per_account_subsidy_for_invite(subsidy, isBilling);

   uint64_t needed = 0;
   if (isBilling)
   {
      auto per_account = (get_create_action_reserve() + resolved_subsidy).value;
      if (numAccounts > 0)
      {
         check(per_account <= std::numeric_limits<uint64_t>::max() /
                                  static_cast<uint64_t>(numAccounts),
               tooManyAccounts.data());
      }
      needed = per_account * static_cast<uint64_t>(numAccounts);
      check(resources >= needed, notEnoughResources.data());
   }

   auto cid = to<Credentials>().issue(fingerprint_checksum,  //
                                      ONE_WEEK.count(),      //
                                      std::vector<MethodNumber>{"createAccount"_m});

   if (needed > 0)
   {
      auto sys = getSysToken();
      to<Tokens>().debit(sys, sender, resources, "");

      auto subsidy_reserve =
          Quantity{resolved_subsidy.value * static_cast<uint64_t>(numAccounts)};
      to<Tokens>().toSub(sys, std::to_string(inviteId), subsidy_reserve);

      // The rest of the resources go to the credential, to subsidize the `create` action,
      // which could (via hooks) require more resources than the simple default `createAccount` action.
      auto credential_resources = resources - subsidy_reserve;
      to<Tokens>().credit(sys, Credentials::service, credential_resources, "");
      to<Credentials>().resource(cid, credential_resources);
   }

   auto inviteTable = open<InviteTable>(KvMode::readWrite);
   check(!inviteTable.get(inviteId).has_value(), inviteIdTaken.data());
   InviteRecord invite{
       .id          = inviteId,
       .cid         = cid,
       .inviter     = sender,
       .numAccounts = numAccounts,
       .useHooks    = useHooks,
       .secret      = invPayload.secret,
       .subsidy     = resolved_subsidy,
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

      const uint64_t amount = invite->subsidy.value;
      if (amount > 0)
      {
         to<Tokens>().fromSub(sys, sub_account, amount);
         to<Tokens>().credit(sys, VirtualServer::service, amount, "");
         to<VirtualServer>().buy_res_for(amount, newAccount, "");
      }

      if (invite->numAccounts == 0)
      {
         auto remainder = balance->value - amount;
         if (remainder > 0)
         {
            to<Tokens>().fromSub(sys, sub_account, remainder);
            to<Tokens>().credit(sys, invite->inviter, remainder,
                                "Excess invite resources refunded");
         }
      }
   }

   Tables().open<RedeemedAccountTable>().put(
       RedeemedAccountRecord{.inviteId = invite->id, .account = newAccount});

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

Quantity Invite::delInvite(uint32_t inviteId)
{
   auto sender      = getSender();
   auto inviteTable = Tables().open<InviteTable>();
   auto invite      = require_invite_from_inviter(inviteTable, inviteId, sender, unauthDelete);

   Quantity refund    = 0;
   auto     sysRecord = to<Tokens>().getSysToken();
   if (sysRecord.has_value())
   {
      auto sys           = sysRecord->id;
      auto sub_account   = std::to_string(invite.id);
      auto balanceRecord = to<Tokens>().getSubBal(sys, sub_account);

      if (balanceRecord.has_value())
      {
         if (balanceRecord->value > 0)
         {
            refund = *balanceRecord;
            to<Tokens>().fromSub(sys, sub_account, refund);
            to<Tokens>().credit(sys, invite.inviter, refund, "Unused invite tokens refunded");
         }
      }
   }

   {
      auto redeemedTable = Tables().open<RedeemedAccountTable>();
      for_redeemed_accounts_on_invite(redeemedTable, inviteId, [&](const RedeemedAccountRecord& row) {
         redeemedTable.remove(row);
      });
   }
   inviteTable.remove(invite);
   to<Credentials>().consume(invite.cid);
   emit().history().updated(invite.id, getSender(), InviteEventType::deleted);

   return refund;
}

std::vector<AccountNumber> Invite::getNewAccts(uint32_t inviteId)
{
   auto sender      = getSender();
   auto inviteTable = Tables(getReceiver(), KvMode::read).open<InviteTable>();
   require_invite_from_inviter(inviteTable, inviteId, sender, unauthInviter);

   std::vector<AccountNumber> accounts;
   auto redeemedTable = Tables(getReceiver(), KvMode::read).open<RedeemedAccountTable>();
   for_redeemed_accounts_on_invite(redeemedTable, inviteId, [&](const RedeemedAccountRecord& row) {
      accounts.push_back(row.account);
   });
   return accounts;
}

optional<InviteRecord> Invite::getInvite(uint32_t inviteId)
{
   return Tables(getReceiver(), KvMode::read).open<InviteTable>().get(inviteId);
}

psibase::TimePointSec Invite::getExpDate(uint32_t inviteId)
{
   auto cid    = getInvite(inviteId)->cid;
   auto expiry = to<Credentials>().get_expiry_date(cid);
   check(expiry.has_value(), inviteCorrupted.data());
   return *expiry;
}

PSIBASE_DISPATCH(UserService::InviteNs::Invite)
