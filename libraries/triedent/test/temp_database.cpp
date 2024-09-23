#include "temp_database.hpp"

#include "temp_directory.hpp"

using namespace triedent;

std::shared_ptr<database> createDb(const database::config& cfg)
{
   return std::make_shared<database>(std::filesystem::temp_directory_path(), cfg,
                                     open_mode::temporary);
}
