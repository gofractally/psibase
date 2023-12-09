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

#include <triedent/db.hpp>

uint64_t bswap(uint64_t x)
{
   x = (x & 0x00000000FFFFFFFF) << 32 | (x & 0xFFFFFFFF00000000) >> 32;
   x = (x & 0x0000FFFF0000FFFF) << 16 | (x & 0xFFFF0000FFFF0000) >> 16;
   x = (x & 0x00FF00FF00FF00FF) << 8 | (x & 0xFF00FF00FF00FF00) >> 8;
   return x;
}

int64_t rand64()
{
   thread_local static std::mt19937 gen(rand());
   return uint64_t(gen()) << 32 | gen();
}

std::string add_comma(uint64_t s)
{
   if (s < 1000)
      return std::to_string(s);
   if (s < 1000000)
   {
      return std::to_string(s / 1000) + ',' + std::to_string((s % 1000) + 1000).substr(1);
   }
   if (s < 1000000000)
   {
      return std::to_string(s / 1000000) + ',' +
             std::to_string(((s % 1000000) / 1000) + 1000).substr(1) + "," +
             std::to_string((s % 1000) + 1000).substr(1);
   }
   return std::to_string(s);
};

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
   uint32_t    rounds        = 10;

   uint32_t                num_read_threads = 6;
   po::options_description desc("Allowed options");
   auto                    opt = desc.add_options();
   opt("help,h", "print this message");
   opt("reset", "reset the database");
   opt("read-only", "just query existing db");
   opt("sparce", po::value<bool>(&use_string)->default_value(false), "use sparse string keys");
   opt("data-dir", po::value<std::string>(&db_dir)->default_value("./big.dir"),
       "the folder that contains the database");
   opt("read-threads,r", po::value<uint32_t>(&num_read_threads)->default_value(6),
       "number of read threads to launch");
   opt("rounds", po::value<uint32_t>(&rounds)->default_value(10),
       "the number of times to run each segment");
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
      triedent::database::create(db_dir,{ });
   }
   bool read_only = false;
   if (vm.count("read-only"))
   {
      read_only = true;
   }

   if (num_read_threads > 64)
   {
      std::cerr << "maximum number of read threads is 64\n";
      return 0;
   }

   triedent::DB::Options options{

   };

   std::cout << "opening database '" << db_dir << "'\n";
   auto  db = triedent::DB::open(options, db_dir);
   auto& ws = db->writeSession();

   uint32_t count = 1000 * 1000 * 10;
   int64_t  key   = 0;

   /*
   for( int i = 0; i  < 7; ++i ) {
      key++;
      auto wt    = ws.startTransaction();
      auto old_size = wt->put(std::span<char>((char*)&key, 8), std::span<char>((char*)&key, 8));
      wt->commit();
      std::cout << "-------------\n";
   }
   std::cout << "=================\n";

   {
      auto rs = db->createReadSession();
      auto rt = rs->startTransaction();

      for( int i = 0; i  < 2; ++i ) {
         key++;
         auto wt    = ws.startTransaction();
         auto old_size = wt->put(std::span<char>((char*)&key, 8), std::span<char>((char*)&key, 8));
         wt->commit();
         std::cout << "-------------\n";
      }
      std::cout << "read session going away\n";
   }
   std::cout << "write session going away\n";

      return 0;
      */

   if (0)
   {
      std::cout << "Starting to insert " << rounds << " rounds of " << add_comma(count)
                << " sequential key/values\n";
      for (uint32_t round = 0; round < rounds; ++round)
      {
         auto start = std::chrono::steady_clock::now();
         auto wt    = ws.startTransaction();

         for (uint32_t i = 0; i < count; ++i)
         {
            ++key;
            auto kv = bswap(key);
            auto old_size =
                wt->put(std::span<char>((char*)&kv, 8), std::span<char>((char*)&key, 8));
            if (old_size != -1)
            {
               std::cerr << "this should be a new value! : " << old_size << "\n";
               return 0;
            }
         }

         wt->commit();
         auto end   = std::chrono::steady_clock::now();
         auto delta = end - start;

         std::cerr << std::setw(4) << round << std::setw(12)
                   << add_comma(int64_t(
                          count /
                          (std::chrono::duration<double, std::milli>(delta).count() / 1000)))
                   << " items/sec   \n";
      }

      std::cout << "Starting to get" << rounds << " rounds of " << add_comma(count)
                << " sequential key/values\n";
      auto rs = db->createReadSession();
      auto rt = rs->startTransaction();
      key     = 0;
      std::vector<char> result;
      for (uint32_t round = 0; round < rounds; ++round)
      {
         auto start = std::chrono::steady_clock::now();

         for (uint32_t i = 0; i < count; ++i)
         {
            ++key;
            //auto kv = key;//bswap(key);
            auto kv    = bswap(key);
            auto found = rt->get(std::span<char>((char*)&kv, 8), &result);
            if (8 != result.size())  // not found.ok)
            {
               std::cerr << "unable to find key: " << key << "\n";
               return 0;
            }
            else
            {
               if (key != *((int64_t*)(result.data())))
               {
                  std::cerr << "value didn't match expected\n";
                  return 0;
               }
            }
            result.resize(0);
         }

         auto end   = std::chrono::steady_clock::now();
         auto delta = end - start;

         std::cerr << std::setw(4) << round << std::setw(12)
                   << add_comma(int64_t(
                          count /
                          (std::chrono::duration<double, std::milli>(delta).count() / 1000)))
                   << " items/sec   \n";
      }

      std::cout << "Starting to update " << rounds << " rounds of " << add_comma(count)
                << " sequential key/values\n";
      key = 0;
      for (uint32_t round = 0; round < rounds; ++round)
      {
         auto start = std::chrono::steady_clock::now();
         auto wt    = ws.startTransaction();

         for (uint32_t i = 0; i < count; ++i)
         {
            //   std::cerr<<i <<"           \r";
            ++key;
            auto    kv  = bswap(key);
            int64_t val = -key;
            auto    old_size =
                wt->put(std::span<char>((char*)&kv, 8), std::span<char>((char*)&val, 8));

            if (old_size != 8)
            {
               std::cerr << "unable to find old value! " << old_size << "  " << key << "\n";
               return 0;
            }
         }

         wt->commit();
         auto end   = std::chrono::steady_clock::now();
         auto delta = end - start;

         std::cerr << std::setw(4) << round << std::setw(12)
                   << add_comma(int64_t(
                          count /
                          (std::chrono::duration<double, std::milli>(delta).count() / 1000)))
                   << " items/sec   \n";
      }
   }
   if( 0 ) {

      std::cout << "Starting to insert " << rounds << " rounds of " << add_comma(count)
                << " random key/values\n";
      key = 0;
      for (uint32_t round = 0; round < rounds; ++round)
      {
         auto start = std::chrono::steady_clock::now();
         auto wt    = ws.startTransaction();

         for (uint32_t i = 0; i < count; ++i)
         {
            key         = rand64();
            int64_t val = i;
            auto    old_size =
                wt->put(std::span<char>((char*)&key, 8), std::span<char>((char*)&val, 8));
         }

         wt->commit();
         auto end   = std::chrono::steady_clock::now();
         auto delta = end - start;

         std::cerr << std::setw(4) << round << std::setw(12)
                   << add_comma(int64_t(
                          count /
                          (std::chrono::duration<double, std::milli>(delta).count() / 1000)))
                   << " items/sec   \n";
      }
   }
   if( 0 ){

      auto rs = db->createReadSession();
      auto rt = rs->startTransaction();
      std::cout << "Starting to find lower bound " << rounds << " rounds of " << add_comma(count)
                << " random key/values\n";
      std::vector<char> result_key;
      std::vector<char> result_val;
      key = 0;
      for (uint32_t round = 0; round < rounds; ++round)
      {
         auto start = std::chrono::steady_clock::now();

         for (uint32_t i = 0; i < count; ++i)
         {
            key         = rand64();
            int64_t val = i;
            rt->get_greater_equal(std::span<const char>((const char*)&key, 8), &result_key,
                                  &result_val);
         }

         auto end   = std::chrono::steady_clock::now();
         auto delta = end - start;

         std::cerr << std::setw(4) << round << std::setw(12)
                   << add_comma(int64_t(
                          count /
                          (std::chrono::duration<double, std::milli>(delta).count() / 1000)))
                   << " items/sec   \n";
      }

      /*
   std::cout << "Starting to find lower bound " << rounds << " rounds of " << add_comma(count)
             << " random key/values in " << num_read_threads << " threads\n";

   for (uint32_t round = 0; round < rounds; ++round)
   {
      std::vector<std::unique_ptr<std::thread>> rthreads;
      rthreads.reserve(num_read_threads);

      auto start = std::chrono::steady_clock::now();

      for (uint32_t i = 0; i < num_read_threads; ++i)
      {
         auto read_loop = [&]()
         {
            auto rs = db->createReadSession();
            auto rt = rs->startTransaction();

            std::vector<char> result_key;
            std::vector<char> result_val;
            key = 0;

            for (uint32_t i = 0; i < count; ++i)
            {
               key         = rand64();
               int64_t val = i;
               rt->get_greater_equal(std::span<const char>((const char*)&key, 8), &result_key,
                                     &result_val);
            }
         };
         rthreads.emplace_back(new std::thread(read_loop));
      }

      for (auto& r : rthreads)
         r->join();

      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cerr << std::setw(4) << round << std::setw(12)
                << add_comma(
                       int64_t((num_read_threads * count) /
                               (std::chrono::duration<double, std::milli>(delta).count() / 1000)))
                << " items/sec   \n";
   }
   */
   }

   auto rs = db->createReadSession();
   auto rt = rs->startTransaction();

   std::cout << "Starting to find lower bound " << rounds << " rounds of " << add_comma(count)
             << " random key/values in " << num_read_threads << " threads while writing\n";

   uint64_t total_writes = 0;
   for (uint32_t round = 0; round < rounds; ++round)
   {
      std::vector<std::unique_ptr<std::thread>> rthreads;
      rthreads.reserve(num_read_threads);

      auto             start = std::chrono::steady_clock::now();
      std::atomic<int> done  = 0;

      for (uint32_t i = 0; i < num_read_threads; ++i)
      {
         auto read_loop = [&]()
         {
            auto lrs = db->createReadSession();

            std::vector<char> result_key;
            std::vector<char> result_val;
            uint64_t key = 0;

            auto rt = lrs->startTransaction();
            for (uint32_t i = 0; i < count; ++i)
            {
               key         = rand64();
               int64_t val = i;
               rt->get_greater_equal(std::span<const char>((const char*)&key, 8), &result_key,
                                     &result_val);
            }
            ++done;
         };
         rthreads.emplace_back(new std::thread(read_loop));
      }

      int64_t writes = 0;
      while (done.load() < num_read_threads)
      {
         auto wt = ws.startTransaction();

         key           = rand64();
         int64_t val   = key;
         auto old_size = wt->put(std::span<char>((char*)&key, 8), std::span<char>((char*)&val, 8));

         wt->commit();
         ++writes;
         ++total_writes;
      }

      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      std::cerr << std::setw(4) << round << std::setw(12)
                << add_comma(
                       int64_t((num_read_threads * count) /
                               (std::chrono::duration<double, std::milli>(delta).count() / 1000)))
                << " read items/sec  ";
      std::cerr << std::setw(12)
                << add_comma(
                       int64_t((writes) /
                               (std::chrono::duration<double, std::milli>(delta).count() / 1000)))
                << " write items/sec   "
                << " items in db: " << add_comma(total_writes) <<" \n";

      for (auto& r : rthreads)
         r->join();
   }

   /*
   auto read_loop = [&]( int c ){
      auto rs = db->createReadSession(); // thread-local access to read db

      while( not done.load( std::memory_order_acquire ) ) {
           auto rt = rs.startTransaction(); // grabs a snapshot

           rt->
      }
   };
   */

   return 0;
}
