#include "temp_database.hpp"

#include "temp_directory.hpp"

using namespace triedent;

std::shared_ptr<database> createDb(const database::config& cfg)
{
   temp_directory dir("triedent-test");
   database::create(dir.path, cfg);
   return std::make_shared<database>(dir.path, cfg, access_mode::read_write);
}
