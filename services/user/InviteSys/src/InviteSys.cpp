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
   auto manualDebit = psibase::NamedBit{"manualDebit"};
   to<TokenSys>().setUserConf(manualDebit, true);
   to<NftSys>().setUserConf(manualDebit, true);

   // Create the invite payer account and set its auth contract
   to<AccountSys>().newAccount(payerAccount, AuthInviteSys::service, true);

   // Enable the invite system in AccountSys
   to<AccountSys>().setCreator(service);

   // TODO - Set whitelist so only the fractally service can create invites.
   // setWhitelist({"fractally"_m})
}

void InviteSys::createInvite(PublicKey inviteKey, AccountNumber inviter)
{
   auto inviteTable = Tables().open<InviteTable>();
   auto invite      = inviteTable.get(inviteKey);
   check(not invite.has_value(), inviteAlreadyExists.data());

   // Add invite
   uint32_t     secondsInWeek{60 * 60 * 24 * 7};
   InviteRecord newInvite{
       .pubkey          = inviteKey,
       .inviter         = inviter,
       .expiry          = to<TransactionSys>().currentBlock().time.seconds + secondsInWeek,
       .newAccountToken = true,
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

void InviteSys::acceptCreate(PublicKey     inviteKey,
                             AccountNumber newAccountName,
                             PublicKey     newAccountKey)
{
   check(inviteKey != newAccountKey, needUniquePubkey.data());

   acceptInvite(inviteKey, newAccountName, newAccount);

   // Create the new account
   to<AccountSys>().newAccount(newAccountName, AuthAnySys::service, true);

   // Set the key & update auth
   std::tuple<PublicKey> params{newAccountKey};
   Action                setKey{.sender  = newAccountName,
                                .service = AuthEcSys::service,
                                .method  = "setKey"_m,
                                .rawData = psio::convert_to_frac(params)};
   to<TransactionSys>().runAs(move(setKey), vector<ServiceMethod>{});
   std::tuple<AccountNumber> params2{AuthEcSys::service};
   Action                    setAuth{.sender  = newAccountName,
                                     .service = AccountSys::service,
                                     .method  = "setAuthCntr"_m,
                                     .rawData = psio::convert_to_frac(params2)};
   to<TransactionSys>().runAs(move(setAuth), vector<ServiceMethod>{});
}

void InviteSys::accept(PublicKey inviteKey)
{
   acceptInvite(inviteKey, getSender(), existingAccount);
}

void InviteSys::reject(psibase::PublicKey inviteKey)
{
   Tables().open<InviteTable>().erase(inviteKey);

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

void InviteSys::acceptInvite(PublicKey     inviteKey,
                             AccountNumber acceptedBy,
                             AccepterType  accepterType)
{
   auto inviteTable = Tables().open<InviteTable>();
   auto invite      = inviteTable.get(inviteKey);
   auto now         = to<TransactionSys>().currentBlock().time.seconds;

   check(invite.has_value(), inviteDNE.data());
   check(invite->expiry > now, inviteExpired.data());
   if (accepterType == newAccount)
   {
      check(invite->newAccountToken, noNewAccToken.data());
      invite->newAccountToken = false;
   }
   invite->acceptedBy = acceptedBy;
   inviteTable.put(*invite);

   // Emit event
   auto eventTable  = Tables().open<ServiceEventTable>();
   auto eventRecord = eventTable.get(SingletonKey{})
                          .value_or(ServiceEventRecord{
                              .key       = SingletonKey{},
                              .eventHead = 0,
                          });

   eventRecord.eventHead = emit().history().inviteAccepted(eventRecord.eventHead, inviteKey);
   eventTable.put(eventRecord);
}

void InviteSys::delInvite(PublicKey inviteKey)
{
   auto sender      = getSender();
   auto inviteTable = Tables().open<InviteTable>();
   auto invite      = inviteTable.get(inviteKey);
   if (invite.has_value())
   {
      check(invite->inviter == sender, unauthDelete.data());
      inviteTable.remove(*invite);
   }

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

   auto settingsTable = Tables().open<InviteSettingsTable>();
   auto settings      = settingsTable.get(SingletonKey{}).value_or(InviteSettingsRecord{});

   // Check that no blacklisted accounts are being whitelisted
   for (const auto& acc : settings.blacklist)
   {
      check(find(begin(accounts), end(accounts), acc) == end(accounts),
            "cannot add blacklisted account to whitelist");
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

   auto settingsTable = Tables().open<InviteSettingsTable>();
   auto settings      = settingsTable.get(SingletonKey{}).value_or(InviteSettingsRecord{});

   // Check that no whitelisted accounts are being blacklisted
   for (const auto& acc : settings.whitelist)
   {
      check(find(begin(accounts), end(accounts), acc) == end(accounts),
            "cannot add whitelisted account to blacklist");
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
   if (auto result = serveSimpleUI<InviteSys, true>(request))
      return result;

   if (auto result = serveGraphQL(request, Queries{}))
      return result;

   return std::nullopt;
}

PSIBASE_DISPATCH(UserService::Invite::InviteSys)
