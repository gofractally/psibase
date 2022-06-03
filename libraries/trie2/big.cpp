#include <stdlib.h>
#include <boost/format.hpp>
#include <consthash/all.hxx>
#include <fstream>
#include <iostream>

#include <trie/trie.hpp>

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
inline std::string to_key6(const std::string_view v)
{
//   std::cout << "to_key(" << v <<")\n";
//   for( auto c : v ) { print8(c); std::cout <<" "; }
//   std::cout <<"\n";

   auto bits  = v.size() * 8;
   auto byte6 = (bits + 5) / 6;

   std::string out;
   out.resize(byte6);

   char* pos6     = out.data();
   const char* pos8     = v.data();
   const char* pos8_end = v.data() + v.size();

   while (pos8 + 3 <= pos8_end)
   {
      pos6[0] = pos8[0] >> 2;
      pos6[1] = (pos8[0] & 0x3) << 4 | pos8[1] >> 4;
      pos6[2] = (pos8[1] & 0xf) << 2 | (pos8[2] >> 6);
      pos6[3] = pos8[2] & 0x3f;
      pos8 += 3;
      pos6 += 4;
   }

   switch (pos8_end - pos8)
   {
      case 2:
         pos6[0] = pos8[0] >> 2;
         pos6[1] = (pos8[0] & 0x3) << 4 | pos8[1] >> 4;
         pos6[2] = (pos8[1] & 0xf) << 2;
         break;
      case 1:
         pos6[0] = pos8[0] >> 2;
         pos6[1] = (pos8[0] & 0x3) << 4;
         break;
      default:
         break;
   }
   return out;
}

int main(int argc, char** argv)
{
   uint64_t       total = 2 * 1000 * 1000 * 1000;
   trie::database db(
       "big.dir",
       trie::database::config{
           //.max_objects = (5 * total) / 4, .hot_pages = 16 * 1024ull, .cold_pages = 8*1024 * 1024ull},
           .max_objects = (5 * total) / 4, .hot_pages = 8*256* 1024ull, .cold_pages = 8*1024 * 1024ull},
       //    .max_objects = (5 * total) / 4, .hot_pages =  16*1024ull, .cold_pages = 8*1024 * 1024ull},
       trie::database::read_write);
   db.print_stats();
   auto s = db.start_revision(0, 0);

   /*
   int count = 0;
   auto itr = s.first();
   while( itr.valid() ) {
      ++itr;
      ++count;
   }
   std::cout <<"total items: " << count<<"\n";
   */

   srand(0);  //uint64_t(&db));
   auto start = std::chrono::steady_clock::now();

   std::cout << "starting...\n";

   int  insert_fails = 0;
   auto lstart       = std::chrono::steady_clock::now();

   int perc = 1000;
   int r    = 1;


   std::string k;
   for (uint64_t i = 0; i < total; ++i)
   {
      try
      {
         if (i % (total / 1000000) == 0)
         {
            db.swap();

            if (r > 1)
            {
               auto ns = db.start_revision(r, r - 1);
               ++r;
               if (r > 10)
               {
                  auto old = db.start_revision(r - 10, r - 10);
                  old.clear();
               }
               s = ns;
            }
         }
         // if( r > 10000 ) {
         //    WARN( "TO MANY REV" );
         //    return 0;
         // }

         if (i % (total / (perc/20)) == 1) {
           db.print_stats();
         }
         if (i % (total / perc) == 1)
         {
            auto end   = std::chrono::steady_clock::now();
            auto delta = end - lstart;
            lstart     = end;
            std::cerr << "progress " << 100 * double(i) / total << "  "
                      << std::chrono::duration<double, std::milli>(delta).count() << "\n";
            std::cout << (total / perc) /
                             (std::chrono::duration<double, std::milli>(delta).count() / 1000)
                      << " items/sec   " << i << " total  fails " << insert_fails << "\n";
         }

         uint64_t v[2];
         uint64_t h =rand64()/4 + rand64()/4 + rand64()/4 + rand64()/4 + rand64()/4;
      //   h          = bswap(h);
          k = to_key6( std::string_view((char*)&h, sizeof(h)) );

       //  h &= 0x3f3f3f3f3f3f3f3f;
         
         if (i < total )
         {
            bool inserted = s.upsert(std::string_view(k.data(), k.size()),
                                     std::string_view((char*)&h, sizeof(h)));
            assert(inserted);

            //auto got = s.get( std::string_view((char*)&h, sizeof(h)) );
            //assert( got );
            /*
            if (r > 445)
            {
               if( i == 134100-10 ) {
               //if (i % 10 == 0)
                  s.validate();
               }
            }
            */
         }
      }
      catch (const std::exception& e)
      {
         std::cerr << e.what() << " i = " << i << "\n";
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
