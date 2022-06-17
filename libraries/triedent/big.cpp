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
#include <boost/program_options/variables_map.hpp>
#include <boost/program_options/parsers.hpp>

#include <triedent/database.hpp>

uint64_t bswap(uint64_t x)
{
   x = (x & 0x00000000FFFFFFFF) << 32 | (x & 0xFFFFFFFF00000000) >> 32;
   x = (x & 0x0000FFFF0000FFFF) << 16 | (x & 0xFFFF0000FFFF0000) >> 16;
   x = (x & 0x00FF00FF00FF00FF) << 8 | (x & 0xFF00FF00FF00FF00) >> 8;
   return x;
}

int64_t rand64()
{
   static std::mt19937 gen(rand());
   return uint64_t(gen()) << 32 | gen();
}

int main(int argc, char** argv)
{
   namespace po = boost::program_options;
   uint32_t hot_page_c = 34;
   uint32_t warm_page_c = 33;
   uint32_t cool_page_c = 35;
   uint32_t cold_page_c = 35;
   uint64_t num_objects = 500*1000*1000;
   std::string db_dir;
   bool use_string = false;
   uint64_t insert_count;
   uint64_t status_count;

   uint32_t       num_read_threads = 6;
   po::options_description desc( "Allowed options" );
   desc.add_options()
      ("help,h", "print this message")
      ("reset", "reset the database" )
      ("sparce", po::value<bool>(&use_string)->default_value(false), "use sparse string keys" )
      ("data-dir", po::value<std::string>(&db_dir)->default_value("./big.dir"), "the folder that contains the database" )
      ("read-threads,r", po::value<uint32_t>(&num_read_threads)->default_value(6), "number of read threads to launch")
      ("hot-size,H", po::value<uint32_t>(&hot_page_c)->default_value(33), "the power of 2 for the amount of RAM for the hot ring, RAM = 2^(hot_size) bytes")
      ("warm-size,w", po::value<uint32_t>(&warm_page_c)->default_value(33), "the power of 2 for the amount of RAM for the warm ring, RAM = 2^(warm_size) bytes")
      ("cool-size,c", po::value<uint32_t>(&cool_page_c)->default_value(33), "the power of 2 for the amount of RAM for the cool ring, RAM = 2^(cool_size) bytes")
      ("cold-size,C",po::value<uint32_t>(&cold_page_c)->default_value(33),  "the power of 2 for the amount of RAM for the cold ring, RAM = 2^(cold_size) bytes")
      ("max-objects,O",po::value<uint64_t>(&num_objects)->default_value(num_objects),  "the maximum number of unique objects in the database")
      ("insert,i",po::value<uint64_t>(&insert_count)->default_value(100000000ull),  "the number of random key/value pairs to insert")
      ("stat,s",po::value<uint64_t>(&status_count)->default_value(1000000ull),  "the number of how often to print stats")
      ;

   po::variables_map vm;
   po::store( po::parse_command_line( argc, argv, desc), vm );
   po::notify(vm);

   if( vm.count("help") ) {
      std::cout << desc <<"\n";
      return 1;
   }
   if( vm.count( "reset" ) ) {
      std::cout << "resetting database\n";
      std::filesystem::remove_all( db_dir );
   }

   if( num_read_threads > 64 ) {
      std::cerr << "maximum number of read threads is 64\n";
      return 0;
   }



   uint64_t       total            = insert_count ;//2 * 1000 * 1000 * 1000;
   triedent::database db( db_dir.c_str(), triedent::database::read_write);
   db.print_stats();
   auto s = db.start_write_session();
   s->set_session_revision( db.get_root_revision() );

   std::vector<uint64_t> revisions;
   revisions.resize(16);
   for( auto& e : revisions ) e = 0;

   std::map<std::string, std::string> base;

   auto start = std::chrono::steady_clock::now();
   srand(s->get_session_revision().id);

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

   std::atomic<uint64_t> revs[64];
   for (auto& r : revs)
      r.store(-1);

   std::atomic<bool> done;
   done.store(false);
   auto read_loop = [&](int c)
   {
      try  {
      int  v  = r.load();
      auto rs = db.start_read_session();

      std::mt19937 gen(c);

      uint64_t ch = 0;
      while ( not done.load( std::memory_order_acquire ) )
      {
         rs->set_session_revision({revisions[(v - 4) % 16]});
         while (r.load(std::memory_order_relaxed) == v  )
         {
            uint64_t h = (uint64_t(gen()) << 32) | gen();
            auto itr = rs->lower_bound(std::string_view((char*)&h, sizeof(h)));
            if (itr.valid())
               ++total_lookups[c].total_lookups;
            if(  done.load( std::memory_order_relaxed) )
               break;
         }

               
         v = r.load();
       //  WARN( "revs[",c,"] = ", v );
         revs[c].store(v);
      }
      } catch ( std::exception& e ) {
         std::cerr << e.what() <<"\n";
         exit(1);
      }
   };

   std::unique_ptr<std::thread> gc(new std::thread(
       [&]()
       {
          auto rs = db.start_read_session();

          uint64_t last_r = 8;
          while (not done.load())
          {
             uint64_t min = r.load()-1;
             for (auto& r : revs)
             {
                if (r.load() < min)
                   min = r.load();
             }
        //     WARN( "min: ", min );
             if (min > last_r)
             {
    //            WARN( "release revision: ", (min-6)%16, "  r: ", min );
                rs->release_revision({revisions[(min - 6) % 16]});
                revisions[(min - 6) % 16] = 0;
                last_r                    = min;
             }
             usleep(100);
          }
          WARN( "exit GC" );
       }));

   auto get_total_lookups = [&]()
   {
      uint64_t t = 0;
      for (uint32_t x = 0; x < num_read_threads; ++x)
         t += total_lookups[x].total_lookups.load();
      return t;
   };

   std::vector<std::unique_ptr<std::thread>> rthreads;

   int64_t     read_start = 0;
   std::string k;
   WARN( "INSERT COUNT: ", insert_count );
   for (uint64_t i = 0; i < insert_count; ++i)
   {
      try
      {
         if ( i > 0 and i % (status_count/10) == 0)
         {
            auto new_r = r.load();
     //       WARN( "NEW R: ", new_r, " id:" , s->get_session_revision().id );
            revisions[new_r % 16] = s->get_session_revision().id;
            s->retain({revisions[new_r % 16]});
            s->fork();


            if (++r == 6)
            {
               WARN("STARTING READ THREADS");
               for (int x = 0; x < num_read_threads; ++x)
               {
                  rthreads.emplace_back(new std::thread([&, x]() { read_loop(x); }));
               }
            }
         }

         if (i % (status_count*10) == 0) 
            db.print_stats();

         if (i % status_count == 0)
         {
            auto end        = std::chrono::steady_clock::now();
            auto delta      = end - lstart;
            lstart          = end;
            auto read_end   = get_total_lookups();
            auto delta_read = read_end - read_start;
            read_start      = read_end;
            std::cout << std::setw(12)
                      << int64_t(status_count /
                                 (std::chrono::duration<double, std::milli>(delta).count() / 1000))
                      << " items/sec   " << i << " total  reads/sec: " << std::setw(12)
                      << uint64_t(
                             delta_read /
                             ((std::chrono::duration<double, std::milli>(delta).count() / 1000)))
                      << "\n";
         }

         uint64_t v[2];
         uint64_t h[4];
         std::string str = std::to_string(rand64());
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
            if( use_string ) {
               auto inserted = s->upsert(str,str);
               if (inserted >= 0 )
               {
                  WARN("failed to insert: ", h);
                  break;
               }
            assert(inserted<0);
            } else {
               auto inserted = s->upsert(hk,hk);
               if (inserted >= 0 )
               {
                  WARN("failed to insert: ", h);
                  break;
               }
            assert(inserted<0);
            }
         }
      }
      catch (const std::exception& e)
      {
         std::cerr << e.what() << " i = " << i << "\n";
         return -1;
      }
   }
   done.store(true);
   for( auto& r : rthreads ) r->join();
   gc->join();

   auto end   = std::chrono::steady_clock::now();
   auto delta = end - start;
   std::cerr << "insert took:    " << std::chrono::duration<double, std::milli>(delta).count()
             << " ms\n";

   s->set_root_revision(  s->get_session_revision() );
   db.print_stats();

   return 0;
}
