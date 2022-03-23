#include "nft_sys.hpp"

#include <contracts/system/transaction_sys.hpp>
#include <psibase/native_tables.hpp>

using namespace psibase;

static constexpr bool enable_print = false;

namespace nft_sys
{
   using table_num                      = uint32_t;
   static constexpr table_num nft_table = 1;

   inline auto nft_key(uint64_t nftid) { return std::tuple{contract, nft_table, nftid}; }

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

   uint64_t exec(account_num this_contract, account_num sender, mint& args)
   {
      auto status = kv_get<status_row>(status_key());

      account_num ram_payer = args.issuer;
      require_auth(ram_payer);

      uint64_t new_id = generate(args.issuer, args.sub_id);

      check(!nft_id::exists(new_id), "Nft already exists");
      check(nft_id::valid(new_id), "Nft ID invalid");

      auto&& nfts{nft_id::get_table()};

      // Emplace the new nft
      nfts.emplace<nft>(ram_payer, [&](auto& row) {
         row.nftid            = new_id;
         row.issuer           = args.issuer;
         row.owner            = args.issuer;
         row.approved_account = 0;
      });

      return new_id;
   }

   extern "C" void called(account_num this_contract, account_num sender)
   {
      auto act  = get_current_action();
      auto data = eosio::convert_from_bin<action>(act.raw_data);
      std::visit(
          [&](auto& x) {
             if constexpr (std::is_same_v<decltype(exec(this_contract, sender, x)), void>)
                exec(this_contract, sender, x);
             else
                set_retval(exec(this_contract, sender, x));
          },
          data);
   }

   extern "C" void __wasm_call_ctors();
   extern "C" void start(account_num this_contract) { __wasm_call_ctors(); }
}  // namespace nft_sys
