#include <services/system/AuthDelegate.hpp>

#include <psibase/dispatch.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/StagedTx.hpp>

using namespace psibase;

namespace SystemService
{
   void AuthDelegate::checkAuthSys(std::uint32_t              flags,
                                   AccountNumber              requester,
                                   AccountNumber              sender,
                                   ServiceMethod              action,
                                   std::vector<ServiceMethod> allowedActions,
                                   std::vector<Claim>         claims)
   {
      auto row = db.open<AuthDelegateTable>().getIndex<0>().get(sender);
      check(row.has_value(), "sender does not have an owning account");

      if (requester == row->owner)
         flags = (flags & ~AuthInterface::requestMask) | AuthInterface::runAsRequesterReq;

      auto account = to<Accounts>().getAccount(row->owner);
      if (!account)
         abortMessage("unknown owner \"" + sender.str() + "\"");

      auto _ = recurse();

      Actor<AuthInterface> auth(AuthDelegate::service, account->authService);
      auth.checkAuthSys(flags, requester, row->owner, std::move(action), std::move(allowedActions),
                        std::move(claims));
   }

   void AuthDelegate::canAuthUserSys(psibase::AccountNumber user)
   {
      // Asserts if no owner is set for the user
      getOwner(user);
   }

   bool AuthDelegate::isAuthSys(psibase::AccountNumber              sender,
                                std::vector<psibase::AccountNumber> authorizers)
   {
      auto owner = getOwner(sender);

      if (std::ranges::contains(authorizers, owner))
         return true;

      auto ownerAuth = to<Accounts>().getAccount(owner)->authService;

      auto _ = recurse();
      return Actor<AuthInterface>{service, ownerAuth}.isAuthSys(owner, std::move(authorizers));
   }

   bool AuthDelegate::isRejectSys(psibase::AccountNumber              sender,
                                  std::vector<psibase::AccountNumber> rejecters)
   {
      auto owner = getOwner(sender);

      if (std::ranges::contains(rejecters, owner))
         return true;

      auto ownerAuth = to<Accounts>().getAccount(owner)->authService;

      auto _ = recurse();
      return Actor<AuthInterface>{service, ownerAuth}.isRejectSys(owner, std::move(rejecters));
   }

   void AuthDelegate::setOwner(psibase::AccountNumber owner)
   {
      auto authTable = db.open<AuthDelegateTable>();
      authTable.put(AuthDelegateRecord{.account = getSender(), .owner = owner});
   }

   psibase::AccountNumber AuthDelegate::getOwner(psibase::AccountNumber account)
   {
      auto row = db.open<AuthDelegateTable>().getIndex<0>().get(account);
      check(row.has_value(), "account does not have an owning account");
      return row->owner;
   }

}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::AuthDelegate)
