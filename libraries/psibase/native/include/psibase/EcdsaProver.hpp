#pragma once

#include <psibase/AccountNumber.hpp>
#include <psibase/Prover.hpp>

namespace psibase
{
   struct PrivateKey;
   struct EcdsaSecp256K1Sha256Prover : Prover
   {
     public:
      // Creates a new key
      EcdsaSecp256K1Sha256Prover(AccountNumber service);
      EcdsaSecp256K1Sha256Prover(AccountNumber service, const PrivateKey& key);
      std::vector<char> prove(std::span<const char> data, const Claim& claim) const;
      bool              remove(const Claim&);
      void              get(std::vector<Claim>&) const;
      void              get(std::vector<ClaimKey>&) const;
      Claim             get() const;

     private:
      AccountNumber     service;
      std::vector<char> pubKey;
      unsigned char     privateKey[32];
   };
}  // namespace psibase
