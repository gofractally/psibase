#include <services/system/AuthDelegateSys.hpp>

#include <psibase/dispatch.hpp>
#include <services/system/AccountSys.hpp>

using namespace psibase;

namespace SystemService
{
   void AuthDelegateSys::checkAuthSys(std::uint32_t              flags,
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

      auto accountSysTables = AccountSys::Tables(AccountSys::service);
      auto accountTable     = accountSysTables.open<AccountTable>();
      auto accountIndex     = accountTable.getIndex<0>();
      auto account          = accountIndex.get(row->owner);
      if (!account)
         abortMessage("unknown owner \"" + sender.str() + "\"");

      Actor<AuthInterface> auth(AuthDelegateSys::service, account->authService);
      auth.checkAuthSys(flags, requester, row->owner, std::move(action), std::move(allowedActions),
                        std::move(claims));
   }

   void AuthDelegateSys::canAuthUserSys(psibase::AccountNumber user)
   {
      auto row = db.open<AuthDelegateTable>().getIndex<0>().get(user);
      check(row.has_value(), "sender does not have an owning account");
   }

   void AuthDelegateSys::setOwner(psibase::AccountNumber owner)
   {
      auto authTable = db.open<AuthDelegateTable>();
      authTable.put(AuthDelegateRecord{.account = getSender(), .owner = owner});
   }

}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::AuthDelegateSys)
