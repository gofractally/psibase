#pragma once

#include <optional>
#include <psibase/MethodNumber.hpp>
#include <psibase/block.hpp>
#include <psibase/psibase.hpp>
#include <psibase/time.hpp>
#include <services/system/AuthSig.hpp>
#include <services/system/Transact.hpp>
#include <services/user/Tokens.hpp>
#include "psibase/crypto.hpp"

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

      bool isAuthSys(psibase::AccountNumber                             sender,
                     std::vector<psibase::AccountNumber>                authorizers,
                     std::optional<ServiceMethod>                       method,
                     std::optional<std::vector<psibase::AccountNumber>> auth_set);

      bool isRejectSys(psibase::AccountNumber                             sender,
                       std::vector<psibase::AccountNumber>                authorizers,
                       std::optional<ServiceMethod>                       method,
                       std::optional<std::vector<psibase::AccountNumber>> auth_set);

      /// Issues a credential
      ///
      /// Parameters:
      /// - `pubkey_fingerprint`: The fingerprint of the credential public key
      /// - `expires`: The number of seconds until the credential expires
      /// - `allowed_actions`: The actions that the credential is allowed to call on the issuer service
      ///
      /// This action is meant to be called inline by another service.
      /// The caller service is the credential issuer.
      ///
      /// A transaction sent from the CREDENTIAL_SENDER account must include a proof for a claim
      /// that matches the specified public key.
      uint32_t issue(psibase::Checksum256                      pubkey_fingerprint,
                     std::optional<uint32_t>                   expires,
                     const std::vector<psibase::MethodNumber>& allowed_actions);

      /// Notifies the credentials service that tokens have been credited to a credential
      ///
      /// This notification must be called after crediting the credential's service, or else
      /// the credited tokens will not be aplied to a particular credential.
      void resource(uint32_t id, UserService::Quantity amount);

      /// Gets the fingerprint of the specified credential pubkey
      psibase::Checksum256 getFingerprint(uint32_t id);

      /// Gets the `expiry_date` of the specified credential
      std::optional<psibase::TimePointSec> get_expiry_date(uint32_t id);

      /// Gets the `id` of the active credential
      std::optional<uint32_t> get_active();

      /// Deletes the specified credential.
      /// Can only be called by the credential's issuer.
      void consume(uint32_t id);
   };

   // clang-format off
   PSIO_REFLECT(Credentials,
      method(init),
      method(canAuthUserSys, user),
      method(checkAuthSys, flags, requester, sender, action, allowedActions, claims),
      method(isAuthSys, sender, authorizers, method, auth_set),
      method(isRejectSys, sender, authorizers, method, auth_set),
      method(issue, pubkey_fingerprint, expires, allowed_actions),
      method(resource, id, amount),
      method(get_active),
      method(getFingerprint, id),
      method(get_expiry_date, id),
      method(consume, id),
   );
   // clang-format on

}  // namespace SystemService
