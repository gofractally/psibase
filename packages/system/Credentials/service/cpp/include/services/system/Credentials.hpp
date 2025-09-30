#pragma once

#include <psibase/psibase.hpp>
#include <services/system/AuthSig.hpp>
#include "psibase/time.hpp"

namespace SystemService
{
   struct Credentials : public psibase::Service
   {
      static constexpr auto service           = psibase::AccountNumber("credentials");
      static constexpr auto CREDENTIAL_SENDER = psibase::AccountNumber("cred-sys");

      /// Creates a credential
      ///
      /// Parameters:
      /// - `pubkey`: The credential public key
      /// - `expires`: The number of seconds until the credential expires
      ///
      /// This action is meant to be called inline by another service.
      /// The caller service is the credential issuer.
      ///
      /// A transaction sent from the CREDENTIAL_SENDER account must include a proof for a claim
      /// that matches the specified public key.
      uint32_t create(SystemService::AuthSig::SubjectPublicKeyInfo pubkey,
                      std::optional<uint32_t>                      expires);

      /// Looks up the credential used to sign the active transaction, and consumes it.
      /// Can only be called by the credential's issuer.
      uint32_t consume_active();

      /// Gets the `id` of the active credential
      std::optional<uint32_t> get_active();

      /// Gets the `expiry_date` of the specified credential
      std::optional<psibase::TimePointSec> get_expiry_date(uint32_t id);

      /// Gets the `pubkey` of the specified credential
      SystemService::AuthSig::SubjectPublicKeyInfo get_pubkey(uint32_t id);

      /// Deletes the specified credential.
      /// Can only be called by the credential's issuer.
      void consume(uint32_t id);
   };

   // clang-format off
   PSIO_REFLECT(Credentials,
      method(create, pubkey, expires),
      method(consume_active),
      method(get_active),
      method(get_pubkey, id),
      method(get_expiry_date, id),
      method(consume, id),
   );
   // clang-format on

}  // namespace SystemService
