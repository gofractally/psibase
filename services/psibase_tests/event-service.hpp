#pragma once

#include <psibase/Actor.hpp>
#include <psibase/Service.hpp>

struct EventService : psibase::Service<EventService>
{
   static constexpr auto service = psibase::AccountNumber{"event-service"};
   struct Events
   {
      struct History
      {
         void e(std::string s, int i);
      };
      struct Ui
      {
      };
      struct Merkle
      {
      };
   };
   psibase::EventNumber foo(std::string s, int i);
};

PSIO_REFLECT(EventService, method(foo, s, i))

PSIBASE_REFLECT_EVENTS(EventService)

PSIBASE_REFLECT_HISTORY_EVENTS(EventService, method(e, s, i))

PSIBASE_REFLECT_UI_EVENTS(EventService)
PSIBASE_REFLECT_MERKLE_EVENTS(EventService)
