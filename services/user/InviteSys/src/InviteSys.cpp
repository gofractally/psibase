#include <services/system/AccountSys.hpp>
#include <services/system/AuthAnySys.hpp>
#include <services/system/AuthEcSys.hpp>
#include <services/system/ProxySys.hpp>
#include <services/system/TransactionSys.hpp>
#include <services/system/commonErrors.hpp>
#include <services/user/AuthInviteSys.hpp>
#include <services/user/InviteSys.hpp>
#include <services/user/NftSys.hpp>
#include <services/user/TokenSys.hpp>

#include <psibase/Bitset.hpp>
#include <vector>

using namespace psibase;
using namespace UserService;
using namespace UserService::Invite;
using namespace UserService::Errors;
using namespace SystemService;
using psio::const_view;
using std::begin;
using std::end;
using std::find;
using std::move;
using std::optional;
using std::string;
using std::vector;

InviteSys::InviteSys(psio::shared_view_ptr<psibase::Action> action)
{
   MethodNumber m{action->method()->value().get()};
   if (m != MethodNumber{"init"})
   {
      auto initRecord = Tables().open<InitTable>().get(SingletonKey{});
      check(initRecord.has_value(), UserService::Errors::uninitialized);
   }
}

void InviteSys::init()
{
   auto initTable = Tables().open<InitTable>();
   auto init      = (initTable.get(SingletonKey{}));
   check(not init.has_value(), alreadyInit);
   initTable.put(InitializedRecord{});

   // Register serveSys handler
   to<SystemService::ProxySys>().registerServer(InviteSys::service);

   // Configure manual debit for self on Token and NFT
   auto manualDebit = psibase::EnumElement{"manualDebit"};
   to<TokenSys>().setUserConf(manualDebit, true);
   to<NftSys>().setUserConf(manualDebit, true);

   // Create the invite payer account and set its auth contract
   to<AccountSys>().newAccount(payerAccount, AuthInviteSys::service, true);

   // TODO - Set whitelist so only the fractally service can create invites.
   // setWhitelist({"fractally"_m})
}

void InviteSys::createInvite(PublicKey inviteKey)
{
   auto inviteTable = Tables().open<InviteTable>();
   check(not inviteTable.get(inviteKey).has_value(), inviteAlreadyExists.data());

   auto inviter       = getSender();
   auto settingsTable = Tables().open<InviteSettingsTable>();
   auto settings      = settingsTable.get(SingletonKey{}).value_or(InviteSettingsRecord{});

   if (settings.whitelist.size() > 0)
   {
      bool whitelisted = find(settings.whitelist.begin(), settings.whitelist.end(), inviter) !=
                         settings.whitelist.end();
      check(whitelisted, onlyWhitelisted.data());
   }
   else if (settings.blacklist.size() > 0)
   {
      bool blacklisted = find(settings.blacklist.begin(), settings.blacklist.end(), inviter) !=
                         settings.blacklist.end();
      check(not blacklisted, noBlacklisted.data());
   }

   // Add invite
   uint32_t     secondsInWeek{60 * 60 * 24 * 7};
   InviteRecord newInvite{
       .pubkey          = inviteKey,
       .inviter         = inviter,
       .expiry          = to<TransactionSys>().currentBlock().time.seconds + secondsInWeek,
       .newAccountToken = true,
       .state           = InviteStates::pending,
   };
   inviteTable.put(newInvite);

   // Emit event
   auto eventTable  = Tables().open<UserEventTable>();
   auto eventRecord = eventTable.get(inviter).value_or(UserEventRecord{
       .user      = inviter,
       .eventHead = 0,
   });

   eventRecord.eventHead =
       emit().history().inviteCreated(eventRecord.eventHead, inviteKey, inviter);
   eventTable.put(eventRecord);
}

void InviteSys::accept(PublicKey inviteKey)
{
   auto inviteTable = Tables().open<InviteTable>();
   auto invite      = inviteTable.get(inviteKey);
   check(invite.has_value(), inviteDNE.data());

   to<AuthInviteSys>().requireAuth(inviteKey);

   auto acceptedBy = getSender();
   check(acceptedBy != InviteSys::payerAccount,
         "Call 'accept' with the accepting account as the sender.");
   check(invite->state != InviteStates::rejected, "This invite was already rejected");

   auto now = to<TransactionSys>().currentBlock().time.seconds;
   check(invite->expiry > now, inviteExpired.data());

   invite->actor = acceptedBy;
   invite->state = InviteStates::accepted;
   inviteTable.put(*invite);

   // Emit event
   auto eventTable  = Tables().open<ServiceEventTable>();
   auto eventRecord = eventTable.get(SingletonKey{})
                          .value_or(ServiceEventRecord{
                              .key       = SingletonKey{},
                              .eventHead = 0,
                          });
   eventRecord.eventHead =
       emit().history().inviteAccepted(eventRecord.eventHead, inviteKey, acceptedBy);
   eventTable.put(eventRecord);
}

void InviteSys::acceptCreate(PublicKey inviteKey, AccountNumber acceptedBy, PublicKey newAccountKey)
{
   auto sender      = getSender();
   auto inviteTable = Tables().open<InviteTable>();
   auto invite      = inviteTable.get(inviteKey);
   check(invite.has_value(), inviteDNE.data());

   to<AuthInviteSys>().requireAuth(inviteKey);

   auto now = to<TransactionSys>().currentBlock().time.seconds;
   check(invite->expiry > now, inviteExpired.data());

   check(invite->state != InviteStates::rejected, alreadyRejected.data());

   bool accountExists = to<AccountSys>().exists(acceptedBy);
   check(not accountExists, "The acceptedBy account already exists");

   check(sender == InviteSys::payerAccount, mustUseInvitedSys.data());
   check(inviteKey != newAccountKey, needUniquePubkey.data());
   check(invite->newAccountToken, noNewAccToken.data());
   invite->newAccountToken = false;

   // Create new account, and set key & auth
   to<AccountSys>().newAccount(acceptedBy, AuthAnySys::service, true);
   std::tuple<PublicKey> params{newAccountKey};
   Action                setKey{.sender  = acceptedBy,
                                .service = AuthEcSys::service,
                                .method  = "setKey"_m,
                                .rawData = psio::convert_to_frac(params)};
   to<TransactionSys>().runAs(move(setKey), vector<ServiceMethod>{});
   std::tuple<AccountNumber> params2{AuthEcSys::service};
   Action                    setAuth{.sender  = acceptedBy,
                                     .service = AccountSys::service,
                                     .method  = "setAuthCntr"_m,
                                     .rawData = psio::convert_to_frac(params2)};
   to<TransactionSys>().runAs(move(setAuth), vector<ServiceMethod>{});

   invite->state = InviteStates::accepted;
   invite->actor = acceptedBy;
   inviteTable.put(*invite);

   // Emit event
   auto eventTable  = Tables().open<ServiceEventTable>();
   auto eventRecord = eventTable.get(SingletonKey{})
                          .value_or(ServiceEventRecord{
                              .key       = SingletonKey{},
                              .eventHead = 0,
                          });
   eventRecord.eventHead =
       emit().history().inviteAccepted(eventRecord.eventHead, inviteKey, acceptedBy);
   eventTable.put(eventRecord);
}

void InviteSys::reject(psibase::PublicKey inviteKey)
{
   auto table  = Tables().open<InviteTable>();
   auto invite = table.get(inviteKey);
   check(invite.has_value(), inviteDNE);

   to<AuthInviteSys>().requireAuth(inviteKey);
   check(invite->state != InviteStates::accepted, alreadyAccepted.data());
   check(invite->state != InviteStates::rejected, alreadyRejected.data());

   auto now = to<TransactionSys>().currentBlock().time.seconds;
   check(invite->expiry > now, inviteExpired.data());

   auto sender = getSender();
   if (sender == InviteSys::payerAccount)
   {
      check(invite->newAccountToken == true,
            "Only an existing account can be used to reject this invite");
      invite->newAccountToken = false;
   }

   invite->state = InviteStates::rejected;
   invite->actor = sender;
   table.put(*invite);

   // Emit event
   auto eventTable  = Tables().open<ServiceEventTable>();
   auto eventRecord = eventTable.get(SingletonKey{})
                          .value_or(ServiceEventRecord{
                              .key       = SingletonKey{},
                              .eventHead = 0,
                          });

   eventRecord.eventHead = emit().history().inviteRejected(eventRecord.eventHead, inviteKey);
   eventTable.put(eventRecord);
}

void InviteSys::delInvite(PublicKey inviteKey)
{
   auto sender      = getSender();
   auto inviteTable = Tables().open<InviteTable>();
   auto invite      = inviteTable.get(inviteKey);
   check(invite.has_value(), inviteDNE.data());
   check(invite->inviter == sender, unauthDelete.data());
   inviteTable.remove(*invite);

   // Emit event
   auto eventTable  = Tables().open<UserEventTable>();
   auto eventRecord = eventTable.get(sender).value_or(UserEventRecord{
       .user      = sender,
       .eventHead = 0,
   });

   eventRecord.eventHead = emit().history().inviteDeleted(eventRecord.eventHead, inviteKey);
   eventTable.put(eventRecord);
}

void InviteSys::delExpired(uint32_t maxDeleted)
{
   auto now = to<TransactionSys>().currentBlock().time.seconds;

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

   // Emit event
   auto sender      = getSender();
   auto eventTable  = Tables().open<UserEventTable>();
   auto eventRecord = eventTable.get(sender).value_or(UserEventRecord{
       .user      = sender,
       .eventHead = 0,
   });

   eventRecord.eventHead =
       emit().history().expInvDeleted(eventRecord.eventHead, numChecked, numDeleted);
   eventTable.put(eventRecord);
}

void InviteSys::setWhitelist(vector<AccountNumber> accounts)
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
   auto                              accountSys = to<AccountSys>();
   for (const auto& acc : accounts)
   {
      if (!accountSys.exists(acc))
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

   // Emit event
   auto eventTable  = Tables().open<ServiceEventTable>();
   auto eventRecord = eventTable.get(SingletonKey{})
                          .value_or(ServiceEventRecord{
                              .key       = SingletonKey{},
                              .eventHead = 0,
                          });

   eventRecord.eventHead = emit().history().whitelistSet(eventRecord.eventHead, accounts);
   eventTable.put(eventRecord);
}

void InviteSys::setBlacklist(vector<AccountNumber> accounts)
{
   check(getSender() == getReceiver(), missingRequiredAuth.data());

   // Check that no whitelisted accounts are being blacklisted
   auto settingsTable = Tables().open<InviteSettingsTable>();
   auto settings      = settingsTable.get(SingletonKey{}).value_or(InviteSettingsRecord{});
   check(settings.whitelist.empty(), whitelistIsSet.data());

   // Detect invalid accounts
   std::map<AccountNumber, uint32_t> counts;
   auto                              accountSys = to<AccountSys>();
   for (const auto& acc : accounts)
   {
      if (!accountSys.exists(acc))
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

   // Emit event
   auto eventTable  = Tables().open<ServiceEventTable>();
   auto eventRecord = eventTable.get(SingletonKey{})
                          .value_or(ServiceEventRecord{
                              .key       = SingletonKey{},
                              .eventHead = 0,
                          });

   eventRecord.eventHead = emit().history().blacklistSet(eventRecord.eventHead, accounts);
   eventTable.put(eventRecord);
}

optional<InviteRecord> InviteSys::getInvite(psibase::PublicKey pubkey)
{
   return Tables().open<InviteTable>().get(pubkey);
}

auto inviteSys = QueryableService<InviteSys::Tables, InviteSys::Events>{InviteSys::service};
struct Queries
{
   auto getEventHead(AccountNumber user) const
   {  //
      return inviteSys.index<Invite::UserEventTable, 0>().get(user);
   }

   auto events() const
   {  //
      return inviteSys.allEvents();
   }

   auto userEvents(AccountNumber           user,
                   optional<uint32_t>      first,
                   const optional<string>& after) const
   {
      return inviteSys.eventIndex<InviteSys::UserEvents>(user, first, after);
   }

   auto serviceEvents(optional<uint32_t> first, const optional<string>& after) const
   {
      return inviteSys.eventIndex<InviteSys::ServiceEvents>(SingletonKey{}, first, after);
   }
};
PSIO_REFLECT(Queries,
             method(getEventHead, user),
             method(events),
             method(userEvents, user, first, after),
             method(serviceEvents, first, after));

auto InviteSys::serveSys(HttpRequest request) -> std::optional<HttpReply>
{
   if (auto result = serveContent(request, Tables{getReceiver()}))
      return result;

   if (auto result = serveSimpleUI<InviteSys, true>(request))
      return result;

   if (auto result = serveGraphQL(request, Queries{}))
      return result;

   return std::nullopt;
}

void InviteSys::storeSys(std::string path, std::string contentType, std::vector<char> content)
{
   psibase::check(psibase::getSender() == psibase::getReceiver(), "wrong sender");
   psibase::storeContent(std::move(path), std::move(contentType), std::move(content),
                         Tables{psibase::getReceiver()});
}

PSIBASE_DISPATCH(UserService::Invite::InviteSys)
