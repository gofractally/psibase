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

   uint8_t* pos6     = (uint8_t*)out.data();
   const uint8_t* pos8     = (uint8_t*)v.data();
   const uint8_t* pos8_end = (uint8_t*)v.data() + v.size();

   while (pos8 + 3 <= pos8_end)
   {
      pos6[0] = pos8[0] >> 2;
      pos6[1] = (pos8[0] & 0x3) << 4 | pos8[1] >> 4;
      pos6[2] = (pos8[1] & 0xf) << 2 | (pos8[2] >> 6);
      pos6[3] = pos8[2] & 0x3f;
      assert( (pos6[0] >> 6) == 0 );
      assert( (pos6[1] >> 6) == 0 );
      assert( (pos6[2] >> 6) == 0 );
      assert( (pos6[3] >> 6) == 0 );
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
   assert( (pos6[0] >> 6) == 0 );
   assert( (pos6[1] >> 6) == 0 );
   assert( (pos6[2] >> 6) == 0 );
   assert( (pos6[3] >> 6) == 0 );
   return out;
}

inline std::string to_key(const std::string_view v)
{
   std::string s(v.data(), v.size());
   for (auto& c : s)
   {
      c -= 62;
      c &= 63;
   }
   return s;
}



int main(int argc, char** argv)
{
   uint64_t       total = 2 * 1000 * 1000 * 1000;
   trie::database db(
       "big.dir",
       trie::database::config{
           //.max_objects = (5 * total) / 4, .hot_pages = 16 * 1024ull, .cold_pages = 8*1024 * 1024ull},
           .max_objects = (5 * total) / 4, .hot_pages = 4*256* 1024ull, .cold_pages = 4*1024 * 1024ull},
       //    .max_objects = (5 * total) / 4, .hot_pages =  16*1024ull, .cold_pages = 8*1024 * 1024ull},
       trie::database::read_write);
   db.print_stats();
   auto s = db.start_write_revision(0, 0);



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
   std::atomic<uint64_t> r(1);
   std::atomic<uint64_t> total_lookups[6];
   for( auto& t : total_lookups ) t.store(0);

   auto read_loop =  [&](int c) {
      int v = r.load();
      auto rs = db.start_read_revision(r-4);

      while( true ) {
         while( r.load(std::memory_order_relaxed) == v ) {
            uint64_t h =rand64()/4 + rand64()/4 + rand64()/4 + rand64()/4 + rand64()/4;
            auto k = to_key6( std::string_view((char*)&h, sizeof(h)) );
            auto itr =  rs->lower_bound( k );
            if( itr.valid() )
               ++total_lookups[c];
         }
         v = r.load();
         rs = db.start_read_revision(v-4);
      }
   };


   auto get_total_lookups = [&](){
      return total_lookups[0].load() + total_lookups[1].load() + total_lookups[2].load() + total_lookups[3].load() + total_lookups[4].load() + total_lookups[5].load();
   };

   int64_t read_start = 0;
   std::string k;
   for (uint64_t i = 0; i < total; ++i)
   {
      try
      {
         if (i % (total / perc) == 1 )
         {
         //   db.swap();

            ++r;
            auto v = r.load(std::memory_order_relaxed);
            if ( v > 1)
            {
               auto ns = db.start_write_revision(v, v - 1);
               if (v > 10)
               {
                  auto old = db.start_write_revision(v - 10, v - 10);
                  old->clear();
               }
               s = std::move(ns);
            }
            if( v == 6 ) {
               WARN( "STARTING READ THREADS" );
               new std::thread( [&](){read_loop(0);} );
               new std::thread( [&](){read_loop(1);} );
               new std::thread( [&](){read_loop(2);} );
               new std::thread( [&](){read_loop(3);} );
               new std::thread( [&](){read_loop(4);} );
               new std::thread( [&](){read_loop(5);} );
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
            auto read_end = get_total_lookups();
            auto delta_read = read_end - read_start;
            read_start = read_end;
            std::cerr << "progress " << 100 * double(i) / total << "  "
                      << std::chrono::duration<double, std::milli>(delta).count() << "\n";
            std::cout << (total / perc) /
                             (std::chrono::duration<double, std::milli>(delta).count() / 1000)
                      << " items/sec   " << i << " total  reads/sec: " << (delta_read / ((std::chrono::duration<double, std::milli>(delta).count() / 1000)))  <<"\n";
         }

         uint64_t v[2];
         uint64_t h =rand64()/4 + rand64()/4 + rand64()/4 + rand64()/4 + rand64()/4;
      //   h          = bswap(h);
          k = to_key6( std::string_view((char*)&h, sizeof(h)) );
          /*
          for( auto c : k ) {
             assert( 0 == c >> 6 );
          }
          */

       //  h &= 0x3f3f3f3f3f3f3f3f;
         
         if (i < total )
         {
            bool inserted = s->upsert(std::string_view(k.data(), k.size()),
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
