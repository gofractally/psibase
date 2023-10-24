#pragma once

#include <psibase/AccountNumber.hpp>
#include <psibase/Prover.hpp>

namespace psibase
{
   struct PrivateKey;
   struct OpenSSLProver : Prover
   {
     public:
      // Creates a new key
      // TODO: parameterize this. Right now it creates a P-256 key
      OpenSSLProver(AccountNumber service);
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
