#pragma once

#include <psibase/block.hpp>
#include <psibase/psibase.hpp>
#include <psibase/time.hpp>
#include <services/system/AuthSig.hpp>
#include <services/system/Transact.hpp>
#include "psibase/MethodNumber.hpp"

namespace SystemService
{
   struct Credentials : public psibase::Service
   {
      static constexpr auto service           = psibase::AccountNumber("credentials");
      static constexpr auto CREDENTIAL_SENDER = psibase::AccountNumber("cred-sys");

      void init();

      void canAuthUserSys(psibase::AccountNumber user);

      void checkAuthSys(uint32_t                    flags,
                        psibase::AccountNumber      requester,
                        psibase::AccountNumber      sender,
                        ServiceMethod               action,
                        std::vector<ServiceMethod>  allowedActions,
                        std::vector<psibase::Claim> claims);

      /// Creates a credential
      ///
      /// Parameters:
      /// - `pubkey`: The credential public key
      /// - `expires`: The number of seconds until the credential expires
      /// - `allowed_actions`: The actions that the credential is allowed to call on the issuer service
      ///
      /// This action is meant to be called inline by another service.
      /// The caller service is the credential issuer.
      ///
      /// A transaction sent from the CREDENTIAL_SENDER account must include a proof for a claim
      /// that matches the specified public key.
      uint32_t create(SystemService::AuthSig::SubjectPublicKeyInfo pubkey,
                      std::optional<uint32_t>                      expires,
                      const std::vector<psibase::MethodNumber>&    allowed_actions);

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
      method(init),
      method(canAuthUserSys, user),
      method(checkAuthSys, flags, requester, sender, action, allowedActions, claims),
      method(create, pubkey, expires, allowed_actions),
      method(consume_active),
      method(get_active),
      method(get_pubkey, id),
      method(get_expiry_date, id),
      method(consume, id),
   );
   // clang-format on

}  // namespace SystemService
