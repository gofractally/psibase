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
   check(not init.has_value(), alreadyInit);
   initTable.put(InitializedRecord{});

   // Register with proxy
   to<SystemService::HttpServer>().registerServer(Invite::service);

   // Configure manual debit for self on Token and NFT
   auto manualDebit = psibase::EnumElement{"manualDebit"};
   to<Tokens>().setUserConf(manualDebit, true);
   to<Nft>().setUserConf(manualDebit, true);

   // Create the invite payer account and set its auth contract
   to<Accounts>().newAccount(payerAccount, AuthInvite::service, true);

   // Register event indices and schema
   to<EventIndex>().setSchema(ServiceSchema::make<Invite>());

   // Event indices:
   to<EventIndex>().addIndex(DbId::historyEvent, Invite::service, "inviteCreated"_m, 1);
   to<EventIndex>().addIndex(DbId::historyEvent, Invite::service, "inviteAccepted"_m, 1);
}

void Invite::createInvite(Spki                         inviteKey,
                          std::optional<AccountNumber> app,
                          std::optional<std::string>   appDomain)
{
   auto inviteTable = Tables().open<InviteTable>();
   check(not inviteTable.get(inviteKey).has_value(), inviteAlreadyExists.data());

   auto inviter       = getSender();
   auto settingsTable = Tables().open<InviteSettingsTable>();
   auto settings      = settingsTable.get(SingletonKey{}).value_or(InviteSettingsRecord{});

   if (settings.whitelist.size() > 0)
   {
      bool whitelisted = std::ranges::find(settings.whitelist, inviter) != settings.whitelist.end();
      check(whitelisted, onlyWhitelisted.data());
   }
   else if (settings.blacklist.size() > 0)
   {
      bool blacklisted = std::ranges::find(settings.blacklist, inviter) != settings.blacklist.end();
      check(not blacklisted, noBlacklisted.data());
   }

   // Add invite
   Seconds      secondsInWeek{60 * 60 * 24 * 7};
   InviteRecord newInvite{
       .pubkey    = inviteKey,
       .inviter   = inviter,
       .app       = app,
       .appDomain = appDomain,
       .expiry    = std::chrono::time_point_cast<Seconds>(to<Transact>().currentBlock().time) +
                 secondsInWeek,
       .newAccountToken = true,
       .state           = InviteStates::pending,
   };
   inviteTable.put(newInvite);

   emit().history().inviteCreated(inviteKey, inviter);
}

void Invite::accept(Spki inviteKey)
{
   auto inviteTable = Tables().open<InviteTable>();
   auto invite      = inviteTable.get(inviteKey);
   check(invite.has_value(), inviteDNE.data());

   to<AuthInvite>().requireAuth(inviteKey);

   auto acceptedBy = getSender();
   check(acceptedBy != Invite::payerAccount,
         "Call 'accept' with the accepting account as the sender.");
   check(invite->state != InviteStates::rejected, "This invite was already rejected");

   auto now = to<Transact>().currentBlock().time;
   check(invite->expiry > now, inviteExpired.data());

   invite->actor = acceptedBy;
   invite->state = InviteStates::accepted;
   inviteTable.put(*invite);

   // Emit event
   emit().history().inviteAccepted(inviteKey, acceptedBy);
}

void Invite::acceptCreate(Spki inviteKey, AccountNumber acceptedBy, Spki newAccountKey)
{
   auto sender      = getSender();
   auto inviteTable = Tables().open<InviteTable>();
   auto invite      = inviteTable.get(inviteKey);
   check(invite.has_value(), inviteDNE.data());

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

   emit().history().inviteAccepted(inviteKey, acceptedBy);
}

void Invite::reject(Spki inviteKey)
{
   auto table  = Tables().open<InviteTable>();
   auto invite = table.get(inviteKey);
   check(invite.has_value(), inviteDNE);

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

   emit().history().inviteRejected(inviteKey);
}

void Invite::delInvite(Spki inviteKey)
{
   auto sender      = getSender();
   auto inviteTable = Tables().open<InviteTable>();
   auto invite      = inviteTable.get(inviteKey);
   check(invite.has_value(), inviteDNE.data());
   check(invite->inviter == sender, unauthDelete.data());
   inviteTable.remove(*invite);

   emit().history().inviteDeleted(inviteKey);
}

void Invite::delExpired(uint32_t maxDeleted)
{
   auto now = to<Transact>().currentBlock().time;

   auto table = Tables().open<InviteTable>();

   uint32_t numChecked = 0;
   uint32_t numDeleted = 0;
   for (auto invite : table.getIndex<0>())
   {
      if (now >= invite.expiry)
      {
         table.remove(invite);
         ++numDeleted;
         if (numDeleted >= maxDeleted)
            break;
      }
      ++numChecked;
   }

   emit().history().expInvDeleted(numChecked, numDeleted);
}

void Invite::setWhitelist(vector<AccountNumber> accounts)
{
   check(getSender() == getReceiver(), missingRequiredAuth.data());

   // Check that no blacklisted accounts are being whitelisted
   auto settingsTable = Tables().open<InviteSettingsTable>();
   auto settings      = settingsTable.get(SingletonKey{}).value_or(InviteSettingsRecord{});
   for (const auto& acc : settings.blacklist)
   {
      bool blacklisted = find(begin(accounts), end(accounts), acc) != end(accounts);
      if (blacklisted)
      {
         string err = "Account " + acc.str() + " already on blacklist";
         abortMessage(err);
      }
   }

   // Detect invalid accounts
   std::map<AccountNumber, uint32_t> counts;
   auto                              accountsService = to<Accounts>();
   for (const auto& acc : accounts)
   {
      if (!accountsService.exists(acc))
      {
         std::string err = "Account " + acc.str() + " does not exist";
         abortMessage(err);
      }
      if (counts[acc] == 0)
         counts[acc]++;
      else
      {
         std::string err = "Account " + acc.str() + " duplicated";
         abortMessage(err);
      }
   }

   settings.whitelist = accounts;
   settingsTable.put(settings);

   emit().history().whitelistSet(accounts);
}

void Invite::setBlacklist(vector<AccountNumber> accounts)
{
   check(getSender() == getReceiver(), missingRequiredAuth.data());

   // Check that no whitelisted accounts are being blacklisted
   auto settingsTable = Tables().open<InviteSettingsTable>();
   auto settings      = settingsTable.get(SingletonKey{}).value_or(InviteSettingsRecord{});
   check(settings.whitelist.empty(), whitelistIsSet.data());

   // Detect invalid accounts
   std::map<AccountNumber, uint32_t> counts;
   auto                              accountsService = to<Accounts>();
   for (const auto& acc : accounts)
   {
      if (!accountsService.exists(acc))
      {
         std::string err = "Account " + acc.str() + " does not exist";
         abortMessage(err);
      }
      if (counts[acc] == 0)
         counts[acc]++;
      else
      {
         std::string err = "Account " + acc.str() + " duplicated";
         abortMessage(err);
      }
   }

   settings.blacklist = accounts;
   settingsTable.put(settings);

   emit().history().blacklistSet(accounts);
}

optional<InviteRecord> Invite::getInvite(Spki pubkey)
{
   return Tables().open<InviteTable>().get(pubkey);
}

bool Invite::isExpired(Spki pubkey)
{
   auto inviteTable = Tables().open<InviteTable>();
   auto invite      = inviteTable.get(pubkey);
   check(invite.has_value(), inviteDNE.data());

   auto now = to<Transact>().currentBlock().time;
   return now >= invite->expiry;
}

void Invite::checkClaim(AccountNumber actor, Spki pubkey)
{
   auto invite = getInvite(pubkey);
   check(invite.has_value(), "This invite does not exist. It may have been deleted after expiry.");
   check(invite->state == InviteStates::accepted, "invite is not in accepted state");
   check(invite->actor == actor, "only " + invite->actor.str() + " may accept this invite");
   check(not isExpired(pubkey), "this invite is expired");
}

struct Queries
{
   auto allCreatedInv() const
   {
      // Todo: pagination?
      auto result =
          to<REvents>().sqlQuery("SELECT * FROM \"history.invite.invitecreated\" ORDER BY ROWID");
      return std::string{result.begin(), result.end()};
   }

   auto getAllInvites() const { return Invite::Tables{}.open<InviteTable>().getIndex<0>(); }

   auto getInvite(string pubkey) const
   {
      return Invite::Tables(Invite::service)
          .open<InviteTable>()
          .get(Spki{AuthSig::parseSubjectPublicKeyInfo(pubkey)});
   }

   // This is called getInviter because it's used to look up the new account `user`
   //    in a table that tracks their original inviter.
   auto getInviter(psibase::AccountNumber user) const
   {
      return Invite::Tables(Invite::service).open<InviteNs::NewAccTable>().get(user);
   }
};
PSIO_REFLECT(Queries,
             method(allCreatedInv),
             method(getAllInvites),
             method(getInvite, pubkey),
             method(getInviter, user))

auto Invite::serveSys(HttpRequest request) -> std::optional<HttpReply>
{
   if (auto result = serveSimpleUI<Invite, true>(request))
      return result;

   if (auto result = serveGraphQL(request, Queries{}))
      return result;

   return std::nullopt;
}

PSIBASE_DISPATCH(UserService::InviteNs::Invite)
