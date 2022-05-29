#include <stdlib.h>
#include <boost/format.hpp>
#include <consthash/all.hxx>
#include <fstream>
#include <iostream>

#include <trie/trie.hpp>

uint64_t bswap (uint64_t x) {
x = (x & 0x00000000FFFFFFFF) << 32 | (x & 0xFFFFFFFF00000000) >> 32;
x = (x & 0x0000FFFF0000FFFF) << 16 | (x & 0xFFFF0000FFFF0000) >> 16;
x = (x & 0x00FF00FF00FF00FF) << 8  | (x & 0xFF00FF00FF00FF00) >> 8;
return x;
}

int64_t rand64() {
   return uint64_t(rand())<<32 | uint64_t(rand());
}

int main(int argc, char** argv)
{
   trie::database db( "big.dir", trie::database::config{
                      .max_objects = 4000*1000*1000ull,
                      .hot_pages  = 500*1000ull,
                      .cold_pages  = 22000*1000ull
                      }, trie::database::read_write );
   db.print_stats();
   auto s = db.start_revision( 0, 0 );


   /*
   int count = 0;
   auto itr = s.first();
   while( itr.valid() ) {
      ++itr;
      ++count;
   }
   std::cout <<"total items: " << count<<"\n";
   */

   srand(0);//uint64_t(&db));
   auto start = std::chrono::steady_clock::now();

   std::cout << "starting...\n";

   int insert_fails = 0;
   auto     lstart = std::chrono::steady_clock::now();
   uint64_t total  = 30000 * 1000ull * 10ull * 10;
   for (uint64_t i = 0; i < total; ++i)
   {
      try {
      if (i % (total / 10000) == 0) {
         db.swap();
      }
      if (i % (total / 1000) == 0)
      {
         auto end   = std::chrono::steady_clock::now();
         auto delta = end - lstart;
         lstart     = end;
         std::cerr << "progress " << 100 * double(i) / total << "  " << std::chrono::duration<double,std::milli>(delta).count() <<"\n";
         std::cout << (total/1000) / (std::chrono::duration<double,std::milli>(delta).count()/1000) <<" items/sec   " << i <<" total  fails " << insert_fails <<"\n";
      }

      uint64_t v[2];
      uint64_t h = rand64() + rand64()+rand64() + rand64() + rand64();
      h = bswap(h);

      h &= 0x3f3f3f3f3f3f3f3f;
      insert_fails += not s.upsert(std::string_view((char*)&h, sizeof(h)), std::string_view((char*)&v, sizeof(v)));
      } catch ( const std::exception& e ) {
         std::cerr << e.what() << " i = " << i <<"\n";
         return -1;
      }
   }
   

   auto end   = std::chrono::steady_clock::now();
   auto delta = end - start;
   std::cerr << "insert took:    " << std::chrono::duration<double, std::milli>(delta).count()
             << " ms\n";

//   s.clear();
//   db.print_stats();


   return 0;
}
