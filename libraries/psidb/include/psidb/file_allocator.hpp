#pragma once

#include <map>
#include <psidb/allocator.hpp>
#include <psidb/gc_allocator.hpp>
#include <psidb/page_header.hpp>
#include <utility>

namespace psidb
{
   // Allocates pages in non-volatile storage.
   // Guarantees safe crash recovery in conjunction with atomic
   // updates to the database header.
   class file_allocator
   {
     public:
      explicit file_allocator(int fd) : fd(fd) {}
      struct free_segment
      {
         page_id       start;
         std::uint32_t size;
      };

      void    initialize(std::uint32_t reserved_pages);
      page_id allocate(std::size_t size);
      void    deallocate(page_id id, std::size_t size);
      // Cause pages to be written as free at the next flush, but does not allow them to be reused.
      // Useful for live but non-durable checkpoints that reference pages on disk.
      // TODO: implement.  Failure to implement this can cause a permanent
      // memory leak after a crash.
      void deallocate_temp(page_id, std::size_t size) {}
      // Writes the free list to the the file.
      // After calling flush, no pages may be allocated or deallocated until the
      // database header is durably written to the file.
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
      page_id                   allocate_unlocked(std::size_t size);
      void                      deallocate_unlocked(page_id id, std::size_t size);
      mutable std::mutex        _mutex;
      int                       fd            = -1;
      free_segment              previous_root = {};
      std::vector<free_segment> freelist;
      std::vector<free_segment> next_freelist;
   };
}  // namespace psidb
