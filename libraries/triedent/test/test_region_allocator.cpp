#include <triedent/region_allocator.hpp>

#include <chrono>
#include <mutex>
#include <thread>

#include "temp_directory.hpp"

#include <catch2/catch.hpp>

using namespace triedent;
using namespace std::literals::chrono_literals;

extern std::vector<std::string> data;

TEST_CASE("region_allocator")
{
   temp_directory dir("triedent-test");
   std::filesystem::create_directories(dir.path);
   gc_queue         gc{256};
   object_db        obj_ids{gc, dir.path / "obj_ids", access_mode::read_write};
   region_allocator a{gc, obj_ids, dir.path / "cold", access_mode::read_write, 128};
   dir.reset();
   std::vector<object_id> ids;
   gc_session             session{gc};
   for (const std::string& s : data)
   {
      {
         std::unique_lock l{session};
         auto             id = obj_ids.alloc(l, node_type::bytes);
         a.try_allocate(l, id, s.size(),
                        [&](void* ptr, object_location loc)
                        {
                           std::memcpy(ptr, s.data(), s.size());
                           obj_ids.init(id, loc);
                        });
         ids.push_back(id);
      }
      gc.poll();
   }
   for (std::size_t i = 0; i < ids.size(); ++i)
   {
      std::lock_guard  l{session};
      auto             info = obj_ids.get(ids[i]);
      object_header*   h    = a.get_object(info);
      std::string_view s{(const char*)h->data(), h->data_size()};
      CHECK(s == data[i]);
   }
}

TEST_CASE("region_allocator threaded")
{
   temp_directory dir("triedent-test");
   std::filesystem::create_directories(dir.path);
   gc_queue         gc{256};
   object_db        obj_ids{gc, dir.path / "obj_ids", access_mode::read_write};
   region_allocator a{gc, obj_ids, dir.path / "cold", access_mode::read_write, 128};
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
      auto                            id = obj_ids.alloc(l, node_type::bytes);
      const auto&                     s  = data[idx];
      a.try_allocate(l, id, s.size(),
                     [&](void* ptr, object_location loc)
                     {
                        std::memcpy(ptr, s.data(), s.size());
                        obj_ids.init(id, loc);
                     });
      std::lock_guard l2{mutex};
      if (auto old = ids[idx])
      {
         auto info = obj_ids.release(old);
         if (info.ref == 0)
         {
            a.deallocate(info);
         }
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
         auto            info = obj_ids.release(id);
         if (info.ref == 0)
         {
            a.deallocate(info);
         }
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
         obj_ids.bump_count(id);
      }
      std::string copy;
      {
         std::lock_guard l{session};
         auto            info = obj_ids.release(id);
         auto            obj  = a.get_object(info);
         copy                 = std::string_view{(char*)obj->data(), obj->size};
         if (info.ref == 0)
         {
            a.deallocate(info);
         }
      }
      if (copy != data[idx])
      {
         failed.store(true);
      }
   };

   std::vector<std::thread> threads;
   threads.emplace_back(
       [&]
       {
          std::mt19937 rng(0);
          gc_session   session{gc};
          while (!done.load())
          {
             write_some(session, rng);
          }
       });
   threads.emplace_back(
       [&]
       {
          std::mt19937 rng(1);
          gc_session   session{gc};
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
             gc_session   session{gc};
             while (!done.load())
             {
                read_some(session, rng);
             }
          });
   }
   threads.emplace_back([&] { gc.run(&done); });
   std::this_thread::sleep_for(100ms);
   done.store(true);
   gc.notify_run();
   gc.push(std::make_shared<int>(0));
   
   for( auto& t : threads ) {
      t.join();
   }

   threads.clear();
   CHECK(!failed.load());
}
