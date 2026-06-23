#include <services/user/Events.hpp>

#include <psibase/dispatch.hpp>
#include <services/user/EventIndex.hpp>
#include "SchemaCache.hpp"

using namespace psibase;
using namespace psio::schema_types;
using namespace UserService;

void Events::addIndex(psibase::DbId          db,
                      psibase::AccountNumber service,
                      psibase::MethodNumber  event,
                      std::uint8_t           column)
{
   check(getSender() == service, "Wrong sender");
   const CompiledType* type = SchemaCache::instance().getSchemaType(db, service, event);
   check(!!type, "Unknown event");
   check(column < type->children.size(), "Unknown column");
   auto secondary = EventConfig{}.open<SecondaryIndexTable>();
   auto row       = secondary.getIndex<0>().get(std::tuple(db, service, event));
   if (!row)
      row = SecondaryIndexRecord{db, service, event, std::vector{SecondaryIndexInfo{}}};
   // Don't add duplicate indexes
   for (const auto& index : row->indexes)
   {
      if (index.indexNum == column)
         return;
   }
   row->indexes.push_back(SecondaryIndexInfo{column});
   secondary.put(*row);
   to<EventIndex>().withFlags(CallFlags::runModeCallback).update(db, service, event);
}

EventNumber Events::event(EventDb db, psibase::MethodNumber type, std::vector<char> rawData)
{
   auto table = open<EventNumberTable>();
   auto row   = table.get(db).value_or(EventNumberRecord{db, 1});
   auto id    = row.nextEventNumber++;
   table.put(row);
   auto events = openEvents(db, KvMode::write);
   events.put({id, getSender(), type, std::move(rawData)});
   return id;
}

void Events::sync()
{
   to<EventIndex>().withFlags(CallFlags::runModeCallback).sync();
}

PSIBASE_DISPATCH(UserService::EventConfig)
