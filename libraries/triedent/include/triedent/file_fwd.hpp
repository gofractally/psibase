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

   // cold_bytes can grow
   // hot/warm/cool are fixed
   // hot/warm/cool/cold MUST be more than twice the
   // maximum allocation size.
   struct database_config
   {
      std::uint64_t hot_bytes  = 1000 * 1000ull;
      std::uint64_t warm_bytes = 1000 * 1000ull;
      std::uint64_t cool_bytes = 1000 * 1000ull;
      std::uint64_t cold_bytes = 1000 * 1000ull;
   };

   enum access_mode
   {
      read_only  = 0,
      read_write = 1,
   };

   enum class open_mode
   {
      // Open an existing database
      read_only  = 0,
      read_write = 1,
      // Create a new database if the database does not exist
      create = 2,
      // Create a new database, overwriting an existing database
      trunc = 3,
      // Create a new database. It is an error if the database already exists
      create_new = 4,
      // Create a unique temporary database which will be deleted when it is closed.
      // The path should be an existing directory.
      temporary = 5,
      // Open an existing database for garbage collection
      gc = 6,
   };

}  // namespace triedent
