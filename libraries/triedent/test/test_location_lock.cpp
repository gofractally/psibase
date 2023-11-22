#include <triedent/location_lock.hpp>

#include <thread>
#include <vector>

#include <catch2/catch.hpp>

using namespace triedent;
using namespace std::literals::chrono_literals;

TEST_CASE("location_lock")
{
   location_mutex mutex;

   static constexpr std::size_t num_ids = 16;
   std::atomic<int>             buf[num_ids];

   std::atomic<bool> failed{false};
   std::atomic<bool> done{false};

   auto write = [&](object_id id, int value)
   {
      location_lock l{mutex, id};
      buf[id.id - 1].store(value);
      std::this_thread::sleep_for(10us);
      if (buf[id.id - 1].load() != value)
      {
         failed.store(true);
      }
   };

   std::vector<std::thread> threads;
   for (int i = 0; i < 16; ++i)
   {
      threads.emplace_back(
          [&, i]
          {
             std::mt19937                               rng(i);
             std::uniform_int_distribution<std::size_t> dist{1, num_ids};
             while (!done.load())
             {
                object_id id{dist(rng)};
                write(id, i + 42);
             }
          });
   }
   std::this_thread::sleep_for(100ms);
   done.store(true);

   for( auto& t : threads ) {
      t.join();
   }

   threads.clear();
   CHECK(!failed.load());
}
