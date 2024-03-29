#include <services/user/NftSys.hpp>

#include <psibase/Bitset.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/commonErrors.hpp>

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

NftSys::NftSys(psio::shared_view_ptr<psibase::Action> action)
{
   MethodNumber m{action->method()};
   if (m != MethodNumber{"init"})
   {
      auto initRecord = Tables().open<InitTable>().get(SingletonKey{});
      check(initRecord.has_value(), uninitialized);
   }
}

void NftSys::init()
{
   auto initTable = Tables().open<InitTable>();
   auto init      = (initTable.get(SingletonKey{}));
   check(not init.has_value(), alreadyInit);
   initTable.put(InitializedRecord{});

   // Configure manual debit for self on Token and NFT
   to<NftSys>().setUserConf(userConfig::manualDebit, true);

   // Register serveSys handler
   to<SystemService::HttpServer>().registerServer(NftSys::service);
}

NID NftSys::mint()
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

   newRecord.eventHead = emit().history().minted(0, newId, issuer);
   holder.eventHead    = emit().history().minted(0, newId, issuer);

   Tables().open<NftHolderTable>().put(holder);
   nftTable.put(newRecord);

   return newId;
}

void NftSys::burn(NID nftId)
{
   auto record = getNft(nftId);

   check(record.owner == getSender(), missingRequiredAuth);

   auto holder      = getNftHolder(record.owner);
   holder.eventHead = emit().history().burned(holder.eventHead, nftId);

   Tables().open<NftTable>().erase(nftId);
   Tables().open<NftHolderTable>().put(holder);
}

void NftSys::credit(NID nftId, psibase::AccountNumber receiver, view<const Memo> memo)
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

   senderHolder.eventHead =
       emit().history().credited(senderHolder.eventHead, nftId, sender, receiver, memo);
   receiverHolder.eventHead =
       emit().history().credited(receiverHolder.eventHead, nftId, sender, receiver, memo);
   record.eventHead =  //
       emit().history().credited(record.eventHead, nftId, sender, receiver, memo);

   if (isTransfer)
   {
      senderHolder.eventHead =
          emit().history().transferred(senderHolder.eventHead, nftId, sender, receiver, memo);
      receiverHolder.eventHead =
          emit().history().transferred(receiverHolder.eventHead, nftId, sender, receiver, memo);
      record.eventHead =
          emit().history().transferred(record.eventHead, nftId, sender, receiver, memo);
   }

   if (isTransfer)
   {
      record.owner = receiver;
   }
   else
   {
      creditRecord.debitor = receiver;
      Tables().open<CreditTable>().put(creditRecord);
   }

   Tables().open<NftTable>().put(record);
   Tables().open<NftHolderTable>().put(senderHolder);
   Tables().open<NftHolderTable>().put(receiverHolder);
}

void NftSys::uncredit(NID nftId, view<const Memo> memo)
{
   auto                   record       = getNft(nftId);
   psibase::AccountNumber sender       = getSender();
   auto                   creditRecord = getCredRecord(nftId);

   check(creditRecord.debitor != Accounts::nullAccount, uncreditRequiresCredit);
   check(record.owner == sender, creditorAction);

   auto senderHolder   = getNftHolder(sender);
   auto receiverHolder = getNftHolder(creditRecord.debitor);

   record.eventHead         = emit().history().uncredited(record.eventHead, nftId, sender,  //
                                                          creditRecord.debitor, memo);
   senderHolder.eventHead   = emit().history().uncredited(senderHolder.eventHead, nftId, sender,
                                                          creditRecord.debitor, memo);
   receiverHolder.eventHead = emit().history().uncredited(receiverHolder.eventHead, nftId, sender,
                                                          creditRecord.debitor, memo);
   Tables().open<NftTable>().put(record);
   Tables().open<NftHolderTable>().put(senderHolder);
   Tables().open<NftHolderTable>().put(receiverHolder);
   Tables().open<CreditTable>().erase(nftId);
}

void NftSys::debit(NID nftId, view<const Memo> memo)
{
   auto record       = getNft(nftId);
   auto debitor      = getSender();
   auto creditor     = record.owner;
   auto creditRecord = getCredRecord(nftId);

   check(creditRecord.debitor != Accounts::nullAccount, debitRequiresCredit);
   check(creditRecord.debitor == debitor, missingRequiredAuth);

   record.owner = debitor;

   auto creditorHolder = getNftHolder(creditor);
   auto debitorHolder  = getNftHolder(debitor);
   record.eventHead =
       emit().history().transferred(record.eventHead, nftId, creditor, debitor, memo);
   creditorHolder.eventHead =
       emit().history().transferred(creditorHolder.eventHead, nftId, creditor, debitor, memo);
   debitorHolder.eventHead =
       emit().history().transferred(debitorHolder.eventHead, nftId, creditor, debitor, memo);

   Tables().open<NftTable>().put(record);
   Tables().open<NftHolderRecord>().put(creditorHolder);
   Tables().open<NftHolderRecord>().put(debitorHolder);
   Tables().open<CreditTable>().erase(nftId);
}

void NftSys::setUserConf(psibase::EnumElement flag, bool enable)
{
   auto sender  = getSender();
   auto record  = getNftHolder(sender);
   auto bit     = NftHolderRecord::Configurations::value(flag);
   bool flagSet = getNftHolder(sender).config.get(bit);

   check(flagSet != enable, redundantUpdate);

   record.config.set(bit, enable);
   record.eventHead = emit().history().userConfSet(record.eventHead, sender, flag, enable);

   Tables().open<NftHolderTable>().put(record);
}

NftRecord NftSys::getNft(NID nftId)
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

NftHolderRecord NftSys::getNftHolder(AccountNumber account)
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

CreditRecord NftSys::getCredRecord(NID nftId)
{
   auto creditRecord = Tables().open<CreditTable>().get(nftId);

   if (creditRecord.has_value())
   {
      return *creditRecord;
   }
   else
   {
      check(exists(nftId), nftDNE);

      return CreditRecord{nftId, Accounts::nullAccount};
   }
}

bool NftSys::exists(NID nftId)
{
   return Tables().open<NftTable>().get(nftId).has_value();
}

bool NftSys::getUserConf(psibase::AccountNumber account, psibase::EnumElement flag)
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

auto nftSys = QueryableService<NftSys::Tables, NftSys::Events>{NftSys::service};
struct NftQuery
{
   auto events() const
   {  //
      return nftSys.allEvents();
   }
   auto nftEvents(NID nftId, optional<uint32_t> first, const optional<string>& after) const
   {
      return nftSys.eventIndex<NftSys::NftEvents>(nftId, first, after);
   }
   auto userEvents(AccountNumber           user,
                   optional<uint32_t>      first,
                   const optional<string>& after) const
   {
      return nftSys.eventIndex<NftSys::UserEvents>(user, first, after);
   }

   auto nftHolders() const { return nftSys.index<NftHolderTable, 0>(); }
   auto nfts() const { return nftSys.index<NftTable, 0>(); }
   auto nftCredits() const { return nftSys.index<CreditTable, 0>(); }
};
PSIO_REFLECT(NftQuery,
             method(events),
             method(nftEvents, nftId, first, after),
             method(userEvents, user, first, after),
             method(nftHolders),
             method(nfts),
             method(nftCredits));

std::optional<psibase::HttpReply> NftSys::serveSys(psibase::HttpRequest request)
{
   if (auto result = serveSimpleUI<NftSys, true>(request))
      return result;
   if (auto result = serveGraphQL(request, NftQuery{}))
      return result;
   return nullopt;
}

PSIBASE_DISPATCH(UserService::NftSys)
