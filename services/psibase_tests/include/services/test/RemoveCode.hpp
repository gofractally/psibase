#pragma once

#include <cstdint>
#include <psibase/AccountNumber.hpp>
#include <psibase/Service.hpp>
#include <psibase/crypto.hpp>
#include <psibase/nativeTables.hpp>

namespace TestService
{
   struct RemoveCode : psibase::Service
   {
      static constexpr auto service      = psibase::AccountNumber{"rm-code"};
      static constexpr auto serviceFlags = psibase::CodeRow::allowWriteNative;
      void removeCode(psibase::Checksum256 codeHash, std::uint8_t vmType, std::uint8_t vmVersion);
      void setCodeRow(psibase::CodeRow row);
   };

   PSIO_REFLECT(RemoveCode,
                method(removeCode, codeHash, vmType, vmVersion),
                method(setCodeRow, row))
}  // namespace TestService
