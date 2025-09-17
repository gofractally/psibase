#include <services/system/AuthDelegate.hpp>

#include <psibase/dispatch.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/AuthAny.hpp>
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
                                            std::optional(std::move(authSet)));
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
      auto table  = open<AuthDelegateTable>();
      auto record = table.getIndex<0>().get(owner);
      auto sender = getSender();
      if (sender == owner || record && record->owner == sender)
      {
         abortMessage("circular ownership");
      }

      table.put(AuthDelegateRecord{.account = getSender(), .owner = owner});
   }

   psibase::AccountNumber AuthDelegate::getOwner(psibase::AccountNumber account)
   {
      auto row = open<AuthDelegateTable>(KvMode::read).getIndex<0>().get(account);
      check(row.has_value(), "account does not have an owning account");
      return row->owner;
   }

   Actor<AuthInterface> AuthDelegate::authServiceOf(psibase::AccountNumber account)
   {
      return Actor<AuthInterface>{service, to<Accounts>().getAuthOf(account)};
   }

   void AuthDelegate::newAccount(psibase::AccountNumber name, psibase::AccountNumber owner)
   {
      auto table  = open<AuthDelegateTable>();
      auto record = table.getIndex<0>().get(name);
      if (record && record->owner == owner)
      {
         // idempotent if the new account already exists & is owned
         //   by the same owner
         return;
      }

      check(to<Accounts>().exists(owner), "owner account does not exist");
      to<Accounts>().newAccount(name, AuthAny::service, true);
      Action setOwner{
          .sender  = name,
          .service = service,
          .method  = "setOwner"_m,
          .rawData = psio::convert_to_frac(std::make_tuple(owner))  //
      };

      Action setAuth{
          .sender  = name,
          .service = Accounts::service,
          .method  = "setAuthServ"_m,
          .rawData = psio::convert_to_frac(std::make_tuple(service))  //
      };

      auto _ = recurse();
      to<Transact>().runAs(std::move(setOwner), std::vector<ServiceMethod>{});
      to<Transact>().runAs(std::move(setAuth), std::vector<ServiceMethod>{});
   }

}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::AuthDelegate)
