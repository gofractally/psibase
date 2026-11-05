#pragma once

#include <optional>
#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/Spki.hpp>
#include <services/system/Transact.hpp>
#include <vector>

namespace SystemService
{
   /// One action the account's key is allowed to authorize.
   struct AllowedAction
   {
      psibase::AccountNumber service;
      psibase::MethodNumber  method;

      friend bool operator==(const AllowedAction&, const AllowedAction&) = default;
   };
   PSIO_REFLECT(AllowedAction, service, method)

   /// Stored authorization for an account that uses `auth-scope`.
   struct AuthScopeRow
   {
      psibase::AccountNumber        account;
      AuthSig::SubjectPublicKeyInfo pubkey;
      psibase::AccountNumber        owner;
      std::vector<AllowedAction>    allowed;

      friend bool operator==(const AuthScopeRow&, const AuthScopeRow&) = default;
   };
   PSIO_REFLECT(AuthScopeRow, account, pubkey, owner, allowed)

   using AuthScopeTable = psibase::Table<AuthScopeRow, &AuthScopeRow::account>;
   PSIO_REFLECT_TYPENAME(AuthScopeTable)

   /// Auth service for an account whose key may authorize only whitelisted actions.
   class AuthScope : public psibase::Service
   {
     public:
      static constexpr auto service = psibase::AccountNumber("auth-scope");
      static_assert(service.value != 0);
      using Tables = psibase::ServiceTables<AuthScopeTable>;

      /// Authenticate `sender` for `action`.
      ///
      /// A `verify-sig` claim must carry `pubkey`. The action must match `allowed`.
      ///
      /// Returns false if the claim is missing or the action is not whitelisted. Aborts only when
      /// `sender` has no row.
      bool checkAuthSys(uint32_t                    flags,
                        psibase::AccountNumber      sender,
                        ServiceMethod               action,
                        std::vector<psibase::Claim> claims);

      /// Aborts unless `user` has a row.
      void canAuthUserSys(psibase::AccountNumber user);

      /// Get the accounts this auth service delegates authority to for a sender.
      std::vector<psibase::AccountNumber> getDlgsSys(psibase::AccountNumber       sender,
                                                     std::optional<ServiceMethod> method);

      /// Returns whether the sender's `owner` is among `authorizers`, or the sender is among
      /// `authorizers` and `method` is whitelisted for the sender.
      ///
      /// Aborts when `sender` has no row.
      bool isAuthSys(psibase::AccountNumber              sender,
                     std::vector<psibase::AccountNumber> authorizers,
                     std::optional<ServiceMethod>        method);

      /// Returns whether the sender's `owner` is among `rejecters`, or the sender is among
      /// `rejecters` and `method` is whitelisted for the sender.
      ///
      /// Aborts when `sender` has no row.
      bool isRejectSys(psibase::AccountNumber              sender,
                       std::vector<psibase::AccountNumber> rejecters,
                       std::optional<ServiceMethod>        method);

      /// Creates `name` on this auth service and stores its row.
      ///
      /// The behavior if `name` already exists is determined by `mode`:
      /// * `requireNew`: aborts.
      /// * `matchExisting`: aborts unless `name` uses this auth service and its row already has
      ///   this `key`, `owner`, and `allowed`. Changes nothing, so any sender may call it.
      /// * `keepExisting`: replaces the row's `key`, `owner`, and `allowed`. The sender must be the
      ///   row's current `owner`.
      ///
      /// Aborts if `owner` does not exist, or if `owner` is `name` or is owned by `name`.
      ///
      /// Returns true if an account was created.
      bool newAccount(psibase::AccountNumber        name,
                      AuthSig::SubjectPublicKeyInfo key,
                      psibase::AccountNumber        owner,
                      std::vector<AllowedAction>    allowed,
                      NewAccountMode                mode);

      /// Returns the stored row, if any.
      std::optional<AuthScopeRow> get(psibase::AccountNumber account);

      /// Replaces `account`'s authorized public key. The sender must be the row's `owner`.
      ///
      /// Aborts if `account` has no row or the sender is not the row's `owner`.
      void setKey(psibase::AccountNumber        account,
                  AuthSig::SubjectPublicKeyInfo key);

      /// Replaces `account`'s action whitelist. The sender must be the row's `owner`.
      ///
      /// Aborts if `account` has no row or the sender is not the row's `owner`.
      void setAllowed(psibase::AccountNumber     account,
                      std::vector<AllowedAction> allowed);

      /// Replaces `account`'s owning account. The sender must be the row's `owner`.
      ///
      /// Aborts if `account` has no row, the sender is not the row's `owner`, `owner` does not
      /// exist, or ownership would be circular.
      void setOwner(psibase::AccountNumber account, psibase::AccountNumber owner);
   };
   PSIO_REFLECT(AuthScope,  //
                method(checkAuthSys, flags, sender, action, claims),
                method(canAuthUserSys, user),
                method(getDlgsSys, sender, method),
                method(isAuthSys, sender, authorizers, method),
                method(isRejectSys, sender, rejecters, method),
                method(newAccount, name, key, owner, allowed, mode),
                method(get, account),
                method(setKey, account, key),
                method(setAllowed, account, allowed),
                method(setOwner, account, owner)
                //
   )
   PSIBASE_REFLECT_TABLES(AuthScope, AuthScope::Tables)
}  // namespace SystemService
