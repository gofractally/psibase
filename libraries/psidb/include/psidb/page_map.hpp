#pragma once

#include <atomic>
#include <cstddef>
#include <memory>
#include <psidb/page_header.hpp>

namespace psidb
{
   // This class tracks the mapping of file pages to pages in the in-memory cache
   //
   // concurrency cases:
   // - load/load
   // - load/evict
   //
   // In-memory pages should typically be accessed through direct links
   // This object is used only when loading or evicting pages.  As such,
   // I suspect that the speed of access is relatively unimportant, and
   // contention (especially with fine-grained locking) is low.  My biggest
   // concern is to make sure that memory usage does not scale worse than
   // total available RAM.  A flat array (the current implementation)
   // scales with the database size on disk, which could become a big problem.
   // OTOH, it's simple and good enough for now.
   // TODO: revist this later once everything else is working.
   class page_map
   {
     public:
      page_map(std::size_t max_file_pages)
          : pages(new std::atomic<page_id>[max_file_pages]), size(max_file_pages)
      {
         for (std::size_t i = 0; i < max_file_pages; ++i)
         {
            pages[i].store(null_page);
         }
      }
      static constexpr page_id null_page   = 0xffffffff;
      static constexpr page_id locked_page = 0xfffffffe;
      class value_handle
      {
        public:
         ~value_handle()
         {
            if (ptr)
            {
               unlock();
            }
         }
         void store(page_id new_value)
         {
            ptr->store(new_value, std::memory_order_release);
            ptr->notify_one();
            ptr = nullptr;
         }
         // TODO: do we need release for erase and unlock?
         void     erase() { store(null_page); }
         void     unlock() { store(value); }
         explicit operator bool() const { return value != null_page; }
         page_id  operator*() const { return value; }

        private:
         friend class page_map;
         constexpr value_handle(page_id value, std::atomic<page_id>* ptr) : value(value), ptr(ptr)
         {
         }
         value_handle(const value_handle&) = delete;
         page_id               value;
         std::atomic<page_id>* ptr;
      };
      // locks and returns the row.  The lock will be released
      // when the result goes out of scope, or explicitly.
      value_handle lock(page_id key)
      {
         auto offset = key - max_memory_pages;
         assert(offset < size);
         auto* result = pages.get() + offset;
         while (true)
         {
            auto val = result->exchange(locked_page, std::memory_order_acquire);
            if (val != locked_page)
            {
               return {val, result};
            }
            result->wait(locked_page);
         }
      }
      void store(page_id key, page_id value)
      {
         // TODO: This can just be an atomic store
         lock(key).store(value);
      }

     private:
      // Notes:
      // - A flat array is optimal in both space and time if file_pages <= memory_pages
      // - A flat array is better than any system that stores key+value if file_pages <= 2*memory_pages
      // - A B*+ tree has a worst case utilization slightly worse than 2/3
      //   (depending on the node size), which makes a flat array better if file_pages <= 3*memory_pages
      //
      // page_id -> page_id
      //
      std::unique_ptr<std::atomic<page_id>[]> pages;
      std::size_t                             size;
   };
}  // namespace psidb
