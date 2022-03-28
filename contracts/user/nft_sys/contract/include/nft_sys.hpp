#pragma once

#include <compare>
#include <psibase/actor.hpp>
#include <psibase/table.hpp>
#include <string_view>

namespace psibase
{
   using nid = uint64_t;
   struct nft
   {
      nid         nftid;
      account_num issuer;
      account_num owner;
      account_num approved_account;

      static bool is_valid_key(const nid& id) { return id != 0; }

      friend std::strong_ordering operator<=>(const nft&, const nft&) = default;
   };
   EOSIO_REFLECT(nft, nftid, issuer, owner, approved_account);
   PSIO_REFLECT(nft, nftid, issuer, owner, approved_account);

   using nft_table_t = table<nft, &nft::nftid>;

   using tables = contract_tables<nft_table_t>;
   class nft_sys : public psibase::contract
   {
     public:
      static constexpr psibase::account_num contract     = 100;
      static constexpr std::string_view     account_name = "nft.sys";

      using sub_id_type = uint32_t;

      // Mutate
      uint64_t mint(psibase::account_num issuer, sub_id_type sub_id);
      void     transfer(psibase::account_num          from,
                        psibase::account_num          to,
                        uint64_t                      nid,
                        psio::const_view<std::string> memo);

      // Read-only interface
      std::optional<nft> get_nft(nid nft_id);

     private:
      tables db{contract};
   };

   // clang-format off
   PSIO_REFLECT_INTERFACE(nft_sys, 
      (mint, 0, issuer, sub_id), 
      (transfer, 1, actor, to, nid, memo),
      (get_nft, 2, nft_id)
   );
   // clang-format on

}  // namespace psibase