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

      const AuthScopeRow& requireSenderRow(const std::optional<AuthScopeRow>& row)
      {
         check(row.has_value(), "sender does not have a public key");
         return *row;
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
      const auto senderRow = get(user);
      requireSenderRow(senderRow);
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

   void AuthScope::newAccount(AccountNumber                 name,
                              AuthSig::SubjectPublicKeyInfo key,
                              AccountNumber                 owner,
                              std::vector<AllowedAction>    allowed)
   {
      check(to<Accounts>().exists(owner), "owner account does not exist");

      open<AuthScopeTable>().put(AuthScopeRow{
          .account = name,
          .pubkey  = std::move(key),
          .owner   = owner,
          .allowed = std::move(allowed),
      });
      to<Accounts>().newAccount(name, AuthScope::service, NewAccountMode::requireNew);
   }

   std::optional<AuthScopeRow> AuthScope::get(AccountNumber account)
   {
      return open<AuthScopeTable>(KvMode::read).getIndex<0>().get(account);
   }

   void AuthScope::setKey(AccountNumber account, AuthSig::SubjectPublicKeyInfo key)
   {
      auto table = open<AuthScopeTable>();
      auto row   = table.getIndex<0>().get(account);
      check(row.has_value(), "account does not have a public key");
      check(getSender() == row->owner, "sender is not the owner");
      row->pubkey = std::move(key);
      table.put(*row);
   }

   void AuthScope::setAllowed(AccountNumber account, std::vector<AllowedAction> allowed)
   {
      auto table = open<AuthScopeTable>();
      auto row   = table.getIndex<0>().get(account);
      check(row.has_value(), "account does not have a public key");
      check(getSender() == row->owner, "sender is not the owner");
      row->allowed = std::move(allowed);
      table.put(*row);
   }
}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::AuthScope)
