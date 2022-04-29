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
