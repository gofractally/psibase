#include <services/system/Accounts.hpp>
#include <services/system/AuthAny.hpp>
#include <services/system/AuthK1.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/Transact.hpp>
#include <services/system/commonErrors.hpp>
#include <services/user/AuthInvite.hpp>
#include <services/user/Invite.hpp>
#include <services/user/Nft.hpp>
#include <services/user/TokenSys.hpp>

#include <psibase/Bitset.hpp>
#include <psibase/serveContent.hpp>
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
using std::move;
using std::optional;
using std::string;
using std::vector;

Invite::Invite(psio::shared_view_ptr<Action> action)
{
   MethodNumber m{action->method()};
   if (m != MethodNumber{"init"} && m != MethodNumber{"storeSys"})
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
   to<TokenSys>().setUserConf(manualDebit, true);
   to<Nft>().setUserConf(manualDebit, true);

   // Create the invite payer account and set its auth contract
   to<Accounts>().newAccount(payerAccount, AuthInvite::service, true);

   // TODO - Set whitelist so only the fractally service can create invites.
   // setWhitelist({"fractally"_m})
}

void Invite::createInvite(PublicKey inviteKey)
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
       .expiry          = to<Transact>().currentBlock().time.seconds + secondsInWeek,
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

void Invite::accept(PublicKey inviteKey)
{
   auto inviteTable = Tables().open<InviteTable>();
   auto invite      = inviteTable.get(inviteKey);
   check(invite.has_value(), inviteDNE.data());

   to<AuthInvite>().requireAuth(inviteKey);

   auto acceptedBy = getSender();
   check(acceptedBy != Invite::payerAccount,
         "Call 'accept' with the accepting account as the sender.");
   check(invite->state != InviteStates::rejected, "This invite was already rejected");

   auto now = to<Transact>().currentBlock().time.seconds;
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

void Invite::acceptCreate(PublicKey inviteKey, AccountNumber acceptedBy, PublicKey newAccountKey)
{
   auto sender      = getSender();
   auto inviteTable = Tables().open<InviteTable>();
   auto invite      = inviteTable.get(inviteKey);
   check(invite.has_value(), inviteDNE.data());

   to<AuthInvite>().requireAuth(inviteKey);

   auto now = to<Transact>().currentBlock().time.seconds;
   check(invite->expiry > now, inviteExpired.data());

   check(invite->state != InviteStates::rejected, alreadyRejected.data());

   bool accountExists = to<Accounts>().exists(acceptedBy);
   check(not accountExists, "The acceptedBy account already exists");

   check(sender == Invite::payerAccount, mustUseInvitedSys.data());
   check(inviteKey != newAccountKey, needUniquePubkey.data());
   check(invite->newAccountToken, noNewAccToken.data());
   invite->newAccountToken = false;

   // Create new account, and set key & auth
   to<Accounts>().newAccount(acceptedBy, AuthAny::service, true);
   std::tuple<PublicKey> params{newAccountKey};
   Action                setKey{.sender  = acceptedBy,
                                .service = AuthK1::service,
                                .method  = "setKey"_m,
                                .rawData = psio::convert_to_frac(params)};
   to<Transact>().runAs(move(setKey), vector<ServiceMethod>{});
   std::tuple<AccountNumber> params2{AuthK1::service};
   Action                    setAuth{.sender  = acceptedBy,
                                     .service = Accounts::service,
                                     .method  = "setAuthServ"_m,
                                     .rawData = psio::convert_to_frac(params2)};
   to<Transact>().runAs(move(setAuth), vector<ServiceMethod>{});

   invite->state = InviteStates::accepted;
   invite->actor = acceptedBy;
   inviteTable.put(*invite);

   // Remember which account is responsible for inviting the new account
   auto newAccTable = Tables().open<NewAccTable>();
   auto newAcc      = newAccTable.get(acceptedBy);
   check(not newAcc.has_value(), accAlreadyExists.data());
   newAccTable.put(NewAccountRecord{acceptedBy, invite->inviter});

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

void Invite::reject(PublicKey inviteKey)
{
   auto table  = Tables().open<InviteTable>();
   auto invite = table.get(inviteKey);
   check(invite.has_value(), inviteDNE);

   to<AuthInvite>().requireAuth(inviteKey);
   check(invite->state != InviteStates::accepted, alreadyAccepted.data());
   check(invite->state != InviteStates::rejected, alreadyRejected.data());

   auto now = to<Transact>().currentBlock().time.seconds;
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

void Invite::delInvite(PublicKey inviteKey)
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

void Invite::delExpired(uint32_t maxDeleted)
{
   auto now = to<Transact>().currentBlock().time.seconds;

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

optional<InviteRecord> Invite::getInvite(PublicKey pubkey)
{
   return Tables().open<InviteTable>().get(pubkey);
}

bool Invite::isExpired(PublicKey pubkey)
{
   auto inviteTable = Tables().open<InviteTable>();
   auto invite      = inviteTable.get(pubkey);
   check(invite.has_value(), inviteDNE.data());

   auto now = to<Transact>().currentBlock().time.seconds;
   return now >= invite->expiry;
}

void Invite::checkClaim(AccountNumber actor, PublicKey pubkey)
{
   auto invite = getInvite(pubkey);
   check(invite.has_value(), "This invite does not exist. It may have been deleted after expiry.");
   check(invite->state == InviteStates::accepted, "invite is not in accepted state");
   check(invite->actor == actor, "only " + invite->actor.str() + " may accept this invite");
   check(not isExpired(pubkey), "this invite is expired");
}

auto invite = QueryableService<Invite::Tables, Invite::Events>{Invite::service};
struct Queries
{
   auto getEventHead(AccountNumber user) const
   {  //
      return Invite::Tables(Invite::service).open<InviteNs::UserEventTable>().get(user);
   }

   auto getInvite(string pubkey) const
   {
      return Invite::Tables(Invite::service).open<InviteTable>().get(publicKeyFromString(pubkey));
   }

   auto getInviter(psibase::AccountNumber user)
   {
      return Invite::Tables(Invite::service).open<InviteNs::NewAccTable>().get(user);
   }

   auto events() const
   {  //
      return invite.allEvents();
   }

   auto userEvents(AccountNumber           user,
                   optional<uint32_t>      first,
                   const optional<string>& after) const
   {
      return invite.eventIndex<Invite::UserEvents>(user, first, after);
   }

   auto serviceEvents(optional<uint32_t> first, const optional<string>& after) const
   {
      return invite.eventIndex<Invite::ServiceEvents>(SingletonKey{}, first, after);
   }
};
PSIO_REFLECT(Queries,
             method(getEventHead, user),
             method(getInvite, pubkey),
             method(getInviter, user),
             method(events),
             method(userEvents, user, first, after),
             method(serviceEvents, first, after));

auto Invite::serveSys(HttpRequest request) -> std::optional<HttpReply>
{
   if (auto result = serveContent(request, Tables{}))
      return result;

   if (auto result = serveSimpleUI<Invite, true>(request))
      return result;

   if (auto result = serveGraphQL(request, Queries{}))
      return result;

   return std::nullopt;
}

void Invite::storeSys(string path, string contentType, vector<char> content)
{
   check(getSender() == getReceiver(), "wrong sender");
   storeContent(move(path), move(contentType), move(content), Tables());
}

PSIBASE_DISPATCH(UserService::InviteNs::Invite)
