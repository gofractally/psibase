#pragma once

#include <psibase/Service.hpp>
#include <psibase/nativeTables.hpp>

namespace SystemService
{
   struct SetCodeSys : psibase::Service<SetCodeSys>
   {
      static constexpr auto     service      = psibase::AccountNumber("setcode-sys");
      static constexpr uint64_t serviceFlags = psibase::CodeRow::allowWriteNative;

      void setCode(psibase::AccountNumber service,
                   uint8_t                vmType,
                   uint8_t                vmVersion,
                   std::vector<char>      code);

      void setFlags(psibase::AccountNumber service, uint64_t flags);
   };
   PSIO_REFLECT(SetCodeSys,
                method(setCode, contact, vmType, vmVersion, code),
                method(setFlags, service, flags))
}  // namespace SystemService
