#pragma once

#include <compare>
#include <psibase/Service.hpp>
#include <psibase/Table.hpp>

namespace TestService
{
   struct SingleKeyRow
   {
      int         key;
      int         value;
      friend auto operator<=>(const SingleKeyRow&, const SingleKeyRow&) = default;
   };
   PSIO_REFLECT(SingleKeyRow, key, value)
   using SingleKeyTable = psibase::Table<SingleKeyRow, &SingleKeyRow::key>;
   PSIO_REFLECT_TYPENAME(SingleKeyTable)

   struct MultiKeyRow
   {
      int         key1;
      int         key2;
      int         value;
      friend auto operator<=>(const MultiKeyRow&, const MultiKeyRow&) = default;
   };
   PSIO_REFLECT(MultiKeyRow, key1, key2, value);
   using MultiKeyTable = psibase::Table<MultiKeyRow, &MultiKeyRow::key1, &MultiKeyRow::key2>;
   PSIO_REFLECT_TYPENAME(MultiKeyTable)

   struct CompoundKeyRow
   {
      int key1;
      int key2;
      int value;
      using CompoundKey = psibase::CompositeKey<&CompoundKeyRow::key2, &CompoundKeyRow::key1>;
      friend auto operator<=>(const CompoundKeyRow&, const CompoundKeyRow&) = default;
   };
   PSIO_REFLECT(CompoundKeyRow, key1, key2, value);
   using CompoundKeyTable =
       psibase::Table<CompoundKeyRow, &CompoundKeyRow::key1, CompoundKeyRow::CompoundKey{}>;
   PSIO_REFLECT_TYPENAME(CompoundKeyTable)

   struct TestTable : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"test-table"};
      using Tables = psibase::ServiceTables<SingleKeyTable, MultiKeyTable, CompoundKeyTable>;
      void getSingle();
      void getMulti();
      void getCompound();
      void removeSingle();
      void removeMulti();
      void subindex();
   };
   PSIO_REFLECT(TestTable,
                method(getSingle),
                method(getMulti),
                method(getCompound),
                method(removeSingle),
                method(removeMulti),
                method(subindex))
   PSIBASE_REFLECT_TABLES(TestTable, TestTable::Tables)
}  // namespace TestService
