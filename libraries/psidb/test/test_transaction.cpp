#include <psidb/cursor.hpp>
#include <psidb/database.hpp>

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

int main()
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
   assert(cursor.get_value() == "v1");
}
