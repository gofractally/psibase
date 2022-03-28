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
   check(nft::is_valid_key(new_id), "Nft ID invalid");

   nft_table.put(nft{new_id, issuer, issuer, 0});

   return new_id;
}

void nft_contract::transfer(account_num              from,
                            account_num              to,
                            nid                      nft_id,
                            psio::const_view<string> memo)
{
   stubs::require_auth(from);

   check(to != account_sys::null_account, "Target account invalid");

   actor<account_sys> asys{nft_contract::contract, account_sys::contract};
   check(asys.exists(to), "Target account DNE");

   check(to != from, "Cannot transfer NFT to self");

   check(nft::is_valid_key(nft_id), "NFT invalid");

   auto nft_table = db.open<nft_table_t>();
   auto nft_idx   = nft_table.get_index<0>();
   auto item_opt  = nft_idx.get(nft_id);
   check(item_opt != std::nullopt, "Nft DNE");

   nft item = item_opt.value();
   check(item.owner == from, "You don't own this NFT");

   // Modify the owner and reinsert into the database
   item.owner = to;
   nft_table.put(item);
}

std::optional<nft> nft_contract::get_nft(nid nft_id)
{
   auto nft_table = db.open<nft_table_t>();
   auto nft_idx   = nft_table.get_index<0>();
   return nft_idx.get(nft_id);

   //printf("Contract 2: NFT ID is %" PRId64 "\n", (*nft).nftid);
}

PSIBASE_DISPATCH(nft_sys::nft_contract)
