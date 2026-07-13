#include <services/user/Events.hpp>

#include <psibase/dispatch.hpp>
#include <services/system/Transact.hpp>
#include <services/user/EventIndex.hpp>
#include "SchemaCache.hpp"

using namespace psibase;
using namespace psio::schema_types;
using namespace UserService;
using namespace SystemService;

namespace
{
   bool    merkleSaved = false;
   Merkle& getMerkle()
   {
      check(!merkleSaved,
            "Merkle events cannot be published after the state has already been saved");
      auto fn = []
      {
         if (auto row = Events{}.open<EventMerkleTable>().get({}))
            return std::move(row->merkle);
         else
            abortMessage(
                "Merkle events cannot be published before the events service is initialized");
      };
      static Merkle result = fn();
      return result;
   }
}  // namespace

void Events::init()
{
   auto table = open<EventMerkleTable>();
   if (!table.get({}))
      table.put({});
}

void Events::addIndex(psibase::EventDb       db,
                      psibase::AccountNumber service,
                      psibase::MethodNumber  event,
                      std::uint8_t           column)
{
   check(getSender() == service, "Wrong sender");
   const CompiledType* type = SchemaCache::instance().getSchemaType({}, db, service, event);
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
   auto value  = EventRecord{id, getSender(), type, std::move(rawData)};
   events.put(value);
   if (db == EventDb::merkleEvent)
   {
      getMerkle().push(value);
   }
   return id;
}

Checksum256 Events::saveMerkle()
{
   check(getSender() == Transact::service, "wrong sender");
   auto& m = getMerkle();
   open<EventMerkleTable>().put({m});
   merkleSaved = true;
   return m.root();
}

void Events::startBlock()
{
   check(getSender() == Transact::service, "wrong sender");
   open<EventMerkleTable>().put({});
}

void Events::sync()
{
   to<EventIndex>().withFlags(CallFlags::runModeCallback).sync();
}

PSIBASE_DISPATCH(UserService::EventConfig)
