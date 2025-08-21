#pragma once

#include <cstdint>
#include <psibase/AccountNumber.hpp>
#include <psibase/MethodNumber.hpp>
#include <psibase/Service.hpp>
#include <psibase/db.hpp>
#include <psio/reflect.hpp>
#include <services/user/EventsTables.hpp>

namespace UserService
{

   /// The `events` service maintains indexes for all events.
   ///
   /// Queries for events use SQL and are sent to the `/sql` endpoint with
   /// `Content-Type: application/sql`
   ///
   /// There is one table for each type of event, for example, `"history.tokens.transferred"`.
   /// Note that double quotes are required because a `.` is not otherwise allowed
   /// in SQL table names.
   ///
   /// Each field of the event is a column in the table. Types that are represented
   /// in json as a number, string, true, false, or null are represented by an
   /// appropriate SQL value and can be compared. Types that do not have a
   /// simple representation in SQL are represented by an opaque SQL value. The
   /// result of applying any operation to an opaque value other that returning it
   /// as a query result is unspecified.
   ///
   /// The query result is returned as a JSON array of objects.
   ///
   /// Example:
   ///
   /// Given an event
   /// ```c++
   /// void add(uint32_t x, uint32_t y, uint32_t sum);
   /// ```
   /// the query
   /// ```sql
   /// SELECT * FROM "history.example.add" WHERE sum > 10 ORDER BY x
   /// ```
   /// might return a result that looks like
   /// ```json
   /// [{"x":5,"y":7,"sum":12},{"x":6,"y":5,"sum":11}]
   /// ```
   ///
   struct EventConfig : psibase::Service
   {
      static constexpr psibase::AccountNumber service{"events"};

      using Tables = psibase::ServiceTables<SecondaryIndexTable>;

      /// Requests an index. Indexes can improve the performance of queries involving
      /// the column. The indexes are subjective and MAY be adjusted by individual nodes.
      /// Indexes increase the CPU cost of transactions that create events.
      /// Block producers SHOULD use exactly the indexes requested by services
      /// to ensure consistent billing.
      void addIndex(psibase::DbId          db,
                    psibase::AccountNumber service,
                    psibase::MethodNumber  event,
                    std::uint8_t           column);
   };
   PSIO_REFLECT(EventConfig, method(addIndex, db, service, event, column))
   PSIBASE_REFLECT_TABLES(EventConfig, EventConfig::Tables)

   using Events = EventConfig;

}  // namespace UserService
