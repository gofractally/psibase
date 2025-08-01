#pragma once

#include <psibase/Service.hpp>
#include <psibase/nativeTables.hpp>

namespace TestService
{
   struct VerifyWithCall : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"verify-call"};
      static constexpr auto flags   = psibase::CodeRow::isAuthService;
      void                  verifySys(psibase::Checksum256 transactionHash,
                                      psibase::Claim       claim,
                                      std::vector<char>    proof);
   };
   PSIO_REFLECT(VerifyWithCall, method(verifySys, claim, proof))
}  // namespace TestService
