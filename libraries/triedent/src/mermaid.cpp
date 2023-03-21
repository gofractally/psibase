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
      std::string db_dir;

      po::options_description desc("Allowed options");
      auto                    opt = desc.add_options();
      opt("help,h", "print this message");
      opt("reset", "reset the database");
      opt("status", "print status of the database");
      opt("validate", "count the number of keys in database");
      opt("gc", "free any space caused by dangling ref counts");
      opt("create", "creates an empty database with the give parameters");
      opt("data-dir", po::value<std::string>(&db_dir)->default_value("./big.dir"),
          "the folder that contains the database");
      opt("hot-size,H", po::value<uint32_t>(&hot_page_c)->default_value(33),
          "the power of 2 for the amount of RAM for the hot ring, RAM = 2^(hot_size) bytes");
      opt("warm-size,w", po::value<uint32_t>(&warm_page_c)->default_value(33),
          "the power of 2 for the amount of RAM for the warm ring, RAM = 2^(warm_size) bytes");
      opt("cool-size,c", po::value<uint32_t>(&cool_page_c)->default_value(33),
          "the power of 2 for the amount of RAM for the cool ring, RAM = 2^(cool_size) bytes");
      opt("cold-size,C", po::value<uint32_t>(&cold_page_c)->default_value(33),
          "the power of 2 for the amount of RAM for the cold ring, RAM = 2^(cold_size) bytes");

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
         auto db   = std::make_shared<database>(db_dir.c_str(), triedent::database::read_only);
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
   }
   catch (std::exception& e)
   {
      std::cerr << e.what() << std::endl;
   }

   return 0;
}
