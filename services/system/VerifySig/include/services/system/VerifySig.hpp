#pragma once

#include <psibase/Service.hpp>
#include <psibase/nativeTables.hpp>

namespace SystemService
{
   struct VerifySig : psibase::Service
   {
      static constexpr auto     service      = psibase::AccountNumber("verify-sig");
      static constexpr uint64_t serviceFlags = psibase::CodeRow::isAuthService;

      void verifySys(psibase::Checksum256 transactionHash,
                     psibase::Claim       claim,
                     std::vector<char>    proof);
   };
   PSIO_REFLECT(VerifySig, method(verifySys, transactionHash, claim, proof))
}  // namespace SystemService
