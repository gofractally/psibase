#pragma once

#include <map>
#include <services/user/Packages.hpp>

#include "types.hpp"

namespace UserService
{
   struct SchemaCache
   {
      SchemaCache();
      // The argument list of an event that `user` may read, or null
      const EventSchema* getSchemaType(psibase::AccountNumber user,
                                       psibase::EventDb       db,
                                       psibase::AccountNumber service,
                                       psibase::MethodNumber  event);

      struct CacheEntry
      {
         CacheEntry(const CacheEntry&) = delete;
         CacheEntry(psibase::ServiceSchema&& schema);
         psibase::ServiceSchema schema;
         // filled lazily, by the event's type node in `schema`
         std::map<const psio::schema_types::AnyType*, EventSchema> events;
      };
      static SchemaCache&                          instance();
      std::map<psibase::AccountNumber, CacheEntry> cache;
   };
}  // namespace UserService
