#include "event-service.hpp"

#include <psibase/DefaultTestChain.hpp>

#include <psio/to_hex.hpp>

#include <catch2/catch.hpp>

using namespace psibase;
using namespace std::literals::string_literals;

TEST_CASE("test events")
{
   DefaultTestChain t;
   auto             test_service = t.addService("event-service"_a, "event-service.wasm");

   auto evId = t.from("event-service"_a)
                   .to<EventService>()
                   .foo("antidisestablishmentarianism", 42)
                   .returnVal();
   auto result = EventService().events().history().e(evId);
   auto [s, i] = result->unpack();
   CHECK(s == "antidisestablishmentarianism"s);
   CHECK(i == 42);
}
