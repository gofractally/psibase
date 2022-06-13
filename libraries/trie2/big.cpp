#include <stdlib.h>
#include <boost/format.hpp>
#include <consthash/all.hxx>
#include <fstream>
#include <iostream>
#include <map>
#include <unistd.h>
#include <random>

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
   static std::mt19937 gen(-1);
   return uint64_t(gen())<<32 | gen();
}
/*
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
*/



int main(int argc, char** argv)
{
   uint64_t       total = 2 * 1000 * 1000 * 1000;
   trie::database db(
       "big.dir",
       trie::database::config{
        //   .max_objects = (1 * total) / 4, .hot_pages = 1 * 1024ull, .cold_pages = 8*124 * 1024ull},
          .max_objects = (5 * total) / 4, .hot_pages = 31, 
                                          .warm_pages = 31,
                                          .cool_pages = 31,
                                          .cold_pages = 31 },
       //    .max_objects = (5 * total) / 4, .hot_pages =  16*1024ull, .cold_pages = 8*1024 * 1024ull},
       trie::database::read_write);
   db.print_stats();
   auto s = db.start_write_session();

   std::vector<uint64_t> revisions;
   revisions.resize(16);

   std::map<std::string,std::string> base;

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
   struct tlc {
      alignas(64) std::atomic<uint64_t> total_lookups;
   };
   tlc total_lookups[6];
   for( auto& t : total_lookups ) t.total_lookups.store(0);

   std::atomic<uint64_t> revs[6];
   for( auto& r : revs ) r.store(0);

   auto read_loop =  [&](int c) {
      int v = r.load();
      auto rs = db.start_read_session();

      std::mt19937 gen(c);

      uint64_t ch = 0;
      while( true ) {
         rs->set_session_revision( {revisions[(v-4)%16]} );
         while( r.load(std::memory_order_relaxed) == v ) {
            uint64_t h = (uint64_t(gen()) << 32) | gen();
            ch *= 1000999;
            auto itr =  rs->lower_bound( std::string_view((char*)&h, sizeof(h)) );
            if( itr.valid() )
               ++total_lookups[c].total_lookups;
         }
         v = r.load();
  //       if( c == 0 )
  //         WARN( "read revision: ", (v-4)%16 );
         revs[c].store(v);
      //   rs = db.start_read_revision(v-4);
      }
   };

/*
    new std::thread( [&](){
        auto rs = db.start_read_session();
         
        uint64_t last_r = 8;
        while( true ) {
           uint64_t min = -1ull;
           for( auto& r: revs ) {
               if( r.load() < min )
                  min = r.load();
           }
           if( min > last_r ) {
         //     WARN( "release revision: ", (min-6)%16, "  r: ", min );
              rs->release_revision( {revisions[(min-7)%16]} );     
              revisions[(min-7)%16] = 0;
              last_r = min;
           }
        }
    });
    */


   auto get_total_lookups = [&](){
      return total_lookups[0].total_lookups.load() + 
             total_lookups[1].total_lookups.load() + 
             total_lookups[2].total_lookups.load() + 
             total_lookups[3].total_lookups.load() + 
             total_lookups[4].total_lookups.load() + 
             total_lookups[5].total_lookups.load();
   };

   int64_t read_start = 0;
   std::string k;
   for (uint64_t i = 0; i < total; ++i)
   {
      try
      {
       //  if( i & (0xff == 0 )
       //     db.swap();
         if ( false and i % (total / perc) == 1 )
         {

            ++r;
     //       s->release_revision( {revisions[r%16]} );
            revisions[r%16] = s->get_session_revision().id;
            s->retain( {revisions[r%16]} );
            auto v = r.load(std::memory_order_relaxed);
            /*
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
            */
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
            std::cout << std::setw(12) << int64_t((total / perc) /
                             (std::chrono::duration<double, std::milli>(delta).count() / 1000))
                      << " items/sec   " << i << " total  reads/sec: " << std::setw(12) << uint64_t(delta_read / ((std::chrono::duration<double, std::milli>(delta).count() / 1000)))  <<"\n";
         }

         uint64_t v[2];
         uint64_t h[4];
         h[0]= rand64();
         h[1]= rand64();
         h[2]= rand64();
         h[3]= rand64();
      //   h          = bswap(h);
          auto hk =  std::string_view((char*)h, sizeof(h));
          /*
          for( auto c : k ) {
             assert( 0 == c >> 6 );
          }
          */

       //  h &= 0x3f3f3f3f3f3f3f3f;
         
         if (i < total )
         {
            //base.emplace( std::make_pair(k,std::string((char*)&h, sizeof(h))) );
            bool inserted = s->upsert(hk, hk);
            if( not inserted ) {
               WARN( "failed to insert: ", h );
            }
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
