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

      using namespace psio::schema_types;

      const AnyType* getFieldType(const Object& ty, std::uint32_t index)
      {
         return &ty.members.at(index).type;
      }
      const AnyType* getFieldType(const Struct& ty, std::uint32_t index)
      {
         return &ty.members.at(index).type;
      }
      const AnyType* getFieldType(const Tuple& ty, std::uint32_t index)
      {
         return &ty.members.at(index);
      }
      const AnyType* getFieldType(const auto& ty, std::uint32_t index)
      {
         abortMessage("Can only extract fields of Tuple, Struct, or Object");
      }

      const AnyType& getFieldType(const Schema& schema, const AnyType& ty, const FieldId& field)
      {
         const AnyType* result = &ty;
         for (auto idx : field.path)
         {
            result = result->resolve(schema);
            if (!result)
               abortMessage("Failed to resolve type");
            result = std::visit([&](const auto& t) { return getFieldType(t, idx); }, result->value);
         }
         return *result;
      }

      bool indexesEqual(const Schema&                 lschema,
                        const AnyType&                ltype,
                        const std::vector<IndexInfo>& lhs,
                        const Schema&                 rschema,
                        const AnyType&                rtype,
                        const std::vector<IndexInfo>& rhs,
                        TypeMatcher&                  keyMatcher)
      {
         return std::ranges::equal(
             lhs, rhs,
             [&](const auto& lhs, const auto& rhs)
             {
                return std::ranges::equal(
                    lhs, rhs,
                    [&](const auto& lhs, const auto& rhs)
                    {
                       return lhs.path == rhs.path && lhs.transform == rhs.transform &&
                              keyMatcher.match(
                                  lhs.type ? *lhs.type : getFieldType(lschema, ltype, lhs),
                                  rhs.type ? *rhs.type : getFieldType(rschema, rtype, rhs));
                    });
             });
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
         TypeMatcher rowMatcher(existing->schema.types, schema.types, SchemaDifference::upgrade);
         TypeMatcher keyMatcher(existing->schema.types, schema.types, SchemaDifference::equivalent);
         if (existing->schema.database && !existing->schema.database->empty())
         {
            std::vector<TableInfo> nullTables;
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
                     abortMessage("Cannot remove table " + prev.str());
                  }
                  else
                  {
                     // TODO: Adding and removing indexes safely is possible, but
                     // requires migration.
                     // - Remove index: Migration deletes the rows of the index. Index can
                     //   be reused after migration completes.
                     // - Add index: All table writes update index. Migration writes index for
                     //   existing rows. Key conflict on regular update fails as usual. Key
                     //   conflict in migrate aborts migration. Index can be read after migration
                     //   completes.
                     if (!rowMatcher.match(prev.type, pos->type))
                        abortMessage("Incompatible update for table " + prev.str());
                     if (!indexesEqual(existing->schema.types, prev.type, prev.indexes,
                                       schema.types, pos->type, pos->indexes, keyMatcher))
                     {
                        abortMessage("Cannot change indexes for table " + prev.str());
                     }
                  }
               }
            }
         }
         // UI events do not need to maintain compatibility
         for (const auto& [name, ty] : existing->schema.history)
         {
            auto pos = schema.history.find(name);
            if (pos == schema.history.end())
            {
               abortMessage("Cannot remove event history." + name);
            }
            else
            {
               if (!rowMatcher.match(ty, pos->second))
               {
                  abortMessage("Incompatible update to event history." + name);
               }
            }
         }
         for (const auto& [name, ty] : existing->schema.merkle)
         {
            auto pos = schema.merkle.find(name);
            if (pos == schema.merkle.end())
            {
               abortMessage("Cannot remove event merkle." + name);
            }
            else
            {
               if (!rowMatcher.match(ty, pos->second))
               {
                  abortMessage("Incompatible update to event merkle." + name);
               }
            }
         }
      }
      schemas.put({service, std::move(schema)});
   }

   void Packages::publish(PackageMeta package, Checksum256 sha256, std::string file)
   {
      auto sender   = getSender();
      auto packages = open<PublishedPackageTable>();
      if (auto existing = packages.get(std::tie(sender, package.name, package.version)))
      {
         check(existing->sha256 == sha256, "Package already published");
      }
      packages.put({
          .owner       = sender,
          .name        = std::move(package.name),
          .version     = std::move(package.version),
          .description = std::move(package.description),
          .depends     = std::move(package.depends),
          .accounts    = std::move(package.accounts),
          .sha256      = std::move(sha256),
          .file        = std::move(file),
      });
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
