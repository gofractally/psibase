#include <services/user/PackageSys.hpp>
#include <services/user/RPackageSys.hpp>

#include <services/system/AccountSys.hpp>
#include <services/system/AuthDelegateSys.hpp>

using Tables = psibase::ServiceTables<psibase::WebContentTable>;

using namespace SystemService;

namespace UserService
{
   struct Query
   {
      auto installed() const
      {
         return PackageSys::Tables(PackageSys::service).open<InstalledPackageTable>().getIndex<0>();
      }
      // Returns the accounts that need to be created to install a package.
      // Validates that existing accounts have the correct owner.
      auto newAccounts(std::vector<psibase::AccountNumber> accounts,
                       psibase::AccountNumber              owner) const
      {
         std::vector<psibase::AccountNumber> result;
         auto                                accountIndex =
             AccountSys::Tables(AccountSys::service).open<AccountTable>().getIndex<0>();
         auto ownerIndex = AuthDelegateSys::Tables(AuthDelegateSys::service)
                               .open<AuthDelegateSys::AuthDelegateTable>()
                               .getIndex<0>();
         for (auto account : accounts)
         {
            if (auto accountRow = accountIndex.get(account))
            {
               if (accountRow->authService != AuthDelegateSys::service)
               {
                  if (account != owner &&
                      std::ranges::find(accounts, accountRow->authService) == accounts.end())
                  {
                     psibase::abortMessage("Account " + account.str() + " does not use " +
                                           AuthDelegateSys::service.str() + " as its auth service");
                  }
               }
               else
               {
                  if (auto ownerRow = ownerIndex.get(account))
                  {
                     if (ownerRow->owner != owner)
                     {
                        psibase::abortMessage("Account " + account.str() + " is not owned by " +
                                              owner.str());
                     }
                  }
                  else
                  {
                     psibase::abortMessage("Cannot find owner for " + account.str());
                  }
               }
            }
            else
               result.push_back(account);
         }
         return result;
      }
   };
   PSIO_REFLECT(  //
       Query,
       method(installed),
       method(newAccounts, accounts, owner))

   std::optional<psibase::HttpReply> RPackageSys::serveSys(psibase::HttpRequest request)
   {
      if (auto result = psibase::serveGraphQL(request, Query{}))
         return result;
      if (auto result = psibase::serveContent(request, Tables{psibase::getReceiver()}))
         return result;
      return std::nullopt;
   }

   void RPackageSys::storeSys(std::string path, std::string contentType, std::vector<char> content)
   {
      psibase::check(psibase::getSender() == psibase::getReceiver(), "wrong sender");
      psibase::storeContent(std::move(path), std::move(contentType), std::move(content),
                            Tables{psibase::getReceiver()});
   }
}  // namespace UserService

PSIBASE_DISPATCH(UserService::RPackageSys)
