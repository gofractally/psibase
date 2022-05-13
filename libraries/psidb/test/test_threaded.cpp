#include <psidb/database.hpp>

#include "test_util.hpp"

#define CATCH_CONFIG_MAIN
#include <catch2/catch.hpp>

std::mutex global_mutex;

#define CHECK_R(...)                        \
   do                                       \
   {                                        \
      if (!(__VA_ARGS__))                   \
      {                                     \
         std::lock_guard l(::global_mutex); \
         CHECK(__VA_ARGS__);                \
      }                                     \
   } while (0)

#define REQUIRE_R(...)                      \
   do                                       \
   {                                        \
      if (!(__VA_ARGS__))                   \
      {                                     \
         std::lock_guard l(::global_mutex); \
         CHECK(__VA_ARGS__);                \
         test_failed();                     \
         return;                            \
      }                                     \
   } while (0)

TEST_CASE("thread tests", "[thread]")
{
   tmp_file file;

   psidb::database   db(::dup(file.native_handle()), 65536);
   std::atomic<bool> done{false};
   auto              test_failed = [&]() { done = true; };
   // set up initial state
   {
      auto trx = db.start_transaction();
      trx.insert("0", "0");
      std::uint32_t i = 0;
      trx.insert("", {reinterpret_cast<const char*>(&i), sizeof(i)});
      trx.commit();
   };
   // one thread writes in a determinsic pattern
   auto writer = [&]()
   {
      for (std::uint32_t i = 1; i < 200; ++i)
      {
         auto trx    = db.start_transaction();
         auto [k, v] = make_kv(i);
         trx.insert(k, v);
         if (i % 4 == 2)
         {
            auto [half, _] = make_kv(i / 2);
            trx.erase(half);
         }
         trx.erase("");
         trx.insert("", {reinterpret_cast<const char*>(&i), sizeof(i)});
         trx.commit();
         db.async_flush(true);
         auto stats = db.get_stats();
         std::cout << "memory used: " << stats.memory.used << " / " << stats.memory.total
                   << ", checkpoints: " << stats.checkpoints << ", disk used: " << stats.file.used
                   << " / " << stats.file.total << std::endl;
      }
      done = true;
   };
   // many threads read and verify that they see a consistent snapshot
   auto reader = [&]()
   {
      std::uint32_t prev = 0;
      while (!done)
      {
         auto trx    = db.start_read();
         auto cursor = trx.get_cursor();
         cursor.lower_bound("");
         REQUIRE_R(cursor.valid());
         REQUIRE_R(cursor.get_key() == "");
         auto          value = cursor.get_value();
         std::uint32_t info;
         REQUIRE_R(value.size() == sizeof(info));
         std::memcpy(&info, value.data(), sizeof(info));
         REQUIRE_R(info >= prev);
         for (std::uint32_t i = 0; i < info + 10; ++i)
         {
            auto [k, v] = make_kv(i);
            cursor.lower_bound(k);
            if (i <= info && (i % 2 == 0 || i > info / 2))
            {
               REQUIRE_R(cursor.valid());
               REQUIRE_R(cursor.get_key() == k);
               REQUIRE_R(cursor.get_value() == v);
            }
            else
            {
               if (cursor.valid())
               {
                  REQUIRE_R(cursor.get_key() != k);
               }
            }
         }
         prev = info;
      }
   };
   std::thread              w{writer};
   std::vector<std::thread> r;
   for (int i = 0; i < 10; ++i)
   {
      r.push_back(std::thread{reader});
   }
   w.join();
   for (auto& t : r)
   {
      t.join();
   }

   db.start_transaction().commit();
   db.start_transaction().commit();
   auto stats = db.get_stats();
   std::cout << "memory used: " << stats.memory.used << " / " << stats.memory.total
             << ", checkpoints: " << stats.checkpoints << ", disk used: " << stats.file.used
             << " / " << stats.file.total << std::endl;
}
