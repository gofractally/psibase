#pragma once

#include <psibase/AccountNumber.hpp>
#include <psibase/Prover.hpp>
#include <psibase/pkcs11.hpp>

namespace psibase
{

   class PKCS11Prover : public Prover
   {
     public:
      PKCS11Prover(std::shared_ptr<pkcs11::session> session,
                   AccountNumber                    service,
                   pkcs11::object_handle            key);
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
   void loadPKCS11Keys(std::shared_ptr<pkcs11::session> session,
                       AccountNumber                    service,
                       CompoundProver&                  out);

}  // namespace psibase
