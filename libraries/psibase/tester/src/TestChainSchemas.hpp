#pragma once

#include <map>
#include <psibase/schema.hpp>
#include <services/user/Packages.hpp>

namespace psibase
{
   struct TestChainSchemas
   {
      std::map<psibase::AccountNumber, psibase::ServiceSchema> schemas;
      const psibase::ServiceSchema* operator()(psibase::AccountNumber service)
      {
         auto pos = schemas.find(service);
         if (pos != schemas.end())
            return &pos->second;

         auto table = UserService::Packages{}.open<UserService::InstalledSchemaTable>();
         if (auto row = table.get(service))
         {
            auto [pos, inserted] = schemas.try_emplace(service, std::move(row->schema));
            return &pos->second;
         }
         return nullptr;
      }
   };
}  // namespace psibase
