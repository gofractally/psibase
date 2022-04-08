#pragma once

#include <compare>
#include <psibase/actor.hpp>
#include <psibase/table.hpp>
#include <string_view>

namespace nft_sys
{
   using nid = uint64_t; //TODO: change to 32 bit
   struct nft
   {
      nid                    nftid;
      psibase::AccountNumber issuer;
      psibase::AccountNumber owner;
      psibase::AccountNumber approved_account;

      static bool is_valid_key(const nid& id) { return id != 0; }

      friend std::strong_ordering operator<=>(const nft&, const nft&) = default;
   };
   EOSIO_REFLECT(nft, nftid, issuer, owner, approved_account);
   PSIO_REFLECT(nft, nftid, issuer, owner, approved_account);

   using nft_table_t = psibase::table<nft, &nft::nftid>;

   using tables = psibase::contract_tables<nft_table_t>;
   class nft_contract : public psibase::contract
   {
     public:
      static constexpr psibase::AccountNumber contract = "nft-sys"_a;

      using sub_id_type = uint32_t;

      // Mutate
      uint64_t mint(psibase::AccountNumber issuer, sub_id_type sub_id);

      void transfer(psibase::AccountNumber        from,
                    psibase::AccountNumber        to,
                    uint64_t                      nid,
                    psio::const_view<std::string> memo);

      // Read-only interface
      std::optional<nft> get_nft(nid nft_id);

     private:
      tables db{contract};
   };

   PSIO_REFLECT(nft_contract,
                method(mint, issuer, sub_id),
                method(transfer, actor, to, nid, memo),
                method(get_nft, nft_id));

}  // namespace nft_sys
