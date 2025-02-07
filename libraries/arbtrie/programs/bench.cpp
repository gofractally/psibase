#include <chrono>
#include <format>

#include <boost/program_options/cmdline.hpp>
#include <boost/program_options/options_description.hpp>
#include <boost/program_options/parsers.hpp>
#include <boost/program_options/variables_map.hpp>

#include <arbtrie/database.hpp>

namespace po = boost::program_options;
using namespace arbtrie;
std::string get_current_time_and_date()
{
   auto const time = std::chrono::system_clock::now();
   return std::format("{:%Y-%m-%d %X}", time);
}

struct benchmark_config
{
   uint32_t rounds;
   uint32_t items      = 1000000;
   uint32_t batch_size = 100;
   uint32_t value_size = 8;
};

struct result
{
   std::vector<double> items_per_second;
};

int64_t rand_from_seq(uint64_t seq)
{
   return XXH3_64bits((char*)&seq, sizeof(seq));
}

void to_key(uint64_t val, std::vector<char>& v)
{
   v.resize(sizeof(val));
   memcpy(v.data(), &val, sizeof(val));
}
void to_key(std::string val, std::vector<char>& v)
{
   v.resize(val.size());
   memcpy(v.data(), val.data(), val.size());
}

uint64_t bswap(uint64_t x)
{
   x = (x & 0x00000000FFFFFFFF) << 32 | (x & 0xFFFFFFFF00000000) >> 32;
   x = (x & 0x0000FFFF0000FFFF) << 16 | (x & 0xFFFF0000FFFF0000) >> 16;
   x = (x & 0x00FF00FF00FF00FF) << 8 | (x & 0xFF00FF00FF00FF00) >> 8;
   return x;
}
static bool addc = false;
auto format_comma( auto arg ) {
   if( addc )
      return add_comma(arg);
   return std::to_string(arg);
}
static char sepearator = '\t';


int64_t get_test(benchmark_config   cfg,
                 arbtrie::database& db,
                 auto&              ws,
                 std::string        name,
                 auto               make_key)
{
   std::cerr << "---------------------  " << name
             << "  "
                "--------------------------------------------------\n";
   std::cerr << get_current_time_and_date() << "\n";
   if constexpr (debug_memory)
      std::cerr << "debug memory enabled\n";
   if constexpr (update_checksum_on_modify)
      std::cerr << "update checksum on modify\n";
   else if constexpr (update_checksum_on_compact)
      std::cerr << "update checksum on compact\n";
   std::cerr << "rounds: " << cfg.rounds << "  items: " << format_comma(cfg.items)
             << " batch: " << format_comma(cfg.batch_size) << "\n";
   std::cerr << "-----------------------------------------------------------------------\n";

   std::vector<char> key;
   auto                 root  = ws.get_root();
   auto                 start = std::chrono::steady_clock::now();
   for (uint64_t i = 0; i < cfg.items; ++i)
   {
      make_key(i, key);
      key_view kstr(key.data(), key.size());
      ws.get(root, kstr, [=](bool found, const value_type& r) {
             if( not found )  {
                TRIEDENT_WARN( "seq: ", i );
                abort();
             }
             });
   }
   auto   end    = std::chrono::steady_clock::now();
   auto   delta  = end - start;
   double result = cfg.items / (std::chrono::duration<double, std::milli>(delta).count() / 1000);
   std::cerr << format_comma(uint64_t(result)) << " get/sec\n";
   return result;
}

template <upsert_mode mode = upsert_mode::insert>
std::vector<int> insert_test(benchmark_config   cfg,
                             arbtrie::database& db,
                             auto&&             ws,
                             std::string        name,
                             auto               make_key)
{
   std::cerr << "---------------------  " << name
             << "  "
                "--------------------------------------------------\n";
   std::cerr << get_current_time_and_date() << "\n";
   if constexpr (debug_memory)
      std::cerr << "debug memory enabled\n";
   if constexpr (update_checksum_on_modify)
      std::cerr << "update checksum on modify\n";
   else if constexpr (update_checksum_on_compact)
      std::cerr << "update checksum on compact\n";
   std::cerr << "rounds: " << cfg.rounds << "  items: " << format_comma(cfg.items)
             << " batch: " << format_comma(cfg.batch_size) << "\n";
   std::cerr << "-----------------------------------------------------------------------\n";
   std::vector<int> result;
   result.reserve(cfg.rounds);

   auto root = ws.create_root();
   if constexpr (mode.is_update() and not mode.is_insert() )
      root = ws.get_root();

   uint64_t             seq = 0;
   std::vector<char> key;
   std::vector<char> value;
   value.resize(cfg.value_size);
   value_view vv(value.data(), value.size());

   for (int r = 0; r < cfg.rounds; ++r)
   {
      auto start    = std::chrono::steady_clock::now();
      int  inserted = 0;
      while (inserted < cfg.items)
      {
         for (int i = 0; i < cfg.batch_size; ++i)
         {
            make_key(seq++, key);
            key_view kstr(key.data(), key.size());
            if constexpr (mode.is_upsert())
               ws.upsert(root, kstr, vv);
            else if constexpr (mode.is_insert())
               ws.insert(root, kstr, vv);
            else
               ws.update(root, kstr, vv);
            ++inserted;
         }
         ws.template set_root<sync_type::none>(root);
      }

      auto end   = std::chrono::steady_clock::now();
      auto delta = end - start;
      result.push_back(inserted /
                       (std::chrono::duration<double, std::milli>(delta).count() / 1000));
      std::cerr << std::setw(4) << std::left << r << " " << std::setw(10) << std::right
                << format_comma(seq) << sepearator <<"  " << std::setw(10) << std::right << format_comma(result.back())
                << sepearator << "  items/sec\n";
   }
   return result;
}

void print_stat(auto& ws)
{
   auto start = std::chrono::steady_clock::now();
   auto stats = ws.get_node_stats(ws.get_root());
   auto end   = std::chrono::steady_clock::now();
   std::cerr << stats << "\n";
   std::cerr << std::fixed << std::setprecision(3)
             << std::chrono::duration<double, std::milli>(end - start).count() / 1000 << "  sec\n";
}

int main(int argc, char** argv)
{
   arbtrie::thread_name("main");
   std::string db_dir = "benchdb";
   uint32_t    rounds;
   uint32_t    batch;
   uint32_t    items;
   uint32_t    value_size;
   bool        run_cthread;
   bool        dense_rand;
   bool        dense_little;
   bool        dense_big;
   bool        sparse_rand;
   bool        sparse_seq;

   po::options_description desc("Allowed options");
   auto                    opt = desc.add_options();
   opt("help,h", "print this message");
   opt("rounds", po::value<uint32_t>(&rounds)->default_value(10), "the number of times to run");
   opt("batch", po::value<uint32_t>(&batch)->default_value(10),
       "the number of items to insert per transaction");
   opt("items", po::value<uint32_t>(&items)->default_value(1000000),
       "the total number of items to insert per round");
   opt("value-size,v", po::value<uint32_t>(&value_size)->default_value(8),
       "the total number of items to insert per round");
   opt("run-compact-thread", po::value<bool>(&run_cthread)->default_value(true));
   opt("reset", "reset the database");
   opt("stat", "prints statistics about the database");

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
      TRIEDENT_WARN("resetting database");
      std::filesystem::remove_all(db_dir);
      arbtrie::database::create(db_dir, {.run_compact_thread = false});
   }
   if (vm.count("stat"))
   {
      database db(db_dir, {.run_compact_thread = run_cthread});
      auto     ws = db.start_write_session();
      print_stat(ws);
      return 0;
   }

   database db(db_dir, {.run_compact_thread = run_cthread});
   auto     ws = db.start_write_session();

   benchmark_config cfg = {rounds, items, batch, value_size};

   print_stat(ws);
   insert_test<upsert_mode::upsert>(cfg, db, ws, "big endian seq upsert",
                                    [](uint64_t seq, auto& v) { to_key(bswap(seq), v); });
   print_stat(ws);

   get_test(cfg, db, ws, "big endian seq get",
            [](uint64_t seq, auto& v) { to_key(bswap(seq), v); });
   get_test(cfg, db, ws, "big endian rand get",
            [cfg](uint64_t seq, auto& v) { 
              uint64_t k = uint64_t(rand_from_seq(seq)) % (cfg.items*cfg.rounds);
               to_key(bswap(k), v); 
            });

   insert_test<upsert_mode::update>(cfg, db, ws, "big endian seq update",
                                    [](uint64_t seq, auto& v) { to_key(bswap(seq), v); });
   print_stat(ws);
   insert_test<upsert_mode::insert>(cfg, db, ws, "big endian seq insert",
                                    [](uint64_t seq, auto& v) { to_key(bswap(seq), v); });
   print_stat(ws);

   insert_test<upsert_mode::insert>(cfg, db, ws, "string number rand insert",
                                    [](uint64_t seq, auto& v)
                                    { to_key(std::to_string(rand_from_seq(seq)), v); });
   print_stat(ws);
   get_test(cfg, db, ws, "string number rand get",
                        [](uint64_t seq, auto& v)
                        { to_key(std::to_string(rand_from_seq(seq)), v); });

   insert_test<upsert_mode::update>(cfg, db, ws, "string number rand update",
                                    [](uint64_t seq, auto& v)
                                    { to_key(std::to_string(rand_from_seq(seq)), v); });
   print_stat(ws);
   insert_test<upsert_mode::upsert>(cfg, db, ws, "string number rand upsert",
                                    [](uint64_t seq, auto& v)
                                    { to_key(std::to_string(rand_from_seq(seq)), v); });
   print_stat(ws);

   insert_test<upsert_mode::insert>(cfg, db, ws, "string number seq insert",
                                    [](uint64_t seq, auto& v) { to_key(std::to_string(seq), v); });
   print_stat(ws);
   insert_test<upsert_mode::update>(cfg, db, ws, "string number seq update",
                                    [](uint64_t seq, auto& v) { to_key(std::to_string(seq), v); });
   print_stat(ws);
   insert_test<upsert_mode::upsert>(cfg, db, ws, "string number seq upsert",
                                    [](uint64_t seq, auto& v) { to_key(std::to_string(seq), v); });
   print_stat(ws);
   insert_test<upsert_mode::insert>(cfg, db, ws, "dense random insert",
                                    [](uint64_t seq, auto& v) { to_key(rand_from_seq(seq), v); });
   print_stat(ws);
   insert_test<upsert_mode::update>(cfg, db, ws, "dense random update",
                                    [](uint64_t seq, auto& v) { to_key(rand_from_seq(seq), v); });
   print_stat(ws);
   insert_test<upsert_mode::upsert>(cfg, db, ws, "dense random upsert",
                                    [](uint64_t seq, auto& v) { to_key(rand_from_seq(seq), v); });
   print_stat(ws);

   insert_test<upsert_mode::insert>(cfg, db, ws, "little endian seq insert",
                                    [](uint64_t seq, auto& v) { to_key(seq, v); });
   print_stat(ws);
   insert_test<upsert_mode::update>(cfg, db, ws, "little endian seq update",
                                    [](uint64_t seq, auto& v) { to_key(seq, v); });
   print_stat(ws);
   insert_test<upsert_mode::upsert>(cfg, db, ws, "little endian seq upsert",
                                    [](uint64_t seq, auto& v) { to_key(seq, v); });
   print_stat(ws);

   return 0;
}
