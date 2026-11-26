#include <services/user/Packages.hpp>

#include <psibase/check.hpp>
#include <psibase/dispatch.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/AuthDelegate.hpp>

using namespace psibase;
using namespace SystemService;

namespace UserService
{
   namespace
   {
      namespace ir = psio::pssz_ir;
      using psio::schema_types::AnyType;
      using psio::schema_types::Schema;

      // The type of one component of an index key: the transform's result,
      // or the member the path leads to (checkValid resolved every path).
      const AnyType& keyType(const Schema& schema, const AnyType& row, const FieldId& field)
      {
         if (field.type)
            return *field.type;
         const char* msg    = nullptr;
         auto*       result = psibase::getFieldType(schema, row, field.path, msg);
         if (!result)
            abortMessage(msg);
         return *result;
      }

      // An installed schema and the one that replaces it are of one service:
      // they are compared as contracts
      // (doc/migrations/2026-11-fracpack-to-pssz/flip-interop.md section 0.1).
      bool indexesEqual(const Schema&                 lschema,
                        const AnyType&                ltype,
                        const std::vector<IndexInfo>& lhs,
                        const Schema&                 rschema,
                        const AnyType&                rtype,
                        const std::vector<IndexInfo>& rhs)
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
                              ir::equivalent(lschema, keyType(lschema, ltype, lhs), rschema,
                                             keyType(rschema, rtype, rhs), ir::compare::contract)
                                  .ok;
                    });
             });
      }

      // Whether every value of `prev` is a value of `next` with the same
      // bytes (docs/pssz-spec.md 7.5: members are appended and optional, no
      // offset width moves)
      std::string upgradeError(const Schema&  prevSchema,
                               const AnyType& prev,
                               const Schema&  nextSchema,
                               const AnyType& next)
      {
         auto result =
             ir::evolves_from(prevSchema, prev, nextSchema, next, ir::compare::contract);
         if (result)
            return {};
         return ": " + result.path + ": " + result.reason;
      }
   }  // namespace

   void Packages::postinstall(PackageMeta package, std::vector<char> manifest)
   {
      auto sender = getSender();
      for (AccountNumber account : package.accounts)
      {
         if (auto auth = to<Accounts>().getAuthOf(account); auth != AuthDelegate::service)
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
            if (to<AuthDelegate>().checkOwner(account) != sender)
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
                 .services    = std::move(package.services),
                 .exports     = std::move(package.exports),
                 .owner       = sender});
   }

   void Packages::setSchema(ServiceSchema schema)
   {
      auto service = getSender();
      schema.checkValid();
      auto tables  = Tables(getReceiver());
      auto schemas = tables.open<InstalledSchemaTable>();
      if (auto existing = schemas.get(service))
      {
         const auto& prevTypes = existing->schema.types;
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
                     if (auto err = upgradeError(prevTypes, prev.type, schema.types, pos->type);
                         !err.empty())
                        abortMessage("Incompatible update for table " + prev.str() + err);
                     if (!indexesEqual(prevTypes, prev.type, prev.indexes, schema.types,
                                       pos->type, pos->indexes))
                     {
                        abortMessage("Cannot change indexes for table " + prev.str());
                     }
                  }
               }
            }
         }
         for (const auto& [name, ty] : existing->schema.history)
         {
            auto pos = schema.history.find(name);
            if (pos == schema.history.end())
            {
               abortMessage("Cannot remove event history." + name);
            }
            else
            {
               if (auto err = upgradeError(prevTypes, ty.type, schema.types, pos->second.type);
                   !err.empty())
               {
                  abortMessage("Incompatible update to event history." + name + err);
               }
               // Changing access is allowed because it doesn't break the layout
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
               if (auto err = upgradeError(prevTypes, ty.type, schema.types, pos->second.type);
                   !err.empty())
               {
                  abortMessage("Incompatible update to event merkle." + name + err);
               }
            }
         }
      }
      schemas.put({service, std::move(schema)});
   }

   std::optional<ServiceSchema> Packages::getSchema(AccountNumber service)
   {
      auto schemas = open<InstalledSchemaTable>(KvMode::read);
      if (auto row = schemas.get(service))
         return std::move(row->schema);
      else
         return std::nullopt;
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
          .scope       = std::move(package.scope),
          .description = std::move(package.description),
          .depends     = std::move(package.depends),
          .accounts    = std::move(package.accounts),
          .services    = std::move(package.services),
          .exports     = std::move(package.exports),
          .sha256      = std::move(sha256),
          .file        = std::move(file),
      });
   }

   void Packages::setSources(std::vector<PackageSource> sources)
   {
      open<PackageSourcesTable>().put({getSender(), std::move(sources)});
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
