#include "nft_sys.hpp"

#include <contracts/system/account_sys.hpp>
#include <contracts/system/transaction_sys.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/native_tables.hpp>

#include <psio/fracpack.hpp>
#include <psio/from_bin.hpp>
#include <psio/reflect.hpp>

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

NID NftSys::mint()
{
   auto issuer = get_sender();
   auto output = issuer.str() + "\n";
   printf(output.c_str());
   auto nft_table = db.open<nft_table_t>();
   auto nft_idx   = nft_table.get_index<0>();

   // Todo - replace with auto incrementing when available
   auto new_id = (nft_idx.begin() == nft_idx.end()) ? 1 : (*(--nft_idx.end())).id + 1;

   check(NftRow::isValidKey(new_id), "Nft ID invalid");

   nft_table.put(NftRow{
       .id              = new_id,           //
       .issuer          = issuer,           //
       .owner           = issuer,           //
       .approvedAccount = AccountNumber(0)  //
   });

   return new_id;
}

std::optional<NftRow> NftSys::getNft(NID nftId)
{
   auto nft_table = db.open<nft_table_t>();
   auto nft_idx   = nft_table.get_index<0>();
   return nft_idx.get(nftId);

   //printf("Contract 2: NFT ID is %" PRId64 "\n", (*nft).id);
}

int64_t NftSys::isAutodebit()
{
   auto ad_table_idx = db.open<AdTable_t>().get_index<0>();
   auto ad           = ad_table_idx.get(get_sender());
   bool ret          = (!ad.has_value()) || (ad.has_value() && ad->autodebit);
   return ret ? 1 : 0;
}

void NftSys::autodebit(bool autoDebit) {}

PSIBASE_DISPATCH(UserContract::NftSys)
