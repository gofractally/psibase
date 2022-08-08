#pragma once

#include <psibase/Contract.hpp>
#include <psibase/nativeTables.hpp>

namespace system_contract
{
   struct SetCodeSys : psibase::Contract<SetCodeSys>
   {
      static constexpr auto     contract      = psibase::AccountNumber("setcode-sys");
      static constexpr uint64_t contractFlags = psibase::AccountRow::allowWriteNative;

      uint8_t setCode(psibase::AccountNumber contract,
                      uint8_t                vmType,
                      uint8_t                vmVersion,
                      std::vector<char>      code);
   };
   PSIO_REFLECT(SetCodeSys, method(setCode, contact, vmType, vmVersion, code))
}  // namespace system_contract
