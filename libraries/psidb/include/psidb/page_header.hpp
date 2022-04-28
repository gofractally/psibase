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
      leaf
   };

   enum class page_flags : std::uint8_t
   {
      dirty0  = 1,
      dirty1  = 2,
      evicted = 4
   };

   struct page_header
   {
      page_type            type;
      page_flags           flags;
      std::atomic<bool>    dirty0;
      std::atomic<bool>    dirty1;
      page_id              id;
      std::atomic<page_id> prev;
      version_type         version;
      bool                 is_dirty(page_flags f) const
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
