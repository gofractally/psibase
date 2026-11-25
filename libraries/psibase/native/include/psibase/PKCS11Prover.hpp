#pragma once

#include <psibase/AccountNumber.hpp>
#include <psibase/Prover.hpp>
#include <psibase/pkcs11.hpp>

namespace psibase
{

   class PKCS11Prover : public Prover
   {
     public:
      // In each case service must be the verifier for the key
      // (psibase/verifier.hpp); the constructors throw otherwise.
      PKCS11Prover(std::shared_ptr<pkcs11::session> session,
                   AccountNumber                    service,
                   pkcs11::object_handle            key);
      // Generates a key of the type that service verifies
      PKCS11Prover(std::shared_ptr<pkcs11::session> session, AccountNumber service);
      PKCS11Prover(std::shared_ptr<pkcs11::session> session,
                   AccountNumber                    service,
                   std::span<const char>            key);
      std::vector<char> prove(std::span<const char> data, const Claim& claim) const;
      bool              remove(const Claim&);
      void              get(std::vector<Claim>&) const;
      void              get(std::vector<ClaimKey>&) const;
      Claim             get() const;

     private:
      AccountNumber                    service;
      std::vector<char>                pubKey;
      std::shared_ptr<pkcs11::session> session;
      pkcs11::object_handle            privateKey;
      pkcs11::mechanism                mechanism;
      bool                             prehash = false;
   };
   // Each key is loaded for the service that verifies it
   void loadPKCS11Keys(std::shared_ptr<pkcs11::session> session,
                       std::string_view                 label,
                       CompoundProver&                  out);
   void loadPKCS11Keys(std::shared_ptr<pkcs11::session> session, CompoundProver& out);

}  // namespace psibase
