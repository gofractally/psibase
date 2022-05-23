#include <psidb/cursor.hpp>
#include <psidb/database.hpp>

#include "test_util.hpp"

#define CATCH_CONFIG_MAIN
#include <catch2/catch.hpp>

TEST_CASE("persistence simple", "[persistence]")
{
   tmp_file file;

   std::string value = "v1";
   {
      psidb::database db(::dup(file.native_handle()), 1024);

      auto trx = db.start_transaction();
      trx.insert("a", value);
      trx.commit();
      db.async_flush();
   }
   {
      psidb::database db(::dup(file.native_handle()), 1024);
      auto            trx    = db.start_transaction();
      auto            cursor = trx.get_cursor();
      cursor.lower_bound("a");
      CHECK_CURSOR(cursor, "a", value);
   }
}

TEST_CASE("persistence large value", "[persistence]")
{
   tmp_file file;

   std::string value(65536, static_cast<char>(0xCC));
   {
      psidb::database db(::dup(file.native_handle()), 1024);

      auto trx = db.start_transaction();
      trx.insert("a", value);
      trx.commit();
      db.async_flush();
   }
   {
      psidb::database db(::dup(file.native_handle()), 1024);
      auto            trx    = db.start_transaction();
      auto            cursor = trx.get_cursor();
      cursor.lower_bound("a");
      CHECK_CURSOR(cursor, "a", value);
   }
}

TEST_CASE("stable checkpoint", "[persistence]")
{
   tmp_file file;

   std::vector<std::pair<std::string, std::string>> data = {{"a", "v1"}, {"b", "v2"}};
   {
      psidb::database db(::dup(file.native_handle()), 1024);

      for (auto [key, value] : data)
      {
         auto trx = db.start_transaction();
         trx.insert(key, value);
         trx.commit();
         db.async_flush();
      }
   }
   {
      psidb::database db(::dup(file.native_handle()), 1024);
      std::size_t     i = 0;
      for (const auto& checkpoint : db.stable_checkpoints())
      {
         CHECK(i < data.size());
         auto                                             cursor = checkpoint.get_cursor();
         std::vector<std::pair<std::string, std::string>> contents;
         cursor.lower_bound("");
         while (cursor.valid())
         {
            contents.emplace_back(cursor.get_key(), cursor.get_value());
            cursor.next();
         }
         auto expected = data;
         expected.resize(i + 1);
         CHECK(contents == expected);
         ++i;
      }
      CHECK(i == 2);
   }
}

TEST_CASE("stable checkpoint allocation", "[persistence]")
{
   tmp_file file;

   std::vector<std::pair<std::string, std::string>> data;
   {
      psidb::database db(::dup(file.native_handle()), 1024);

      for (std::size_t i = 0; i < 100; ++i)
      {
         auto trx          = db.start_transaction();
         auto [key, value] = make_kv(i);
         data.push_back({key, value});
         trx.insert(key, value);
         trx.commit();
         db.async_flush();
         db.sync();
         if (i >= 5)
         {
            db.delete_stable_checkpoint(db.stable_checkpoints()[0]);
            // 2 header pages
            // 1 free list
            // 1 checkpoint data
            // 6 active checkpoints
            CHECK(db.get_stats().file.used == 10);
            if (i >= 6)
            {
               // 1 previous free list
               // 1 previous checkpoint data
               // 1 previous checkpoint
               CHECK(db.get_stats().file.total == 13);
            }
         }
      }
   }
   {
      psidb::database db(::dup(file.native_handle()), 1024);
      // 5 checkpoints
      CHECK(db.get_stats().file.used == 9);
      CHECK(db.get_stats().file.total == 13);
      std::size_t i = 95;
      for (const auto& checkpoint : db.stable_checkpoints())
      {
         CHECK(i < data.size());
         auto expected = data;
         expected.resize(i + 1);
         std::sort(expected.begin(), expected.end());
         CHECK_STATE(checkpoint, expected);
         ++i;
      }
      CHECK(i == 100);
   }
}

TEST_CASE("basic eviction", "[persistence]")
{
   tmp_file file;

   psidb::database db(file.native_handle(), 1024);

   {
      auto trx = db.start_transaction();
      for (int i = 0; i < 200; ++i)
      {
         auto [k, v] = make_kv(i);
         trx.insert(k, v);
      }
      trx.commit();
      db.async_flush();
      db.sync();
   }

   // N.B. This test will eventually need to be updated,
   // because it depends on the simple eviction algorithm.
   // These two calls to full_gc will need to be replaced
   // with "wait for a while" however that is defined.
   //
   // run the garbage collector to clear all the accessed flags
   db.full_gc();
   // run the garbage collector again to evict pages
   db.full_gc();

   // After eviction, only the root is held in memory
   CHECK(db.get_stats().memory.used == 1);

   // Make sure that evicted pages can be loaded again
   {
      auto trx    = db.start_read();
      auto cursor = trx.get_cursor();
      for (int i = 0; i < 200; ++i)
      {
         auto [k, v] = make_kv(i);
         cursor.lower_bound(k);
         CHECK_CURSOR(cursor, k, v);
      }
   }
}

TEST_CASE("abort", "[abort]")
{
   tmp_file file;

   psidb::database db(file.native_handle(), 1024);

   {
      auto trx = db.start_transaction();
      trx.insert("a", "v1");
      trx.abort();
   }

   {
      auto trx    = db.start_read();
      auto cursor = trx.get_cursor();
      cursor.lower_bound("");
      CHECK(!cursor.valid());
   }
}

TEST_CASE("leaf transaction insert independence")
{
   tmp_file file;

   psidb::database db(file.native_handle(), 1024);
   auto            trx    = db.start_transaction();
   auto            cursor = trx.get_cursor();
   // add elements
   trx.insert("b", "v1");
   trx.commit();

   // After a transaction is committed, it can still be used read-only
   // or converted to a read transaction.
   auto trx2    = db.start_transaction();
   auto cursor2 = trx2.get_cursor();
   // add more elements
   trx2.insert("a", "v2");

   // verify that original cursor shows no changes
   cursor.lower_bound("a");
   CHECK(cursor.get_value() == "v1");
}

TEST_CASE("transaction insert independence")
{
   tmp_file file;

   psidb::database db(file.native_handle(), 1024);
   auto            trx    = db.start_transaction();
   auto            cursor = trx.get_cursor();
   for (int i = 0; i < 400; ++i)
   {
      auto [k, v] = make_kv(i);
      trx.insert(k, v);
   }
   trx.commit();

   auto trx2    = db.start_transaction();
   auto cursor2 = trx2.get_cursor();
   for (int i = 400; i < 600; ++i)
   {
      auto [k, v] = make_kv(i);
      trx2.insert(k, v);
   }

   // verify that values inserted by cursor2 are not present in cursor1
   for (int i = 0; i < 400; ++i)
   {
      auto [k, v] = make_kv(i);
      cursor.lower_bound(k);
      CHECK(cursor.valid());
      if (cursor.valid())
      {
         CHECK(cursor.get_key() == k);
         CHECK(cursor.get_value() == v);
      }
   }
   for (int i = 400; i < 600; ++i)
   {
      auto [k, v] = make_kv(i);
      cursor.lower_bound(k);
      if (cursor.valid())
      {
         CHECK(cursor.get_key() != k);
      }
   }
}
