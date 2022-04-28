#pragma once

#include <cstdint>
#include <psidb/page_header.hpp>

namespace psidb
{
   static constexpr std::size_t max_tables = 14;

   struct checkpoint_root
   {
      version_type version;
      page_id      table_roots[max_tables];
      friend bool  operator<=>(const checkpoint_root& lhs, const checkpoint_root& rhs)
      {
         return lhs.version < rhs.version;
      }
   };
   static_assert(sizeof(checkpoint_root) == 64);

   struct database_header
   {
      std::uint32_t magic          = 0x626488cf;
      std::uint32_t format_version = 0;
      // Information about free space
      // Try to align checkpoints to 64 bytes.
      char padding[52];
      // On disk we maintain:
      // - The last stable checkpoint
      // - The last committed version
      // - Pending transactions that haven't become final
      // A stable checkpoint is always present, committed
      // may or may not be present
      // and pending
      // are only stored when the database is closed.
      uint32_t        num_checkpoints;  // always >= 1
      checkpoint_root checkpoints[page_size / sizeof(checkpoint_root) - 2];
      char            checksum[64];
      // fills the checksum field
      void set_checksum() { checksum[0] = 4; }
      // returns true iff the checksum is correct
      bool verify() { return checksum[0] == 4; }
   };
   static_assert(sizeof(database_header) == page_size);
}  // namespace psidb
