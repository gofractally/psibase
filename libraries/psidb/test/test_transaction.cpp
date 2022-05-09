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
