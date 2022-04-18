#include "nft_sys.hpp"

#include <contracts/system/account_sys.hpp>
#include <psibase/actor.hpp>
#include <psibase/dispatch.hpp>

using namespace psibase;
using namespace UserContract;
using psio::const_view;
using std::string;
using system_contract::account_sys;

namespace stubs
{
   // Replace with auth calls when available
   bool require_auth(AccountNumber acc) { return true; }
   void burnNFT() { check(false, "DB missing ability to delete records"); }
}  // namespace stubs

NID NftSys::mint()
{
   auto issuer   = get_sender();
   auto nftTable = db.open<NftTable_t>();
   auto nftIdx   = nftTable.get_index<0>();

   // Todo - replace with auto incrementing when available
   auto newId = (nftIdx.begin() == nftIdx.end()) ? 1 : (*(--nftIdx.end())).id + 1;

   check(NftRecord::isValidKey(newId), "Nft ID invalid");

   nftTable.put(NftRecord{
       .id         = newId,                     //
       .issuer     = issuer,                    //
       .owner      = issuer,                    //
       .creditedTo = account_sys::null_account  //
   });

   return newId;
}

void NftSys::burn(NID nftId)
{
   auto nftTable = db.open<NftTable_t>();
   auto nftIdx   = nftTable.get_index<0>();
   auto nft      = nftIdx.get(nftId);

   check(nft.has_value(), Errors::nftDNE);
   check(nft->owner == get_sender(), Errors::missingRequiredAuth);

   stubs::burnNFT();
}

void NftSys::autodebit(bool enable)
{
   auto adRecord = AdRecord{.user = get_sender(), .autodebit = enable};
   db.open<AdTable_t>().put(adRecord);
}

void NftSys::credit(psibase::AccountNumber receiver, NID nftId, std::string memo)
{
   auto record = getNft(nftId);
   check(record.has_value(), Errors::nftDNE);

   check(record->owner == get_sender(), Errors::missingRequiredAuth);
   check(receiver != record->owner, Errors::creditorIsDebitor);
   check(record->creditedTo == account_sys::null_account, Errors::alreadyCredited);
   check(at<account_sys>().exists(receiver), Errors::receiverDNE);

   bool transferred = _isAutoDebit(receiver);

   if (transferred)
   {
      record->owner = receiver;
   }
   else
   {
      record->creditedTo = receiver;
   }
   db.open<NftTable_t>().put(*record);

   if (transferred)
   {
      // Emit transferred event
   }
}

void NftSys::uncredit(NID nftId)
{
   auto record = getNft(nftId);
   check(record.has_value(), Errors::nftDNE);

   check(record->creditedTo != account_sys::null_account, Errors::uncreditRequiresCredit);
   check(record->owner == get_sender(), Errors::creditorAction);

   record->creditedTo = account_sys::null_account;
   db.open<NftTable_t>().put(*record);
}

void NftSys::debit(NID nftId)
{
   auto debiter = get_sender();
   auto record  = getNft(nftId);
   check(record.has_value(), Errors::nftDNE);

   auto creditedTo = record->creditedTo;
   check(creditedTo != account_sys::null_account, Errors::debitRequiresCredit);
   check(creditedTo == debiter, Errors::missingRequiredAuth);

   record->owner      = debiter;
   record->creditedTo = account_sys::null_account;

   db.open<NftTable_t>().put(*record);

   // Todo - Emit transferred event
}

std::optional<NftRecord> NftSys::getNft(NID nftId)
{
   auto nftTable = db.open<NftTable_t>();
   auto nftIdx   = nftTable.get_index<0>();
   return nftIdx.get(nftId);
}

bool NftSys::isAutodebit()
{
   return _isAutoDebit(get_sender());
}

bool NftSys::_isAutoDebit(psibase::AccountNumber account)
{
   auto ad_record = db.open<AdTable_t>().get_index<0>().get(account);
   return (!ad_record.has_value()) || (ad_record->autodebit);
}

bool NftSys::_exists(NID nftId)
{
   auto record = getNft(nftId);
   return record.has_value();
}

PSIBASE_DISPATCH(UserContract::NftSys)
