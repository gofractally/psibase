#pragma once

#include <map>
#include <services/user/Packages.hpp>

namespace UserService
{
   struct SchemaCache
   {
      explicit SchemaCache(InstalledSchemaTable table);
      const psio::schema_types::CompiledType* getSchemaType(psibase::DbId          db,
                                                            psibase::AccountNumber service,
                                                            psibase::MethodNumber  event);

      struct CacheEntry
      {
         CacheEntry(const CacheEntry&) = delete;
         CacheEntry(psibase::ServiceSchema&& schema);
         psibase::ServiceSchema             schema;
         psio::schema_types::CompiledSchema cschema;
      };
      static SchemaCache&                          instance();
      InstalledSchemaTable                         table;
      std::map<psibase::AccountNumber, CacheEntry> cache;
   };
}  // namespace UserService
