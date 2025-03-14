#include <services/user/Packages.hpp>

#include <psibase/check.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/AuthDelegate.hpp>

using namespace psibase;
using namespace SystemService;

namespace UserService
{
   namespace
   {
      AccountNumber getAuthServ(AccountNumber account)
      {
         auto db = Accounts::Tables(Accounts::service);
         if (auto row = db.open<AccountTable>().getIndex<0>().get(account))
            return row->authService;
         else
            abortMessage("Unknown account " + account.str());
      }
      AccountNumber getOwner(AccountNumber account)
      {
         auto db = AuthDelegate::Tables(AuthDelegate::service);
         if (auto row = db.open<AuthDelegateTable>().getIndex<0>().get(account))
            return row->owner;
         else
            abortMessage("Cannot find owner for " + account.str());
      }
   }  // namespace

   void Packages::postinstall(PackageMeta package, std::vector<char> manifest)
   {
      auto sender = getSender();
      for (AccountNumber account : package.accounts)
      {
         if (auto auth = getAuthServ(account); auth != AuthDelegate::service)
         {
            // - A single account doesn't need to use delegation
            // - Accounts that have special auth defined in this package are okay
            if (account != sender &&
                std::ranges::find(package.accounts, auth) == package.accounts.end())
               abortMessage("Account " + account.str() + " in " + package.name + " does not use " +
                            AuthDelegate::service.str() + " as its auth service");
         }
         else
         {
            if (getOwner(account) != sender)
               abortMessage("Account " + account.str() + " in " + package.name +
                            " is not owned by " + sender.str());
         }
      }

      auto mtable = Tables(psibase::getReceiver()).open<PackageManifestTable>();
      mtable.put({.name = package.name, .owner = sender, .data = std::move(manifest)});

      auto table = Tables(psibase::getReceiver()).open<InstalledPackageTable>();
      table.put({.name        = std::move(package.name),
                 .version     = std::move(package.version),
                 .description = std::move(package.description),
                 .depends     = std::move(package.depends),
                 .accounts    = std::move(package.accounts),
                 .owner       = sender});
   }

   void Packages::setSchema(ServiceSchema schema)
   {
      auto service = getSender();
      auto tables  = Tables(getReceiver());
      auto schemas = tables.open<InstalledSchemaTable>();
      if (auto existing = schemas.get(service))
      {
         if (existing->schema.database && !existing->schema.database->empty())
         {
            std::vector<TableInfo> nullTables;
            std::vector<std::pair<psio::schema_types::AnyType, psio::schema_types::AnyType>>
                tableRows;
            for (const auto& [db, existingTables] : *existing->schema.database)
            {
               const auto* currentTables = &nullTables;
               if (schema.database)
               {
                  auto pos = schema.database->find(db);
                  if (pos != schema.database->end())
                  {
                     currentTables = &pos->second;
                  }
               }
               for (const TableInfo& prev : existingTables)
               {
                  auto pos = std::ranges::find_if(*currentTables,
                                                  [&](auto& t) { return t.table == prev.table; });
                  if (pos == currentTables->end())
                  {
                     // TODO: It's okay as long as the table is empty
                     abortMessage("Cannot remove table " + std::to_string(prev.table));
                  }
                  else
                  {
                     tableRows.push_back({prev.type, pos->type});
                  }
               }
            }
            auto difference = match(existing->schema.types, schema.types, tableRows);
            if (!(difference >= 0))
               abortMessage("Incompatible tables");
            // TODO: Check events
            // TOOD: Should actions be checked?
         }
      }
      schemas.put({service, std::move(schema)});
   }

   void Packages::checkOrder(std::uint64_t id, std::uint32_t index)
   {
      auto sender = getSender();
      auto table  = Tables(psibase::getReceiver()).open<TransactionOrderTable>();
      auto row =
          table.getIndex<0>().get(std::tuple(sender, id)).value_or(TransactionOrder{sender, id, 0});
      if (index != row.index)
      {
         abortMessage("Index should be " + std::to_string(row.index));
      }
      ++row.index;
      table.put(row);
   }

   void Packages::removeOrder(std::uint64_t id)
   {
      auto sender = getSender();
      auto table  = Tables(psibase::getReceiver()).open<TransactionOrderTable>();
      table.erase(std::tuple(sender, id));
   }
}  // namespace UserService

PSIBASE_DISPATCH(UserService::Packages)
