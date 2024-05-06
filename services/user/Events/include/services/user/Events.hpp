#pragma once

#include <cstdint>
#include <psibase/AccountNumber.hpp>
#include <psibase/MethodNumber.hpp>
#include <psibase/Service.hpp>
#include <psibase/db.hpp>
#include <psibase/nativeTables.hpp>
#include <psio/reflect.hpp>
#include <services/user/EventsTables.hpp>

namespace UserService
{

   /// The `events` service maintains indexes for all events.
   ///
   /// Queries for events use SQL and are sent to the /sql endpoint with
   /// `Content-Type: application/sql`
   ///
   /// There is one table for each type of event, for example, `"history.tokens.transferred"`.
   /// Note that double quotes are required because a '.' is not otherwise allowed
   /// in SQL table names.
   ///
   /// Each field of the event is a column in the table. Types that are represented
   /// in json as a number, string, true, false, or null are represented by an
   /// appropriate SQL value and can be compared. Types that do not have a
   /// representation in SQL (reflected structs, arrays, containers) are
   /// represented by an opaque SQL value. The result of applying any operation
   /// to an opaque value, other that returning it as a query result is unspecified.
   ///
   /// The query result is returned as a JSON array of objects.
   struct EventIndex : psibase::Service<EventIndex>
   {
      static constexpr psibase::AccountNumber service{"events"};
      static constexpr auto                   serviceFlags =
          psibase::CodeRow::isSubjective | psibase::CodeRow::forceReplay;
      /// Sets the schema associated with a service.
      void setSchema(const ServiceSchema& schema);
      /// Requests an index. Indexes can improve the performance of queries involving
      /// the column. The indexes are subjective and MAY be adjusted by individual nodes.
      /// Indexes increase the CPU cost of transactions that create events.
      /// Block producers SHOULD use exactly the indexes requested by services
      /// to ensure consistent billing.
      void addIndex(psibase::DbId          db,
                    psibase::AccountNumber service,
                    psibase::MethodNumber  event,
                    std::uint8_t           column);

      // --- Maintenance actions ---

      // Initializes the service
      void init();
      // Indexes all new events. This is run automatically at the end of every transaction.
      void sync();
      // Runs in subjective mode at the end of each block
      void onBlock();

      template <typename T>
      static T open(std::uint16_t id)
      {
         return T{psibase::DbId::writeOnly, psio::convert_to_key(std::tuple(service, id))};
      }
   };
   PSIO_REFLECT(EventIndex,
                method(init),
                method(setSchema, schema),
                method(addIndex, db, service, event, column),
                method(sync),
                method(onBlock))

   using Events = EventIndex;

}  // namespace UserService
