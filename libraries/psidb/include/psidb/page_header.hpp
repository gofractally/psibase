#pragma once

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <string_view>

namespace psidb
{

   using key_type     = std::string_view;
   using page_id      = std::uint32_t;
   using version_type = std::uint64_t;

   constexpr std::size_t page_size    = 4096;
   constexpr std::size_t min_key_size = 16;

   enum class page_type : std::uint8_t
   {
      node,
      leaf,
      free
   };

   enum class page_flags : std::uint8_t
   {
   };

   using gc_flag_type = std::uint8_t;

   static constexpr std::size_t max_memory_pages = 0x10000000;

   struct page_header
   {
      page_type            type;
      page_flags           flags;
      std::atomic<uint8_t> accessed;
      std::atomic<bool>    pinned;
      page_id              id;
      std::atomic<page_id> prev;
      version_type         version;
      // TODO: accessed can be a counter to keep frequently used pages
      // in memory longer.
      void access() { accessed.store(1, std::memory_order_relaxed); }
      void clear_access() { accessed.store(0, std::memory_order_relaxed); }
      bool should_evict() { return accessed.load(std::memory_order_relaxed) == 0 && id != 0; }
      void pin() { pinned.store(1, std::memory_order_relaxed); }
      void unpin() { pinned.store(0, std::memory_order_release); }
      bool is_pinned() const { return pinned.load(std::memory_order_acquire); }
   };

}  // namespace psidb
