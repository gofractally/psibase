#include <boost/asio/steady_timer.hpp>
#include <iomanip>
#include <iostream>
#include <psibase/random_timer.hpp>

#include <catch2/catch_all.hpp>

TEST_CASE("test random timer distribution")
{
   boost::asio::io_context                                     ctx;
   psibase::net::basic_random_timer<boost::asio::steady_timer> timer{ctx};
   using namespace std::literals::chrono_literals;
   std::vector<std::chrono::steady_clock::duration> result;
   for (int i = 0; i < 100; ++i)
   {
      timer.expires_after(10ms, 20ms);
      auto start = std::chrono::steady_clock::now();
      auto end   = start;
      timer.async_wait([&](const std::error_code&)
                       { result.push_back(std::chrono::steady_clock::now() - start); });
      ctx.run();
      ctx.restart();
   }
   // The times should be uniformly distributed with a bias
   // This can be verified using a KS test, but for now just inspect manually.
   for (std::size_t i = 0; i < result.size(); ++i)
   {
      std::cout << std::setw(8) << result[i].count();
      if (i % 8 == 7)
         std::cout << '\n';
      else
         std::cout << ' ';
   }
   std::cout << std::endl;
}
