#pragma once

#include <filesystem>
#include <random>
#include <string_view>

struct TempDirectory
{
   TempDirectory() : path(randomName()) { std::filesystem::create_directory(path); }
   ~TempDirectory() { std::filesystem::remove_all(path); }
   static std::filesystem::path randomName()
   {
      constexpr int                              max_tries = 8;
      constexpr int                              len       = 24;
      auto                                       root      = std::filesystem::temp_directory_path();
      std::string_view                           chars     = "abcdefghijklmnopqrstuvwxyz1234567890";
      std::uniform_int_distribution<std::size_t> dist(0, chars.size() - 1);
      std::random_device                         rng;
      for (int i = 0; i < max_tries; ++i)
      {
         std::string name;
         for (int j = 0; j < len; ++j)
         {
            name += chars[dist(rng)];
         }
         auto result = root / name;
         if (!std::filesystem::exists(result))
            return result;
      }
      throw std::runtime_error("Failed to find unused directory name");
   }
   std::filesystem::path path;
};
