#include <psibase/Bitset.hpp>
#include <psibase/dispatch.hpp>
#include <psio/fracpack.hpp>
#include <services/system/AccountSys.hpp>
#include <services/system/commonErrors.hpp>
#include <services/user/NftSys.hpp>

using namespace psibase;
using namespace UserService;
using namespace Errors;
using psio::const_view;
using std::string;
using SystemService::AccountSys;

NftSys::NftSys(psio::shared_view_ptr<psibase::Action> action)
{
   MethodNumber m{action->method()->value().get()};
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

   // TODO
   // Turn on manualDebit for this and tokens

   emit().ui().initialized();
}

NID NftSys::mint()
{
   auto issuer   = getSender();
   auto nftTable = Tables().open<NftTable>();
   auto nftIdx   = nftTable.getIndex<0>();

   // Todo - replace with auto incrementing when available
   auto newId = (nftIdx.begin() == nftIdx.end()) ? 1 : (*(--nftIdx.end())).id + 1;

   check(NftRecord::isValidKey(newId), invalidNftId);

   nftTable.put(NftRecord{
       .id     = newId,   //
       .issuer = issuer,  //
       .owner  = issuer   //
   });

   emit().ui().minted(newId, issuer);

   return newId;
}

void NftSys::burn(NID nftId)
{
   auto record = getNft(nftId);

   check(record.owner == getSender(), missingRequiredAuth);

   Tables().open<NftTable>().erase(nftId);

   emit().ui().burned(nftId);
}

void NftSys::credit(NID nftId, psibase::AccountNumber receiver, const_view<String> memo)
{
   auto                   record       = getNft(nftId);
   psibase::AccountNumber sender       = getSender();
   CreditRecord           creditRecord = getCredRecord(nftId);
   auto manualDebitFlag                = NftHolderRecord::Configurations::getIndex("manualDebit"_m);
   bool isTransfer                     = not getNftHolder(receiver).config.get(manualDebitFlag);

   check(record.owner == sender, missingRequiredAuth);
   check(receiver != record.owner, creditorIsDebitor);
   check(creditRecord.debitor == AccountSys::nullAccount, alreadyCredited);

   if (isTransfer)
   {
      record.owner = receiver;
      Tables().open<NftTable>().put(record);
   }
   else
   {
      creditRecord.debitor = receiver;
      Tables().open<CreditTable>().put(creditRecord);
   }

   emit().ui().credited(nftId, sender, receiver, memo);

   if (isTransfer)
   {
      emit().ui().transferred(nftId, sender, receiver, memo);
   }
}

void NftSys::uncredit(NID nftId, const_view<String> memo)
{
   auto                   record       = getNft(nftId);
   psibase::AccountNumber sender       = getSender();
   auto                   creditRecord = getCredRecord(nftId);

   check(creditRecord.debitor != AccountSys::nullAccount, uncreditRequiresCredit);
   check(record.owner == sender, creditorAction);

   Tables().open<CreditTable>().erase(nftId);

   emit().ui().uncredited(nftId, sender, creditRecord.debitor, memo);
}

void NftSys::debit(NID nftId, const_view<String> memo)
{
   auto record       = getNft(nftId);
   auto debiter      = getSender();
   auto creditor     = record.owner;
   auto creditRecord = getCredRecord(nftId);

   check(creditRecord.debitor != AccountSys::nullAccount, debitRequiresCredit);
   check(creditRecord.debitor == debiter, missingRequiredAuth);

   record.owner = debiter;

   Tables().open<NftTable>().put(record);
   Tables().open<CreditTable>().erase(nftId);

   emit().ui().transferred(nftId, creditor, debiter, memo);
}

void NftSys::setUserConf(psibase::NamedBit flag, bool enable)
{
   auto sender  = getSender();
   auto record  = getNftHolder(sender);
   auto bit     = NftHolderRecord::Configurations::getIndex(flag);
   bool flagSet = getNftHolder(sender).config.get(bit);

   check(flagSet != enable, redundantUpdate);

   record.config.set(bit, enable);

   Tables().open<NftHolderTable>().put(record);

   emit().ui().userConfSet(sender, flag, enable);
}

NftRecord NftSys::getNft(NID nftId)
{
   auto nftRecord = Tables().open<NftTable>().get(nftId);
   bool exists    = nftRecord.has_value();

   // Todo
   if (false)  // if (nftId < nextAvailableID()) // Then the NFt definitely existed at one point
   {
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
      check(account != AccountSys::nullAccount, invalidAccount);
      check(to<AccountSys>().exists(account), invalidAccount);

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

      return CreditRecord{nftId, AccountSys::nullAccount};
   }
}

bool NftSys::exists(NID nftId)
{
   return Tables().open<NftTable>().get(nftId).has_value();
}

bool NftSys::getUserConf(psibase::AccountNumber account, psibase::NamedBit flag)
{
   auto hodler = Tables().open<NftHolderTable>().get(account);
   if (hodler.has_value() == false)
   {
      return false;
   }
   else
   {
      auto bit = NftHolderRecord::Configurations::getIndex(flag);
      return (*hodler).config.get(bit);
   }
}

PSIBASE_DISPATCH(UserService::NftSys)
