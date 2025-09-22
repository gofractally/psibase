#pragma once

#include <psibase/AccountNumber.hpp>
#include <psibase/MethodNumber.hpp>
#include <psibase/Service.hpp>
#include <psibase/db.hpp>
#include <psibase/nativeTables.hpp>
#include <services/user/EventsTables.hpp>

namespace UserService
{
   struct EventIndex : psibase::Service
   {
      static constexpr psibase::AccountNumber service{"event-index"};
      static constexpr auto                   serviceFlags = 0;

      /// Mark the table as having a pending index update
      void update(psibase::DbId db, psibase::AccountNumber service, psibase::MethodNumber event);
      /// Indexes all new events. This is run automatically at the end of every transaction.
      void sync();
      /// Runs in subjective mode at the end of each block
      void onBlock();
   };
   PSIO_REFLECT(EventIndex, method(update, db, service, event), method(sync), method(onBlock))
   PSIBASE_REFLECT_TABLES(EventIndex, EventsTables)
}  // namespace UserService
