#include <stdlib.h>
#include <unistd.h>
#include <boost/format.hpp>
#include <fstream>
#include <iostream>
#include <map>
#include <random>

#include <boost/program_options/cmdline.hpp>
#include <boost/program_options/options_description.hpp>
#include <boost/program_options/parsers.hpp>
#include <boost/program_options/variables_map.hpp>

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
   namespace po            = boost::program_options;
   uint32_t    hot_page_c  = 34;
   uint32_t    warm_page_c = 33;
   uint32_t    cool_page_c = 35;
   uint32_t    cold_page_c = 35;
   uint64_t    num_objects = 500 * 1000 * 1000;
   std::string db_dir;
   bool        use_string = false;
   uint64_t    insert_count;
   uint64_t    status_count;
   bool        check_content = false;

   uint32_t                num_read_threads = 6;
   po::options_description desc("Allowed options");
   auto                    opt = desc.add_options();
   opt("help,h", "print this message");
   opt("reset", "reset the database");
   opt("sparce", po::value<bool>(&use_string)->default_value(false), "use sparse string keys");
   opt("data-dir", po::value<std::string>(&db_dir)->default_value("./big.dir"),
       "the folder that contains the database");
   opt("read-threads,r", po::value<uint32_t>(&num_read_threads)->default_value(6),
       "number of read threads to launch");
   opt("hot-size,H", po::value<uint32_t>(&hot_page_c)->default_value(33),
       "the power of 2 for the amount of RAM for the hot ring, RAM = 2^(hot_size) bytes");
   opt("warm-size,w", po::value<uint32_t>(&warm_page_c)->default_value(33),
       "the power of 2 for the amount of RAM for the warm ring, RAM = 2^(warm_size) bytes");
   opt("cool-size,c", po::value<uint32_t>(&cool_page_c)->default_value(33),
       "the power of 2 for the amount of RAM for the cool ring, RAM = 2^(cool_size) bytes");
   opt("cold-size,C", po::value<uint32_t>(&cold_page_c)->default_value(33),
       "the power of 2 for the amount of RAM for the cold ring, RAM = 2^(cold_size) bytes");
   opt("max-objects,O", po::value<uint64_t>(&num_objects)->default_value(num_objects),
       "the maximum number of unique objects in the database");
   opt("insert,i", po::value<uint64_t>(&insert_count)->default_value(100000000ull),
       "the number of random key/value pairs to insert");
   opt("stat,s", po::value<uint64_t>(&status_count)->default_value(1000000ull),
       "the number of how often to print stats");
   opt("check-content", po::bool_switch(&check_content), "check content against std::map (slow)");

   po::variables_map vm;
   po::store(po::parse_command_line(argc, argv, desc), vm);
   po::notify(vm);

   if (vm.count("help"))
   {
      std::cerr << desc << "\n";
      return 1;
   }
   if (vm.count("reset"))
   {
      std::cerr << "resetting database\n";
      std::filesystem::remove_all(db_dir);
      triedent::database::create(db_dir,
                                 triedent::database::config{.hot_bytes  = 1ull << hot_page_c,
                                                            .warm_bytes = 1ull << warm_page_c,
                                                            .cool_bytes = 1ull << cool_page_c,
                                                            .cold_bytes = 1ull << cold_page_c});
   }

   if (num_read_threads > 64)
   {
      std::cerr << "maximum number of read threads is 64\n";
      return 0;
   }

   uint64_t total = insert_count;  //2 * 1000 * 1000 * 1000;
   auto  _db = std::make_shared<triedent::database>(db_dir.c_str(), triedent::database::read_write);
   auto& db  = *_db;
   db.print_stats();
   std::cerr << "\n";
   auto s    = db.start_write_session();
   auto root = s->get_top_root();

   using root_t = std::shared_ptr<triedent::root>;
   std::mutex          revisions_mutex;
   std::vector<root_t> revisions(16);

   auto start = std::chrono::steady_clock::now();
   srand(time(nullptr));

   std::cerr << "starting...\n";

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
      try
      {
         int    v  = r.load();
         auto   rs = db.start_read_session();
         root_t rr;

         std::mt19937 gen(c);

         uint64_t ch = 0;
         while (not done.load(std::memory_order_acquire))
         {
            {
               std::lock_guard lock{revisions_mutex};
               rr = {revisions[(v - 4) % 16]};
            }
            while (r.load(std::memory_order_relaxed) == v)
            {
               uint64_t h = (uint64_t(gen()) << 32) | gen();
               // TODO
               // auto     itr = rs->lower_bound(rr, std::string_view((char*)&h, sizeof(h)));
               // if (itr.valid())
               //    ++total_lookups[c].total_lookups;
               if (done.load(std::memory_order_relaxed))
                  break;
            }

            v = r.load();
            //  TRIEDENT_WARN( "revs[",c,"] = ", v );
            revs[c].store(v);
         }
      }
      catch (std::exception& e)
      {
         std::cerr << e.what() << "\n";
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
             uint64_t min = r.load() - 1;
             for (auto& r : revs)
             {
                if (r.load() < min)
                   min = r.load();
             }
             //     TRIEDENT_WARN( "min: ", min );
             if (min > last_r)
             {
                //            TRIEDENT_WARN( "release revision: ", (min-6)%16, "  r: ", min );
                root_t r;
                {
                   std::lock_guard lock{revisions_mutex};
                   r = std::move(revisions[(min - 6) % 16]);
                }
                rs->release(r);
                last_r = min;
             }
             usleep(100);
          }
          // TRIEDENT_WARN("exit GC");
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
   // TRIEDENT_WARN("INSERT COUNT: ", insert_count);
   std::map<std::string, std::string> comparison_map;
   for (uint64_t i = 0; i < insert_count; ++i)
   {
      try
      {
         if (i > 0 and i % (status_count / 10) == 0)
         {
            auto   new_r = r.load();
            root_t old_root;
            {
               std::lock_guard lock{revisions_mutex};
               old_root              = std::move(revisions[new_r % 16]);
               revisions[new_r % 16] = root;
            }
            s->release(old_root);

            if (++r == 6)
            {
               // TRIEDENT_WARN("STARTING READ THREADS");
               for (int x = 0; x < num_read_threads; ++x)
               {
                  rthreads.emplace_back(new std::thread([&, x]() { read_loop(x); }));
               }
            }
         }

         if (i % (status_count * 10) == 0 && false)
         {
            db.print_stats();
            std::cerr << "\n";
         }

         if (i % status_count == 0)
         {
            auto end        = std::chrono::steady_clock::now();
            auto delta      = end - lstart;
            lstart          = end;
            auto read_end   = get_total_lookups();
            auto delta_read = read_end - read_start;
            read_start      = read_end;
            std::cerr << std::setw(12)
                      << int64_t(status_count /
                                 (std::chrono::duration<double, std::milli>(delta).count() / 1000))
                      << " items/sec   " << i << " total  reads/sec: " << std::setw(12)
                      << uint64_t(
                             delta_read /
                             ((std::chrono::duration<double, std::milli>(delta).count() / 1000)))
                      << "\n";
         }

         uint64_t    v[2];
         uint64_t    h[4];
         std::string str = std::to_string(rand64());
         h[0]            = rand64();
         h[1]            = rand64();
         h[2]            = rand64();
         h[3]            = rand64();
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
            if (use_string)
            {
               if (check_content)
                  comparison_map[str] = str;
               int inserted;
               inserted = s->upsert(root, str, str);
               if (inserted >= 0)
               {
                  // TRIEDENT_WARN("failed to insert: ", h);
                  break;
               }
               assert(inserted < 0);
            }
            else
            {
               if (check_content)
                  comparison_map[(std::string)hk] = (std::string)hk;
               int inserted;
               inserted = s->upsert(root, hk, hk);
               if (inserted >= 0)
               {
                  // TRIEDENT_WARN("failed to insert: ", h);
                  break;
               }
               assert(inserted < 0);
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
   for (auto& r : rthreads)
      r->join();
   gc->join();

   auto end   = std::chrono::steady_clock::now();
   auto delta = end - start;
   std::cerr << "\ninsert took:    " << std::chrono::duration<double, std::milli>(delta).count()
             << " ms\n";
   s->set_top_root(root);
   db.print_stats();
   std::cerr << "\n";

   if (check_content)
   {
      std::cerr << "Checking content...\n";
      int missing    = 0;
      int mismatched = 0;
      for (auto& [k, v] : comparison_map)
      {
         std::vector<char> read_value;
         if (!s->get(root, k, &read_value, nullptr))
            ++missing;
         else if (std::string_view{read_value.data(), read_value.size()} != v)
            ++mismatched;
      }
      std::cerr << "missing: " << missing << " mismatched: " << mismatched << "\n";
   }

   return 0;
}
