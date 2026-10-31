#include <services/system/AuthScope.hpp>

#include <psibase/blob.hpp>
#include <psibase/dispatch.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/VerifySig.hpp>

#include <algorithm>

using namespace psibase;

namespace SystemService
{
   namespace
   {
      bool actionAllowed(const AuthScopeRow& row, ServiceMethod action)
      {
         return std::ranges::contains(row.allowed, AllowedAction{action.service, action.method});
      }

      template <typename RowOpt>
      auto& requireConfigured(RowOpt& row, const char* missingMessage)
      {
         check(row.has_value(), missingMessage);
         return *row;
      }

      template <typename RowOpt>
      auto& requireSenderRow(RowOpt& row)
      {
         return requireConfigured(row, "sender is not configured in AuthScope");
      }

      template <typename RowOpt>
      auto& requireAccountRow(RowOpt& row)
      {
         return requireConfigured(row, "account is not configured in AuthScope");
      }

      bool senderAuthorizedViaList(const AuthScopeRow&                row,
                                   AccountNumber                      sender,
                                   const std::vector<AccountNumber>& accounts,
                                   const std::optional<ServiceMethod>& method)
      {
         if (std::ranges::contains(accounts, row.owner))
            return true;
         return method && std::ranges::contains(accounts, sender) && actionAllowed(row, *method);
      }

      AuthScopeRow& requireOwnedBySender(std::optional<AuthScopeRow>& row)
      {
         auto& configured = requireAccountRow(row);
         check(getSender() == configured.owner, "sender is not the owner");
         return configured;
      }

      void replaceAuthRules(AuthScopeTable& table, const AuthScopeRow& row)
      {
         table.put(row);
         to<Accounts>().incAuthSeq(row.account);
      }

      void requireValidOwner(AccountNumber account, AccountNumber owner, AuthScopeTable& table)
      {
         check(to<Accounts>().exists(owner), "owner account does not exist");
         if (account == owner)
            abortMessage("circular ownership");
         if (auto ownerRow = table.getIndex<0>().get(owner); ownerRow && ownerRow->owner == account)
            abortMessage("circular ownership");
      }

      template <typename Fn>
      void mutateOwnedRow(AuthScopeTable& table, AccountNumber account, Fn&& mutate)
      {
         auto  stored = table.getIndex<0>().get(account);
         auto& row    = requireOwnedBySender(stored);
         mutate(table, row);
         replaceAuthRules(table, row);
      }

   }  // namespace

   bool AuthScope::checkAuthSys(uint32_t                    flags,
                                AccountNumber               sender,
                                ServiceMethod               action,
                                std::vector<psibase::Claim> claims)
   {
      const auto            senderRow = get(sender);
      const AuthScopeRow&   row       = requireSenderRow(senderRow);

      auto hasMatchingClaim = std::ranges::any_of(
          claims,
          [&](const Claim& claim)
          {
             return claim.service == VerifySig::service &&
                    compare_blob(claim.rawData, row.pubkey.data) == 0;
          });
      return hasMatchingClaim && actionAllowed(row, action);
   }

   void AuthScope::canAuthUserSys(AccountNumber user)
   {
      const auto userRow = get(user);
      requireAccountRow(userRow);
   }

   std::vector<AccountNumber> AuthScope::getDlgsSys(AccountNumber sender,
                                                     std::optional<ServiceMethod>)
   {
      const auto senderRow = get(sender);
      return {requireSenderRow(senderRow).owner};
   }

   bool AuthScope::isAuthSys(AccountNumber                sender,
                             std::vector<AccountNumber>   authorizers,
                             std::optional<ServiceMethod> method)
   {
      const auto senderRow = get(sender);
      return senderAuthorizedViaList(requireSenderRow(senderRow), sender, authorizers, method);
   }

   bool AuthScope::isRejectSys(AccountNumber                sender,
                               std::vector<AccountNumber>   rejecters,
                               std::optional<ServiceMethod> method)
   {
      const auto senderRow = get(sender);
      return senderAuthorizedViaList(requireSenderRow(senderRow), sender, rejecters, method);
   }

   bool AuthScope::newAccount(AccountNumber                 name,
                              AuthSig::SubjectPublicKeyInfo key,
                              AccountNumber                 owner,
                              std::vector<AllowedAction>    allowed,
                              NewAccountMode                mode)
   {
      auto table = open<AuthScopeTable>();
      requireValidOwner(name, owner, table);

      auto row = AuthScopeRow{
          .account = name,
          .pubkey  = std::move(key),
          .owner   = owner,
          .allowed = std::move(allowed),
      };
      if (to<Accounts>().newAccount(name, AuthScope::service, mode))
      {
         table.put(row);
         return true;
      }

      auto existing = table.getIndex<0>().get(name);
      if (mode == NewAccountMode::matchExisting)
         check(existing == row, "account already exists");
      else
      {
         requireOwnedBySender(existing);
         replaceAuthRules(table, row);
      }
      return false;
   }

   std::optional<AuthScopeRow> AuthScope::get(AccountNumber account)
   {
      return open<AuthScopeTable>(KvMode::read).getIndex<0>().get(account);
   }

   void AuthScope::setKey(AccountNumber account, AuthSig::SubjectPublicKeyInfo key)
   {
      auto table = open<AuthScopeTable>();
      mutateOwnedRow(table, account, [&](AuthScopeTable&, AuthScopeRow& row) { row.pubkey = std::move(key); });
   }

   void AuthScope::setAllowed(AccountNumber account, std::vector<AllowedAction> allowed)
   {
      auto table = open<AuthScopeTable>();
      mutateOwnedRow(table, account,
                     [&](AuthScopeTable&, AuthScopeRow& row) { row.allowed = std::move(allowed); });
   }

   void AuthScope::setOwner(AccountNumber account, AccountNumber owner)
   {
      auto table = open<AuthScopeTable>();
      mutateOwnedRow(table, account, [&](AuthScopeTable& t, AuthScopeRow& row)
                     {
                        requireValidOwner(account, owner, t);
                        row.owner = owner;
                     });
   }
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::AuthScope)
