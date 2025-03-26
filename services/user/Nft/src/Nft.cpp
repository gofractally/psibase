#include <services/user/Nft.hpp>

#include <psibase/Bitset.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/commonErrors.hpp>
#include <services/user/Events.hpp>

#include <psibase/serveSimpleUI.hpp>

using namespace psibase;
using namespace UserService;
using namespace Errors;
using psio::view;
using std::nullopt;
using std::optional;
using std::string;
using SystemService::Accounts;

namespace
{
   namespace userConfig
   {
      constexpr auto manualDebit = psibase::EnumElement{"manualDebit"};
   }
}  // namespace

Nft::Nft(psio::shared_view_ptr<psibase::Action> action)
{
   MethodNumber m{action->method()};
   if (m != MethodNumber{"init"})
   {
      auto initRecord = Tables().open<InitTable>().get(SingletonKey{});
      check(initRecord.has_value(), uninitialized);
   }
}

void Nft::init()
{
   auto initTable = Tables().open<InitTable>();
   auto init      = (initTable.get(SingletonKey{}));
   check(not init.has_value(), alreadyInit);
   initTable.put(InitializedRecord{});

   // Configure manual debit for self on Token and NFT
   recurse().to<Nft>().setUserConf(userConfig::manualDebit, true);

   // Register serveSys handler
   to<SystemService::HttpServer>().registerServer(Nft::service);

   // Register event schema
   to<EventIndex>().setSchema(ServiceSchema::make<Nft>());
   // Event indices:
   to<EventIndex>().addIndex(DbId::historyEvent, Nft::service, "minted"_m, 0);
   to<EventIndex>().addIndex(DbId::historyEvent, Nft::service, "minted"_m, 1);
   to<EventIndex>().addIndex(DbId::historyEvent, Nft::service, "burned"_m, 0);
   to<EventIndex>().addIndex(DbId::historyEvent, Nft::service, "burned"_m, 1);
   to<EventIndex>().addIndex(DbId::historyEvent, Nft::service, "userConfSet"_m, 0);
   to<EventIndex>().addIndex(DbId::historyEvent, Nft::service, "credited"_m, 0);
   to<EventIndex>().addIndex(DbId::historyEvent, Nft::service, "credited"_m, 1);
   to<EventIndex>().addIndex(DbId::historyEvent, Nft::service, "credited"_m, 2);
   to<EventIndex>().addIndex(DbId::historyEvent, Nft::service, "uncredited"_m, 0);
   to<EventIndex>().addIndex(DbId::historyEvent, Nft::service, "uncredited"_m, 1);
   to<EventIndex>().addIndex(DbId::historyEvent, Nft::service, "uncredited"_m, 2);
   to<EventIndex>().addIndex(DbId::merkleEvent, Nft::service, "transferred"_m, 0);
   to<EventIndex>().addIndex(DbId::merkleEvent, Nft::service, "transferred"_m, 1);
   to<EventIndex>().addIndex(DbId::merkleEvent, Nft::service, "transferred"_m, 2);
}

NID Nft::mint()
{
   auto issuer   = getSender();
   auto holder   = getNftHolder(issuer);
   auto nftTable = Tables().open<NftTable>();
   auto nftIdx   = nftTable.getIndex<0>();

   // Todo - replace with auto incrementing when available
   auto newId = (nftIdx.begin() == nftIdx.end()) ? 1 : (*(--nftIdx.end())).id + 1;

   check(NftRecord::isValidKey(newId), invalidNftId);

   auto newRecord = NftRecord{
       .id     = newId,   //
       .issuer = issuer,  //
       .owner  = issuer   //
   };

   Tables().open<NftHolderTable>().put(holder);
   nftTable.put(newRecord);

   emit().history().minted(newId, issuer);

   return newId;
}

void Nft::burn(NID nftId)
{
   auto record = getNft(nftId);
   check(record.owner == getSender(), missingRequiredAuth);

   Tables().open<NftTable>().erase(nftId);
   emit().history().burned(nftId, record.owner);
}

void Nft::credit(NID nftId, psibase::AccountNumber receiver, view<const Memo> memo)
{
   auto                   record          = getNft(nftId);
   psibase::AccountNumber sender          = getSender();
   CreditRecord           creditRecord    = getCredRecord(nftId);
   auto                   manualDebitFlag = NftHolderRecord::Configurations::value("manualDebit"_m);
   auto                   senderHolder    = getNftHolder(sender);
   auto                   receiverHolder  = getNftHolder(receiver);
   bool                   isTransfer      = not receiverHolder.config.get(manualDebitFlag);

   check(record.owner == sender, missingRequiredAuth);
   check(receiver != record.owner, creditorIsDebitor);
   check(creditRecord.debitor == Accounts::nullAccount, alreadyCredited);

   emit().history().credited(nftId, sender, receiver, memo);

   if (isTransfer)
   {
      record.owner = receiver;
      emit().merkle().transferred(nftId, sender, receiver, memo);
   }
   else
   {
      creditRecord.creditor = sender;
      creditRecord.debitor  = receiver;
      Tables().open<CreditTable>().put(creditRecord);
   }

   Tables().open<NftTable>().put(record);
   Tables().open<NftHolderTable>().put(receiverHolder);
}

void Nft::uncredit(NID nftId, view<const Memo> memo)
{
   auto                   record       = getNft(nftId);
   psibase::AccountNumber sender       = getSender();
   auto                   creditRecord = getCredRecord(nftId);

   check(creditRecord.debitor != Accounts::nullAccount, uncreditRequiresCredit);
   check(record.owner == sender, creditorAction);

   Tables().open<CreditTable>().erase(nftId);
   emit().history().uncredited(nftId, sender, creditRecord.debitor, memo);
}

void Nft::debit(NID nftId, view<const Memo> memo)
{
   auto record       = getNft(nftId);
   auto debitor      = getSender();
   auto creditor     = record.owner;
   auto creditRecord = getCredRecord(nftId);

   check(creditRecord.debitor != Accounts::nullAccount, debitRequiresCredit);
   check(creditRecord.debitor == debitor, missingRequiredAuth);

   record.owner = debitor;
   Tables().open<NftTable>().put(record);
   Tables().open<CreditTable>().erase(nftId);

   emit().merkle().transferred(nftId, creditor, debitor, memo);
}

void Nft::setUserConf(psibase::EnumElement flag, bool enable)
{
   auto sender  = getSender();
   auto record  = getNftHolder(sender);
   auto bit     = NftHolderRecord::Configurations::value(flag);
   bool flagSet = getNftHolder(sender).config.get(bit);

   if (flagSet != enable)
   {
      record.config.set(bit, enable);
      Tables().open<NftHolderTable>().put(record);

      emit().history().userConfSet(sender, flag, enable);
   }
}

NftRecord Nft::getNft(NID nftId)
{
   auto nftIdx    = Tables().open<NftTable>().getIndex<0>();
   auto nftRecord = nftIdx.get(nftId);
   bool exists    = nftRecord.has_value();

   auto nextAvailableId = [&]()
   {
      // Todo - replace with table.getNextAvailableKey() when available
      return (nftIdx.begin() == nftIdx.end()) ? 1 : (*(--nftIdx.end())).id + 1;
   };

   if (nftId < nextAvailableId())
   {
      // NFT definitely existed at one point
      check(exists, nftBurned);
   }
   else
   {
      check(exists, nftDNE);
   }

   return *nftRecord;
}

NftHolderRecord Nft::getNftHolder(AccountNumber account)
{
   auto nftHodler = Tables().open<NftHolderTable>().get(account);

   if (nftHodler.has_value())
   {
      return *nftHodler;
   }
   else
   {
      check(account != Accounts::nullAccount, invalidAccount);
      check(to<Accounts>().exists(account), invalidAccount);

      return NftHolderRecord{account};
   }
}

CreditRecord Nft::getCredRecord(NID nftId)
{
   auto creditRecord = Tables().open<CreditTable>().get(nftId);

   if (creditRecord.has_value())
   {
      return *creditRecord;
   }
   else
   {
      check(exists(nftId), nftDNE);

      return CreditRecord{
          .nftId    = nftId,
          .debitor  = Accounts::nullAccount,
          .creditor = Accounts::nullAccount  //
      };
   }
}

bool Nft::exists(NID nftId)
{
   return Tables().open<NftTable>().get(nftId).has_value();
}

bool Nft::getUserConf(psibase::AccountNumber account, psibase::EnumElement flag)
{
   auto hodler = Tables().open<NftHolderTable>().get(account);
   if (hodler.has_value() == false)
   {
      return false;
   }
   else
   {
      auto bit = NftHolderRecord::Configurations::value(flag);
      return (*hodler).config.get(bit);
   }
}

struct UserDetail
{
   psibase::AccountNumber account;
   psibase::AccountNumber authService;
};
PSIO_REFLECT(UserDetail, account, authService);

struct NftDetail
{
   NID        id;
   UserDetail owner;
   UserDetail issuer;
};
PSIO_REFLECT(NftDetail, id, owner, issuer);

auto nftService = Nft::Tables{Nft::service};
struct NftQuery
{
   auto allNfts() const
   {
      return nftService.open<NftTable>().getIndex<0>();  //
   }

   auto userNfts(AccountNumber         user,
                 optional<uint32_t>    first,
                 optional<uint32_t>    last,
                 optional<std::string> before,
                 optional<std::string> after) const
   {
      auto idx = nftService.open<NftTable>().getIndex<1>().subindex(user);

      return makeConnection<Connection<NftRecord, "UserNftConnection", "UserNftEdge">>(
          idx, {std::nullopt}, {std::nullopt}, {std::nullopt}, {std::nullopt}, first, last, before,
          after);
   }

   auto userCredits(AccountNumber         user,
                    optional<uint32_t>    first,
                    optional<uint32_t>    last,
                    optional<std::string> before,
                    optional<std::string> after) const
   {
      auto idx = nftService.open<UserService::CreditTable>().getIndex<1>().subindex(user);

      return psibase::makeConnection<
          Connection<CreditRecord, "UserCreditConnection", "UserCreditEdge">>(
          idx, {std::nullopt}, {std::nullopt}, {std::nullopt}, {std::nullopt}, first, last, before,
          after);
   }

   auto userDebits(AccountNumber         user,
                   optional<uint32_t>    first,
                   optional<uint32_t>    last,
                   optional<std::string> before,
                   optional<std::string> after) const
   {
      auto idx = nftService.open<UserService::CreditTable>().getIndex<2>().subindex(user);

      return psibase::makeConnection<
          Connection<CreditRecord, "UserCreditConnection", "UserCreditEdge">>(
          idx, {std::nullopt}, {std::nullopt}, {std::nullopt}, {std::nullopt}, first, last, before,
          after);
   }

   auto nftDetails(NID nftId) const
   {  //
      auto nft = nftService.open<NftTable>().getIndex<0>().get(nftId);
      check(nft.has_value(), "NFT DNE");

      auto accountsIdx = SystemService::Accounts::Tables{SystemService::Accounts::service}
                             .open<SystemService::AccountTable>()
                             .getIndex<0>();
      auto owner  = accountsIdx.get(nft->owner);
      auto issuer = accountsIdx.get(nft->issuer);
      check(owner.has_value(), "Account DNE. Should never happen.");

      // clang-format off
      return NftDetail
      {
         .id = nft->id,
         .owner = UserDetail{
            .account     = nft->owner,
            .authService = owner->authService,
         },
         .issuer = UserDetail{
            .account     = nft->issuer,
            .authService = issuer->authService,
         },
      };
      // clang-format on
   }

   auto issuerNfts(AccountNumber         issuer,
                   optional<uint32_t>    first,
                   optional<uint32_t>    last,
                   optional<std::string> before,
                   optional<std::string> after) const
   {
      auto idx = nftService.open<NftTable>().getIndex<2>().subindex(issuer);

      return makeConnection<Connection<NftRecord, "UserNftConnection", "UserNftEdge">>(
          idx, {std::nullopt}, {std::nullopt}, {std::nullopt}, {std::nullopt}, first, last, before,
          after);
   }

   auto userConf(AccountNumber user, psibase::EnumElement flag) const
   {
      auto holder = nftService.open<NftHolderTable>().getIndex<0>().get(user);
      check(holder.has_value(), "NFT service has no record of user account");
      return holder->config.get(NftHolderRecord::Configurations::value(flag));
   }
};
PSIO_REFLECT(NftQuery,
             method(allNfts),
             method(userNfts, user, first, last, before, after),
             method(userCredits, user, first, last, before, after),
             method(userDebits, user, first, last, before, after),
             method(nftDetails, nftId),
             method(issuerNfts, issuer, first, last, before, after),
             method(userConf, user, flag));

std::optional<psibase::HttpReply> Nft::serveSys(psibase::HttpRequest request)
{
   if (auto result = serveSimpleUI<Nft, true>(request))
      return result;
   if (auto result = serveGraphQL(request, NftQuery{}))
      return result;
   return nullopt;
}

PSIBASE_DISPATCH(UserService::Nft)
