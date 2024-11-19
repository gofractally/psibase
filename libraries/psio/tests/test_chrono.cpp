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
   using sys_ns     = std::chrono::sys_time<std::chrono::nanoseconds>;
   using sys_us     = std::chrono::sys_time<std::chrono::microseconds>;
   using sys_ms     = std::chrono::sys_time<std::chrono::milliseconds>;
   using sys_s      = std::chrono::sys_time<std::chrono::seconds>;
   std::string time = R"("2024-11-18T12:34:56.789012345Z")";
   auto        ns   = psio::convert_from_json<sys_ns>(time);
   auto        us   = psio::convert_from_json<sys_us>(time);
   auto        ms   = psio::convert_from_json<sys_ms>(time);
   auto        s    = psio::convert_from_json<sys_s>(time);
   CHECK(ns.time_since_epoch().count() == 1731933296789012345);
   CHECK(us.time_since_epoch().count() == 1731933296789012);
   CHECK(ms.time_since_epoch().count() == 1731933296789);
   CHECK(s.time_since_epoch().count() == 1731933296);
   CHECK(psio::convert_to_json(ns) == R"("2024-11-18T12:34:56.789012345Z")");
   CHECK(psio::convert_to_json(us) == R"("2024-11-18T12:34:56.789012Z")");
   CHECK(psio::convert_to_json(ms) == R"("2024-11-18T12:34:56.789Z")");
   CHECK(psio::convert_to_json(s) == R"("2024-11-18T12:34:56Z")");
   // extra precision
   CHECK(psio::convert_from_json<sys_ns>(R"("2024-11-18T12:34:56.7890123456789Z")")
             .time_since_epoch()
             .count() == 1731933296789012345);
   // time zone
   CHECK(psio::convert_from_json<sys_ns>(R"("2024-11-18T12:34:56.789012345+00")")
             .time_since_epoch()
             .count() == 1731933296789012345);
   CHECK(psio::convert_from_json<sys_ns>(R"("2024-11-18T12:34:56.789012345+0000")")
             .time_since_epoch()
             .count() == 1731933296789012345);
   CHECK(psio::convert_from_json<sys_ns>(R"("2024-11-18T12:34:56.789012345+00:00")")
             .time_since_epoch()
             .count() == 1731933296789012345);
   // time zone conversion to UTC
   CHECK(psio::convert_from_json<sys_ns>(R"("2024-11-18T12:34:56.789012345-01")")
             .time_since_epoch()
             .count() == 1731936896789012345);
   CHECK(psio::convert_from_json<sys_ns>(R"("2024-11-18T12:34:56.789012345-0123")")
             .time_since_epoch()
             .count() == 1731938276789012345);
   CHECK(psio::convert_from_json<sys_ns>(R"("2024-11-18T12:34:56.789012345-01:23")")
             .time_since_epoch()
             .count() == 1731938276789012345);

   CHECK(psio::convert_from_json<sys_ns>(R"("2024-11-18T12:34:56.789012345+01")")
             .time_since_epoch()
             .count() == 1731929696789012345);
   CHECK(psio::convert_from_json<sys_ns>(R"("2024-11-18T12:34:56.789012345+0123")")
             .time_since_epoch()
             .count() == 1731928316789012345);
   CHECK(psio::convert_from_json<sys_ns>(R"("2024-11-18T12:34:56.789012345+01:23")")
             .time_since_epoch()
             .count() == 1731928316789012345);
   // leap days
   CHECK(psio::convert_from_json<sys_ns>(R"("2024-02-29T12:34:56.7890123456789Z")")
             .time_since_epoch()
             .count() == 1709210096789012345);
   CHECK(psio::convert_from_json<sys_ns>(R"("2000-02-29T12:34:56.7890123456789Z")")
             .time_since_epoch()
             .count() == 951827696789012345);
   // less precision
   CHECK(psio::convert_from_json<sys_ns>(R"("2024-11-18T12:34:56.78901234Z")")
             .time_since_epoch()
             .count() == 1731933296789012340);
   CHECK(psio::convert_from_json<sys_ns>(R"("2024-11-18T12:34:56.7890123Z")")
             .time_since_epoch()
             .count() == 1731933296789012300);
   CHECK(psio::convert_from_json<sys_ns>(R"("2024-11-18T12:34:56.789012Z")")
             .time_since_epoch()
             .count() == 1731933296789012000);
   CHECK(psio::convert_from_json<sys_ns>(R"("2024-11-18T12:34:56.78901Z")")
             .time_since_epoch()
             .count() == 1731933296789010000);
   CHECK(psio::convert_from_json<sys_ns>(R"("2024-11-18T12:34:56.7890Z")")
             .time_since_epoch()
             .count() == 1731933296789000000);
   CHECK(psio::convert_from_json<sys_ns>(R"("2024-11-18T12:34:56.789Z")")
             .time_since_epoch()
             .count() == 1731933296789000000);
   CHECK(
       psio::convert_from_json<sys_ns>(R"("2024-11-18T12:34:56.78Z")").time_since_epoch().count() ==
       1731933296780000000);
   CHECK(
       psio::convert_from_json<sys_ns>(R"("2024-11-18T12:34:56.7Z")").time_since_epoch().count() ==
       1731933296700000000);
   CHECK(psio::convert_from_json<sys_ns>(R"("2024-11-18T12:34:56Z")").time_since_epoch().count() ==
         1731933296000000000);
   // end of day
   CHECK(psio::convert_from_json<sys_ns>(R"("2024-11-18T24:00:00.000Z")")
             .time_since_epoch()
             .count() == 1731974400000000000);
   // system time does not include leap seconds
   CHECK(psio::convert_from_json<sys_ns>(R"("2016-12-31T23:59:60Z")").time_since_epoch().count() ==
         1483228799000000000);

   // Invalid formats
   std::int64_t  a;
   std::uint32_t b;
   // month out of range
   CHECK(!psio::parse_system_time("2024-13-18T12:34:56.789012345Z", a, b));
   CHECK(!psio::parse_system_time("2024-00-18T12:34:56.789012345Z", a, b));
   // days out-of-range
   CHECK(!psio::parse_system_time("2023-04-31T12:34:56.789012345Z", a, b));
   CHECK(!psio::parse_system_time("2024-12-32T12:34:56.789012345Z", a, b));
   // bad leap day
   CHECK(!psio::parse_system_time("2023-02-29T12:34:56.789012345Z", a, b));
   CHECK(!psio::parse_system_time("1900-02-29T12:34:56.789012345Z", a, b));
   // time out of range
   CHECK(!psio::parse_system_time("2024-11-18T24:01:00Z", a, b));
   CHECK(!psio::parse_system_time("2024-11-18T24:00:01Z", a, b));
   CHECK(!psio::parse_system_time("2024-11-18T24:00:00.1Z", a, b));
   // bad offset
   CHECK(!psio::parse_system_time("2024-11-18T00:00:00+010", a, b));
   CHECK(!psio::parse_system_time("2024-11-18T00:00:00-010", a, b));
}
