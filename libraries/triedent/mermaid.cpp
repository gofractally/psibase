#include <boost/program_options/cmdline.hpp>
#include <boost/program_options/options_description.hpp>
#include <boost/program_options/variables_map.hpp>
#include <boost/program_options/parsers.hpp>

#include <triedent/database.hpp>

int main( int argc, char** argv ) {
   namespace po = boost::program_options;
   uint32_t hot_page_c = 34;
   uint32_t warm_page_c = 33;
   uint32_t cool_page_c = 35;
   uint32_t cold_page_c = 35;
   uint64_t num_objects = 250*1000*1000;
   std::string db_dir;
   bool use_string = false;

   uint32_t       num_read_threads = 6;
   po::options_description desc( "Allowed options" );
   desc.add_options()
      ("help,h", "print this message")
      ("reset", "reset the database" )
      ("sparce", po::value<bool>(&use_string)->default_value(false), "use sparse string keys" )
      ("status", "print status of the database" )
      ("data-dir", po::value<std::string>(&db_dir)->default_value("./big.dir"), "the folder that contains the database" )
      ("read-threads,r", po::value<uint32_t>(&num_read_threads)->default_value(6), "number of read threads to launch")
      ("hot-size,H", po::value<uint32_t>(&hot_page_c)->default_value(34), "the power of 2 for the amount of RAM for the hot ring, RAM = 2^(hot_size) bytes")
      ("hot-size,H", po::value<uint32_t>(&hot_page_c)->default_value(33), "the power of 2 for the amount of RAM for the hot ring, RAM = 2^(hot_size) bytes")
      ("warm-size,w", po::value<uint32_t>(&warm_page_c)->default_value(33), "the power of 2 for the amount of RAM for the warm ring, RAM = 2^(warm_size) bytes")
      ("cool-size,c", po::value<uint32_t>(&cool_page_c)->default_value(33), "the power of 2 for the amount of RAM for the cool ring, RAM = 2^(cool_size) bytes")
      ("cold-size,C",po::value<uint32_t>(&cold_page_c)->default_value(33),  "the power of 2 for the amount of RAM for the cold ring, RAM = 2^(cold_size) bytes")
      ("max-objects,O",po::value<uint64_t>(&num_objects)->default_value(num_objects),  "the maximum number of unique objects in the database")
      ;

   po::variables_map vm;
   po::store( po::parse_command_line( argc, argv, desc), vm );
   po::notify(vm);

   if( vm.count("help") ) {
      std::cout << desc <<"\n";
      return 1;
   }

   return 0;
}
