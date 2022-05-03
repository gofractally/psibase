#include <psidb/cursor.hpp>
#include <psidb/database.hpp>

#define CATCH_CONFIG_MAIN
#include <catch2/catch.hpp>

#include <fcntl.h>
#include <filesystem>

class tmp_file
{
  public:
   tmp_file()
       : _fd(::open(std::filesystem::temp_directory_path().c_str(), O_RDWR | O_TMPFILE | O_EXCL))
   {
   }
   ~tmp_file() { ::close(_fd); }
   int native_handle() { return _fd; }

  private:
   int _fd;
};

auto make_kv(int i)
{
   return std::pair{std::to_string(i), std::to_string(i * 1024)};
}

#define CHECK_CURSOR(cursor, k, v)         \
   do                                      \
   {                                       \
      CHECK(cursor.valid());               \
      if (cursor.valid())                  \
      {                                    \
         CHECK(cursor.get_key() == (k));   \
         CHECK(cursor.get_value() == (v)); \
      }                                    \
   } while (false)

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
   cursor.insert("a", "v1");
   cursor.lower_bound("a");
   CHECK_CURSOR(cursor, "a", "v1");
   cursor.lower_bound(std::string_view{"a", 2});
   CHECK(!cursor.valid());
   cursor.lower_bound(" ");
   CHECK_CURSOR(cursor, "a", "v1");
}

TEST_CASE("lower_bound large", "[lower_bound]")
{
   tmp_file file;

   psidb::database db(file.native_handle(), 1024);
   auto            trx    = db.start_transaction();
   auto            cursor = trx.get_cursor();
   for (int i = 100; i < 900; i += 2)
   {
      auto [k, v] = make_kv(i);
      cursor.insert(k, v);
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

TEST_CASE("leaf transaction insert independence")
{
   tmp_file file;

   psidb::database db(file.native_handle(), 1024);
   auto            trx    = db.start_transaction();
   auto            cursor = trx.get_cursor();
   // add elements
   cursor.insert("b", "v1");
   trx.commit();

   // After a transaction is committed, it can still be used read-only
   // or converted to a read transaction.
   auto trx2    = db.start_transaction();
   auto cursor2 = trx2.get_cursor();
   // add more elements
   cursor2.insert("a", "v2");

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
      cursor.insert(k, v);
   }
   trx.commit();

   auto trx2    = db.start_transaction();
   auto cursor2 = trx2.get_cursor();
   for (int i = 400; i < 600; ++i)
   {
      auto [k, v] = make_kv(i);
      cursor2.insert(k, v);
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
