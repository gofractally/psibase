#include <psibase/mock_timer.hpp>

#include <boost/asio/io_context.hpp>

#include <catch2/catch_all.hpp>

using namespace psibase::test;

TEST_CASE("mock_timer")
{
   boost::asio::io_context ctx;
   mock_timer              timer(ctx);
   int                     counter = 0;
   using namespace std::literals::chrono_literals;
   timer.expires_after(1s);
   timer.async_wait([&](std::error_code) { ++counter; });
   ctx.poll();
   CHECK(counter == 0);
   mock_clock::advance(mock_clock::now() + 1s);
   CHECK(counter == 0);
   ctx.poll();
   CHECK(counter == 1);
}
