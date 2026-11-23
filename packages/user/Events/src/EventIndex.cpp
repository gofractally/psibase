#include <services/user/EventIndex.hpp>

#include <psibase/Table.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <regex>
#include <services/user/Events.hpp>

#include "SchemaCache.hpp"
#include "eventKeys.hpp"
#include "types.hpp"

using namespace psibase;
using namespace UserService;

void EventIndex::update(EventDb db, psibase::AccountNumber service, psibase::MethodNumber event)
{
   // mark the table as dirty
   auto dirtyTable = EventIndex{}.open<IndexDirtyTable>();
   dirtyTable.put(IndexDirtyRecord{db, service, event});
}

namespace
{
   std::uint64_t getNextEventNumber(EventDb db)
   {
      if (auto row = EventConfig{}.open<EventNumberTable>(KvMode::read).get(db))
      {
         return row->nextEventNumber;
      }
      else
      {
         return 1;
      }
   }

   std::vector<SecondaryIndexInfo> lookupIndexes(const SecondaryIndexTable& table, auto&& key)
   {
      if (auto row = table.getIndex<0>().get(key))
         return std::move(row->indexes);
      return {SecondaryIndexInfo{}};
   }

   SecondaryIndexRecord lookupIndexRecord(const SecondaryIndexTable& table, auto&& key)
   {
      if (auto row = table.getIndex<0>().get(key))
         return std::move(*row);
      auto [db, service, event] = key;
      return {db, service, event, {SecondaryIndexInfo{}}};
   }

   // Appends the key (psio::key) of one column of a decoded event
   void columnToKey(const EventSchema&          type,
                    const psio::pssz_ir::Value& event,
                    std::uint8_t                column,
                    std::vector<char>&          key)
   {
      check(column < type.columns.size(), "Unknown column");
      const auto& member = eventMember(event, column);
      if (auto status =
              psio::pssz_ir::to_key(*type.types, *type.columns[column].type, member, key);
          !status.ok())
         abortMessage("Cannot index column " + type.columns[column].name + ": " +
                      std::string(status.error().what));
   }

   struct IndexWriter
   {
      std::vector<char>   key;
      std::vector<char>   data;
      SchemaCache&        cache = SchemaCache::instance();
      SecondaryIndexTable secondary{
          DbId::writeOnly,
          psio::encode(psio::key{}, std::tuple(EventIndex::service, secondaryIndexTableNum))};
      EventIndexHandle handle{KvMode::write};
      bool             operator()(EventTable& events, EventDb db, std::uint64_t eventNum)
      {
         auto row = events.getView(eventNum);
         if (!row)
            return false;

         const EventSchema* type =
             cache.getSchemaType({}, db, (*row)->service(), (*row)->type());
         if (!type)
            return true;

         // An event whose bytes are not its argument list is not indexed
         psio::pssz_ir::Value value;
         if (!decodeEvent(*type, (*row)->rawData(), value))
            return true;

         auto indexes = secondary.getIndex<0>().get(
             std::tuple(db, (*row)->service().unpack(), (*row)->type().unpack()));
         if (!indexes)
            indexes.emplace(SecondaryIndexRecord{.indexes = std::vector{SecondaryIndexInfo{}}});
         for (const auto& index : indexes->indexes)
         {
            psio::to_key(EventIndexTable{db, (*row)->service(), (*row)->type()}, key);
            psio::to_key(index.indexNum, key);
            for (const auto& column : index.columns())
               columnToKey(*type, value, column, key);
            psio::to_key(eventNum, key);
            psibase::raw::kvPut(handle, key.data(), key.size(), nullptr, 0);
            key.clear();
         }
         return true;
      }
   };

   bool processInit(EventDb db, std::uint32_t& max_steps, std::uint64_t& end)
   {
      IndexWriter writer;
      auto        events = Events{}.openEvents(db, KvMode::read);
      for (; max_steps; --max_steps)
      {
         if (--end == 0)
         {
            return false;
         }
         if (!writer(events, db, end))
            return false;
      }
      return true;
   }

   bool processIndex(std::uint32_t& maxSteps, PendingIndexRecord& item)
   {
      EventIndexTable id{item.db, item.service, item.event};
      auto            handle = EventIndexHandle{KvMode::readWrite};
      auto            key    = psio::encode(psio::key{}, id);
      if (item.endKey != 0)
      {
         key.push_back(0xff);
      }
      else
      {
         key.push_back(item.info.indexNum);
      }
      auto prefixLen = key.size();
      key.insert(key.end(), item.nextKey.begin(), item.nextKey.end());
      auto processRows = [&](auto&& f)
      {
         while (maxSteps)
         {
            if (!f())
               return false;
            --maxSteps;
            key.push_back(0);
            std::uint32_t size =
                psibase::raw::kvGreaterEqual(handle, key.data(), key.size(), prefixLen);
            if (size == -1)
            {
               return false;
            }
            auto keySize = psibase::raw::getKey(nullptr, 0);
            key.resize(keySize);
            psibase::raw::getKey(key.data(), key.size());
         }
         item.nextKey.assign(key.begin() + prefixLen, key.end());
         return true;
      };
      if (item.endKey != 0)
      {
         auto&              cache  = SchemaCache::instance();
         auto               events = EventConfig{}.openEvents(item.db, KvMode::read);
         const EventSchema* type   = cache.getSchemaType({}, item.db, item.service, item.event);
         std::vector<char>  subkey{key.begin(), key.begin() + prefixLen};
         subkey.back() = item.info.indexNum;
         bool more     = processRows(
             [&]
             {
                auto eventNum = keyToEventId(key, prefixLen);
                if (eventNum >= item.endKey)
                   return false;
                auto event = events.getView(eventNum);
                if (!event || !type)
                   return true;
                psio::pssz_ir::Value value;
                if (!decodeEvent(*type, (*event)->rawData(), value))
                   return true;
                for (const auto& column : item.info.columns())
                   columnToKey(*type, value, column, subkey);
                psio::to_key(eventNum, subkey);
                psibase::raw::kvPut(handle, subkey.data(), subkey.size(), nullptr, 0);
                subkey.resize(prefixLen);
                return true;
             });
         if (!more)
         {
            // mark index as ready
            auto secondary = SecondaryIndexTable{
                DbId::writeOnly,
                psio::encode(psio::key{},
                             std::tuple(EventIndex::service, secondaryIndexReadyTableNum)),
                KvMode::readWrite};
            auto row = lookupIndexRecord(secondary, std::tuple(item.db, item.service, item.event));
            row.indexes.push_back(item.info);
            secondary.put(row);
         }
         return more;
      }
      else
      {
         return processRows(
             [&]
             {
                psibase::kvRemoveRaw(handle, key);
                return true;
             });
      }
   }

   bool processQueue(std::uint32_t maxSteps)
   {
      auto queue = EventIndex{}.open<PendingIndexTable>();

      for (auto item : queue.getIndex<0>())
      {
         bool more = (item.endKey != 0 && item.nextKey.empty())
                         ? processInit(item.db, maxSteps, item.endKey)
                         : processIndex(maxSteps, item);
         if (more)
         {
            queue.put(item);
            return true;
         }
         else
         {
            queue.remove(item);
         }
      }
      return false;
   }

   DbIndexStatus initStatus(DbIndexStatusTable& table, EventDb db)
   {
      if (auto result = table.get(db))
         return *result;

      auto queue = EventIndex{}.open<PendingIndexTable>();

      auto queueRow = PendingIndexRecord{.seq = 0, .db = db, .endKey = getNextEventNumber(db)};
      // Find the first available sequence number
      {
         if (auto last = queue.getIndex<0>().last())
            queueRow.seq = (*last).seq + 1;
      }
      queue.put(queueRow);
      DbIndexStatus result{.db = db, .nextEventNumber = queueRow.endKey};
      table.put(result);
      return result;
   }
}  // namespace

// Checks event tables that have been marked as dirty and
// queues any required index updates.
void queueIndexChanges()
{
   auto status          = EventIndex{}.open<DbIndexStatusTable>().getIndex<0>();
   auto getNextEventNum = [&](EventDb db)
   {
      if (auto result = status.get(db))
         return result->nextEventNumber;
      return static_cast<std::uint64_t>(1);
   };

   auto objective  = EventConfig{}.open<SecondaryIndexTable>();
   auto subjective = EventIndex{}.open<DbId::writeOnly, secondaryIndexTableNum>();
   auto ready      = EventIndex{}.open<DbId::writeOnly, secondaryIndexReadyTableNum>();
   auto dirtyTable = EventIndex{}.open<IndexDirtyTable>();
   auto queue      = EventIndex{}.open<PendingIndexTable>();

   auto handle = EventIndexHandle{KvMode::read};

   std::uint64_t nextSeq;
   {
      if (auto last = queue.getIndex<0>().last())
         nextSeq = last->seq + 1;
      else
         nextSeq = 0;
   }
   for (auto dirty : dirtyTable.getIndex<0>())
   {
      auto requestRecord = lookupIndexRecord(objective, dirty.primaryKey());
      subjective.put(requestRecord);
      auto requested      = requestRecord.indexes;
      auto existingRecord = lookupIndexRecord(ready, dirty.primaryKey());
      auto existing       = existingRecord.indexes;
      for (const auto& pending : queue.getIndex<1>().subindex(dirty.primaryKey()))
      {
         if (pending.endKey != 0)
         {
            existing.push_back(pending.info);
         }
      }
      // TODO: apply subjective filters
      std::vector<SecondaryIndexInfo> added;
      std::vector<SecondaryIndexInfo> removed;
      std::ranges::sort(requested);
      std::ranges::sort(existing);
      std::ranges::set_difference(existing, requested, std::back_inserter(removed));
      std::ranges::set_difference(requested, existing, std::back_inserter(added));
      bool completedSome      = false;
      auto processDifferences = [&](const auto& items, bool add)
      {
         for (const auto& info : items)
         {
            PendingIndexRecord queueItem{nextSeq, dirty.db, dirty.service, dirty.event, info};
            if (add)
            {
               queueItem.endKey = getNextEventNum(dirty.db);
            }
            auto existing = queue.getIndex<1>().get(queueItem.byIndex());
            if (existing && (existing->endKey != 0) != add)
            {
               // cancel pending opposite operation on the same index
               queue.remove(*existing);
               existing.reset();
            }
            if (!existing)
            {
               auto key =
                   psio::encode(psio::key{}, EventIndexTable{dirty.db, dirty.service, dirty.event});
               if (add)
               {
                  key.push_back(0xFF);
               }
               else
               {
                  key.push_back(info.indexNum);
               }
               std::uint32_t size =
                   psibase::raw::kvGreaterEqual(handle, key.data(), key.size(), key.size());
               if (!add)
               {
                  std::erase(existingRecord.indexes, info);
                  completedSome = true;
               }
               if (size == -1)
               {
                  if (add)
                  {
                     existingRecord.indexes.push_back(info);
                     completedSome = true;
                  }
               }
               else
               {
                  queueItem.nextKey = psibase::getKey();
                  queueItem.nextKey.erase(queueItem.nextKey.begin(),
                                          queueItem.nextKey.begin() + key.size());
                  queue.put(queueItem);
                  ++nextSeq;
               }
            }
         }
      };
      processDifferences(added, true);
      processDifferences(removed, false);
      if (completedSome)
      {
         std::ranges::sort(existingRecord.indexes);
         ready.put(existingRecord);
      }
      dirtyTable.remove(dirty);
   }
}

void EventIndex::sync()
{
   auto        table = EventIndex{}.open<DbIndexStatusTable>();
   IndexWriter writer;
   for (auto db : {EventDb::historyEvent, EventDb::merkleEvent})
   {
      auto events = Events{}.openEvents(db, KvMode::read);
      auto status = initStatus(table, db);

      auto eventNum = status.nextEventNumber;
      auto eventEnd = getNextEventNumber(db);
      for (; eventNum != eventEnd; ++eventNum)
      {
         if (!writer(events, db, eventNum))
            abortMessage(std::format("Missing event {}", eventNum));
      }
      if (eventNum != status.nextEventNumber)
      {
         status.nextEventNumber = eventNum;
         table.put(status);
      }
   }
}

void EventIndex::onBlock()
{
   queueIndexChanges();
   processQueue(1000);
}

PSIBASE_DISPATCH(UserService::EventIndex)
