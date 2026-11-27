#include <psibase/checkSchema.hpp>

#include <algorithm>
#include <format>
#include <psibase/package.hpp>
#include <psibase/tester.hpp>
#include <ranges>
#include <unordered_map>

namespace psibase
{
   std::optional<std::string> findDifference(const ServiceSchema& lhs, const ServiceSchema& rhs)
   {
      // Both schemas are of one service. Compared as contracts: the bytes
      // and what a consumer of the text forms sees (member and parameter
      // names, variant alternative labels, custom ids, argument list
      // forms). The comparison is the same whichever language built the
      // package: a declaration and its twin in the other language are one
      // contract (doc/migrations/2026-11-fracpack-to-pssz/flip-interop.md
      // section 0.1).
      std::string why;
      auto        same = [&](const psio::schema_types::AnyType& l,
                             const psio::schema_types::AnyType& r)
      {
         auto result = psio::pssz_ir::equivalent(lhs.types, l, rhs.types, r,
                                                 psio::pssz_ir::compare::contract);
         if (!result)
            why = " (" + result.path + ": " + result.reason + ")";
         return result.ok;
      };

      for (const auto& [name, lty] : lhs.actions)
      {
         if (auto rpos = rhs.actions.find(name); rpos != rhs.actions.end())
         {
            const auto& rty = rpos->second;
            if (!same(*lty.params, *rty.params))
               return std::format("Parameter types for action {} do not match{}", name, why);
            if (lty.result && rty.result)
            {
               if (!same(**lty.result, **rty.result))
                  return std::format("Return type for {} does not match{}", name, why);
            }
            else if (!lty.result && !rty.result)
            {
            }
            else if (lty.result && !rty.result)
            {
               return std::format("Missing return type for {}", name);
            }
            else if (!lty.result && rty.result)
            {
               return std::format("Extra return type for {}", name);
            }
         }
         else
         {
            return std::format("Missing action {}", name);
         }
      }
      for (const auto& [name, _] : rhs.actions)
      {
         if (lhs.actions.find(name) == lhs.actions.end())
            return std::format("Extra action {}", name);
      }
      for (auto [levents, revents] : {
               std::pair{&lhs.history, &rhs.history},
               std::pair{&lhs.merkle, &rhs.merkle},
           })
      {
         for (const auto& [name, lty] : *levents)
         {
            if (auto rty = revents->find(name); rty != revents->end())
            {
               if (!same(lty.type, rty->second.type))
                  return std::format("Type for event {} does not match{}", name, why);
               if (lty.access != rty->second.access)
                  return std::format("Access for event {} does not match", name);
            }
            else
            {
               return std::format("Missing event {}", name);
            }
         }
         for (const auto& [name, _] : *revents)
         {
            if (levents->find(name) == levents->end())
               return std::format("Extra event {}", name);
         }
      }
      // Allow tables to be missing
      if (rhs.database)
      {
         for (const auto& [db, rtables] : *rhs.database)
         {
            // Compare tables by their declared numeric `table` index
            std::unordered_map<std::uint16_t, const TableInfo*> lByIdx;
            if (lhs.database)
            {
               if (auto pos = lhs.database->find(db); pos != lhs.database->end())
               {
                  for (const TableInfo& t : pos->second)
                  {
                     lByIdx.insert({t.table, &t});
                  }
               }
            }

            for (const auto& rtab : rtables)
            {
               auto ltabPos = lByIdx.find(rtab.table);
               if (ltabPos == lByIdx.end())
               {
                  auto tableName =
                      rtab.name ? std::string_view{*rtab.name} : std::string_view{"<unnamed>"};
                  return std::format("Extra table {}::{} (index {})", db, tableName, rtab.table);
               }
               const auto& ltab = *ltabPos->second;

               auto tableName =
                   ltab.name ? std::string_view{*ltab.name} : std::string_view{"<unnamed>"};
               if (!same(ltab.type, rtab.type))
                  return std::format("Type for table {}::{} does not match{}", db, tableName, why);
               if (ltab.indexes.size() < rtab.indexes.size())
                  return std::format("Too many indexes for table {}::{}", db, tableName);
               for (const auto& [lindex, rindex] : std::views::zip(ltab.indexes, rtab.indexes))
               {
                  if (lindex.size() != rindex.size())
                  {
                     return std::format("Index does not match in {}::{}", db, tableName);
                  }
                  for (const auto& [lfield, rfield] : std::views::zip(lindex, rindex))
                  {
                     if (lfield.path != rfield.path || lfield.transform != rfield.transform ||
                         lfield.type.has_value() != rfield.type.has_value() ||
                         (lfield.type && rfield.type && !same(*lfield.type, *rfield.type)))
                     {
                        return std::format("Index does not match in {}::{}", db, tableName);
                     }
                  }
               }
            }
         }
      }
      return {};
   }

   std::optional<std::string> findDifference(const psibase::ServiceSchema& schema)
   {
      DirectoryRegistry registry{TestChain::defaultPackageDir()};
      for (auto info : registry.index())
      {
         if (std::ranges::contains(info.accounts, schema.service))
         {
            auto package = registry.get(info);
            for (const auto& [service, _, info] : package.services)
            {
               if (service == schema.service)
               {
                  if (!info.schema)
                     return std::format("Missing schema for {}", service.str());
                  return findDifference(*info.schema, schema);
               }
            }
         }
      }
      return std::format("Could not find package containing {}", schema.service.str());
   }

}  // namespace psibase
