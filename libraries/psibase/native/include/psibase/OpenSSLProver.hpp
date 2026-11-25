#pragma once

#include <psibase/AccountNumber.hpp>
#include <psibase/Prover.hpp>

namespace psibase
{
   struct PrivateKey;
   struct OpenSSLProver : Prover
   {
     public:
      // Creates a new key of the type that service verifies
      // (psibase/verifier.hpp). Throws if service is not a known verifier.
      OpenSSLProver(AccountNumber service);
      // Loads a private key. Throws unless service is the verifier for it.
      OpenSSLProver(AccountNumber service, std::span<const char> key);
      ~OpenSSLProver();
      std::vector<char> prove(std::span<const char> data, const Claim& claim) const;
      bool              remove(const Claim&);
      void              get(std::vector<Claim>&) const;
      void              get(std::vector<ClaimKey>&) const;
      Claim             get() const;

     private:
      AccountNumber     service;
      std::vector<char> pubKey;
      void*             privateKey;
   };
}  // namespace psibase
