#include <services/user/Events.hpp>

#include <psibase/Table.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <psio/schema.hpp>
#include <regex>

#include "SchemaCache.hpp"
#include "eventKeys.hpp"
#include "types.hpp"

using namespace psibase;
using namespace psio::schema_types;
using namespace UserService;

void EventIndex::setSchema(const ServiceSchema& schema)
{
   check(getSender() == schema.service, "Wrong sender");
   Events::open<ServiceSchemaTable>(schemaTableNum).put(schema);
}

void EventIndex::addIndex(psibase::DbId          db,
                          psibase::AccountNumber service,
                          psibase::MethodNumber  event,
                          std::uint8_t           column)
{
   auto secondary = Events::open<SecondaryIndexTable>(secondaryIndexSpecTableNum);
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
   // mark the table as dirty
   auto dirtyTable = IndexDirtyTable{
       DbId::writeOnly, psio::convert_to_key(std::tuple(EventIndex::service, indexDirtyTableNum))};
   dirtyTable.put(IndexDirtyRecord{db, service, event});
}

std::uint64_t getNextEventNumber(const DatabaseStatusRow& status, DbId db)
{
   switch (db)
   {
      case DbId::historyEvent:
         return status.nextHistoryEventNumber;
      case DbId::uiEvent:
         return status.nextUIEventNumber;
      case DbId::merkleEvent:
         return status.nextMerkleEventNumber;
      default:
         abortMessage("Not an event db");
   }
}

bool EventIndex::indexSome(psibase::DbId db, std::uint32_t max)
{
   const auto dbStatus = psibase::kvGet<psibase::DatabaseStatusRow>(
       psibase::DatabaseStatusRow::db, psibase::DatabaseStatusRow::key());
   check(!!dbStatus, "DatabaseStatusRow not found");

   auto table = DbIndexStatusTable(
       DbId::writeOnly,
       psio::convert_to_key(std::tuple(EventIndex::service, dbIndexStatusTableNum)));
   auto status = table.getIndex<0>().get(db);
   if (!status)
      status = DbIndexStatus{db, 1};

   std::vector<char> key;
   std::vector<char> data;
   auto              eventNum  = status->nextEventNumber;
   auto              eventEnd  = getNextEventNumber(*dbStatus, db);
   auto&             cache     = SchemaCache::instance();
   auto              secondary = SecondaryIndexTable(
       DbId::writeOnly,
       psio::convert_to_key(std::tuple(EventIndex::service, secondaryIndexTableNum)));
   EventWrapper wrapper(nullptr);
   for (; max != 0 && eventNum != eventEnd; --max, ++eventNum)
   {
      std::uint32_t sz = psibase::raw::getSequential(db, eventNum);
      data.resize(sz);
      psibase::raw::getResult(data.data(), sz, 0);
      if (!psio::fracpack_validate<SequentialRecord<MethodNumber>>(data))
         continue;
      auto [service, type] = psio::from_frac<SequentialRecord<MethodNumber>>(data);
      if (!type)
         continue;
      const CompiledType* ctype = cache.getSchemaType(db, service, *type);
      if (!ctype)
         continue;
      wrapper.set(ctype);

      FracParser parser(psio::FracStream{data}, wrapper.get(), psibase_builtins, false);
      check(parser.next().kind == FracParser::start, "expected start");        // start
      check(parser.next().kind == FracParser::scalar, "expected service");     // service
      check(parser.next().kind == FracParser::scalar, "expected event type");  // type
      auto saved = parser.in;
      // validate remaining data
      if (![&]
          {
             while (auto item = parser.next())
             {
                if (item.kind == FracParser::error)
                   return false;
             }
             return true;
          }())
         continue;

      auto indexes = secondary.getIndex<0>().get(std::tuple(db, service, *type));
      if (!indexes)
         indexes.emplace(SecondaryIndexRecord{.indexes = std::vector{SecondaryIndexInfo{}}});
      for (const auto& index : indexes->indexes)
      {
         psio::vector_stream stream{key};
         to_key(EventIndexTable{db, service, *type}, stream);
         to_key(index.indexNum, stream);
         for (const auto& column : index.columns())
         {
            parser.in = saved;
            parser.parse(ctype);
            parser.push(parser.select_child(column));
            to_key(parser, stream);
         }
         to_key(eventNum, stream);
         psibase::raw::kvPut(DbId::writeOnly, key.data(), key.size(), nullptr, 0);
         key.clear();
      }
   }
   if (eventNum != status->nextEventNumber)
   {
      status->nextEventNumber = eventNum;
      table.put(*status);
   }
   return eventNum != eventEnd;
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

bool Events::processQueue(std::uint32_t maxSteps)
{
   auto queue = PendingIndexTable{DbId::writeOnly, psio::convert_to_key(std::tuple(
                                                       EventIndex::service, pendingIndexTableNum))};

   auto&             cache = SchemaCache::instance();
   EventWrapper      wrapper;
   std::vector<char> data;
   for (auto item : queue.getIndex<0>())
   {
      EventIndexTable id{item.db, item.service, item.event};
      auto            key = psio::convert_to_key(id);
      if (item.add)
      {
         key.push_back(0xff);
      }
      else
      {
         key.push_back(item.info.indexNum);
      }
      auto prefixLen = key.size();
      key.insert(key.end(), item.nextKey.begin(), item.nextKey.end());
      auto processIndex = [&](auto&& f)
      {
         while (maxSteps)
         {
            f();
            --maxSteps;
            key.push_back(0);
            std::uint32_t size =
                psibase::raw::kvGreaterEqual(DbId::writeOnly, key.data(), key.size(), prefixLen);
            if (size == -1)
            {
               return false;
            }
            auto keySize = psibase::raw::getKey(nullptr, 0);
            key.resize(keySize);
            psibase::raw::getKey(key.data(), key.size());
         }
         return true;
      };
      bool more;
      if (item.add)
      {
         const CompiledType* ctype = cache.getSchemaType(item.db, item.service, item.event);
         wrapper.set(ctype);
         std::vector<char> subkey{key.begin(), key.begin() + prefixLen};
         subkey.back() = item.info.indexNum;
         more          = processIndex(
             [&]
             {
                auto eventNum = keyToEventId(key, prefixLen);
                auto sz       = psibase::raw::getSequential(item.db, eventNum);
                if (sz == -1)
                   return;
                data.resize(sz);
                psibase::raw::getResult(data.data(), data.size(), 0);
                FracParser parser{psio::FracStream{data}, wrapper.get(), psibase_builtins, false};
                auto       saved = parser.get_pos(parser.select_child(2));
                psio::vector_stream stream{subkey};
                for (const auto& column : item.info.columns())
                {
                   parser.set_pos(saved);
                   parser.parse(ctype);
                   parser.push(parser.select_child(column));
                   to_key(parser, stream);
                }
                to_key(eventNum, stream);
                psibase::raw::kvPut(DbId::writeOnly, subkey.data(), subkey.size(), nullptr, 0);
                subkey.resize(prefixLen);
                data.clear();
             });
         if (!more)
         {
            // mark index as ready
            auto secondary = SecondaryIndexTable{
                DbId::writeOnly,
                psio::convert_to_key(std::tuple(EventIndex::service, secondaryIndexTableNum))};
            auto row = lookupIndexRecord(secondary, std::tuple(item.db, item.service, item.event));
            row.indexes.push_back(item.info);
            secondary.put(row);
         }
      }
      else
      {
         more = processIndex([&] { psibase::kvRemoveRaw(DbId::writeOnly, key); });
      }
      if (more)
      {
         item.nextKey.assign(key.begin() + prefixLen, key.end());
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

// Checks event tables that have been marked as dirty and
// queues any required index updates.
void queueIndexChanges()
{
   auto objective  = Events::open<SecondaryIndexTable>(secondaryIndexSpecTableNum);
   auto subjective = Events::open<SecondaryIndexTable>(secondaryIndexTableNum);
   auto dirtyTable = IndexDirtyTable{
       DbId::writeOnly, psio::convert_to_key(std::tuple(EventIndex::service, indexDirtyTableNum))};
   auto          queue = PendingIndexTable{DbId::writeOnly, psio::convert_to_key(std::tuple(
                                                       EventIndex::service, pendingIndexTableNum))};
   std::uint64_t nextSeq;
   {
      auto begin = queue.getIndex<0>().begin();
      auto end   = queue.getIndex<0>().end();
      if (begin == end)
         nextSeq = 0;
      else
         nextSeq = (*--end).seq + 1;
   }
   for (auto dirty : dirtyTable.getIndex<0>())
   {
      auto requested      = lookupIndexes(objective, dirty.primaryKey());
      auto existingRecord = lookupIndexRecord(subjective, dirty.primaryKey());
      auto existing       = existingRecord.indexes;
      for (const auto& pending : queue.getIndex<1>().subindex(dirty.primaryKey()))
      {
         if (pending.add)
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
            PendingIndexRecord queueItem{nextSeq, dirty.db, dirty.service, dirty.event, info, add};
            auto               existing = queue.getIndex<1>().get(queueItem.byIndex());
            if (existing && existing->add != add)
            {
               // cancel pending opposite operation on the same index
               queue.remove(*existing);
               existing.reset();
            }
            if (!existing)
            {
               auto key =
                   psio::convert_to_key(EventIndexTable{dirty.db, dirty.service, dirty.event});
               if (add)
               {
                  key.push_back(0xFF);
               }
               else
               {
                  key.push_back(info.indexNum);
               }
               std::uint32_t size = psibase::raw::kvGreaterEqual(DbId::writeOnly, key.data(),
                                                                 key.size(), key.size());
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
         subjective.put(existingRecord);
      }
      dirtyTable.remove(dirty);
   }
}

void Events::sync()
{
   while (indexSome(DbId::historyEvent, 0xffffffffu))
   {
   }
   while (indexSome(DbId::merkleEvent, 0xffffffffu))
   {
   }
}

void Events::onBlock()
{
   queueIndexChanges();
   processQueue(1000);
}

PSIBASE_DISPATCH(UserService::EventIndex)
