#pragma once

#include <psibase/psibase.hpp>
#include <services/system/AuthSig.hpp>

namespace SystemService
{
   struct CredentialsService : public psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber("credentials");

      /// Creates a credential with the given public key
      ///
      /// This action is meant to be called inline by another service.
      /// The owner service is the service that calls this action.
      ///
      /// The corresponding private key can be used to authorize the "cred-sys" account to call
      ///   transactions containing actions on the owner service.
      uint32_t create(SystemService::AuthSig::SubjectPublicKeyInfo pubkey);

      /// Looks up the credential used to sign the active transaction, and consumes (deletes) it.
      /// Can only be called by the credential's owner service.
      uint32_t consume_active();
   };

   // clang-format off
   PSIO_REFLECT(CredentialsService,
      method(create, pubkey),
      method(consume_active),
   );
   // clang-format on

}  // namespace SystemService
