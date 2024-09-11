#pragma once

#include <cstddef>
#include <cstdint>

namespace triedent
{
   inline constexpr std::uint32_t file_magic              = 0x3088cf00;
   inline constexpr std::uint32_t file_type_mask          = 0xFF;
   inline constexpr std::uint32_t file_type_database_root = 1;
   inline constexpr std::uint32_t file_type_index         = 2;
   inline constexpr std::uint32_t file_type_data          = 3;
   inline constexpr std::uint32_t file_type_cold          = 4;

   inline constexpr std::size_t round_to_page(std::size_t arg)
   {
      constexpr std::size_t page_size = 4096;
      return (arg + page_size - 1) / page_size * page_size;
   }

   enum cache_level_type
   {
      hot_cache  = 0,  // pinned, zero copy access (ram) 50% of RAM
      warm_cache = 1,  // pinned, copy to hot on access (ram) 25% of RAM
      cool_cache = 2,  // not pinned, copy to hot on access (disk cache)  25% of RAM
      cold_cache = 3   // not pinned, copy to hot on access (uncached) AS NEEDED DISK
   };

   struct allocator_stats
   {
      std::uint64_t total_bytes;
      std::uint64_t used_bytes;
      std::uint64_t free_bytes;
      std::uint64_t available_bytes;
      std::uint64_t num_objects;
   };
}  // namespace triedent
