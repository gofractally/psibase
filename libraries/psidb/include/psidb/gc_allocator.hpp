#pragma once

#include <atomic>
#include <condition_variable>
#include <cstddef>
#include <mutex>
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
   class page_map;
   // During a collection cycle, a node can have 3 possible states
   // - new: allocated after the collection phase started, but not reached by the gc
   // - marked: Seen by the gc scan
   // - old: Not seen by the scan
   //
   // A new node will not be freed
   // new and old nodes can become marked
   //
   // If an old or marked node is modified to point to a new node,
   // then the new node contains a copy of the old pointer.  This
   // restriction on modification makes concurrent collection safe.
   //
   // When starting a new collection phase any node that was new or marked
   // becomes old.
   class gc_allocator
   {
     public:
      static constexpr page_id null_page = 0xffffffff;
      explicit gc_allocator(std::size_t max_pages);
      ~gc_allocator();
      void*        allocate(std::size_t size) { return ::operator new(size); }
      void         deallocate(void* ptr, std::size_t size) { return ::operator delete(ptr); }
      page_header* allocate_page(page_header* src)
      {
         std::lock_guard l{_allocate_mutex};
         auto            result = _head;
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
                  mark_copy(src, result);
                  gc_notify();
                  //std::osyncstream(std::cout) << "allocate page: " << get_id(result) << std::endl;
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
         gc_notify();
         mark_copy(src, result);
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
      void  sweep(cycle&&, page_map&);
      cycle start_cycle();
      void  scan_root(cycle& data, page_header* header);
      bool  scan(cycle& data, node_ptr ptr);
      void  rescan_root(page_header* header);
      void  rescan(node_ptr ptr);
      void  rescan_children(page_internal_node* node);
      void  rescan_children(page_leaf*);
      void  mark_copy(page_header* src, page_header* dest)
      {
         // What happens if _gc_flag is flipped concurrently?
         // - This page will be linked into the tree before the roots are scanned
         //   so it is guaranteed to be scanned.
         // - It is indeterminate whether the page is marked as new or old.
         //   It must not be marked as scanned no matter what, because that
         //   would prevent scanning.
         // - If gc is not currently executing, then all pages are either new or marked.
         //   No additional check is required to avoid unnecessary queueing.
         if (!src || src->type == page_type::leaf || is_marked(src) || is_new(src) ||
             is_evicted(src))
         {
            mark_new(dest);
         }
         else
         {
            // The prior loads or _gc_flag in is_marked/is_new.
            std::atomic_thread_fence(std::memory_order_acquire);
            // acquire to ensure that eviction marks are visible to rescan_root
            if (_rescanning.load(std::memory_order_acquire))
            {
               // - If this thread's barrier entry happens before the initial gc thread barrier,
               //   then _rescanning must be false, because of the acquire fence above.
               // - If the final gc thread barrier happens before this thread's barrier entry,
               //   then all reachable pages are either marked or new and no reachable pages
               //   are evicted.  i.e. we can't get here.
               // - If this thread's barrier entry happens before the final gc thread barrier,
               //   then all evicted pages are marked as evicted and this thread's barrier
               //   exit will also happen before the final gc thread barrier.  Therefore,
               //   nothing will be freed before this function returns and rescan_root is safe.
               rescan_root(src);
               mark_new(dest);
            }
            else
            {
               mark_old(dest);
               queue_scan(dest);
            }
         }
      }
      void mark(page_header* header)
      {
         set_gc_flag(header, _gc_flag.load(std::memory_order_relaxed));
      }
      void mark_old(page_header* header)
      {
         set_gc_flag(header, (_gc_flag.load(std::memory_order_relaxed) ^ 1) | 2);
      }
      void mark_new(page_header* header)
      {
         set_gc_flag(header, _gc_flag.load(std::memory_order_relaxed) | 2);
      }
      void mark_evicted(page_header* header) { set_gc_flag(header, 0xFE); }
      void mark_free(page_header* header) { set_gc_flag(header, 0xFF); }
      bool is_marked(page_header* header)
      {
         return get_gc_flag(header) == _gc_flag.load(std::memory_order_relaxed);
      }
      bool is_new(page_header* header)
      {
         return get_gc_flag(header) == (_gc_flag.load(std::memory_order_relaxed) | 2);
      }
      bool is_free(page_header* header) { return get_gc_flag(header) == 0xFF; }
      bool is_evicted(page_header* header) { return get_gc_flag(header) == 0xFE; }
      // Returns true if the page has not been accessed recently
      bool is_old(page_header* header);
      bool is_dirty(page_header* header);
      bool scan_prev(cycle& data, page_header* page);
      bool scan_children(cycle& data, page_internal_node* node);
      bool scan_children(cycle& data, page_leaf*);
      bool page_is_live(cycle& data, page_header* page, version_type end_version);

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
         std::size_t   used;
         std::size_t   total;
         std::size_t   limit;
         std::uint64_t total_evicted;
      };
      stats get_stats() const;
      // Blocks until the gc should run
      bool gc_wait()
      {
         std::unique_lock l{_notify_mutex};
         _notify_cond.wait(l, [this]() { return should_gc() || _stopped; });
         return !_stopped;
      }
      void gc_stop()
      {
         std::unique_lock l{_notify_mutex};
         _stopped = true;
         _notify_cond.notify_one();
      }
      void gc_set_threshold(std::int64_t count)
      {
         _gc_threshold.store(count, std::memory_order_relaxed);
      }
      void gc_notify()
      {
         auto val = _gc_threshold.fetch_sub(1, std::memory_order_relaxed);
         if (val == 0)
         {
            std::unique_lock{_notify_mutex};
            _notify_cond.notify_one();
         }
      }
      bool should_gc() const { return _gc_threshold.load(std::memory_order_relaxed) < 0; }

     private:
      void set_gc_flag(page_header* header, gc_flag_type value)
      {
         _page_flags[get_id(header)].store(value, std::memory_order_release);
      }
      gc_flag_type get_gc_flag(page_header* header)
      {
         return _page_flags[get_id(header)].load(std::memory_order_acquire);
      }
      void queue_scan(page_header* header)
      {
         std::lock_guard l{_scan_queue_mutex};
         _scan_queue.push_back(header);
      }
      std::vector<page_header*> get_scan_queue()
      {
         std::lock_guard l{_scan_queue_mutex};
         return std::move(_scan_queue);
      }
      // TODO: separate data accessed by the garbage collector
      // from data modified on every allocation.
      page_header*                                 _head = nullptr;
      std::mutex                                   _allocate_mutex;
      std::unique_ptr<std::atomic<gc_flag_type>[]> _page_flags;
      void*                                        _unused;
      std::atomic<page_header*>                    _free_pool;
      std::atomic<std::int64_t>                    _gc_threshold;
      std::mutex                                   _notify_mutex;
      std::condition_variable                      _notify_cond;
      bool                                         _stopped = false;
      std::atomic<gc_flag_type>                    _gc_flag;
      shared_value                                 _gc_mutex;
      std::atomic<bool>                            _rescanning;

      // statistics
      std::uint64_t _eviction_count = 0;

      //
      std::mutex                _scan_queue_mutex;
      std::vector<page_header*> _scan_queue;

      void*       _base = nullptr;
      std::size_t _size = 0;
   };

}  // namespace psidb
