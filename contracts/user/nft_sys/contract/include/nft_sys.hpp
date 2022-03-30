#pragma once

#include <compare>
#include <psibase/actor.hpp>
#include <psibase/table.hpp>
#include <string_view>

namespace nft_sys
{
   using nid = uint64_t;
   struct nft_row
   {
      nid                  nftid;
      psibase::account_num issuer;
      psibase::account_num owner;
      psibase::account_num approved_account;

      static bool is_valid_key(const nid& id) { return id != 0; }

      friend std::strong_ordering operator<=>(const nft_row&, const nft_row&) = default;
   };
   EOSIO_REFLECT(nft_row, nftid, issuer, owner, approved_account);
   PSIO_REFLECT(nft_row, nftid, issuer, owner, approved_account);

   using nft_table_t = psibase::table<nft_row, &nft_row::nftid>;

   using tables = psibase::contract_tables<nft_table_t>;
   class nft_contract : public psibase::contract
   {
     public:
      static constexpr psibase::account_num contract     = 100;
      static constexpr std::string_view     account_name = "nft_sys";

      using sub_id_type = uint32_t;

      // Mutate
      nid mint(psibase::account_num issuer, sub_id_type sub_id);

      // Read-only interface
      std::optional<nft_row> get_nft(nid nft_id);

     private:
      tables db{contract};
   };

   // clang-format off
   PSIO_REFLECT_INTERFACE(nft_contract, 
      (mint, 0, issuer, sub_id), 
      (get_nft, 1, nft_id)
   );
   // clang-format on

}  // namespace nft_sys