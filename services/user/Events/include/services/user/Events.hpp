#pragma once

#include <algorithm>
#include <map>
#include <psibase/AccountNumber.hpp>
#include <psibase/MethodNumber.hpp>
#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/check.hpp>
#include <psibase/db.hpp>
#include <psio/reflect.hpp>
#include <psio/schema.hpp>
#include <string>
#include <vector>

namespace UserService
{

   struct ServiceSchema
   {
      psibase::AccountNumber                                       service;
      psio::Schema                                                 schema;
      std::map<psibase::MethodNumber, psio::schema_types::AnyType> ui;
      std::map<psibase::MethodNumber, psio::schema_types::AnyType> history;
      std::map<psibase::MethodNumber, psio::schema_types::AnyType> merkle;
      const auto&                                                  getDb(psibase::DbId db) const
      {
         switch (db)
         {
            case psibase::DbId::uiEvent:
               return ui;
            case psibase::DbId::merkleEvent:
               return merkle;
            case psibase::DbId::historyEvent:
               return history;
            default:
               psibase::abortMessage("Not an event db");
         }
      }
      const psio::schema_types::AnyType* getType(psibase::DbId db, psibase::MethodNumber event)
      {
         const auto& types = getDb(db);
         if (auto pos = types.find(event); pos != types.end())
            return &pos->second;
         else
            psibase::abortMessage("Unknown event type");
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

   using ServiceSchemaTable = psibase::Table<ServiceSchema, &ServiceSchema::service>;
   using EventsTables = psibase::ServiceTables<ServiceSchemaTable /* 1 reserved for indexes */>;

   struct EventIndex : psibase::Service<EventIndex>
   {
      static constexpr psibase::AccountNumber service{"events"};
      void                                    setSchema(const ServiceSchema& schema);
      void                                    indexEvent(std::uint64_t id);
      void                                    send(int i);
      std::optional<psibase::HttpReply>       serveSys(const psibase::HttpRequest&);
      struct Events
      {
         struct Ui
         {
         };
         struct History
         {
            void testEvent(int32_t i) {}
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
                method(serveSys, request))

   PSIBASE_REFLECT_EVENTS(EventIndex);
   PSIBASE_REFLECT_HISTORY_EVENTS(EventIndex, method(testEvent, i));
   PSIBASE_REFLECT_UI_EVENTS(EventIndex);
   PSIBASE_REFLECT_MERKLE_EVENTS(EventIndex);
   using Events = EventIndex;
}  // namespace UserService
