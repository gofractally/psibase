#include "nft_sys.hpp"

#include <contracts/system/account_sys.hpp>
#include <psibase/Bitset.hpp>
#include <psibase/actor.hpp>
#include <psibase/dispatch.hpp>
#include <psio/fracpack.hpp>

using namespace psibase;
using namespace UserContract;
using psio::const_view;
using std::string;
using system_contract::account_sys;

namespace stubs
{
   // Replace with auth calls when available
   bool require_auth(AccountNumber acc) { return true; }
}  // namespace stubs

namespace
{
   constexpr auto manualDebitBit = NftHolderRecord::Configurations::getIndex("manualDebit"_m);
}

NID NftSys::mint()
{
   auto issuer   = get_sender();
   auto nftTable = db.open<NftTable_t>();
   auto nftIdx   = nftTable.get_index<0>();

   // Todo - replace with auto incrementing when available
   auto newId = (nftIdx.begin() == nftIdx.end()) ? 1 : (*(--nftIdx.end())).id + 1;

   check(NftRecord::isValidKey(newId), "Nft ID invalid");

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

   check(record.owner == get_sender(), Errors::missingRequiredAuth);

   db.open<NftTable_t>().erase(nftId);

   emit().ui().burned(nftId);
}

void NftSys::credit(NID nftId, psibase::AccountNumber receiver, const_view<String> memo)
{
   auto                   record       = getNft(nftId);
   psibase::AccountNumber sender       = get_sender();
   CreditRecord           creditRecord = getCredRecord(nftId);
   auto                   isTransfer   = not getNftHolder(receiver).config.get(manualDebitBit);

   check(record.owner == sender, Errors::missingRequiredAuth);
   check(receiver != record.owner, Errors::creditorIsDebitor);
   check(creditRecord.debitor == account_sys::nullAccount, Errors::alreadyCredited);

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

   check(creditRecord.debitor != account_sys::nullAccount, Errors::uncreditRequiresCredit);
   check(record.owner == sender, Errors::creditorAction);

   db.open<CreditTable_t>().erase(nftId);

   emit().ui().uncredited(nftId, sender, creditRecord.debitor, memo);
}

void NftSys::debit(NID nftId, const_view<String> memo)
{
   auto record       = getNft(nftId);
   auto debiter      = get_sender();
   auto creditor     = record.owner;
   auto creditRecord = getCredRecord(nftId);

   check(creditRecord.debitor != account_sys::nullAccount, Errors::debitRequiresCredit);
   check(creditRecord.debitor == debiter, Errors::missingRequiredAuth);

   record.owner = debiter;

   db.open<NftTable_t>().put(record);
   db.open<CreditTable_t>().erase(nftId);

   emit().ui().transferred(nftId, creditor, debiter, memo);
}

void NftSys::manualDebit(bool enable)
{
   auto record = getNftHolder(get_sender());

   check(record.config.get(manualDebitBit) != enable, Errors::redundantUpdate);

   record.config.set(manualDebitBit);
   db.open<NftHolderTable_t>().put(record);

   if (enable)
   {
      emit().ui().enabledManDeb(get_sender());
   }
   else
   {
      emit().ui().disabledManDeb(get_sender());
   }
}

NftRecord NftSys::getNft(NID nftId)
{
   auto nftRecord = db.open<NftTable_t>().get_index<0>().get(nftId);
   bool exists    = nftRecord.has_value();

   if (false)  // if (nftId < nextAvailableID()) // Then the NFt definitely existed at one point
   {
      check(exists, Errors::nftBurned);
   }
   else
   {
      check(exists, Errors::nftDNE);
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
      check(account != account_sys::nullAccount, Errors::invalidAccount);
      check(at<account_sys>().exists(account), Errors::invalidAccount);

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
      check(exists(nftId), Errors::nftDNE);

      return CreditRecord{nftId, account_sys::nullAccount};
   }
}

bool NftSys::exists(NID nftId)
{
   return db.open<NftTable_t>().get_index<0>().get(nftId).has_value();
}

PSIBASE_DISPATCH(UserContract::NftSys)
