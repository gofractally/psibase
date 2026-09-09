#include <services/system/AuthDelegate.hpp>

#include <psibase/dispatch.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/AuthAny.hpp>
#include <services/system/StagedTx.hpp>
#include "services/system/Transact.hpp"

using namespace psibase;

namespace SystemService
{
   bool AuthDelegate::checkAuthSys(std::uint32_t              flags,
                                   AccountNumber              requester,
                                   AccountNumber              sender,
                                   ServiceMethod              action,
                                   std::vector<ServiceMethod> allowedActions,
                                   std::vector<Claim>         claims)
   {
      auto owner = getOwner(sender);
      check(owner.has_value(), "account does not have an owning account");

      if (requester == *owner)
         flags = (flags & ~AuthInterface::requestMask) | AuthInterface::runAsRequesterReq;

      auto _ = recurse();
      return authServiceOf(*owner).checkAuthSys(flags, requester, *owner, std::move(action),
                                                std::move(allowedActions), std::move(claims));
   }

   void AuthDelegate::canAuthUserSys(psibase::AccountNumber user)
   {
      check(getOwner(user).has_value(), "account does not have an owning account");
   }

   std::vector<AccountNumber> AuthDelegate::getDlgsSys(psibase::AccountNumber sender)
   {
      auto owner = getOwner(sender);
      check(owner.has_value(), "account does not have an owning account");
      return {*owner};
   }

   bool AuthDelegate::isAuthSys(psibase::AccountNumber              sender,
                                std::vector<psibase::AccountNumber> authorizers)
   {
      auto owner = getOwner(sender);
      check(owner.has_value(), "account does not have an owning account");
      return std::ranges::contains(authorizers, *owner);
   }

   bool AuthDelegate::isRejectSys(psibase::AccountNumber              sender,
                                  std::vector<psibase::AccountNumber> rejecters)
   {
      auto owner = getOwner(sender);
      check(owner.has_value(), "account does not have an owning account");
      return std::ranges::contains(rejecters, *owner);
   }

   void AuthDelegate::setOwner(psibase::AccountNumber owner)
   {
      auto table  = open<AuthDelegateTable>();
      auto record = table.getIndex<0>().get(owner);
      auto sender = getSender();
      if (sender == owner || record && record->owner == sender)
      {
         abortMessage("circular ownership");
      }

      to<Accounts>().incAuthSeq(sender);

      table.put(AuthDelegateRecord{.account = getSender(), .owner = owner});
   }

   std::optional<AccountNumber> AuthDelegate::getOwner(psibase::AccountNumber account)
   {
      if (auto row = open<AuthDelegateTable>(KvMode::read).getIndex<0>().get(account))
         return row->owner;
      return std::nullopt;
   }

   Actor<AuthInterface> AuthDelegate::authServiceOf(psibase::AccountNumber account)
   {
      return Actor<AuthInterface>{service, to<Accounts>().getAuthOf(account)};
   }

   // cases to consider:
   // - the account does not exist
   // - the account exists and uses AuthDelegate with another owner
   // - the account exists and uses a different auth service
   // - the account exists and uses a different auth service but there is a record in auth delegate
   bool AuthDelegate::newAccount(psibase::AccountNumber name,
                                 psibase::AccountNumber owner,
                                 bool                   requireMatch)
   {
      auto table = open<AuthDelegateTable>();
      if (requireMatch)
      {
         auto record = table.getIndex<0>().get(name);
         if (record && record->owner != owner)
         {
            abortMessage(std::format("{} is owned by {}", name.str(), record->owner.str()));
         }
      }

      check(to<Accounts>().exists(owner), "owner account does not exist");

      bool created = to<Accounts>().newAccount(name, AuthDelegate::service, requireMatch);
      if (created)
         table.put(AuthDelegateRecord{.account = name, .owner = owner});
      return created;
   }

}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::AuthDelegate)
