#include "SchemaCache.hpp"

#include "types.hpp"

using namespace psibase;
using namespace psio::schema_types;

namespace UserService
{
   SchemaCache::SchemaCache(ServiceSchemaTable table) : table(std::move(table)) {}
   const CompiledType* SchemaCache::getSchemaType(DbId          db,
                                                  AccountNumber service,
                                                  MethodNumber  event)
   {
      auto pos = cache.find(service);
      if (pos == cache.end())
      {
         if (auto schema = table.getIndex<0>().get(service))
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
         cschema(this->schema.schema, psibase_builtins, this->schema.types())
   {
   }

   SchemaCache& SchemaCache::instance()
   {
      static SchemaCache result{EventsTables{AccountNumber{"events"}}.open<ServiceSchemaTable>()};
      return result;
   }
}  // namespace UserService
