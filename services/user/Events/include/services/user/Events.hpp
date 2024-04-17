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
      std::uint8_t indexNum;
      // TODO: allow indexes over multiple columns
      std::span<const std::uint8_t> columns() const
      {
         if (indexNum == 0xffu)
            return {};
         else
            return {&indexNum, 1};
      }
   };

   // For each db, tracks the lowest event number that has not been indexed.
   struct DbIndexStatus
   {
      std::uint32_t db;
      std::uint64_t nextEventNumber;
   };
   PSIO_REFLECT(DbIndexStatus, db, nextEventNumber);

   using ServiceSchemaTable = psibase::Table<ServiceSchema, &ServiceSchema::service>;
   using DbIndexStatusTable = psibase::Table<DbIndexStatus, &DbIndexStatus::db>;
   using EventsTables       = psibase::ServiceTables<ServiceSchemaTable>;

   struct EventIndex : psibase::Service<EventIndex>
   {
      static constexpr psibase::AccountNumber service{"events"};
      // Sets the schema associated with a service
      void setSchema(const ServiceSchema& schema);
      void indexEvent(std::uint64_t id);
      void send(int i, double d);
      bool indexSome(std::uint32_t db, std::uint32_t max);
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
                method(indexEvent, id),
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
