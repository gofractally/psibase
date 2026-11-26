#pragma once

#include <psibase/Service.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/verifier.hpp>

namespace SystemService
{
   /// Verifies ECDSA signatures made with secp256r1 (P-256) keys, with
   /// BearSSL: the second verifier for the curve, which an account may
   /// choose in auth-sig in place of the default, verify-r1.
   ///
   /// Which verifiers a key may use is defined in psibase/verifier.hpp.
   struct VerifyBear1 : psibase::Service
   {
      static constexpr auto     service      = psibase::verifier::bear1;
      static constexpr uint64_t serviceFlags = psibase::CodeRow::isVerify;

      void verifySys(psibase::Checksum256 transactionHash,
                     psibase::Claim       claim,
                     std::vector<char>    proof);
   };
   PSIO_REFLECT(VerifyBear1, method(verifySys, transactionHash, claim, proof))
   PSIBASE_REFLECT_TABLES(VerifyBear1)
}  // namespace SystemService
