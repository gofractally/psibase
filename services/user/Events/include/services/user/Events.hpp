#pragma once

#include <algorithm>
#include <map>
#include <psibase/AccountNumber.hpp>
#include <psibase/MethodNumber.hpp>
#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/db.hpp>
#include <psio/reflect.hpp>
#include <psio/schema.hpp>
#include <string>
#include <vector>

namespace UserService
{

   struct ServiceSchema
   {
      psibase::AccountNumber service;
      psio::Schema           schema;
      using EventMap = std::map<psibase::MethodNumber, psio::schema_types::AnyType>;
      EventMap ui;
      EventMap history;
      EventMap merkle;
      //
      const EventMap* getDb(psibase::DbId db) const
      {
         switch (db)
         {
            case psibase::DbId::uiEvent:
               return &ui;
            case psibase::DbId::merkleEvent:
               return &merkle;
            case psibase::DbId::historyEvent:
               return &history;
            default:
               return nullptr;
         }
      }
      const psio::schema_types::AnyType* getType(psibase::DbId db, psibase::MethodNumber event)
      {
         if (const auto* types = getDb(db))
            if (auto pos = types->find(event); pos != types->end())
               return &pos->second;
         return nullptr;
      }
      std::vector<const psio::schema_types::AnyType*> types() const
      {
         std::vector<const psio::schema_types::AnyType*> result;
         for (const auto* m : {&ui, &history, &merkle})
         {
            for (const auto& [_, type] : *m)
            {
               result.push_back(&type);
            }
         }
         return result;
      }
   };
   PSIO_REFLECT(ServiceSchema, service, schema, ui, history, merkle)

   struct SecondaryIndexInfo
   {
      std::uint8_t indexNum = 0xff;
      // TODO: allow indexes over multiple columns
      std::span<const std::uint8_t> columns() const
      {
         if (indexNum == 0xffu)
            return {};
         else
            return {&indexNum, 1};
      }
      int getPos() const
      {
         if (indexNum == 0xff)
            return 0;
         else
            return indexNum + 1;
      }
      friend auto operator<=>(const SecondaryIndexInfo&, const SecondaryIndexInfo&) = default;
   };
   PSIO_REFLECT(SecondaryIndexInfo, indexNum)

   struct SecondaryIndexRecord
   {
      psibase::DbId                   db;
      psibase::AccountNumber          service;
      psibase::MethodNumber           event;
      std::vector<SecondaryIndexInfo> indexes;
      auto                            primaryKey() const { return std::tuple(db, service, event); }
   };
   PSIO_REFLECT(SecondaryIndexRecord, db, service, event, indexes);

   // The queue of indexes being added or removed
   struct PendingIndexRecord
   {
      std::uint64_t          seq;
      psibase::DbId          db;
      psibase::AccountNumber service;
      psibase::MethodNumber  event;
      SecondaryIndexInfo     info;
      bool                   add;
      std::vector<char>      nextKey;
      auto                   byIndex() const { return std::tuple(db, service, event, info); }
   };
   PSIO_REFLECT(PendingIndexRecord, seq, db, service, event, info, add, nextKey)

   // For each db, tracks the lowest event number that has not been indexed.
   struct DbIndexStatus
   {
      psibase::DbId db;
      std::uint64_t nextEventNumber;
   };
   PSIO_REFLECT(DbIndexStatus, db, nextEventNumber);

   // Used to pass information about index changes from objective to subjective.
   //
   // Whenever an index is added or removed, a row in this table is created.
   // onBlock will clear entries as it processes them.
   struct IndexDirtyRecord
   {
      psibase::DbId          db;
      psibase::AccountNumber service;
      psibase::MethodNumber  event;
      auto                   primaryKey() const { return std::tuple(db, service, event); }
   };
   PSIO_REFLECT(IndexDirtyRecord, db, service, event)

   using ServiceSchemaTable = psibase::Table<ServiceSchema, &ServiceSchema::service>;
   using DbIndexStatusTable = psibase::Table<DbIndexStatus, &DbIndexStatus::db>;
   using SecondaryIndexTable =
       psibase::Table<SecondaryIndexRecord, &SecondaryIndexRecord::primaryKey>;
   using PendingIndexTable =
       psibase::Table<PendingIndexRecord, &PendingIndexRecord::seq, &PendingIndexRecord::byIndex>;
   using IndexDirtyTable = psibase::Table<IndexDirtyRecord, &IndexDirtyRecord::primaryKey>;
   using EventsTables    = psibase::ServiceTables<ServiceSchemaTable, SecondaryIndexTable>;

   // These are stored in the writeOnly database
   constexpr std::uint16_t dbIndexStatusTableNum{0};
   constexpr std::uint16_t eventIndexesNum{1};
   constexpr std::uint16_t secondaryIndexTableNum{2};
   constexpr std::uint16_t pendingIndexTableNum{3};
   constexpr std::uint16_t indexDirtyTableNum{4};

   struct EventIndex : psibase::Service<EventIndex>
   {
      static constexpr psibase::AccountNumber service{"events"};
      // Sets the schema associated with a service
      void setSchema(const ServiceSchema& schema);
      // Adds an index.
      // TODO: Add existing rows to the index
      // TODO: There should be a way to construct the index concurrently.
      void addIndex(psibase::DbId          db,
                    psibase::AccountNumber service,
                    psibase::MethodNumber  event,
                    std::uint8_t           column);
      // Temporary for testing
      void send(int i, double d);
      // returns true if there is more to do
      bool indexSome(psibase::DbId db, std::uint32_t max);
      // Applies pending index changes
      bool processQueue(std::uint32_t maxSteps);
      // Runs in subjective mode at the end of each block
      void onBlock();
      // Standard HTTP API
      std::optional<psibase::HttpReply> serveSys(const psibase::HttpRequest&);
      struct Events
      {
         struct Ui
         {
         };
         struct History
         {
            void testEvent(int32_t i, double d) {}
         };
         struct Merkle
         {
         };
      };
   };
   PSIO_REFLECT(EventIndex,
                method(setSchema, schema),
                method(addIndex, db, service, event, column),
                method(send, i),
                method(indexSome, db, maxRows),
                method(onBlock),
                method(serveSys, request))

   PSIBASE_REFLECT_EVENTS(EventIndex);
   PSIBASE_REFLECT_HISTORY_EVENTS(EventIndex, method(testEvent, i));
   PSIBASE_REFLECT_UI_EVENTS(EventIndex);
   PSIBASE_REFLECT_MERKLE_EVENTS(EventIndex);
   using Events = EventIndex;
}  // namespace UserService
