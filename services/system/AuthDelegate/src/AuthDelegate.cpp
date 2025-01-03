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
      auto owner = getOwner(sender);

      if (requester == owner)
         flags = (flags & ~AuthInterface::requestMask) | AuthInterface::runAsRequesterReq;

      auto _ = recurse();
      authServiceOf(owner).checkAuthSys(flags, requester, owner, std::move(action),
                                        std::move(allowedActions), std::move(claims));
   }

   void AuthDelegate::canAuthUserSys(psibase::AccountNumber user)
   {
      // Asserts if no owner is set for the user
      getOwner(user);
   }

   bool AuthDelegate::isAuthSys(psibase::AccountNumber                             sender,
                                std::vector<psibase::AccountNumber>                authorizers,
                                std::optional<std::vector<psibase::AccountNumber>> authSet_opt)
   {
      auto authSet = authSet_opt ? std::move(*authSet_opt) : std::vector<AccountNumber>{};

      // Base case to prevent infinite recursion
      if (std::ranges::contains(authSet, sender))
         return false;

      authSet.push_back(sender);

      auto owner = getOwner(sender);

      if (std::ranges::contains(authorizers, owner))
         return true;

      auto _ = recurse();
      return authServiceOf(owner).isAuthSys(owner, std::move(authorizers),
                                            std::make_optional(authSet));
   }

   bool AuthDelegate::isRejectSys(psibase::AccountNumber                             sender,
                                  std::vector<psibase::AccountNumber>                rejecters,
                                  std::optional<std::vector<psibase::AccountNumber>> authSet_opt)
   {
      auto authSet = authSet_opt ? std::move(*authSet_opt) : std::vector<AccountNumber>{};

      // Base case to prevent infinite recursion
      if (std::ranges::contains(authSet, sender))
         return false;

      authSet.push_back(sender);

      auto owner = getOwner(sender);

      if (std::ranges::contains(rejecters, owner))
         return true;

      auto _ = recurse();
      return authServiceOf(owner).isRejectSys(owner, std::move(rejecters),
                                              std::make_optional(authSet));
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

   Actor<AuthInterface> AuthDelegate::authServiceOf(psibase::AccountNumber account)
   {
      return Actor<AuthInterface>{service, to<Accounts>().getAuthOf(account)};
   }

}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::AuthDelegate)
