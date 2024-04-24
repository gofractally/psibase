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
      // returns true if there is more to do
      bool indexSome(psibase::DbId db, std::uint32_t max);
      // Applies pending index changes
      bool processQueue(std::uint32_t maxSteps);
      // Runs in subjective mode at the end of each block
      void onBlock();
   };
   PSIO_REFLECT(EventIndex,
                method(setSchema, schema),
                method(addIndex, db, service, event, column),
                method(indexSome, db, maxRows),
                method(onBlock))

   using Events = EventIndex;

}  // namespace UserService
