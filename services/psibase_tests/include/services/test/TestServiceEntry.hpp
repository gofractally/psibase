#pragma once

#include <psibase/Service.hpp>

namespace TestService
{
   struct CallCounterRow
   {
      static constexpr int start  = 0;
      static constexpr int called = 1;
      int                  id;
      int                  count;
   };
   PSIO_REFLECT(CallCounterRow, id, count)
   using CallCounterTable = psibase::Table<CallCounterRow, &CallCounterRow::id>;
   PSIO_REFLECT_TYPENAME(CallCounterTable)

   struct TestServiceEntry : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"entry-point"};
      using Tables                  = psibase::ServiceTables<CallCounterTable>;
      int call(int number, std::string memo);
   };
   PSIO_REFLECT(TestServiceEntry, method(call, number, memo))
   PSIBASE_REFLECT_TABLES(TestServiceEntry, TestServiceEntry::Tables)
}  // namespace TestService
