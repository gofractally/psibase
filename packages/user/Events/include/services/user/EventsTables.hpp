#pragma once

#include <cstdint>
#include <psibase/AccountNumber.hpp>
#include <psibase/MethodNumber.hpp>
#include <psibase/Table.hpp>
#include <psibase/db.hpp>
#include <psibase/schema.hpp>
#include <psio/reflect.hpp>
#include <span>
#include <vector>

namespace UserService
{
   using psibase::ServiceSchema;

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
      using PrimaryKey = psibase::CompositeKey<&SecondaryIndexRecord::db,
                                               &SecondaryIndexRecord::service,
                                               &SecondaryIndexRecord::event>;
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
      using ByIndex = psibase::CompositeKey<&PendingIndexRecord::db,
                                            &PendingIndexRecord::service,
                                            &PendingIndexRecord::event,
                                            &PendingIndexRecord::info>;
      auto byIndex() const { return ByIndex{}(*this); }
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
      using PrimaryKey = psibase::
          CompositeKey<&IndexDirtyRecord::db, &IndexDirtyRecord::service, &IndexDirtyRecord::event>;
      auto primaryKey() const { return PrimaryKey{}(*this); }
   };
   PSIO_REFLECT(IndexDirtyRecord, db, service, event)

   using ServiceSchemaTable = psibase::Table<ServiceSchema, &ServiceSchema::service>;
   using DbIndexStatusTable = psibase::Table<DbIndexStatus, &DbIndexStatus::db>;
   PSIO_REFLECT_TYPENAME(DbIndexStatusTable)
   using SecondaryIndexTable =
       psibase::Table<SecondaryIndexRecord, SecondaryIndexRecord::PrimaryKey{}>;
   PSIO_REFLECT_TYPENAME(SecondaryIndexTable)
   using PendingIndexTable =
       psibase::Table<PendingIndexRecord, &PendingIndexRecord::seq, PendingIndexRecord::ByIndex{}>;
   PSIO_REFLECT_TYPENAME(PendingIndexTable)
   using IndexDirtyTable = psibase::Table<IndexDirtyRecord, IndexDirtyRecord::PrimaryKey{}>;
   PSIO_REFLECT_TYPENAME(IndexDirtyTable)

   using EventsTables =
       psibase::WriteOnlyTables<DbIndexStatusTable,
                                void,  // The actual indexes are not a regular table
                                SecondaryIndexTable,
                                PendingIndexTable,
                                IndexDirtyTable,
                                void,  // objective
                                ServiceSchemaTable,
                                SecondaryIndexTable>;

   constexpr std::uint16_t eventIndexesNum{1};
   // There are three copies of the list of secondary indexes:
   // - spec: The indexes requested by services
   // - all: Derived from spec by applying subjective rules
   // - ready: A subset of all containing only indexes that are fully synced
   constexpr std::uint16_t secondaryIndexTableNum{2};
   //constexpr std::uint16_t secondaryIndexSpecTableNum{5};
   constexpr std::uint16_t secondaryIndexReadyTableNum{7};

}  // namespace UserService

namespace psibase
{
   PSIO_REFLECT_TYPENAME(UserService::ServiceSchemaTable)
}
