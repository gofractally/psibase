#pragma once

#include <optional>
#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
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
   };
   PSIO_REFLECT(AuthScopeRow, account, pubkey, owner, allowed)

   using AuthScopeTable = psibase::Table<AuthScopeRow, &AuthScopeRow::account>;
   PSIO_REFLECT_TYPENAME(AuthScopeTable)

   /// Auth service for an account whose key may authorize only whitelisted actions.
   ///
   /// The key cannot authorize an action on `auth-scope`.
   class AuthScope : public psibase::Service
   {
     public:
      static constexpr auto service = psibase::AccountNumber("auth-scope");
      static_assert(service.value != 0);
      using Tables = psibase::ServiceTables<AuthScopeTable>;

      /// Authenticate `sender` for `action`.
      ///
      /// A `verify-sig` claim must carry `pubkey`. When `firstAuthFlag` is set, that claim must be
      /// first. The action must match `allowed` and must not target `auth-scope`.
      ///
      /// Returns false if the claim is missing, the action is not whitelisted, or the action
      /// targets `auth-scope`. Aborts only when `sender` has no row.
      bool checkAuthSys(uint32_t                    flags,
                        psibase::AccountNumber      sender,
                        ServiceMethod               action,
                        std::vector<psibase::Claim> claims);

      /// Aborts unless `user` has a row.
      void canAuthUserSys(psibase::AccountNumber user);

      /// Get the accounts this auth service delegates authority to for a sender.
      std::vector<psibase::AccountNumber> getDlgsSys(psibase::AccountNumber       sender,
                                                     std::optional<ServiceMethod> method);

      /// Returns whether the sender's `owner` is among `authorizers`.
      ///
      /// Aborts when `sender` has no row.
      bool isAuthSys(psibase::AccountNumber              sender,
                     std::vector<psibase::AccountNumber> authorizers,
                     std::optional<ServiceMethod>        method);

      /// Returns whether the sender's `owner` is among `rejecters`.
      ///
      /// Aborts when `sender` has no row.
      bool isRejectSys(psibase::AccountNumber              sender,
                       std::vector<psibase::AccountNumber> rejecters,
                       std::optional<ServiceMethod>        method);

      /// Creates `name` on this auth service and stores its row.
      ///
      /// Aborts if `owner` does not exist or `name` already exists.
      void newAccount(psibase::AccountNumber        name,
                      AuthSig::SubjectPublicKeyInfo key,
                      psibase::AccountNumber        owner,
                      std::vector<AllowedAction>    allowed);

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

     private:
      psibase::AccountNumber checkOwner(psibase::AccountNumber sender);
   };
   PSIO_REFLECT(AuthScope,  //
                method(checkAuthSys, flags, sender, action, claims),
                method(canAuthUserSys, user),
                method(getDlgsSys, sender, method),
                method(isAuthSys, sender, authorizers, method),
                method(isRejectSys, sender, rejecters, method),
                method(newAccount, name, key, owner, allowed),
                method(get, account),
                method(setKey, account, key),
                method(setAllowed, account, allowed)
                //
   )
   PSIBASE_REFLECT_TABLES(AuthScope, AuthScope::Tables)
}  // namespace SystemService
