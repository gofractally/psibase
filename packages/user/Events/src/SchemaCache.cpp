#include "SchemaCache.hpp"

#include <services/user/Events.hpp>
#include "types.hpp"

using namespace psibase;
using namespace psio::schema_types;

namespace UserService
{
   SchemaCache::SchemaCache() {}
   const CompiledType* SchemaCache::getSchemaType(EventDb       db,
                                                  AccountNumber service,
                                                  MethodNumber  event)
   {
      auto pos = cache.find(service);
      if (pos == cache.end())
      {
         if (auto schema = to<Packages>().getSchema(service))
         {
            pos = cache.try_emplace(service, std::move(*schema)).first;
         }
         else
         {
            return nullptr;
         }
      }
      if (auto type = pos->second.schema.getType(db, event))
         return pos->second.cschema.get(type);
      return nullptr;
   }

   SchemaCache::CacheEntry::CacheEntry(ServiceSchema&& schema)
       : schema(std::move(schema)),
         cschema(this->schema.types, psibase_builtins, this->schema.eventTypes())
   {
   }

   SchemaCache& SchemaCache::instance()
   {
      static SchemaCache result{};
      return result;
   }
}  // namespace UserService
