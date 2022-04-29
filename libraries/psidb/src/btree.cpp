#include <cassert>
#include <cstdint>
#include <cstring>
#include <string_view>

#include <sys/mman.h>
#include <psidb/cursor.hpp>
#include <psidb/page_manager.hpp>

using namespace psidb;

#include <iostream>

auto make_kv(int i)
{
   return std::pair{std::to_string(i), std::to_string(i * 1024)};
}

int main(int argc, const char** argv)
{
   page_manager db("psi.dat", 65536);
   auto         trx = db.start_transaction();
   cursor       c(&db, trx);

   bool insert = (argc > 1 && argv[1] == std::string("--store"));
   if (insert)
   {
      for (int i = 0; i < 10; ++i)
      {
         auto [k, v] = make_kv(i);
         c.insert(k, v);
      }
   }
   db.commit_transaction(trx);
   for (int i = 0; i < 10; ++i)
   {
      auto [k, v] = make_kv(i);
      c.lower_bound(k);
      std::cout << c.get_key() << ": " << c.get_value() << std::endl;
   }
   db.async_flush();
}
