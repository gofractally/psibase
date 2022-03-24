#pragma once

#include <compare>
#include <psibase/actor.hpp>
#include <psibase/table.hpp>

namespace psibase
{
   using nid = uint64_t;
   struct nft
   {
      nid         nftid;
      account_num issuer;
      account_num owner;
      account_num approved_account;

      friend std::strong_ordering operator<=>(const nft&, const nft&) = default;
   };
   EOSIO_REFLECT(nft, nftid, issuer, owner, approved_account);
   using nft_table_t = table<nft, &nft::nftid>;

   using tables = contract_tables<nft_table_t>;
   class nft_sys : public psibase::contract
   {
     public:
      static constexpr psibase::account_num contract = 100;
      using sub_id_type                              = uint32_t;

      uint64_t mint(psibase::account_num issuer, sub_id_type sub_id);
      void     transfer(psibase::account_num actor,
                        psibase::account_num to,
                        uint64_t             nid,
                        std::string          memo);
   };

   PSIO_REFLECT_INTERFACE(nft_sys, (mint, 0, issuer, sub_id), (transfer, 1, actor, to, nid, memo));

}  // namespace psibase