#include <psibase/mock_timer.hpp>

#include <boost/asio/io_context.hpp>

#define CATCH_CONFIG_MAIN
#include <catch2/catch.hpp>

using namespace psibase::test;

TEST_CASE("mock_timer")
{
   boost::asio::io_context ctx;
   mock_timer              timer(ctx);
   int                     counter = 0;
   using namespace std::literals::chrono_literals;
   timer.expires_after(1s);
   timer.async_wait([&](std::error_code) { ++counter; });
   ctx.run();
   ctx.restart();
   CHECK(counter == 0);
   mock_clock::advance(1s);
   CHECK(counter == 0);
   ctx.run();
   ctx.restart();
   CHECK(counter == 1);
}
