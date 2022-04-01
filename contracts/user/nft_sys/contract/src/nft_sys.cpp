#include "nft_sys.hpp"

#include <contracts/system/account_sys.hpp>
#include <contracts/system/transaction_sys.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/native_tables.hpp>

#include <psio/fracpack.hpp>
#include <psio/from_bin.hpp>
#include <psio/reflect.hpp>

using namespace psibase;
using namespace nft_sys;
using psio::const_view;
using std::string;
using system_contract::account_sys;

namespace
{
   uint64_t generate(uint32_t a, uint32_t b)
   {
      return (static_cast<uint64_t>(a) << 32 | static_cast<uint64_t>(b));
   }
}  // namespace

namespace stubs
{
   // Replace with auth calls when available
   bool require_auth(AccountNumber acc) { return true; }
}  // namespace stubs

uint64_t nft_contract::mint(AccountNumber issuer, sub_id_type sub_id)
{
   //TODO - delete sub_id
   AccountNumber ram_payer = issuer;
   stubs::require_auth(ram_payer);

   auto nft_table = db.open<nft_table_t>();
   auto nft_idx   = nft_table.get_index<0>();

   // Todo - replace with auto incrementing when available
   auto new_id = (nft_idx.begin() == nft_idx.end()) ? 1 : (*(--nft_idx.end())).id + 1;

   check(nft_row::is_valid_key(new_id), "Nft ID invalid");

   nft_table.put(nft_row{
       .id               = new_id,           //
       .issuer           = issuer,           //
       .owner            = issuer,           //
       .approved_account = AccountNumber(0)  //
   });

   return new_id;
}

std::optional<nft_row> nft_contract::getNft(nid nft_id)
{
   auto nft_table = db.open<nft_table_t>();
   auto nft_idx   = nft_table.get_index<0>();
   return nft_idx.get(nft_id);

   //printf("Contract 2: NFT ID is %" PRId64 "\n", (*nft).id);
}

int64_t nft_contract::isAutodebit(psibase::AccountNumber user)
{
   auto ad_table_idx = db.open<ad_table_t>().get_index<0>();
   auto ad           = ad_table_idx.get(user);
   bool ret          = (!ad.has_value()) || (ad.has_value() && ad->autodebit);
   return ret ? 1 : 0;
}

PSIBASE_DISPATCH(nft_sys::nft_contract)
