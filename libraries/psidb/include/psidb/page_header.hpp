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
      dirty0  = 1,
      dirty1  = 2,
      evicted = 4
   };

   using gc_flag_type = std::uint8_t;

   static constexpr std::size_t max_memory_pages = 0x10000000;

   struct page_header
   {
      page_type            type;
      page_flags           flags;
      std::atomic<bool>    dirty0;
      std::atomic<bool>    dirty1;
      std::atomic<uint8_t> accessed;
      std::atomic<bool>    pinned;
      page_id              id;
      std::atomic<page_id> prev;
      version_type         version;
      // The oldest version in the list formed by prev
      version_type min_version;
      // TODO: accessed can be a counter to keep frequently used pages
      // in memory longer.
      void access() { accessed.store(1, std::memory_order_relaxed); }
      void clear_access() { accessed.store(0, std::memory_order_relaxed); }
      bool should_evict() { return accessed.load(std::memory_order_relaxed) == 0 && id != 0; }
      void pin() { pinned.store(1, std::memory_order_relaxed); }
      void unpin() { pinned.store(0, std::memory_order_release); }
      bool is_pinned() const { return pinned.load(std::memory_order_acquire); }
      bool is_dirty(page_flags f) const
      {
         if (f == page_flags::dirty0)
         {
            return dirty0.load(std::memory_order_relaxed);
         }
         else if (f == page_flags::dirty1)
         {
            return dirty1.load(std::memory_order_relaxed);
         }
         else
         {
            __builtin_unreachable();
         }
      }
      void set_dirty(page_flags f, bool value)
      {
         if (f == page_flags::dirty0)
         {
            dirty0.store(value, std::memory_order_relaxed);
         }
         else if (f == page_flags::dirty1)
         {
            dirty1.store(value, std::memory_order_relaxed);
         }
         else
         {
            __builtin_unreachable();
         }
      }
   };

}  // namespace psidb
