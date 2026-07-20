#pragma once

#include <map>
#include <services/user/Packages.hpp>

namespace UserService
{
   struct SchemaCache
   {
      SchemaCache();
      const psio::schema_types::CompiledType* getSchemaType(psibase::EventDb       db,
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
      std::map<psibase::AccountNumber, CacheEntry> cache;
   };
}  // namespace UserService
