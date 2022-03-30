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
   bool require_auth(account_num acc) { return true; }
}  // namespace stubs

uint64_t nft_contract::mint(account_num issuer, sub_id_type sub_id)
{
   account_num ram_payer = issuer;
   stubs::require_auth(ram_payer);

   uint64_t new_id = generate(issuer, sub_id);

   auto nft_table = db.open<nft_table_t>();
   auto nft_idx   = nft_table.get_index<0>();

   check(nft_idx.get(new_id) == std::nullopt, "Nft already exists");
   check(nft_row::is_valid_key(new_id), "Nft ID invalid");

   nft_table.put(nft_row{new_id, issuer, issuer, 0});

   return new_id;
}

std::optional<nft_row> nft_contract::get_nft(nid nft_id)
{
   auto nft_table = db.open<nft_table_t>();
   auto nft_idx   = nft_table.get_index<0>();
   return nft_idx.get(nft_id);

   //printf("Contract 2: NFT ID is %" PRId64 "\n", (*nft).nftid);
}

PSIBASE_DISPATCH(nft_sys::nft_contract)
