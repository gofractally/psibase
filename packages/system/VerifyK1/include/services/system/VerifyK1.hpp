#pragma once

#include <psibase/Service.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/verifier.hpp>

namespace SystemService
{
   /// Verifies ECDSA signatures made with secp256k1 keys.
   ///
   /// Use `psibase::verifierFor` to find the verifier for a key; do not
   /// name this service for a key directly.
   struct VerifyK1 : psibase::Service
   {
      static constexpr auto     service      = psibase::verifier::k1;
      static constexpr uint64_t serviceFlags = psibase::CodeRow::isVerify;

      void verifySys(psibase::Checksum256 transactionHash,
                     psibase::Claim       claim,
                     std::vector<char>    proof);
   };
   PSIO_REFLECT(VerifyK1, method(verifySys, transactionHash, claim, proof))
   PSIBASE_REFLECT_TABLES(VerifyK1)
}  // namespace SystemService
