#pragma once

#include <psibase/AccountNumber.hpp>
#include <psibase/Prover.hpp>

namespace psibase
{
   struct PrivateKey;
   struct Claim;
   struct EcdsaSecp256K1Sha256Prover : Prover
   {
     public:
      EcdsaSecp256K1Sha256Prover(AccountNumber contract, const PrivateKey& key);
      std::vector<char> prove(std::span<const char> data, const Claim& claim) const;

     private:
      AccountNumber     contract;
      std::vector<char> pubKey;
      unsigned char     privateKey[32];
   };
}  // namespace psibase
