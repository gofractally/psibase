#include <stdlib.h>
#include <unistd.h>
#include <boost/format.hpp>
#include <consthash/all.hxx>
#include <fstream>
#include <iostream>
#include <map>
#include <random>

#include <boost/program_options/cmdline.hpp>
#include <boost/program_options/options_description.hpp>

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
   return uint64_t(gen()) << 32 | gen();
}

int main(int argc, char** argv)
{
   namespace po = boost::program_options;

   po::options_description desc( "Allowed options" );
   desc.add_options()
      ("help", "print this message")
      ("read-threads", "number of read threads to launch")
      ("hot-size", "the power of 2 for the amount of RAM for the hot ring, RAM = 2^(hot_size) bytes")
      ("warm-size", "the power of 2 for the amount of RAM for the warm ring, RAM = 2^(hot_size) bytes")
      ("cool-size", "the power of 2 for the amount of RAM for the cool ring, RAM = 2^(hot_size) bytes")
      ("cold-size", "the power of 2 for the amount of RAM for the cold ring, RAM = 2^(hot_size) bytes")
      ;
      


   uint64_t       num_read_threads = 10;
   uint64_t       total            = 2 * 1000 * 1000 * 1000;
   trie::database db(
       "big.dir",
       trie::database::config{
           //   .max_objects = (1 * total) / 4, .hot_pages = 1 * 1024ull, .cold_pages = 8*124 * 1024ull},
           .max_objects = (5 * total) / 4,
           .hot_pages   = 34,
           .warm_pages  = 33,
           .cool_pages  = 35,
           .cold_pages  = 35},
       //    .max_objects = (5 * total) / 4, .hot_pages =  16*1024ull, .cold_pages = 8*1024 * 1024ull},
       trie::database::read_write);
   db.print_stats();
   auto s = db.start_write_session();

   std::vector<uint64_t> revisions;
   revisions.resize(16);

   std::map<std::string, std::string> base;

   srand(0);  //uint64_t(&db));
   auto start = std::chrono::steady_clock::now();

   std::cout << "starting...\n";

   int  insert_fails = 0;
   auto lstart       = std::chrono::steady_clock::now();

   int                   perc = 1000;
   std::atomic<uint64_t> r(1);
   struct tlc
   {
      alignas(64) std::atomic<uint64_t> total_lookups;
   };
   tlc total_lookups[6];
   for (auto& t : total_lookups)
      t.total_lookups.store(0);

   std::atomic<uint64_t> revs[32];
   for (auto& r : revs)
      r.store(0);

   auto read_loop = [&](int c)
   {
      int  v  = r.load();
      auto rs = db.start_read_session();

      std::mt19937 gen(c);

      uint64_t ch = 0;
      while (true)
      {
         rs->set_session_revision({revisions[(v - 4) % 16]});
         while (r.load(std::memory_order_relaxed) == v)
         {
            uint64_t h = (uint64_t(gen()) << 32) | gen();
            ch *= 1000999;
            auto itr = rs->lower_bound(std::string_view((char*)&h, sizeof(h)));
            if (itr.valid())
               ++total_lookups[c].total_lookups;
         }
         v = r.load();
         revs[c].store(v);
      }
   };

   new std::thread(
       [&]()
       {
          auto rs = db.start_read_session();

          uint64_t last_r = 8;
          while (true)
          {
             uint64_t min = -1ull;
             for (auto& r : revs)
             {
                if (r.load() < min)
                   min = r.load();
             }
             if (min > last_r)
             {
                //     WARN( "release revision: ", (min-6)%16, "  r: ", min );
                rs->release_revision({revisions[(min - 7) % 16]});
                revisions[(min - 7) % 16] = 0;
                last_r                    = min;
             }
          }
       });

   auto get_total_lookups = [&]()
   {
      uint64_t t = 0;
      for (uint32_t x = 0; x < num_read_threads; ++x)
         t += total_lookups[x].total_lookups.load();
      return t;
   };

   int64_t     read_start = 0;
   std::string k;
   for (uint64_t i = 0; i < total; ++i)
   {
      try
      {
         //  if( i & (0xff == 0 )
         //     db.swap();
         if (i % (total / perc) == 1)
         {
            ++r;
            //       s->release_revision( {revisions[r%16]} );
            revisions[r % 16] = s->get_session_revision().id;
            s->retain({revisions[r % 16]});
            auto v = r.load(std::memory_order_relaxed);
            if (v == 6)
            {
               WARN("STARTING READ THREADS");
               for (int x = 0; x < num_read_threads; ++x)
               {
                  new std::thread([&, x]() { read_loop(x); });
               }
            }
         }

         if (i % (total / (perc / 20)) == 1)
         {
            db.print_stats();
         }
         if (i % (total / perc) == 1)
         {
            auto end        = std::chrono::steady_clock::now();
            auto delta      = end - lstart;
            lstart          = end;
            auto read_end   = get_total_lookups();
            auto delta_read = read_end - read_start;
            read_start      = read_end;
            std::cout << std::setw(12)
                      << int64_t((total / perc) /
                                 (std::chrono::duration<double, std::milli>(delta).count() / 1000))
                      << " items/sec   " << i << " total  reads/sec: " << std::setw(12)
                      << uint64_t(
                             delta_read /
                             ((std::chrono::duration<double, std::milli>(delta).count() / 1000)))
                      << "\n";
         }

         uint64_t v[2];
         uint64_t h[4];
         h[0] = rand64();
         h[1] = rand64();
         h[2] = rand64();
         h[3] = rand64();
         //   h          = bswap(h);
         auto hk = std::string_view((char*)h, sizeof(h));
         /*
          for( auto c : k ) {
             assert( 0 == c >> 6 );
          }
          */

         //  h &= 0x3f3f3f3f3f3f3f3f;

         if (i < total)
         {
            //base.emplace( std::make_pair(k,std::string((char*)&h, sizeof(h))) );
            bool inserted = s->upsert(hk, hk);
            if (not inserted)
            {
               WARN("failed to insert: ", h);
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
