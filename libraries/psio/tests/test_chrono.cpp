#include <psio/chrono.hpp>

#include "test_fracpack.hpp"

TEST_CASE("roundtrip chrono")
{
   test<std::chrono::nanoseconds>({std::chrono::nanoseconds(0), std::chrono::nanoseconds(1),
                                   std::chrono::nanoseconds::min(),
                                   std::chrono::nanoseconds::max()});
}

TEST_CASE("chrono format")
{
   std::string time = R"("2024-11-18T12:34:56.789012345Z")";
   auto        ns = psio::convert_from_json<std::chrono::sys_time<std::chrono::nanoseconds>>(time);
   auto        us = psio::convert_from_json<std::chrono::sys_time<std::chrono::microseconds>>(time);
   auto        ms = psio::convert_from_json<std::chrono::sys_time<std::chrono::milliseconds>>(time);
   auto        s  = psio::convert_from_json<std::chrono::sys_time<std::chrono::seconds>>(time);
   CHECK(ns.time_since_epoch().count() == 1731933296789012345);
   CHECK(us.time_since_epoch().count() == 1731933296789012);
   CHECK(ms.time_since_epoch().count() == 1731933296789);
   CHECK(s.time_since_epoch().count() == 1731933296);
   CHECK(psio::convert_to_json(ns) == R"("2024-11-18T12:34:56.789012345Z")");
   CHECK(psio::convert_to_json(us) == R"("2024-11-18T12:34:56.789012Z")");
   CHECK(psio::convert_to_json(ms) == R"("2024-11-18T12:34:56.789Z")");
   CHECK(psio::convert_to_json(s) == R"("2024-11-18T12:34:56Z")");
}
