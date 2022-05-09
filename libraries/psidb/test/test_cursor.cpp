#include <psidb/cursor.hpp>
#include <psidb/database.hpp>

#include "test_util.hpp"

#define CATCH_CONFIG_MAIN
#include <catch2/catch.hpp>

TEST_CASE("lower_bound empty", "[lower_bound]")
{
   tmp_file file;

   psidb::database db(file.native_handle(), 1024);
   auto            trx    = db.start_transaction();
   auto            cursor = trx.get_cursor();
   cursor.lower_bound("a");
   CHECK(!cursor.valid());
}

TEST_CASE("lower_bound simple", "[lower_bound]")
{
   tmp_file file;

   psidb::database db(file.native_handle(), 1024);
   auto            trx    = db.start_transaction();
   auto            cursor = trx.get_cursor();
   trx.insert("a", "v1");
   cursor.lower_bound("a");
   CHECK_CURSOR(cursor, "a", "v1");
   cursor.lower_bound(std::string_view{"a", 2});
   CHECK(!cursor.valid());
   cursor.lower_bound(" ");
   CHECK_CURSOR(cursor, "a", "v1");
}

TEST_CASE("lower_bound many", "[lower_bound]")
{
   tmp_file file;

   psidb::database db(file.native_handle(), 1024);
   auto            trx    = db.start_transaction();
   auto            cursor = trx.get_cursor();
   for (int i = 100; i < 900; i += 2)
   {
      auto [k, v] = make_kv(i);
      trx.insert(k, v);
   }
   cursor.lower_bound("");
   CHECK_CURSOR(cursor, "100", "102400");
   for (int i = 100; i < 900; i += 2)
   {
      auto [k, v] = make_kv(i);
      cursor.lower_bound(k);
      CHECK_CURSOR(cursor, k, v);
      auto [mid, _] = make_kv(i + 1);
      cursor.lower_bound(mid);
      if (i < 898)
      {
         auto [nextk, nextv] = make_kv(i + 2);
         CHECK_CURSOR(cursor, nextk, nextv);
      }
      else
      {
         CHECK(!cursor.valid());
      }
   }
}

TEST_CASE("lower bound large value", "[lower_bound]")
{
   tmp_file file;

   psidb::database db(file.native_handle(), 1024);

   auto        trx    = db.start_transaction();
   auto        cursor = trx.get_cursor();
   std::string value(65536, static_cast<char>(0xCC));
   trx.insert("a", value);
   cursor.lower_bound("a");
   CHECK_CURSOR(cursor, "a", value);
}

TEST_CASE("next", "[next]")
{
   tmp_file file;

   psidb::database db(file.native_handle(), 1024);

   auto trx    = db.start_transaction();
   auto cursor = trx.get_cursor();
   trx.insert("a", "v1");
   trx.insert("b", "v2");
   cursor.lower_bound("");
   cursor.next();
   CHECK_CURSOR(cursor, "b", "v2");
   cursor.next();
   CHECK(!cursor.valid());
}

TEST_CASE("previous", "[previous]")
{
   tmp_file file;

   psidb::database db(file.native_handle(), 1024);

   auto trx    = db.start_transaction();
   auto cursor = trx.get_cursor();
   trx.insert("a", "v1");
   cursor.lower_bound("b");
   cursor.previous();
   CHECK_CURSOR(cursor, "a", "v1");
}

TEST_CASE("erase simple", "[erase]")
{
   tmp_file file;

   psidb::database db(file.native_handle(), 1024);

   auto trx    = db.start_transaction();
   auto cursor = trx.get_cursor();

   trx.insert("a", "v1");
   trx.erase("a");
   cursor.lower_bound("");
   CHECK(!cursor.valid());
}

TEST_CASE("erase many", "[erase]")
{
   tmp_file file;

   psidb::database db(file.native_handle(), 1024);

   auto trx    = db.start_transaction();
   auto cursor = trx.get_cursor();
   for (int i = 100; i < 500; ++i)
   {
      auto [k, v] = make_kv(i);
      trx.insert(k, v);
   }

   for (int i = 100; i < 400; ++i)
   {
      auto [k, v] = make_kv(i);
      trx.erase(k);
   }
   cursor.lower_bound("");
   CHECK_CURSOR(cursor, "400", "409600");
}
