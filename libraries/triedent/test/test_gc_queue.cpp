#include <triedent/gc_queue.hpp>

#include <thread>
#include <vector>

#include <catch2/catch.hpp>

using namespace triedent;
using namespace std::literals::chrono_literals;

TEST_CASE("gc_queue")
{
   std::atomic<int>  limit{0};
   std::atomic<int>  value{0};
   std::atomic<bool> failed{false};
   std::atomic<bool> done{false};
   gc_queue          q(256);

   struct incrementer
   {
      ~incrementer() { ++*p; }
      std::atomic<int>* p;
   };

   std::vector<std::jthread> threads;

   for (int i = 0; i < 10; ++i)
   {
      threads.emplace_back(
          [&]()
          {
             gc_queue::session session{q};
             while (!done)
             {
                std::lock_guard l{session};
                int             x = limit.load();
                int             y = value.load();
                std::this_thread::sleep_for(1us);
                int z = value.load();
                if (y > x || z > x)
                   failed = 1;
             }
          });
   }

   threads.emplace_back(
       [&]
       {
          while (!done && limit < std::numeric_limits<int>::max())
          {
             ++limit;
             q.push(std::make_shared<incrementer>(&value));
             q.poll();
          }
       });

   std::this_thread::sleep_for(10ms);
   done = true;
   threads.clear();
   {
      INFO("limit: " << limit.load());
      INFO("value: " << value.load());
      CHECK(!failed.load());
   }
   q.poll();
   CHECK(limit.load() == value.load());
}
