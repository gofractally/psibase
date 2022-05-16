#pragma once

#include <map>
#include <psidb/allocator.hpp>
#include <psidb/gc_allocator.hpp>
#include <psidb/page_header.hpp>
#include <utility>

namespace psidb
{
   class file_allocator
   {
     public:
      explicit file_allocator(int fd) : fd(fd) {}
      struct free_segment
      {
         constexpr free_segment() = default;
         template <typename T, typename U>
         constexpr free_segment(std::pair<T, U> p) : start(p.first), size(p.second)
         {
         }
         template <typename T, typename U>
         operator std::pair<T, U>() const
         {
            return {start, size};
         }
         page_id       start;
         std::uint32_t size;
      };

      void         initialize(std::uint32_t reserved_pages);
      page_id      allocate(std::size_t size);
      void         deallocate(page_id id, std::size_t size);
      free_segment flush(gc_allocator& alloc);
      int          read(void* data, page_id page, std::size_t num_pages);
      int          write(page_id page, const void* data, std::size_t num_pages);
      void         load(page_id root, std::uint32_t num_pages, gc_allocator& alloc);
      struct stats
      {
         std::size_t used;
         std::size_t total;
      };
      stats get_stats() const;

     private:
      file_allocator(const file_allocator&) = delete;
      page_id                          allocate_unlocked(std::size_t size);
      void                             deallocate_unlocked(page_id id, std::size_t size);
      mutable std::mutex               _mutex;
      int                              fd            = -1;
      free_segment                     previous_root = {};
      std::map<page_id, std::uint32_t> freelist_by_addr;
   };
}  // namespace psidb
