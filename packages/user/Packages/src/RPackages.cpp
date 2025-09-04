#include <services/user/Packages.hpp>
#include <services/user/RPackages.hpp>

#include <services/system/Accounts.hpp>
#include <services/system/AuthDelegate.hpp>

using namespace SystemService;

namespace
{
   void requireAccount(psibase::AccountNumber account)
   {
      if (!psibase::to<Accounts>().exists(account))
         psibase::abortMessage(std::format("account '{}' does not exist", account.str()));
   }
}  // namespace

namespace UserService
{
   struct Query
   {
      auto installed() const
      {
         return Packages::Tables(Packages::service)
             .open<InstalledPackageTable>()
             .getIndex<0>()
             .subindex<PackageKey>(std::tuple{});
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

      auto package(psibase::AccountNumber owner, std::string name, std::string version) const
      {
         requireAccount(owner);
         return Packages{}.open<PublishedPackageTable>().get(std::tuple(owner, name, version));
      }

      auto packages(psibase::AccountNumber            owner,
                    std::optional<std::string>        name,
                    std::optional<uint32_t>           first,
                    std::optional<uint32_t>           last,
                    const std::optional<std::string>& before,
                    const std::optional<std::string>& after) const
      {
         requireAccount(owner);

         using Conn =
             psibase::Connection<PublishedPackage, psio::FixedString{"PublishedPackageConnection"},
                                 psio::FixedString{"PublishedPackageEdge"}>;
         auto published = Packages{}.open<PublishedPackageTable>().getIndex<0>();
         if (name)
         {
            auto index = published.subindex(std::tuple(owner, *name));
            return makeConnection<Conn>(index, {}, {}, {}, {}, first, last, before, after);
         }
         else
         {
            auto index = published.subindex(owner);
            return makeConnection<Conn>(index, {}, {}, {}, {}, first, last, before, after);
         }
      }

      auto sources(psibase::AccountNumber account) const -> std::vector<PackageSource>
      {
         requireAccount(account);

         auto table = Packages{}.open<PackageSourcesTable>();
         if (auto row = table.get(account))
         {
            return std::move(row->sources);
         }
         return {};
      }
   };
   PSIO_REFLECT(  //
       Query,
       method(installed),
       method(newAccounts, accounts, owner),
       method(package, owner, name, version),
       method(packages, owner, name, first, last, before, after),
       method(sources, account))

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
                .headers     = {{"Content-Encoding", "gzip"},
                                {"Access-Control-Allow-Origin", "*"},
                                {"Access-Control-Allow-Methods", "GET, OPTIONS, HEAD"},
                                {"Access-Control-Allow-Headers", "*"}},
            };
         }
      }
      return {};
   }

   struct SchemaQuery
   {
      std::string service;
      PSIO_REFLECT(SchemaQuery, service)
   };

   std::optional<psibase::HttpReply> serveSchema(psibase::HttpRequest& request)
   {
      auto path = request.path();
      if (request.method == "GET" && path == "/schema")
      {
         auto query       = request.query<SchemaQuery>();
         auto schemaTable = Packages{}.open<InstalledSchemaTable>();
         if (auto row = schemaTable.get(psibase::AccountNumber{query.service}))
         {
            psibase::HttpReply reply{
                .contentType = "application/json",
                .headers     = psibase::allowCors(),
            };
            psio::vector_stream stream{reply.body};
            psio::to_json(row->schema, stream);
            return std::move(reply);
         }
         else
         {
            std::string msg = "No schema for service '" + query.service + "'";
            return psibase::HttpReply{
                .status      = psibase::HttpStatus::notFound,
                .contentType = "text/html",
                .body        = {msg.begin(), msg.end()},
                .headers     = psibase::allowCors(),
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
      if (auto result = serveSchema(request))
         return result;
      return std::nullopt;
   }
}  // namespace UserService

PSIBASE_DISPATCH(UserService::RPackages)
