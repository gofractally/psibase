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
      // Types that are part of the file format and must remain stable
      node = 0,
      leaf = 1,
      data = 2,
      // Additional types used in memory only
      free,
      temp
   };

   enum class page_flags : std::uint8_t
   {
      unwritable = 1
   };

   using gc_flag_type = std::uint8_t;

   static constexpr std::size_t max_memory_pages = 0x10000000;

   struct page_header
   {
      page_type            type;
      page_flags           flags;
      std::atomic<uint8_t> accessed;
      std::atomic<uint8_t> pinned;
      std::atomic<bool>    mutex;
      page_id              id;
      std::atomic<page_id> prev;
      version_type         version;
      void                 init_header()
      {
         flags = {};
         id    = 0;
         accessed.store(1, std::memory_order_relaxed);
         pinned.store(false, std::memory_order_relaxed);
         mutex.store(false, std::memory_order_relaxed);
      }
      // TODO: accessed can be a counter to keep frequently used pages
      // in memory longer.
      void access()
      {
         accessed.store(1, std::memory_order_relaxed);
         assert(type != page_type::free);
      }
      void clear_access() { accessed.store(0, std::memory_order_relaxed); }
      bool should_evict() { return accessed.load(std::memory_order_relaxed) == 0 && id != 0; }
      void pin() { pinned.fetch_add(1, std::memory_order_relaxed); }
      void unpin() { pinned.fetch_sub(1, std::memory_order_release); }
      bool is_pinned() const { return pinned.load(std::memory_order_acquire) != 0; }
      void lock()
      {
         while (mutex.exchange(true, std::memory_order_acquire))
         {
            mutex.wait(true);
         }
      }
      void unlock()
      {
         mutex.store(false, std::memory_order_release);
         mutex.notify_one();
      }
   };

}  // namespace psidb
