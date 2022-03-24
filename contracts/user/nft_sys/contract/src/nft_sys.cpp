#include "nft_sys.hpp"

#include <contracts/system/transaction_sys.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/native_tables.hpp>
#include <psio/fracpack.hpp>
#include <psio/from_bin.hpp>
#include <psio/reflect.hpp>

using namespace psibase;

static constexpr bool enable_print = false;

namespace psibase
{
   using table_num                      = uint32_t;
   static constexpr table_num nft_table = 1;

   inline auto nft_key(uint64_t nftid) { return std::tuple{nft_sys::contract, nft_table, nftid}; }

   struct mi_table_wrapper
   {
      template <typename T>
      void emplace(account_num ram_payer, auto&& construct)
      {
         T t;
         construct(t);
         kv_put(nft_key(t.nftid), t);
      }
   };

   struct nft
   {
      uint64_t    nftid;
      account_num issuer;
      account_num owner;
      account_num approved_account;

      inline bool operator==(const nft& rhs) const
      {
         return nftid == rhs.nftid && issuer == rhs.issuer && owner == rhs.owner &&
                approved_account == rhs.approved_account;
      }

      auto key() const { return nft_key(nftid); }
   };
   EOSIO_REFLECT(nft, nftid, issuer, owner, approved_account);

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
         static bool              exists(uint64_t id) { return false; }
         static bool              valid(uint64_t id) { return true; }
         static mi_table_wrapper& get_table()
         {
            static mi_table_wrapper table;
            return table;
         }
      };
   }  // namespace

   uint64_t nft_sys::mint(psibase::account_num issuer, sub_id_type sub_id)
   {
      auto status = kv_get<status_row>(status_key());

      account_num ram_payer = issuer;
      require_auth(ram_payer);

      uint64_t new_id = generate(issuer, sub_id);

      check(!nft_id::exists(new_id), "Nft already exists");
      check(nft_id::valid(new_id), "Nft ID invalid");

      auto&& nfts{nft_id::get_table()};

      // Emplace the new nft
      nfts.emplace<nft>(ram_payer, [&](auto& row) {
         row.nftid            = new_id;
         row.issuer           = issuer;
         row.owner            = issuer;
         row.approved_account = 0;
      });

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
