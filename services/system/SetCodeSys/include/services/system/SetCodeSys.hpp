#pragma once

#include <psibase/Service.hpp>
#include <psibase/nativeTables.hpp>

namespace system_contract
{
   struct SetCodeSys : psibase::Service<SetCodeSys>
   {
      static constexpr auto     service       = psibase::AccountNumber("setcode-sys");
      static constexpr uint64_t contractFlags = psibase::CodeRow::allowWriteNative;

      void setCode(psibase::AccountNumber contract,
                   uint8_t                vmType,
                   uint8_t                vmVersion,
                   std::vector<char>      code);

      void setFlags(psibase::AccountNumber contract, uint64_t flags);
   };
   PSIO_REFLECT(SetCodeSys,
                method(setCode, contact, vmType, vmVersion, code),
                method(setFlags, contract, flags))
}  // namespace system_contract
