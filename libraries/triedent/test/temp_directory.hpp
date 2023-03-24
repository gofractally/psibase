#pragma once

#include <filesystem>
#include <string_view>

struct temp_directory
{
   explicit temp_directory(std::string_view name);
   ~temp_directory();
   void                  reset();
   std::filesystem::path path;
};
