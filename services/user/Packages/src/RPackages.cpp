#include <services/user/Packages.hpp>
#include <services/user/RPackages.hpp>

#include <services/system/Accounts.hpp>
#include <services/system/AuthDelegate.hpp>

using namespace SystemService;

namespace UserService
{
   struct Query
   {
      auto installed() const
      {
         return Packages::Tables(Packages::service).open<InstalledPackageTable>().getIndex<0>();
      }
      // Returns the accounts that need to be created to install a package.
      // Validates that existing accounts have the correct owner.
      auto newAccounts(std::vector<psibase::AccountNumber> accounts,
                       psibase::AccountNumber              owner) const
      {
         std::vector<psibase::AccountNumber> result;
         auto accountIndex = Accounts::Tables(Accounts::service).open<AccountTable>().getIndex<0>();
         auto ownerIndex =
             AuthDelegate::Tables(AuthDelegate::service).open<AuthDelegateTable>().getIndex<0>();
         for (auto account : accounts)
         {
            if (auto accountRow = accountIndex.get(account))
            {
               if (accountRow->authService != AuthDelegate::service)
               {
                  if (account != owner &&
                      std::ranges::find(accounts, accountRow->authService) == accounts.end())
                  {
                     psibase::abortMessage("Account " + account.str() + " does not use " +
                                           AuthDelegate::service.str() + " as its auth service");
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

   struct ManifestQuery
   {
      std::string owner;
      std::string package;
      PSIO_REFLECT(ManifestQuery, owner, package)
   };

   std::optional<psibase::HttpReply> servePackageManifest(psibase::HttpRequest& request)
   {
      auto path = request.path();
      if (request.method == "GET" && path == "/manifest")
      {
         auto query = request.query<ManifestQuery>();
         auto manifestIndex =
             Packages::Tables(Packages::service).open<PackageManifestTable>().getIndex<0>();
         if (auto result =
                 manifestIndex.get(std::tuple(query.package, psibase::AccountNumber(query.owner))))
         {
            return psibase::HttpReply{
                .contentType = "application/json",
                .body        = std::move(result->data),
                .headers     = {{"Content-Encoding", "gzip"}},
            };
         }
      }
      return {};
   }

   std::optional<psibase::HttpReply> RPackages::serveSys(psibase::HttpRequest request)
   {
      if (auto result = psibase::serveGraphQL(request, Query{}))
         return result;
      if (auto result = servePackageManifest(request))
         return result;
      return std::nullopt;
   }
}  // namespace UserService

PSIBASE_DISPATCH(UserService::RPackages)
