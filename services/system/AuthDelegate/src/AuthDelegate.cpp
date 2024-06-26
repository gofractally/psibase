#include <services/system/AuthDelegate.hpp>

#include <psibase/dispatch.hpp>
#include <services/system/Accounts.hpp>

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

      auto accountsTables = Accounts::Tables(Accounts::service);
      auto accountTable   = accountsTables.open<AccountTable>();
      auto accountIndex   = accountTable.getIndex<0>();
      auto account        = accountIndex.get(row->owner);
      if (!account)
         abortMessage("unknown owner \"" + sender.str() + "\"");

      Actor<AuthInterface> auth(AuthDelegate::service, account->authService);
      auth.checkAuthSys(flags, requester, row->owner, std::move(action), std::move(allowedActions),
                        std::move(claims));
   }

   void AuthDelegate::canAuthUserSys(psibase::AccountNumber user)
   {
      auto row = db.open<AuthDelegateTable>().getIndex<0>().get(user);
      check(row.has_value(), "sender does not have an owning account");
   }

   void AuthDelegate::setOwner(psibase::AccountNumber owner)
   {
      auto authTable = db.open<AuthDelegateTable>();
      authTable.put(AuthDelegateRecord{.account = getSender(), .owner = owner});
   }

}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::AuthDelegate)
