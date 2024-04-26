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

   struct EventIndex : psibase::Service<EventIndex>
   {
      static constexpr psibase::AccountNumber service{"events"};
      static constexpr auto                   serviceFlags =
          psibase::CodeRow::isSubjective | psibase::CodeRow::forceReplay;
      void init();
      // Sets the schema associated with a service
      void setSchema(const ServiceSchema& schema);
      // Adds an index.
      void addIndex(psibase::DbId          db,
                    psibase::AccountNumber service,
                    psibase::MethodNumber  event,
                    std::uint8_t           column);
      // returns true if there is more to do
      bool indexSome(psibase::DbId db, std::uint32_t max);
      // Applies pending index changes
      bool processQueue(std::uint32_t maxSteps);
      // Indexes all new events
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
                method(indexSome, db, maxRows),
                method(sync),
                method(onBlock))

   using Events = EventIndex;

}  // namespace UserService
