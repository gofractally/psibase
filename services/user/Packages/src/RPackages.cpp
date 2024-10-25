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
         auto ownerIndex   = AuthDelegate::Tables(AuthDelegate::service)
                               .open<AuthDelegate::AuthDelegateTable>()
                               .getIndex<0>();
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

   void parse_query_string_impl(std::string_view                  query,
                                std::span<const std::string_view> keys,
                                std::span<std::string_view>       values)
   {
      while (true)
      {
         auto end   = query.find('&');
         auto split = query.find('=');
         fflush(stdout);
         if (split >= end)
            psibase::abortMessage("Missing '=' in query");

         auto key   = query.substr(0, split);
         auto value = query.substr(split + 1, end - split - 1);
         if (auto pos = std::ranges::find(keys, key); pos != keys.end())
         {
            values[pos - keys.begin()] = value;
         }

         if (end == std::string_view::npos)
         {
            break;
         }
         else
         {
            query.remove_prefix(end + 1);
         }
      }
   }

   template <typename... T>
   std::array<std::string_view, sizeof...(T)> parse_query_string(std::string_view query,
                                                                 const T&... t)
   {
      std::array<std::string_view, sizeof...(T)> keys{t...};
      std::array<std::string_view, sizeof...(T)> values;
      parse_query_string_impl(query, keys, values);
      return values;
   }

   std::optional<psibase::HttpReply> servePackageManifest(psibase::HttpRequest& request)
   {
      constexpr std::string_view prefix = "/manifest?";
      std::string_view           target = request.target;
      if (request.method == "GET" && target.starts_with(prefix))
      {
         auto [owner, package] =
             parse_query_string(target.substr(prefix.size()), "owner", "package");
         auto manifestIndex =
             Packages::Tables(Packages::service).open<PackageManifestTable>().getIndex<0>();
         if (auto result =
                 manifestIndex.get(std::tuple(std::string(package), psibase::AccountNumber(owner))))
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
