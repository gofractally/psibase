#include <triedent/cache_allocator.hpp>

#include <cstring>
#include <mutex>
#include <thread>
#include <utility>
#include <vector>

#include "temp_directory.hpp"

#include <catch2/catch.hpp>

using namespace triedent;

extern std::vector<std::string> data;

TEST_CASE("cache_allocator")
{
   temp_directory dir("triedent-test");
   std::filesystem::create_directories(dir.path);
   cache_allocator a{
       dir.path,
       {.max_ids = 16, .hot_bytes = 128, .warm_bytes = 128, .cool_bytes = 128, .cold_bytes = 1024},
       access_mode::read_write};
   dir.reset();

   std::vector<std::pair<object_id, std::size_t>> known_ids;
   std::mutex                                     id_mutex;

   std::atomic<bool> failed{false};

   //
   auto write_some = [&](auto& session)
   {
      for (std::size_t i = 0; i < data.size(); ++i)
      {
         std::unique_lock l{session};
         auto [loc, ptr] = a.alloc(l, data[i].size(), node_type::bytes);
         std::memcpy(ptr, data[i].data(), data[i].size());

         std::lock_guard l2{id_mutex};
         known_ids.emplace_back(loc.get_id(), i);
      }
   };

   auto read_some = [&](auto& session)
   {
      std::lock_guard     l{session};
      decltype(known_ids) ids;
      {
         std::lock_guard l2{id_mutex};
         ids = known_ids;
      }
      for (auto [id, expected] : ids)
      {
         auto [ptr, type, ref] = a.get_cache<false>(l, id);
         auto size             = cache_allocator::object_size(ptr);
         auto value            = std::string{(char*)ptr, size};
         if (value != data[expected])
         {
            std::cout << value << " != " << data[expected] << std::endl;
            failed.store(true);
         }
      }
   };

   std::vector<std::jthread> threads;
   std::atomic<bool>         done{false};
   threads.emplace_back(
       [&]
       {
          auto session = a.start_session();
          while (!done)
          {
             read_some(session);
          }
       });

   {
      auto session = a.start_session();
      write_some(session);
   }
   done = true;
   threads.clear();

   CHECK(!failed.load());
}
