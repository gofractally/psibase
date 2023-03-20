#include <services/system/ProxySys.hpp>
#include <services/system/TransactionSys.hpp>
#include <services/system/commonErrors.hpp>
#include <services/user/FractalSys.hpp>
#include <services/user/InviteSys.hpp>

using namespace UserService;
using namespace UserService::Fractal;
using namespace psibase;
using std::move;
using std::nullopt;
using std::optional;
using std::string;
using std::tuple;
using std::vector;
using SystemService::TransactionSys;

FractalSys::FractalSys(psio::shared_view_ptr<psibase::Action> action)
{
   MethodNumber m{action->method()};
   if (m != MethodNumber{"init"})
   {
      auto initRecord = Tables().open<InitTable>().get(SingletonKey{});
      check(initRecord.has_value(), UserService::Errors::uninitialized);
   }
}

void FractalSys::init()
{
   auto initTable = Tables().open<InitTable>();
   auto init      = (initTable.get(SingletonKey{}));
   check(not init.has_value(), UserService::Errors::alreadyInit);
   initTable.put(InitializedRecord{});

   // Register with proxy
   to<SystemService::ProxySys>().registerServer(service);
}

void FractalSys::createIdentity()
{
   newIdentity(getSender(), true);
}

void FractalSys::newIdentity(AccountNumber name, bool requireNew)
{
   auto identityTable = Tables().open<IdentityTable>();
   auto identity      = identityTable.get(name);
   bool isNew         = not identity.has_value();
   if (requireNew)
   {
      check(isNew, "Identity already exists");
   }

   if (isNew)
   {
      identityTable.put(IdentityRecord{name});

      // Emit event
      auto eventTable  = Tables().open<ServiceEventTable>();
      auto eventRecord = eventTable.get(SingletonKey{})
                             .value_or(ServiceEventRecord{
                                 .key       = SingletonKey{},
                                 .eventHead = 0,
                             });

      eventRecord.eventHead = emit().history().identityAdded(eventRecord.eventHead, name);
      eventTable.put(eventRecord);
   }
}

void FractalSys::setDispName(string displayName)
{
   auto identityTable = Tables().open<IdentityTable>();
   auto identity      = identityTable.get(getSender());
   check(identity.has_value(), "identity DNE");

   const size_t maxDisplayNameLength = 20;
   check(displayName.length() < maxDisplayNameLength, "display name too long");

   identity->displayName = displayName;
   identityTable.put(*identity);

   // Todo - emit event
}

void FractalSys::invite(AccountNumber fractal, PublicKey pubkey)
{
   auto fractalTable = Tables().open<FractalTable>();
   auto fracRecord   = fractalTable.get(fractal);
   check(fracRecord.has_value(), "fractal DNE");

   to<Invite::InviteSys>().createInvite(pubkey);

   auto inviteTable = Tables().open<InviteTable>();
   auto invite      = inviteTable.get(pubkey);
   check(not invite.has_value(), "invite already exists");

   auto sender      = getSender();
   auto memberTable = Tables().open<MemberTable>();
   auto member      = memberTable.get(MembershipKey{sender, fractal});
   check(member.has_value(), "only members can invite others to a fractal");

   auto record = InviteRecord{pubkey, sender, fractal, psibase::AccountNumber{0}};
   inviteTable.put(record);

   // Save stats? total invites created?

   // Emit events
   auto identityTable = Tables().open<IdentityTable>();
   auto acc           = identityTable.get(sender);
   acc->eventHead     = emit().history().invCreated(acc->eventHead, sender, fractal);
   identityTable.put(*acc);

   fracRecord->eventHead = emit().history().invCreated(fracRecord->eventHead, sender, fractal);
   fractalTable.put(*fracRecord);
}

void FractalSys::claim(PublicKey inviteKey)
{
   auto inviteTable   = Tables().open<InviteTable>();
   auto fractalInvite = inviteTable.get(inviteKey);
   check(fractalInvite.has_value(),
         "This invite does not exist. It is either not meant for fractal-sys, or could have been "
         "deleted after expiry.");
   check(fractalInvite->recipient == AccountNumber{0}, "this invite has already been claimed");

   auto sender = getSender();
   to<Invite::InviteSys>().checkClaim(sender, inviteKey);

   // Save the claimant account name with the invite
   auto record      = *fractalInvite;
   record.recipient = sender;
   inviteTable.put(record);

   // Create an account for the claimant if it doesn't already exist
   bool requireNew = false;
   newIdentity(sender, requireNew);

   // Invite has officially been accepted/associated with an account. No need to keep original inv object
   to<Invite::InviteSys>().delInvite(inviteKey);

   // Emit InviteReceived event
   auto identityTable = Tables().open<IdentityTable>();
   auto identity      = identityTable.get(record.creator);
   if (identity)
   {
      identity->eventHead =
          emit().history().invReceived(identity->eventHead, sender, record.fractal);
      identityTable.put(*identity);
   }
}

void FractalSys::accept(PublicKey inviteKey)
{
   auto sender = getSender();

   auto inviteTable = Tables().open<InviteTable>();
   auto record      = inviteTable.get(inviteKey);
   check(record.has_value(), "invite DNE");

   auto identityTable = Tables().open<IdentityTable>();
   auto joinerProfile = identityTable.get(sender);
   check(joinerProfile.has_value(), "only accounts with a fractal-sys profile can accept invites");

   auto invite  = *record;
   auto fractal = invite.fractal;
   if (invite.recipient != sender)
   {
      claim(inviteKey);
   }
   auto fractalTable = Tables().open<FractalTable>();
   auto fracRecord   = fractalTable.get(fractal);
   check(fracRecord.has_value(), "fractal no longer exists");
   inviteTable.remove(invite);

   auto memberTable = Tables().open<MemberTable>();
   auto key         = MembershipKey{sender, fractal};
   check(not memberTable.get(key).has_value(), "member already joined fractal");
   auto membership = MembershipRecord{key, invite.creator, 0};
   memberTable.put(membership);

   // reject any outstanding invite objects for this user to this fractal
   auto idx = inviteTable.getIndex<1>().subindex(sender);
   for (auto inv : idx)
   {
      if (inv.fractal == fractal)
         reject(inv.key);
   }

   // Emit events
   fracRecord->eventHead = emit().history().invAccepted(fracRecord->eventHead, sender, fractal);
   fractalTable.put(*fracRecord);

   auto inviter = identityTable.get(invite.creator);
   if (inviter)
   {
      inviter->eventHead = emit().history().invAccepted(inviter->eventHead, sender, fractal);
      identityTable.put(*inviter);
   }

   joinerProfile->eventHead =
       emit().history().invAccepted(joinerProfile->eventHead, sender, fractal);
   identityTable.put(*joinerProfile);
}

void FractalSys::reject(PublicKey inviteKey)
{
   auto sender      = getSender();
   auto inviteTable = Tables().open<InviteTable>();
   auto invite      = inviteTable.get(inviteKey);
   check(invite.has_value(), "invite DNE");
   if (invite->recipient != sender)
   {
      claim(inviteKey);
   }

   inviteTable.remove(*invite);

   // Emit event
   auto identityTable = Tables().open<IdentityTable>();
   auto inviter       = identityTable.get(invite->creator);
   if (inviter)
   {
      inviter->eventHead =
          emit().history().invRejected(inviter->eventHead, sender, invite->fractal);
      identityTable.put(*inviter);
   }
}

void FractalSys::registerType()
{
   auto sender = getSender();
   auto table  = Tables().open<FractalTypeTable>();
   auto type   = table.get(sender);
   check(not type.has_value(), "fractal type already registered");

   check(to<FractalInterface>(sender).isFracType(), "registered service is not fractal type");
   // Todo - the above shouldn't return bool. It either get successfully called, or not.

   auto record = FractalTypeRecord{sender};
   table.put(record);

   // TODO - emit event
}

void FractalSys::newFractal(AccountNumber account, AccountNumber type)
{
   auto table  = Tables().open<FractalTable>();
   auto record = table.get(account);
   check(not record.has_value(), "fractal already exists");

   // Todo - Create the account and set its auth

   auto sender = getSender();

   auto          time = to<TransactionSys>().currentBlock().time;
   FractalRecord newFractal{
       .account = account, .type = type, .founder = sender, .creationTime = time};
   table.put(newFractal);

   // Creator of the new fractal is the first member.
   MembershipRecord firstMember{MembershipKey{sender, account}, psibase::AccountNumber{0}, 0};
   Tables().open<MemberTable>().put(firstMember);

   // Todo - check that type exists

   // Todo - emit event
}

void FractalSys::setFracName(AccountNumber fractalAccount, std::string displayName)
{
   // Todo - verify that sender has permission to update the fractal config
   check(displayName.length() < 40, "displayName too long");

   auto table  = Tables().open<FractalTable>();
   auto record = table.get(fractalAccount);
   check(record.has_value(), "fractal DNE");

   record->displayName = displayName;
   table.put(*record);

   // Todo - emit event
}

void FractalSys::setFracDesc(psibase::AccountNumber fractalAccount, std::string description)
{
   // Todo - verify that sender has permission to update the fractal config
   check(description.length() < 1040, "Description is too long");

   auto table  = Tables().open<FractalTable>();
   auto record = table.get(fractalAccount);
   check(record.has_value(), "fractal DNE");

   record->description = description;
   table.put(*record);

   // Todo - emit event
}

void FractalSys::setFracLang(psibase::AccountNumber fractalAccount, std::string languageCode)
{
   // Todo - verify that sender has permission to update the fractal config
   check(languageCode.length() == 3, "language code invalid");

   auto table  = Tables().open<FractalTable>();
   auto record = table.get(fractalAccount);
   check(record.has_value(), "fractal DNE");

   record->languageCode = languageCode;
   table.put(*record);

   // Emit event
}

optional<IdentityRecord> FractalSys::getIdentity(AccountNumber name)
{
   return Tables().open<IdentityTable>().get(name);
}

optional<MembershipRecord> FractalSys::getMember(AccountNumber account, AccountNumber fractal)
{
   return Tables().open<MemberTable>().get(MembershipKey{account, fractal});
}

// TODO - rename queryableservice and delete table management from it. It should just help with events.
auto fractalSys = QueryableService<FractalSys::Tables, FractalSys::Events>{FractalSys::service};
struct Queries
{
   auto getIdentity(AccountNumber user) const
   {  //
      return FractalSys::Tables(FractalSys::service).open<Fractal::IdentityTable>().get(user);
   }

   auto getInvite(PublicKey pubkey) const
   {  //
      return FractalSys::Tables(FractalSys::service).open<Fractal::InviteTable>().get(pubkey);
   }

   auto getMember(AccountNumber user, AccountNumber fractal) const
   {  //
      MembershipKey key{user, fractal};
      return FractalSys::Tables(FractalSys::service).open<Fractal::MemberTable>().get(key);
   }

   auto getFractals(AccountNumber           user,
                    optional<AccountNumber> gt,
                    optional<AccountNumber> ge,
                    optional<AccountNumber> lt,
                    optional<AccountNumber> le,
                    optional<uint32_t>      first,
                    optional<uint32_t>      last,
                    optional<string>        before,
                    optional<string>        after) const
   {
      auto idx = FractalSys::Tables{FractalSys::service}
                     .open<Fractal::MemberTable>()
                     .getIndex<1>()
                     .subindex(user);

      auto convert = [](const auto& opt)
      {
         optional<tuple<AccountNumber>> ret;
         if (opt)
            ret.emplace(std::make_tuple(opt.value()));
         return ret;
      };

      return makeConnection<Connection<MembershipRecord, "MemConnection", "MemEdge">>(
          idx, {convert(gt)}, {convert(ge)}, {convert(lt)}, {convert(le)}, first, last, before,
          after);
   }

   auto getFractal(AccountNumber fractal) const
   {  //
      return FractalSys::Tables(FractalSys::service).open<Fractal::FractalTable>().get(fractal);
   }

   auto getFractalType(AccountNumber service) const
   {  //
      return FractalSys::Tables(FractalSys::service).open<Fractal::FractalTypeTable>().get(service);
   }

   auto events() const
   {  //
      return fractalSys.allEvents();
   }

   auto serviceEvents(optional<uint32_t> first, const optional<string>& after) const
   {
      return fractalSys.eventIndex<FractalSys::ServiceEvents>(SingletonKey{}, first, after);
   }

   auto fractalEvents(AccountNumber           fractal,
                      optional<uint32_t>      first,
                      const optional<string>& after) const
   {
      return fractalSys.eventIndex<FractalSys::FractalEvents>(fractal, first, after);
   }

   auto userEvents(AccountNumber           user,
                   optional<uint32_t>      first,
                   const optional<string>& after) const
   {
      return fractalSys.eventIndex<FractalSys::UserEvents>(user, first, after);
   }
};
PSIO_REFLECT(Queries,  //
             method(getIdentity, user),
             method(getInvite, pubkey),
             method(getMember, user, fractal),
             method(getFractals, user, gt, ge, lt, le, first, last, before, after),
             method(getFractal, fractal),
             method(getFractalType, service),
             //
             method(events),
             method(serviceEvents, first, after),
             method(fractalEvents, fractal, first, after),
             method(userEvents, user, fractal, first, after)
             //
);

optional<HttpReply> FractalSys::serveSys(HttpRequest request)
{
   if (auto result = serveContent(request, Tables{}))
      return result;

   if (auto result = serveSimpleUI<FractalSys, true>(request))
      return result;

   if (auto result = serveGraphQL(request, Queries{}))
      return result;

   return nullopt;
}

void FractalSys::storeSys(string path, string contentType, vector<char> content)
{
   check(getSender() == getReceiver(), "wrong sender");
   storeContent(move(path), move(contentType), move(content), Tables());
}

PSIBASE_DISPATCH(UserService::Fractal::FractalSys)
