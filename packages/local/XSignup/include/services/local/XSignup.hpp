#pragma once

#include <cstdint>
#include <optional>
#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
#include <psibase/time.hpp>
#include <services/system/Spki.hpp>
#include <string>
#include <vector>

namespace LocalService
{
   /// One sign-in provider (an OAuth 2.0 authorization-code flow with PKCE).
   ///
   /// `x` and `github` are built in: an operator supplies only `name`,
   /// `client_id` and `client_secret`, and the remaining fields take the
   /// built-in values. Any other provider must give every field.
   ///
   /// `id_field` and `handle_field` are dot-separated paths into the JSON
   /// the provider's `user_url` returns, e.g. `data.id`.
   struct SignupProvider
   {
      std::string                name;
      std::optional<std::string> label;
      std::optional<std::string> client_id;
      std::optional<std::string> client_secret;
      std::optional<std::string> authorize_url;
      std::optional<std::string> token_url;
      std::optional<std::string> user_url;
      std::optional<std::string> scope;
      std::optional<std::string> id_field;
      std::optional<std::string> handle_field;
      /// `basic`: client credentials in an Authorization header.
      /// `post`: client credentials in the form body.
      std::optional<std::string> token_auth;
      PSIO_REFLECT(SignupProvider,
                   attr(name, utf8),
                   attr(label, utf8),
                   attr(client_id, utf8),
                   attr(client_secret, utf8),
                   attr(authorize_url, utf8),
                   attr(token_url, utf8),
                   attr(user_url, utf8),
                   attr(scope, utf8),
                   attr(id_field, utf8),
                   attr(handle_field, utf8),
                   attr(token_auth, utf8))
   };

   /// Node policy for turning guests into named accounts.
   struct SignupConfig
   {
      /// Whether this node creates accounts at all.
      bool open = false;
      /// The chain account that pays for and signs account creation. Its
      /// key is held by x-keys on this node; see GET /sponsor.
      psibase::AccountNumber sponsor{"signup"};
      /// Development only: a provider that links a guest without checking
      /// anything. Never enable on a public node.
      bool                        dev_provider = false;
      std::vector<SignupProvider> providers;
      PSIO_REFLECT(SignupConfig, open, sponsor, dev_provider, providers)
   };
   using SignupConfigTable = psibase::Table<SignupConfig, psibase::SingletonKey{}>;
   PSIO_REFLECT_TYPENAME(SignupConfigTable)

   struct SponsorKeyRow
   {
      SystemService::AuthSig::SubjectPublicKeyInfo key;
      PSIO_REFLECT(SponsorKeyRow, key)
   };
   using SponsorKeyTable = psibase::Table<SponsorKeyRow, psibase::SingletonKey{}>;
   PSIO_REFLECT_TYPENAME(SponsorKeyTable)

   /// A provider sign-in in progress. `state` is the OAuth state value;
   /// `browser` is the SHA-256 (hex) of a secret held only in a cookie of
   /// the browser that started it, so nobody else can finish it.
   struct SignupAuthRequest
   {
      std::string            state;
      std::string            guest;
      std::string            provider;
      std::string            code_verifier;
      std::string            redirect_uri;
      std::string            browser;
      /// Where the sign-in page resumes: its own query string.
      std::string            resume;
      /// The provider's authorization code, once the browser has returned.
      std::optional<std::string> code;
      psibase::TimePointUSec expires;
      using ByExpires = psibase::CompositeKey<&SignupAuthRequest::expires,
                                              &SignupAuthRequest::state>;
      PSIO_REFLECT(SignupAuthRequest,
                   attr(state, utf8),
                   attr(guest, utf8),
                   attr(provider, utf8),
                   attr(code_verifier, utf8),
                   attr(redirect_uri, utf8),
                   attr(browser, utf8),
                   attr(resume, utf8),
                   attr(code, utf8),
                   expires)
   };
   using SignupAuthRequestTable = psibase::Table<SignupAuthRequest,
                                                 &SignupAuthRequest::state,
                                                 SignupAuthRequest::ByExpires{}>;
   PSIO_REFLECT_TYPENAME(SignupAuthRequestTable)

   /// A provider identity linked to a guest. The provider's tokens are not
   /// kept: only its stable user id and public handle.
   ///
   /// `account` is the account created for this identity, once it exists on
   /// chain. `pending` is a name for which a creation transaction was
   /// issued and not yet seen.
   struct SignupLink
   {
      std::string                           provider;
      std::string                           subject;
      std::string                           handle;
      std::string                           guest;
      std::optional<psibase::AccountNumber> account;
      std::optional<psibase::AccountNumber> pending;
      /// The key the pending account is being created with.
      std::vector<unsigned char>            pending_key;
      psibase::TimePointUSec                pending_until;
      psibase::TimePointUSec                created;
      using Key     = psibase::CompositeKey<&SignupLink::provider, &SignupLink::subject>;
      using ByGuest = psibase::CompositeKey<&SignupLink::guest,
                                            &SignupLink::provider,
                                            &SignupLink::subject>;
      PSIO_REFLECT(SignupLink,
                   attr(provider, utf8),
                   attr(subject, utf8),
                   attr(handle, utf8),
                   attr(guest, utf8),
                   account,
                   pending,
                   pending_key,
                   pending_until,
                   created)
   };
   using SignupLinkTable =
       psibase::Table<SignupLink, SignupLink::Key{}, SignupLink::ByGuest{}>;
   PSIO_REFLECT_TYPENAME(SignupLinkTable)

   /// An outbound request to a provider, and the browser waiting on it.
   struct SignupPendingRequest
   {
      std::int32_t socket;
      std::int32_t client;
      std::string  guest;
      std::string  provider;
      std::string  origin;
      PSIO_REFLECT(SignupPendingRequest,
                   socket,
                   client,
                   attr(guest, utf8),
                   attr(provider, utf8),
                   attr(origin, utf8))
   };
   using SignupPendingRequestTable =
       psibase::Table<SignupPendingRequest, &SignupPendingRequest::socket>;
   PSIO_REFLECT_TYPENAME(SignupPendingRequestTable)

   /// Turns a guest into a named account.
   ///
   /// A guest (see RTransact::getSession) proves who they are to a sign-in
   /// provider, which makes them eligible for one account. The guest then
   /// picks a name, and this service issues a transaction, signed by the
   /// node's sponsor account, that creates the account with the guest's
   /// own key. The guest's browser submits it. The node never holds the
   /// guest's private key, and no provider token or secret goes on chain.
   ///
   /// HTTP interface (host `x-signup.`):
   /// - `GET /status`: what is offered, and the caller's own state.
   /// - `POST /oauth/start {provider, browser, resume}`: begins a provider
   ///   sign-in for the calling guest; returns `{url}` to send the browser
   ///   to. `browser` is the SHA-256 (hex) of a secret the page keeps.
   /// - `GET /oauth/callback`: where the provider returns the browser. It
   ///   records the result and sends the browser back to the sign-in page.
   /// - `POST /oauth/finish {state, secret}`: the same guest, showing the
   ///   secret, completes the sign-in. Only the browser that started a
   ///   sign-in can finish it.
   /// - `POST /create {name, key}`: returns the signed creation transaction.
   /// - `GET|PUT /config`, `GET /sponsor`: node administrators only.
   struct XSignup : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"x-signup"};
      using Subjective              = psibase::SubjectiveTables<SignupConfigTable,
                                                                SponsorKeyTable,
                                                                SignupAuthRequestTable,
                                                                SignupLinkTable>;
      using Session                 = psibase::SessionTables<SignupPendingRequestTable>;

      auto serveSys(psibase::HttpRequest        request,
                    std::optional<std::int32_t> socket) -> std::optional<psibase::HttpReply>;
      void onToken(std::int32_t socket, psibase::HttpReply reply);
      void onUser(std::int32_t socket, psibase::HttpReply reply);
      void onError(std::int32_t socket, std::optional<psibase::HttpReply> reply);
   };
   PSIO_REFLECT(XSignup,
                method(serveSys, request, socket),
                method(onToken, socket, reply),
                method(onUser, socket, reply),
                method(onError, socket, reply, maxDynamicData(0xffffffff)))
   PSIBASE_REFLECT_TABLES(XSignup, XSignup::Subjective, XSignup::Session)
}  // namespace LocalService
