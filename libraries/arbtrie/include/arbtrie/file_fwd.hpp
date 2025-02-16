#pragma once

#include <cstddef>
#include <cstdint>

namespace arbtrie
{
   //   inline constexpr std::uint32_t file_magic              = 0x3088cf00;
   inline constexpr std::uint32_t file_type_database_root = 1;
   inline constexpr std::uint32_t file_type_index         = 2;
   inline constexpr std::uint32_t file_type_data          = 3;

   inline constexpr std::size_t round_to_page(std::size_t arg)
   {
      constexpr std::size_t page_size = 4096;
      return (arg + page_size - 1) / page_size * page_size;
   }

   struct allocator_stats
   {
      std::uint64_t total_bytes;
      std::uint64_t used_bytes;
      std::uint64_t free_bytes;
      std::uint64_t available_bytes;
      std::uint64_t num_objects;
   };
}  // namespace arbtrie
