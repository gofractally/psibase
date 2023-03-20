#include <triedent/cache_allocator.hpp>

#include <cstring>
#include <mutex>
#include <thread>
#include <utility>
#include <vector>

#include "temp_directory.hpp"

#include <catch2/catch.hpp>

using namespace triedent;
using namespace std::literals::chrono_literals;

extern std::vector<std::string> data;

TEST_CASE("cache_allocator")
{
   temp_directory dir("triedent-test");
   std::filesystem::create_directories(dir.path);
   cache_allocator a{dir.path,
                     {.hot_bytes = 128, .warm_bytes = 128, .cool_bytes = 128, .cold_bytes = 1024},
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

TEST_CASE("cache_allocator long")
{
   temp_directory dir("triedent-test");
   std::filesystem::create_directories(dir.path);
   cache_allocator a{dir.path,
                     {.hot_bytes = 128, .warm_bytes = 128, .cool_bytes = 128, .cold_bytes = 128},
                     access_mode::read_write};
   dir.reset();

   std::vector<object_id> ids{data.size()};
   std::mutex             mutex;
   std::atomic<bool>      failed{false};
   std::atomic<bool>      done{false};

   auto write_some = [&](auto& session, auto& rng)
   {
      std::uniform_int_distribution<> dist(0, ids.size() - 1);
      auto                            idx = dist(rng);
      std::unique_lock                l{session};
      const auto&                     s = data[idx];
      object_id                       id;
      {
         auto [lock, ptr] = a.alloc(l, s.size(), node_type::bytes);
         std::memcpy(ptr, s.data(), s.size());
         id = lock.get_id();
      }
      std::lock_guard l2{mutex};
      if (auto old = ids[idx])
      {
         a.release(old);
      }
      ids[idx] = id;
   };

   auto release_some = [&](auto& session, auto& rng)
   {
      object_id                       id;
      std::uniform_int_distribution<> dist(0, ids.size() - 1);
      auto                            idx = dist(rng);
      {
         std::lock_guard l{mutex};
         id       = ids[idx];
         ids[idx] = object_id{};
      }
      if (id)
      {
         std::lock_guard l{session};
         a.release(id);
      }
   };

   auto read_some = [&](auto& session, auto& rng)
   {
      object_id                       id;
      std::uniform_int_distribution<> dist(0, ids.size() - 1);
      auto                            idx = dist(rng);
      {
         std::lock_guard l{mutex};
         id = ids[idx];
         if (!id)
            return;
         a.bump_count(id);
      }
      std::string copy;
      {
         std::lock_guard l{session};
         auto [ptr, node_type, ref] = a.get_cache<true>(l, id);
         copy = std::string_view{(char*)ptr, cache_allocator::object_size(ptr)};
         a.release(id);
      }
      if (copy != data[idx])
      {
         std::osyncstream(std::cout)
             << '[' << gettid() << "] " << copy << " != " << data[idx] << std::endl;
         failed.store(true);
         done.store(true);
      }
   };

   std::vector<std::jthread> threads;
   threads.emplace_back(
       [&]
       {
          std::mt19937 rng(0);
          auto         session = a.start_session();
          while (!done.load())
          {
             write_some(session, rng);
             //std::this_thread::sleep_for(1us);
          }
       });
   threads.emplace_back(
       [&]
       {
          std::mt19937 rng(1);
          auto         session = a.start_session();
          while (!done.load())
          {
             release_some(session, rng);
          }
       });
   for (int i = 0; i < 4; ++i)
   {
      threads.emplace_back(
          [&, i]
          {
             std::mt19937 rng(42 + i);
             auto         session = a.start_session();
             while (!done.load())
             {
                read_some(session, rng);
             }
          });
   }
#if 0
   for(int i = 0; i < 1800; ++i)
   {
      std::this_thread::sleep_for(1s);
      std::cout << "db size:";
      for(auto span : a.span())
      {
         std::cout << ' ' << span.size();
      }
      std::cout << std::endl;
   }
#else
   std::this_thread::sleep_for(100ms);
#endif
   done.store(true);
   threads.clear();
   CHECK(!failed.load());
}
