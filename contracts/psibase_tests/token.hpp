#pragma once
#include <psibase/actor.hpp>

#include <psibase/intrinsic.hpp>

#include <eosio/asset.hpp>
#include <eosio/from_bin.hpp>
#include <eosio/to_bin.hpp>

namespace token
{
   using namespace psibase;
   using psio::const_view;
   class token : public psibase::contract
   {
     public:
      static constexpr psibase::AccountNumber contract = AccountNumber("token");

      uint8_t  transfer(AccountNumber to, uint64_t amount, const_view<String> memo);
      uint8_t  issue(AccountNumber to, uint64_t amount, const_view<String> memo);
      uint64_t getBalance(AccountNumber owner);
   };
   PSIO_REFLECT_INTERFACE(token,
                          (transfer, 0, from, to, amount, memo),
                          (issue, 1, to, amount, memo),
                          (getBalance, 2, owner))

}  // namespace token
