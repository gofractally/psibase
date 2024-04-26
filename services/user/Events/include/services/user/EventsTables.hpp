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

      template <typename T>
      static void makeEvents(psio::SchemaBuilder&                       builder,
                             EventMap&                                  out,
                             std::vector<psio::schema_types::AnyType*>& eventTypes)
      {
         psio::reflect<T>::for_each(
             [&](const psio::meta& ref, auto member)
             {
                using m = psio::MemberPtrType<decltype(member(std::declval<T*>()))>;
                if constexpr (m::isFunction)
                {
                   psio::schema_types::Object type;
                   auto                       nameIter = ref.param_names.begin();
                   auto                       nameEnd  = ref.param_names.end();
                   auto                       i        = ref.param_names.size();
                   forEachType(typename m::SimplifiedArgTypes{},
                               [&](auto* t)
                               {
                                  std::string name =
                                      nameIter == nameEnd ? "c" + std::to_string(i++) : *nameIter++;
                                  type.members.push_back(
                                      {std::move(name),
                                       builder.insert<std::remove_pointer_t<decltype(t)>>()});
                               });
                   auto [pos, inserted] =
                       out.try_emplace(psibase::MethodNumber{ref.name}, std::move(type));
                   if (inserted)
                   {
                      eventTypes.push_back(&pos->second);
                   }
                }
             });
      }

      template <typename T>
      static ServiceSchema make()
      {
         ServiceSchema                             result{.service = T::service};
         std::vector<psio::schema_types::AnyType*> eventTypes;
         psio::SchemaBuilder                       builder;
         if constexpr (requires { typename T::Events::Ui; })
         {
            makeEvents<typename T::Events::Ui>(builder, result.ui, eventTypes);
         }
         if constexpr (requires { typename T::Events::History; })
         {
            makeEvents<typename T::Events::History>(builder, result.history, eventTypes);
         }
         if constexpr (requires { typename T::Events::Merkle; })
         {
            makeEvents<typename T::Events::Merkle>(builder, result.merkle, eventTypes);
         }
         result.schema = std::move(builder).build(eventTypes);
         return result;
      }
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
               return pos->second.resolve(schema);
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
      // There are three different operations that might be queued:
      // Init: nextKey.size() == 0, endKey > 0, operates in reverse order
      // Add: nextKey.size() == 8, endKey > 0
      // Remove: endKey == 0
      std::vector<char> nextKey;
      std::uint64_t     endKey;
      auto              byIndex() const { return std::tuple(db, service, event, info); }
   };
   PSIO_REFLECT(PendingIndexRecord, seq, db, service, event, info, nextKey, endKey)

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

   // These are stored in the writeOnly database
   constexpr std::uint16_t dbIndexStatusTableNum{0};
   constexpr std::uint16_t eventIndexesNum{1};
   // There are three copies of the list of secondary indexes:
   // - spec: The indexes requested by services
   // - all: Derived from spec by applying subjective rules
   // - ready: A subset of all containing only indexes that are fully synced
   constexpr std::uint16_t secondaryIndexTableNum{2};
   constexpr std::uint16_t pendingIndexTableNum{3};
   constexpr std::uint16_t indexDirtyTableNum{4};
   constexpr std::uint16_t secondaryIndexSpecTableNum{5};
   constexpr std::uint16_t schemaTableNum{6};
   constexpr std::uint16_t secondaryIndexReadyTableNum{7};

}  // namespace UserService
