#include <services/system/HttpServer.hpp>
#include <services/system/Transact.hpp>
#include <services/system/commonErrors.hpp>
#include <services/user/Events.hpp>
#include <services/user/Fractal.hpp>
#include <services/user/Invite.hpp>

using namespace UserService;
using namespace UserService::FractalNs;
using namespace psibase;
using std::nullopt;
using std::optional;
using std::string;
using std::tuple;
using std::vector;
using SystemService::Transact;

Fractal::Fractal(psio::shared_view_ptr<psibase::Action> action)
{
   MethodNumber m{action->method()};
   if (m != MethodNumber{"init"})
   {
      auto initRecord = Tables().open<InitTable>().get(SingletonKey{});
      check(initRecord.has_value(), UserService::Errors::uninitialized);
   }
}

void Fractal::init()
{
   auto initTable = Tables().open<InitTable>();
   auto init      = (initTable.get(SingletonKey{}));
   check(not init.has_value(), UserService::Errors::alreadyInit);
   initTable.put(InitializedRecord{});

   // Register with HttpServer
   to<SystemService::HttpServer>().registerServer(service);

   // Register event indices and schema
   to<EventIndex>().setSchema(ServiceSchema::make<Fractal>());

   // Event indices:
   to<EventIndex>().addIndex(DbId::historyEvent, Fractal::service, "identityAdded"_m, 0);
   to<EventIndex>().addIndex(DbId::historyEvent, Fractal::service, "invCreated"_m, 0);
   to<EventIndex>().addIndex(DbId::historyEvent, Fractal::service, "invReceived"_m, 0);
   to<EventIndex>().addIndex(DbId::historyEvent, Fractal::service, "invAccepted"_m, 0);
   to<EventIndex>().addIndex(DbId::historyEvent, Fractal::service, "invAccepted"_m, 1);
   to<EventIndex>().addIndex(DbId::historyEvent, Fractal::service, "invAccepted"_m, 2);
   to<EventIndex>().addIndex(DbId::historyEvent, Fractal::service, "invRejected"_m, 0);
}

void Fractal::createIdentity()
{
   newIdentity(getSender(), true);
}

void Fractal::newIdentity(AccountNumber name, bool requireNew)
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
      emit().history().identityAdded(name);
   }
}

void Fractal::setDispName(string displayName)
{
   auto identityTable = Tables().open<IdentityTable>();
   auto identity      = identityTable.get(getSender());
   check(identity.has_value(), "identity DNE");

   const size_t maxDisplayNameLength = 20;
   check(displayName.length() < maxDisplayNameLength, "display name too long");

   identity->displayName = displayName;
   identityTable.put(*identity);
}

void Fractal::invite(AccountNumber fractal, PublicKey pubkey)
{
   auto fractalTable = Tables().open<FractalTable>();
   auto fracRecord   = fractalTable.get(fractal);
   check(fracRecord.has_value(), "fractal DNE");

   to<InviteNs::Invite>().createInvite(pubkey, service, std::nullopt);

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

   emit().history().invCreated(pubkey, sender, fractal);
}

void Fractal::claim(PublicKey inviteKey)
{
   auto inviteTable   = Tables().open<InviteTable>();
   auto fractalInvite = inviteTable.get(inviteKey);
   check(fractalInvite.has_value(),
         "This invite does not exist. It is either not a fractal invite, or could have been "
         "deleted after expiry.");
   check(fractalInvite->recipient == AccountNumber{0}, "this invite has already been claimed");

   auto sender = getSender();
   to<InviteNs::Invite>().checkClaim(sender, inviteKey);

   // Save the claimant account name with the invite
   auto record      = *fractalInvite;
   record.recipient = sender;
   inviteTable.put(record);

   // Create an account for the claimant if it doesn't already exist
   bool requireNew = false;
   newIdentity(sender, requireNew);

   // Invite has officially been accepted/associated with an account. No need to keep original inv object
   to<InviteNs::Invite>().delInvite(inviteKey);

   emit().history().invReceived(inviteKey, sender, record.fractal);
}

void Fractal::accept(PublicKey inviteKey)
{
   auto sender = getSender();

   auto inviteTable = Tables().open<InviteTable>();
   auto record      = inviteTable.get(inviteKey);
   check(record.has_value(), "invite DNE");

   auto identityTable = Tables().open<IdentityTable>();
   auto joinerProfile = identityTable.get(sender);
   check(joinerProfile.has_value(), "only accounts with a fractal profile can accept invites");

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

   emit().history().invAccepted(inviteKey, invite.creator, fractal, sender);
}

void Fractal::reject(PublicKey inviteKey)
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

   emit().history().invRejected(inviteKey, sender, invite->fractal);
}

void Fractal::registerType()
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

void Fractal::newFractal(AccountNumber account, AccountNumber type)
{
   auto table  = Tables().open<FractalTable>();
   auto record = table.get(account);
   check(not record.has_value(), "fractal already exists");

   // Todo - Create the account and set its auth

   auto sender = getSender();

   auto          time = to<Transact>().currentBlock().time;
   FractalRecord newFractal{
       .account = account, .type = type, .founder = sender, .creationTime = time};
   table.put(newFractal);

   // Creator of the new fractal is the first member.
   MembershipRecord firstMember{MembershipKey{sender, account}, psibase::AccountNumber{0}, 0};
   Tables().open<MemberTable>().put(firstMember);

   // Todo - check that type exists

   // Todo - emit event
}

void Fractal::setFracName(AccountNumber fractalAccount, std::string displayName)
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

void Fractal::setFracDesc(psibase::AccountNumber fractalAccount, std::string description)
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

void Fractal::setFracLang(psibase::AccountNumber fractalAccount, std::string languageCode)
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

optional<IdentityRecord> Fractal::getIdentity(AccountNumber name)
{
   return Tables().open<IdentityTable>().get(name);
}

optional<MembershipRecord> Fractal::getMember(AccountNumber account, AccountNumber fractal)
{
   return Tables().open<MemberTable>().get(MembershipKey{account, fractal});
}

struct Queries
{
   auto getIdentity(AccountNumber user) const
   {  //
      return Fractal::Tables(Fractal::service).open<IdentityTable>().get(user);
   }

   auto getInvite(FractalNs::PublicKey pubkey) const
   {  //
      return Fractal::Tables(Fractal::service).open<InviteTable>().get(pubkey);
   }

   auto getMember(AccountNumber user, AccountNumber fractal) const
   {  //
      MembershipKey key{user, fractal};
      return Fractal::Tables(Fractal::service).open<MemberTable>().get(key);
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
      auto idx = Fractal::Tables{Fractal::service}.open<MemberTable>().getIndex<1>().subindex(user);

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
      return Fractal::Tables(Fractal::service).open<FractalTable>().get(fractal);
   }

   auto getFractalType(AccountNumber service) const
   {  //
      return Fractal::Tables(Fractal::service).open<FractalTypeTable>().get(service);
   }
};
PSIO_REFLECT(Queries,  //
             method(getIdentity, user),
             method(getInvite, pubkey),
             method(getMember, user, fractal),
             method(getFractals, user, gt, ge, lt, le, first, last, before, after),
             method(getFractal, fractal),
             method(getFractalType, service)
             //
);

optional<HttpReply> Fractal::serveSys(HttpRequest request)
{
   if (auto result = serveSimpleUI<Fractal, true>(request))
      return result;

   if (auto result = serveGraphQL(request, Queries{}))
      return result;

   return nullopt;
}

PSIBASE_DISPATCH(UserService::FractalNs::Fractal)
