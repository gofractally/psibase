#include "nft_sys.hpp"

#include <contracts/system/account_sys.hpp>
#include <contracts/system/common_errors.hpp>
#include <psibase/Bitset.hpp>
#include <psibase/actor.hpp>
#include <psibase/dispatch.hpp>
#include <psio/fracpack.hpp>

using namespace psibase;
using namespace UserContract;
using namespace Errors;
using psio::const_view;
using std::string;
using system_contract::account_sys;

NftSys::NftSys(psio::shared_view_ptr<psibase::Action> action)
{
   MethodNumber m{action->method()->value().get()};
   if (m != MethodNumber{"init"})
   {
      auto initRecord = db.open<InitTable_t>().get_index<0>().get((uint8_t)0);
      check(initRecord.has_value(), uninitialized);
   }
}

void NftSys::init()
{
   auto initTable = db.open<InitTable_t>();
   auto init      = (initTable.get_index<0>().get((uint8_t)0));
   check(not init.has_value(), alreadyInit);
   initTable.put(InitializedRecord{});

   // TODO
   // Turn on manualDebit for this and tokens

   emit().ui().initialized();
}

NID NftSys::mint()
{
   auto issuer   = get_sender();
   auto nftTable = db.open<NftTable_t>();
   auto nftIdx   = nftTable.get_index<0>();

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

   check(record.owner == get_sender(), missingRequiredAuth);

   db.open<NftTable_t>().erase(nftId);

   emit().ui().burned(nftId);
}

void NftSys::credit(NID nftId, psibase::AccountNumber receiver, const_view<String> memo)
{
   auto                   record       = getNft(nftId);
   psibase::AccountNumber sender       = get_sender();
   CreditRecord           creditRecord = getCredRecord(nftId);
   auto manualDebitFlag                = NftHolderRecord::Configurations::getIndex("manualDebit"_m);
   bool isTransfer                     = not getNftHolder(receiver).config.get(manualDebitFlag);

   check(record.owner == sender, missingRequiredAuth);
   check(receiver != record.owner, creditorIsDebitor);
   check(creditRecord.debitor == account_sys::nullAccount, alreadyCredited);

   if (isTransfer)
   {
      record.owner = receiver;
      db.open<NftTable_t>().put(record);
   }
   else
   {
      creditRecord.debitor = receiver;
      db.open<CreditTable_t>().put(creditRecord);
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
   psibase::AccountNumber sender       = get_sender();
   auto                   creditRecord = getCredRecord(nftId);

   check(creditRecord.debitor != account_sys::nullAccount, uncreditRequiresCredit);
   check(record.owner == sender, creditorAction);

   db.open<CreditTable_t>().erase(nftId);

   emit().ui().uncredited(nftId, sender, creditRecord.debitor, memo);
}

void NftSys::debit(NID nftId, const_view<String> memo)
{
   auto record       = getNft(nftId);
   auto debiter      = get_sender();
   auto creditor     = record.owner;
   auto creditRecord = getCredRecord(nftId);

   check(creditRecord.debitor != account_sys::nullAccount, debitRequiresCredit);
   check(creditRecord.debitor == debiter, missingRequiredAuth);

   record.owner = debiter;

   db.open<NftTable_t>().put(record);
   db.open<CreditTable_t>().erase(nftId);

   emit().ui().transferred(nftId, creditor, debiter, memo);
}

void NftSys::setConfig(psibase::NamedBit_t flag, bool enable)
{
   auto record  = getNftHolder(get_sender());
   auto bit     = NftHolderRecord::Configurations::getIndex(flag);
   bool flagSet = getNftHolder(get_sender()).config.get(bit);

   check(flagSet != enable, redundantUpdate);

   record.config.set(bit, enable);

   db.open<NftHolderTable_t>().put(record);

   emit().ui().configChanged(get_sender(), flag, enable);
}

NftRecord NftSys::getNft(NID nftId)
{
   auto nftRecord = db.open<NftTable_t>().get_index<0>().get(nftId);
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
   auto nftHodler = db.open<NftHolderTable_t>().get_index<0>().get(account);

   if (nftHodler.has_value())
   {
      return *nftHodler;
   }
   else
   {
      check(account != account_sys::nullAccount, invalidAccount);
      check(at<account_sys>().exists(account), invalidAccount);

      return NftHolderRecord{account};
   }
}

CreditRecord NftSys::getCredRecord(NID nftId)
{
   auto creditRecord = db.open<CreditTable_t>().get_index<0>().get(nftId);

   if (creditRecord.has_value())
   {
      return *creditRecord;
   }
   else
   {
      check(exists(nftId), nftDNE);

      return CreditRecord{nftId, account_sys::nullAccount};
   }
}

bool NftSys::exists(NID nftId)
{
   return db.open<NftTable_t>().get_index<0>().get(nftId).has_value();
}

bool NftSys::getConfig(psibase::AccountNumber account, psibase::NamedBit_t flag)
{
   auto hodler = db.open<NftHolderTable_t>().get_index<0>().get(account);
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

PSIBASE_DISPATCH(UserContract::NftSys)
