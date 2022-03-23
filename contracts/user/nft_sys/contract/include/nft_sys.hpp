#pragma once

#include <psibase/actor.hpp>
#include <psibase/native_tables.hpp>

namespace psibase
{
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