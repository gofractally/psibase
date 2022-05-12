#include <stdlib.h>
#include <boost/format.hpp>
#include <consthash/all.hxx>
#include <fstream>
#include <iostream>
#include <mdbx.h++>

uint64_t bswap(uint64_t x)
{
   x = (x & 0x00000000FFFFFFFF) << 32 | (x & 0xFFFFFFFF00000000) >> 32;
   x = (x & 0x0000FFFF0000FFFF) << 16 | (x & 0xFFFF0000FFFF0000) >> 16;
   x = (x & 0x00FF00FF00FF00FF) << 8 | (x & 0xFF00FF00FF00FF00) >> 8;
   return x;
}

int64_t rand64()
{
   return uint64_t(rand()) << 32 | uint64_t(rand());
}

int main(int argc, char** argv)
{
   mdbx::env_managed::create_parameters  cp;
   mdbx::env_managed::operate_parameters op;
   op.options.nested_write_transactions = true;
   op.options.orphan_read_transactions  = false;
   mdbx::env_managed env(std::string{"big.lmdbx"}, cp, op);

   mdbx::map_handle kv_map;
   {
      auto trx = env.start_write();
      kv_map   = trx.create_map(nullptr);
      trx.commit();
   }

   auto trx = env.start_write();

   /*
   int count = 0;
   auto itr = s.first();
   while( itr.valid() ) {
      ++itr;
      ++count;
   }
   std::cout <<"total items: " << count<<"\n";
   */

   srand(uint64_t(&env));
   auto start = std::chrono::steady_clock::now();

   std::cout << "starting...\n";

   auto     lstart = std::chrono::steady_clock::now();
   uint64_t total  = 10000 * 1000ull * 10ull * 10;
   for (uint64_t i = 0; i < total; ++i)
   {
      if (i % (total / 1000) == 0)
      {
         trx.commit();
         trx        = env.start_write();
         auto end   = std::chrono::steady_clock::now();
         auto delta = end - lstart;
         lstart     = end;
         std::cerr << "progress " << 100 * double(i) / total << "  "
                   << std::chrono::duration<double, std::milli>(delta).count() << "\n";
         std::cout << (total / 1000) /
                          (std::chrono::duration<double, std::milli>(delta).count() / 1000)
                   << " items/sec   " << i << " total\n";
      }

      uint64_t v[2];
      uint64_t h = rand64() + rand64() + rand64() + rand64() + rand64();
      h          = bswap(h);

      h &= 0x3f3f3f3f3f3f3f3f;
      trx.upsert(kv_map, {(char*)&h, (char*)&h + sizeof(h)}, {(char*)&v, (char*)&v + sizeof(v)});
   }
   trx.commit();
   auto end   = std::chrono::steady_clock::now();
   auto delta = end - start;
   std::cerr << "insert took:    " << std::chrono::duration<double, std::milli>(delta).count()
             << " ms\n";
   return 0;
}
