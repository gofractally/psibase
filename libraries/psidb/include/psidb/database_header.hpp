#pragma once

#include <cstdint>
#include <psidb/file_allocator.hpp>
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
      std::uint32_t magic = 0x626488cf;
      // The format for the database header and metadata such
      // as free lists that is written out in full on each sync.
      // Data pages should use a distinct page type instead, to
      // avoid a full copy on a version upgrade.
      std::uint32_t format_version = 0;
      // Tracks available pages
      page_id       freelist      = 0;
      std::uint32_t freelist_size = 0;
      // Information about which pages will be freed when each checkpoint is removed.
      page_id       checkpoint_freelist      = 0;
      std::uint32_t checkpoint_freelist_size = 0;
      // The number of trailing checkpoints that can be autodeleted
      // except after clean shutdown, this is 0 or 1
      std::uint32_t auto_checkpoints = 0;
      // Try to align checkpoints to 64 bytes.
      char     reserved[32];
      uint32_t num_checkpoints;  // always >= 1
      // TODO: allow more than a fixed number of checkpoints
      static constexpr std::size_t max_checkpoints = page_size / sizeof(checkpoint_root) - 2;
      checkpoint_root              checkpoints[max_checkpoints];
      char                         checksum[64];
      // fills the checksum field
      void set_checksum() { checksum[0] = 4; }
      // returns true iff the checksum is correct
      bool verify() { return checksum[0] == 4; }
   };
   static_assert(sizeof(database_header) == page_size);
}  // namespace psidb
