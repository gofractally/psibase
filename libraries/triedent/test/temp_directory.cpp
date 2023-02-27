#include "temp_directory.hpp"

#include <random>

std::filesystem::path random_directory(std::string_view name)
{
   std::random_device rng;
   for (int tries = 0; tries < 5; ++tries)
   {
      auto suffix = rng() % 1000000;
      auto tmp =
          std::filesystem::temp_directory_path() / (std::string(name) + std::to_string(suffix));
      if (!std::filesystem::exists(tmp))
         return tmp;
   }
   throw std::runtime_error("Failed to find unique temp directory");
}

temp_directory::temp_directory(std::string_view name) : path(random_directory(name)) {}
temp_directory::~temp_directory()
{
   reset();
}

void temp_directory::reset()
{
   if (!path.empty())
   {
      std::filesystem::remove_all(path);
      path.clear();
   }
}
