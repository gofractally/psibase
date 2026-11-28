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
      /// What the sign-in is for: nothing for signing up, or the account
      /// whose owner wants this node's sponsor to act as its recovery
      /// partner.
      std::optional<psibase::AccountNumber> recover;
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
                   expires,
                   recover)
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
      /// The owner key the pending account is being created with. The
      /// account is this link's once it exists with that owner key.
      std::vector<unsigned char>            pending_key;
      psibase::TimePointUSec                pending_until;
      psibase::TimePointUSec                created;
      using Key     = psibase::CompositeKey<&SignupLink::provider, &SignupLink::subject>;
      using ByGuest = psibase::CompositeKey<&SignupLink::guest,
                                            &SignupLink::provider,
                                            &SignupLink::subject>;
      /// The account, or the name it is being created with, or the null
      /// account while there is neither
      psibase::AccountNumber accountOrNone() const
      {
         return account.value_or(pending.value_or(psibase::AccountNumber{}));
      }
      using ByAccount = psibase::CompositeKey<&SignupLink::accountOrNone,
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
   using SignupLinkTable = psibase::Table<SignupLink,
                                          SignupLink::Key{},
                                          SignupLink::ByGuest{},
                                          SignupLink::ByAccount{}>;
   PSIO_REFLECT_TYPENAME(SignupLinkTable)

   /// A passkey holder's encrypted list of accounts. The node cannot read
   /// it: `locator` and the encryption key both come from the passkey.
   /// `guest` is the passkey identity (the guest id of RTransact's
   /// SessionInfo) whose session first wrote it, and `key` is that
   /// identity's guest key; only they may replace it, and only with a
   /// higher `version`.
   struct SignupAccountList
   {
      /// 32 bytes, lowercase hex
      std::string                locator;
      std::vector<char>          blob;
      std::vector<unsigned char> key;
      std::uint64_t              version = 0;
      std::string                guest;
      /// The lists of one identity, to bound how many it keeps
      using ByGuest = psibase::CompositeKey<&SignupAccountList::guest,
                                            &SignupAccountList::locator>;
      PSIO_REFLECT(SignupAccountList,
                   attr(locator, utf8),
                   blob,
                   key,
                   version,
                   attr(guest, utf8))
   };
   using SignupAccountListTable = psibase::Table<SignupAccountList,
                                                 &SignupAccountList::locator,
                                                 SignupAccountList::ByGuest{}>;
   PSIO_REFLECT_TYPENAME(SignupAccountListTable)

   /// How many account-list writes a passkey identity has attempted in the
   /// current window. A row is dropped once its window has ended.
   struct SignupListWrites
   {
      std::string            guest;
      psibase::TimePointUSec window_start;
      std::uint32_t          writes = 0;
      using ByStart = psibase::CompositeKey<&SignupListWrites::window_start,
                                            &SignupListWrites::guest>;
      PSIO_REFLECT(SignupListWrites, attr(guest, utf8), window_start, writes)
   };
   using SignupListWritesTable = psibase::Table<SignupListWrites,
                                                &SignupListWrites::guest,
                                                SignupListWrites::ByStart{}>;
   PSIO_REFLECT_TYPENAME(SignupListWritesTable)

   /// A guest who has just proved, by signing in with the provider identity
   /// an account was created with, that they are its owner. It lets the
   /// guest have this node's sponsor act once as the account's recovery
   /// partner.
   struct SignupRecoveryGrant
   {
      std::string            guest;
      psibase::AccountNumber account;
      psibase::TimePointUSec expires;
      PSIO_REFLECT(SignupRecoveryGrant, attr(guest, utf8), account, expires)
   };
   using SignupRecoveryGrantTable =
       psibase::Table<SignupRecoveryGrant, &SignupRecoveryGrant::guest>;
   PSIO_REFLECT_TYPENAME(SignupRecoveryGrantTable)

   /// An outbound request to a provider, and the browser waiting on it.
   struct SignupPendingRequest
   {
      std::int32_t socket;
      std::int32_t client;
      std::string  guest;
      std::string  provider;
      std::string  origin;
      /// See SignupAuthRequest::recover
      std::optional<psibase::AccountNumber> recover;
      PSIO_REFLECT(SignupPendingRequest,
                   socket,
                   client,
                   attr(guest, utf8),
                   attr(provider, utf8),
                   attr(origin, utf8),
                   recover)
   };
   using SignupPendingRequestTable =
       psibase::Table<SignupPendingRequest, &SignupPendingRequest::socket>;
   PSIO_REFLECT_TYPENAME(SignupPendingRequestTable)

   /// Turns a guest into a named account, keeps the encrypted account lists
   /// of passkey holders, and lets the node's sponsor act as the recovery
   /// partner of the accounts it created.
   ///
   /// A guest (see RTransact::getSession) proves who they are to a sign-in
   /// provider, which makes them eligible for one account. The guest then
   /// picks a name and supplies the account's owner and active public keys,
   /// and this service issues a transaction, signed by the node's sponsor
   /// account, that creates the account with them. The guest's browser
   /// submits it. The node never holds a private key of the account, and no
   /// provider token or secret goes on chain. The sponsor, as the creator,
   /// is the account's recovery partner; a user who signs in again with the
   /// same provider identity may have it confirm or reject a pending
   /// change, end a pause, or release a freeze.
   ///
   /// HTTP interface (host `x-signup.`). Replies are JSON; an error is
   /// `{"error": text}`. Bytes are hex. Everything but the administrator
   /// endpoints is readable by the supervisor's pages only (CORS).
   ///
   /// - `GET /status`: what is offered, and the caller's own state:
   ///   `{open, providers: [{name, label}], guest, link: {provider, handle,
   ///   account, pending} | null, accounts: [name], recovery: {account,
   ///   valid_seconds} | null}`.
   /// - `GET /check_name?name=`: `{ok, problem}`.
   /// - `POST /oauth/start {provider, browser, resume, purpose?, account?}`:
   ///   begins a provider sign-in for the calling guest; returns `{url,
   ///   link, recovery}` (`url` is where to send the browser, empty when
   ///   nothing more is needed). `browser` is the SHA-256 (hex) of a secret
   ///   the page keeps. `purpose` is `"signup"` (the default) or
   ///   `"recover"`, which needs `account`.
   /// - `GET /oauth/callback`: where the provider returns the browser. It
   ///   records the result and sends the browser back to the sign-in page.
   /// - `POST /oauth/finish {state, secret}`: the same guest, showing the
   ///   secret, completes the sign-in. Only the browser that started a
   ///   sign-in can finish it. Replies with the link `{provider, handle,
   ///   account, pending}`, or for a recovery `{recovery: {account,
   ///   valid_seconds}}`.
   /// - `POST /create {name, owner: {key, seq}, active: {key, seq}}`:
   ///   `{transaction, valid_seconds}`, the signed creation transaction.
   /// - `GET /list/<locator>`: `{blob, version}`, or 404. No session.
   /// - `PUT /list/<locator> {blob, key, version, sig}`: stores an account
   ///   list. Needs the guest session of `key`. The first identity to write
   ///   a locator owns it; an identity keeps a few lists at most and its
   ///   writes are rate limited (503 with Retry-After). See `listMessage`
   ///   in XSignup.cpp for what is signed.
   /// - `POST /partner/confirm|reject|end-pause {account}` and
   ///   `POST /partner/unfreeze {account, owner: {key, seq}, active: {key,
   ///   seq}}`: with a recovery grant for `account`, `{transaction,
   ///   valid_seconds}`: a transaction signed by the sponsor that calls
   ///   auth-sig's confirm, reject, endPause or unfreezeWith. The grant is
   ///   used up.
   /// - `GET|PUT /config`, `GET /sponsor`: node administrators only.
   struct XSignup : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"x-signup"};
      using Subjective              = psibase::SubjectiveTables<SignupConfigTable,
                                                                SponsorKeyTable,
                                                                SignupAuthRequestTable,
                                                                SignupLinkTable,
                                                                SignupAccountListTable,
                                                                SignupRecoveryGrantTable,
                                                                SignupListWritesTable>;
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
