#pragma once

#include <psibase/Service.hpp>

namespace LocalService
{
   struct TimerIdRow
   {
      std::uint64_t next;
      PSIO_REFLECT(TimerIdRow, next)
   };
   using TimerIdTable = psibase::Table<TimerIdRow, psibase::SingletonKey{}>;
   PSIO_REFLECT_TYPENAME(TimerIdTable)

   struct TimerQueueRow
   {
      std::uint64_t                   id;
      psibase::MonotonicTimePointUSec expiration;
      psibase::AccountNumber          service;
      psibase::MethodNumber           method;
      PSIO_REFLECT(TimerQueueRow, id, expiration, service, method)
   };
   using TimerQueueTable =
       psibase::Table<TimerQueueRow,
                      &TimerQueueRow::id,
                      psibase::CompositeKey<&TimerQueueRow::expiration, &TimerQueueRow::id>{}>;
   PSIO_REFLECT_TYPENAME(TimerQueueTable)

   struct XTimer : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"x-timer"};
      using Session                 = psibase::SessionTables<TimerIdTable, TimerQueueTable>;

      /// Schedules a callback to be executed at the given time.
      /// The callback will be dropped silently if it has not been
      /// run before the current session ends.
      ///
      /// Returns the timer id. The timer id will be passed as
      /// the sole argument to the callback.
      ///
      /// This function may be called inside a subjective transaction
      std::uint64_t runAt(psibase::MonotonicTimePointUSec time, psibase::MethodNumber callback);

      /// Cancels a timer callback. Returns true if cancellation
      /// was successful, or false if the callback has already
      /// started running.
      ///
      /// Only the creator of the timer can cancel it.
      ///
      /// This function may be called inside a subjective transaction
      bool cancel(std::uint64_t id);

      // Internal callback
      void runOne();
   };
   PSIO_REFLECT(XTimer, method(runAt, time, callback), method(cancel, id), method(runOne))
   PSIBASE_REFLECT_TABLES(XTimer, XTimer::Session)
}  // namespace LocalService
