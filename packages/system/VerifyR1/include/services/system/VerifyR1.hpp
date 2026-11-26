#pragma once

#include <psibase/Service.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/verifier.hpp>

namespace SystemService
{
   /// Verifies ECDSA signatures made with secp256r1 (P-256) keys, with
   /// Botan: the default verifier for the curve.
   ///
   /// Use `psibase::verifierFor` to find the default verifier for a key; do
   /// not name this service for a key directly.
   struct VerifyR1 : psibase::Service
   {
      static constexpr auto     service      = psibase::verifier::r1;
      static constexpr uint64_t serviceFlags = psibase::CodeRow::isVerify;

      void verifySys(psibase::Checksum256 transactionHash,
                     psibase::Claim       claim,
                     std::vector<char>    proof);
   };
   PSIO_REFLECT(VerifyR1, method(verifySys, transactionHash, claim, proof))
   PSIBASE_REFLECT_TABLES(VerifyR1)
}  // namespace SystemService
