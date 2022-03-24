#include "nft_sys.hpp"

#include <contracts/system/transaction_sys.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/native_tables.hpp>

#include <psio/fracpack.hpp>
#include <psio/from_bin.hpp>
#include <psio/reflect.hpp>

using namespace psibase;

namespace psibase
{
   using table_num = uint32_t;

   namespace
   {
      // Replace with auth calls when available
      bool require_auth(account_num acc) { return true; }

      // Move to nft_id class
      uint64_t generate(uint32_t a, uint32_t b)
      {
         return (static_cast<uint64_t>(a) << 32 | static_cast<uint64_t>(b));
      }
      struct nft_id
      {
         static bool exists(nid id) { return false; }
         static bool valid(nid id) { return true; }
      };
   }  // namespace

   uint64_t nft_sys::mint(account_num issuer, sub_id_type sub_id)
   {
      account_num ram_payer = issuer;
      require_auth(ram_payer);

      uint64_t new_id = generate(issuer, sub_id);

      tables t{contract};
      auto   nft_table = t.open<nft_table_t>();
      auto   nft_idx   = nft_table.get_index<0>();

      check(nft_idx.get(new_id) == std::nullopt, "Nft already exists");
      check(nft_id::valid(new_id), "Nft ID invalid");

      nft_table.put(nft{new_id, issuer, issuer, 0});

      return new_id;
   }

   void nft_sys::transfer(psibase::account_num actor,
                          psibase::account_num to,
                          uint64_t             nid,
                          std::string          memo)
   {
      printf("Transfer was called.");
   }

}  // namespace psibase

PSIBASE_DISPATCH(psibase::nft_sys)
