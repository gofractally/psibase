#pragma once

#include <psibase/Contract.hpp>
#include <psibase/nativeFunctions.hpp>
#include <psibase/nativeTables.hpp>
#include <psio/from_bin.hpp>
#include <psio/to_bin.hpp>

namespace system_contract
{
   class transaction_sys : public psibase::Contract<transaction_sys>
   {
     public:
      static constexpr auto     contract = psibase::AccountNumber("transact-sys");
      static constexpr uint64_t contractFlags =
          psibase::AccountRow::allowSudo | psibase::AccountRow::allowWriteNative;

      psibase::BlockNum     headBlockNum() const;
      psibase::TimePointSec blockTime() const;

      // TODO: move to another contract
      uint8_t setCode(psibase::AccountNumber contract,
                      uint8_t                vmType,
                      uint8_t                vmVersion,
                      std::vector<char>      code);
   };

   PSIO_REFLECT(transaction_sys, method(setCode, contact, vmType, vmVersion, code))
}  // namespace system_contract
