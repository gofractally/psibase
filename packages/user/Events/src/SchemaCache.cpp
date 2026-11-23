#include "SchemaCache.hpp"

#include <services/user/Events.hpp>
#include "types.hpp"

using namespace psibase;

namespace UserService
{
   SchemaCache::SchemaCache() {}
   const EventSchema* SchemaCache::getSchemaType(AccountNumber user,
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
         auto  found = entry.events.find(type);
         if (found == entry.events.end())
            found = entry.events.emplace(type, makeEventSchema(entry.schema.types, *type)).first;
         return &found->second;
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
