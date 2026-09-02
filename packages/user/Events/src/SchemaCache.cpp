#include "SchemaCache.hpp"

#include <services/user/Events.hpp>
#include "types.hpp"

using namespace psibase;
using namespace psio::schema_types;

namespace UserService
{
   SchemaCache::SchemaCache() {}
   const CompiledType* SchemaCache::getSchemaType(AccountNumber user,
                                                  EventDb       db,
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
      bool canReadPrivate = user == AccountNumber{} || user.base() == service.base();
      if (auto type = pos->second.schema.getType(canReadPrivate, db, event))
      {
         auto& entry = pos->second;
         if (!entry.cschema)
         {
            entry.cschema.emplace(entry.schema.types, psibase_builtins, entry.schema.eventTypes());
         }
         return entry.cschema->get(type);
      }
      return nullptr;
   }

   SchemaCache::CacheEntry::CacheEntry(ServiceSchema&& schema) : schema(std::move(schema)) {}

   SchemaCache& SchemaCache::instance()
   {
      static SchemaCache result{};
      return result;
   }
}  // namespace UserService
