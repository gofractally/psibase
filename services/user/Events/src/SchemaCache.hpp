#pragma once

#include <map>
#include <services/user/EventsTables.hpp>

namespace UserService
{
   struct SchemaCache
   {
      explicit SchemaCache(ServiceSchemaTable table);
      const psio::schema_types::CompiledType* getSchemaType(psibase::DbId          db,
                                                            psibase::AccountNumber service,
                                                            psibase::MethodNumber  event);

      struct CacheEntry
      {
         CacheEntry(const CacheEntry&) = delete;
         CacheEntry(ServiceSchema&& schema);
         ServiceSchema                      schema;
         psio::schema_types::CompiledSchema cschema;
      };
      static SchemaCache&                          instance();
      ServiceSchemaTable                           table;
      std::map<psibase::AccountNumber, CacheEntry> cache;
   };
}  // namespace UserService
