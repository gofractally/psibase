#pragma once

#include <atomic>
#include <cstddef>
#include <psidb/node_ptr.hpp>
#include <psidb/page_header.hpp>
#include <psidb/sync/shared_value.hpp>
#include <vector>

#include <iostream>
#include <syncstream>

namespace psidb
{

   struct page_leaf;
   struct page_internal_node;
   class gc_allocator
   {
     public:
      static constexpr page_id null_page = 0xffffffff;
      explicit gc_allocator(std::size_t max_pages);
      ~gc_allocator();
      void*        allocate(std::size_t size) { return ::operator new(size); }
      void         deallocate(void* ptr, std::size_t size) { return ::operator delete(ptr); }
      page_header* allocate_page()
      {
         // Only one thread will allocate new pages
         auto result = _head;
         if (result == nullptr)
         {
            _head = result = _free_pool.exchange(nullptr, std::memory_order_acquire);
            if (result == nullptr)
            {
               auto end = reinterpret_cast<const char*>(_base) + _size;
               if (reinterpret_cast<char*>(_unused) < end)
               {
                  auto result = reinterpret_cast<page_header*>(_unused);
                  _unused     = reinterpret_cast<char*>(_unused) + page_size;
                  mark(result);
                  --_gc_threshold;
                  return result;
               }
               else
               {
                  throw std::bad_alloc();
               }
            }
         }
         if (result->prev.load(std::memory_order_relaxed) == null_page)
         {
            _head = nullptr;
         }
         else
         {
            _head = translate_page_address(result->prev.load(std::memory_order_relaxed));
         }
         assert(result->type == page_type::free);
         --_gc_threshold;
         mark(result);
         //std::osyncstream(std::cout) << "allocate page: " << get_id(result) << std::endl;
         return result;
      }
      void deallocate_page(page_header* page)
      {
         page->type = page_type::free;
         page->prev = get_id(_head);
         _head      = page;
      }
      static constexpr bool is_memory_page(page_id id) { return id < max_memory_pages; }
      void*                 base() { return _base; }
      page_header*          translate_page_address(page_id id)
      {
         return reinterpret_cast<page_header*>(reinterpret_cast<char*>(_base) + id * page_size);
      }
      page_id get_id(const page_header* page) const
      {
         return (reinterpret_cast<const char*>(page) - reinterpret_cast<const char*>(_base)) /
                page_size;
      }

      struct cycle
      {
         std::vector<version_type> versions;
      };
      void  sweep(cycle&&);
      cycle start_cycle(std::vector<version_type>&& active_versions);
      void  scan_root(cycle& data, page_header* header);
      void  scan(cycle& data, node_ptr ptr);
      void  mark(page_header* header) { header->gc_flag = _gc_flag; }
      bool  is_marked(page_header* header) { return header->gc_flag == _gc_flag; }
      bool  is_old(page_header* header);
      bool  is_dirty(page_header* header);
      void  scan_prev(cycle& data, page_header* page);
      void  scan_children(cycle& data, page_internal_node* node);
      void  scan_children(cycle& data, page_leaf*);
      bool  page_is_live(cycle& data, page_header* page, version_type end_version);

      struct scoped_lock
      {
         ~scoped_lock() { self->_gc_mutex.unlock(value); }
         gc_allocator* self;
         std::uint8_t  value;
      };
      friend struct scoped_lock;

      scoped_lock lock() { return scoped_lock{this, _gc_mutex.load_and_lock()}; }

      struct stats
      {
         std::size_t used;
         std::size_t total;
      };
      stats get_stats() const
      {
         return {static_cast<std::size_t>(reinterpret_cast<char*>(_unused) -
                                          reinterpret_cast<char*>(_base)),
                 _size};
      }
      bool should_gc() const { return _gc_threshold <= 0; }

     private:
      page_header*              _head = nullptr;
      void*                     _unused;
      std::atomic<page_header*> _free_pool;
      std::int64_t              _gc_threshold;
      gc_flag_type              _gc_flag;
      shared_value              _gc_mutex;

      void*       _base = nullptr;
      std::size_t _size = 0;
   };

}  // namespace psidb
