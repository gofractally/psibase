#include <boost/program_options/cmdline.hpp>
#include <boost/program_options/options_description.hpp>
#include <boost/program_options/parsers.hpp>
#include <boost/program_options/variables_map.hpp>

#include <triedent/database.hpp>

using namespace triedent;

int main(int argc, char** argv)
{
   try
   {
      namespace po            = boost::program_options;
      uint32_t    hot_page_c  = 34;
      uint32_t    warm_page_c = 33;
      uint32_t    cool_page_c = 35;
      uint32_t    cold_page_c = 35;
      uint64_t    num_objects = 250 * 1000 * 1000;
      std::string db_dir;
      std::string export_file;
      std::string import_file;
      bool        use_string = false;

      uint32_t                num_read_threads = 6;
      po::options_description desc("Allowed options");
      auto                    opt = desc.add_options();
      opt("help,h", "print this message");
      opt("reset", "reset the database");
      opt("sparce", po::value<bool>(&use_string)->default_value(false), "use sparse string keys");
      opt("status", "print status of the database");
      // opt("count", "count the number of keys in database");
      opt("validate", "count the number of keys in database");
      opt("gc", "free any space caused by dangling ref counts");
      // opt("export", po::value<std::string>(&export_file),
      //     "export the key value db to canonical form");
      // opt("import", po::value<std::string>(&import_file), "import keys previously exported");
      opt("create", "creates an empty database with the give parameters");
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

      po::variables_map vm;
      po::store(po::parse_command_line(argc, argv, desc), vm);
      po::notify(vm);

      if (vm.count("help"))
      {
         std::cout << desc << "\n";
         return 1;
      }

      if (vm.count("reset"))
      {
         std::cout << "resetting database\n";
         std::filesystem::remove_all(db_dir);
      }
      if (vm.count("status"))
      {
         auto db = std::make_shared<database>(db_dir.c_str(), triedent::database::read_only);
         db->print_stats(std::cerr, true);
      }
      if (vm.count("create"))
      {
         database::create(db_dir, triedent::database::config{.hot_bytes  = 1ull << hot_page_c,
                                                             .warm_bytes = 1ull << warm_page_c,
                                                             .cool_bytes = 1ull << cool_page_c,
                                                             .cold_bytes = 1ull << cold_page_c});
      }

      if (vm.count("validate"))
      {
         auto db   = std::make_shared<database>(db_dir.c_str(), triedent::database::read_write);
         auto s    = db->start_write_session();
         auto root = s->get_top_root();
         s->validate(root);
         std::cerr << "everything appears to be ok" << std::endl;
      }

      if (vm.count("gc"))
      {
         auto db = std::make_shared<database>(db_dir.c_str(), triedent::database::read_write, true);
         auto s  = db->start_write_session();
         s->start_collect_garbage();
         s->recursive_retain();
         s->end_collect_garbage();
      }

#if 0
      if (vm.count("import"))
      {
         // TODO: roots within trees
         if (not std::filesystem::exists(import_file))
         {
            throw std::runtime_error("import file does not exist: " + import_file);
         }
         auto db   = std::make_shared<database>(db_dir.c_str(), triedent::database::read_write);
         auto s    = db->start_write_session();
         auto root = s->get_top_root();

         std::ifstream     in(import_file.c_str(), std::fstream::binary | std::fstream::in);
         std::vector<char> value_buffer;
         value_buffer.resize(0xffffff);
         std::vector<char> key_buffer;
         key_buffer.resize(256);

         uint32_t vs;
         uint8_t  ks;
         uint64_t inserted = 0;
         uint64_t updated  = 0;
         while (not in.eof())
         {
            in.read((char*)&ks, 1);
            key_buffer.resize(ks);
            in.read(key_buffer.data(), ks);
            in.read((char*)&vs, 4);
            if (vs > 0xffffff)
            {
               throw std::runtime_error("invalid value size detected in import file");
            }
            in.read(value_buffer.data(), vs);

            if (in.eof())
               break;
            auto old_size = s->upsert(root, std::string_view(key_buffer.data(), ks),
                                      std::string_view(value_buffer.data(), vs));
            if (old_size < 0)
               inserted++;
            else
               updated++;
         }
         s->set_top_root(root);

         std::cerr << "inserted " << inserted << " keys" << std::endl;
         std::cerr << "updated " << updated << " keys" << std::endl;
      }

      bool c = vm.count("count");
      bool e = vm.count("export");
      if (e or c)
      {
         // TODO: roots within trees
         std::ofstream ef(export_file.c_str(), std::fstream::trunc);
         auto    db    = std::make_shared<database>(db_dir.c_str(), triedent::database::read_write);
         auto    s     = db->start_write_session();
         auto    root  = s->get_top_root();
         auto    i     = s->first(root);
         int64_t count = 0;
         while (i.valid())
         {
            ++count;
            if (e)
            {
               auto     k  = i.key();
               auto     v  = i.value();
               uint8_t  ks = k.size();
               uint32_t vs = v.size();
               ef.write((char*)&ks, 1);
               ef.write(k.data(), ks);
               ef.write((char*)&vs, 4);
               ef.write(v.data(), vs);
               if (count % 1000000 == 0)
                  std::cerr << "exported " << count << " items       \r";
            }
            ++i;
         }
         if (e)
            std::cerr << "Exported " << count << " keys to " << export_file << std::endl;
         else
            std::cerr << count << " keys in database " << std::endl;
      }
#endif
   }
   catch (std::exception& e)
   {
      std::cerr << e.what() << std::endl;
   }

   return 0;
}
