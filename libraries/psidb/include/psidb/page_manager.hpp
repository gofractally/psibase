#pragma once

#include <boost/intrusive/list.hpp>
#include <cstddef>
#include <iostream>
#include <map>
#include <psidb/allocator.hpp>
#include <psidb/checkpoint.hpp>
#include <psidb/gc_allocator.hpp>
#include <psidb/node_ptr.hpp>
#include <psidb/page_header.hpp>
#include <psidb/page_types/free_list.hpp>
#include <psidb/sync/mutex_set.hpp>
#include <psidb/sync/shared_queue.hpp>
#include <stdexcept>
#include <syncstream>
#include <utility>

namespace psidb
{

   class page_manager;

   struct checkpoint_data : boost::intrusive::list_base_hook<>
   {
      checkpoint_data(page_manager* self, const checkpoint_root& value);
      // Creates a new checkpoint based on the head checkpoint
      checkpoint_data(page_manager* self);
      ~checkpoint_data();
      page_manager*   _self;
      checkpoint_root _root;

      // Pages that are used by this checkpoint, but not by any later checkpoint.
      // When a checkpoint is deleted, this list is merged into the previous checkpoint.
      // Optimized for few large transactions.
      // A mergeable priority queue would be faster for many small transactions.
      std::vector<std::vector<page_header*>> _pages_to_free;

      void add_free_pages(std::vector<page_header*>&& pages);
      // Free all pages more recent than version
      void free_pages(version_type version);
      void splice_pages(checkpoint_data& other);
   };

   class page_manager
   {
     public:
      page_manager(int fd, std::size_t num_pages);
      page_manager(const char* path, std::size_t num_pages);
      ~page_manager();

      bool         is_memory_page(page_id id) { return id < max_memory_pages; }
      page_header* translate_page_address(page_id id)
      {
         return _allocator.translate_page_address(id);
      }
      page_id      get_id(const page_header* page) { return _allocator.get_id(page); }
      page_header* get_page(node_ptr ptr)
      {
         auto id = *ptr;
         if (is_memory_page(id))
         {
            return translate_page_address(id);
         }
         else
         {
            return read_page(ptr, id);
         }
      }
      page_header* get_page(node_ptr ptr, version_type version)
      {
         auto id = *ptr;
         if (is_memory_page(id))
         {
            while (true)
            {
               //std::osyncstream(std::cout) << "reading page: " << id << " v" << version << std::endl;
               page_header* p = translate_page_address(id);
               assert(p->type != page_type::free);
               if (p->version <= version)
               {
                  return p;
               }
               else
               {
                  //std::osyncstream(std::cout) << id << " (v" << p->version << ") -> " << p->prev << std::endl;
                  id = p->prev;
               }
            }
         }
         else
         {
            return read_page(ptr, id);
         }
      }
      page_header* get_page(page_id& id)
      {
         if (is_memory_page(id))
         {
            return translate_page_address(id);
         }
         else
         {
            return read_page(id);
         }
      }
      void* get_pages(page_id& id, std::size_t count)
      {
         if (is_memory_page(id))
         {
            return translate_page_address(id);
         }
         else
         {
            return read_pages(id, count);
         }
      }
      std::pair<page_header*, page_id> allocate_page()
      {
         page_header* result = static_cast<page_header*>(_allocator.allocate_page());
         return {result, get_id(result)};
      }
      void set_root(const checkpoint& c, int db, page_id new_root)
      {
         c._root->_root.table_roots[db] = new_root;
      }
      page_header* root(const checkpoint& c, int db)
      {
         return get_page(c._root->_root.table_roots[db]);
      }
      page_id get_root_id(const checkpoint& c, int db) const
      {
         return c._root->_root.table_roots[db];
      }
      version_type get_version(const checkpoint& c) { return c._root->_root.version; }
      checkpoint   get_head()
      {
         std::lock_guard l{_commit_mutex};
         return {last_commit};
      }
      checkpoint start_transaction()
      {
         if (_flush_pending)
         {
            _flush_version = head->_root.version;
            _flush_pending = false;
            _dirty_flag    = switch_dirty_flag(_dirty_flag);
            // TODO: should this be in async_flush?
            if (head == last_commit)
            {
               start_flush(head, _flush_stable);
            }
         }
         head.reset(new checkpoint_data(this));
         return {head};
      }
      void commit_transaction(const checkpoint& c, std::vector<page_header*>&& obsolete_pages)
      {
         {
            std::lock_guard l{_checkpoint_mutex};
            auto            pos = _active_checkpoints.iterator_to(*c._root);
            // last_commit must exist and be before c.
            assert(pos != _active_checkpoints.begin());
            --pos;
            pos->add_free_pages(std::move(obsolete_pages));
         }
         {
            std::lock_guard l{_commit_mutex};
            last_commit = c._root;
         }
         if (last_commit->_root.version == _flush_version)
         {
            start_flush(c._root, _flush_stable);
         }
#if 0
         if (_allocator.should_gc())
         {
            run_gc();
         }
#endif
         //_gc_manager.process_gc(_allocator, _file_allocator);
      }
      void abort_transaction(checkpoint&& c)
      {
         assert(c._root.get() == &_active_checkpoints.back());
         c._root.reset();
      }
      void async_flush(bool stable = true)
      {
         // FIXME: automatically ignoring multiple flushes
         // is probably a bad idea.  At the very least, it interacts
         // badly with stable.
         if (_syncing.exchange(true, std::memory_order_relaxed))
         {
            return;
         }
         if (head == last_commit)
         {
            if (_flush_version != head->_root.version)
            {
               _flush_version = head->_root.version;
               _flush_pending = false;
               _dirty_flag    = switch_dirty_flag(_dirty_flag);
               start_flush(head, stable);
            }
         }
         else
         {
            _flush_stable  = stable;
            _flush_pending = true;
         }
      }
      // Mark a page as dirty.
      void touch_page(page_header* page, version_type version)
      {
         if (version > _flush_version)
         {
            page->set_dirty(_dirty_flag, true);
         }
         else
         {
            page->set_dirty(switch_dirty_flag(_dirty_flag), true);
         }
      }
      enum value_reference_flags : std::uint16_t
      {
         file,
         memory
      };
      struct value_reference
      {
         value_reference_flags flags;
         std::uint16_t         offset;
         std::uint32_t         size;
         union
         {
            const char* data;
            page_id     page;
         };
      };
      value_reference clone_value(std::string_view data)
      {
         if (data.size() > UINT32_MAX)
         {
            throw std::invalid_argument("value too large");
         }
         void* copy = _allocator.allocate(data.size());
         std::memcpy(copy, data.data(), data.size());
         return {value_reference_flags::memory, 0, static_cast<std::uint32_t>(data.size()),
                 static_cast<const char*>(copy)};
      }

      // A lock must be held around:
      // - All allocations
      // - All page lookups that might follow a prev ptr
      // Locks are non-exclusive, and acquiring a lock is non-blocking.
      auto gc_lock() { return _allocator.lock(); }

      void run_gc_loop()
      {
         while (_allocator.gc_wait())
         {
            run_gc();
         }
      }

      void stop_gc() { _allocator.gc_stop(); }

      void run_gc()
      {
         std::vector<version_type> versions;
         std::vector<page_header*> roots;
         gc_allocator::cycle       cycle = _allocator.start_cycle();
         {
            std::lock_guard l{_checkpoint_mutex};
            for (const auto& c : _active_checkpoints)
            {
               cycle.versions.push_back(c._root.version);
               roots.push_back(translate_page_address(c._root.table_roots[0]));
            }
         }
#if 0
      {
         std::osyncstream ss(std::cout);
         ss << "gc: ";
         for(auto v : cycle.versions)
         {
            ss << v << " ";
         }
         ss << std::endl;
      }
#endif
         for (page_header* root : roots)
         {
            _allocator.scan_root(cycle, root);
         }
         _allocator.sweep(std::move(cycle));
      }

      void queue_gc(page_header* node);
      struct stats
      {
         file_allocator::stats file;
         gc_allocator::stats   memory;
         std::size_t           checkpoints;
      };
      stats get_stats() const
      {
         return {_file_allocator.get_stats(), _allocator.get_stats(), checkpoints()};
      }
      std::size_t checkpoints() const
      {
         std::lock_guard l{_checkpoint_mutex};
         return _active_checkpoints.size();
      }
      void print_summary();

     private:
      page_manager(const page_manager&) = delete;

      friend struct checkpoint_data;

      using checkpoint_ptr = std::shared_ptr<checkpoint_data>;

      page_flags switch_dirty_flag(page_flags f)
      {
         if (f == page_flags::dirty0)
         {
            return page_flags::dirty1;
         }
         else if (f == page_flags::dirty1)
         {
            return page_flags::dirty0;
         }
         else
         {
            __builtin_unreachable();
         }
      }

      page_id allocate_file_page();
      page_id allocate_file_pages(std::size_t count);

      // Manage the in memory page cache
      void*        read_pages(page_id& id, std::size_t count);
      page_header* read_page(page_id& id);
      page_header* read_page(node_ptr ptr, page_id id);
      void         evict_page(node_ptr ptr);

      // Write dirty pages back to the filesystem
      void write_worker();
      void queue_write(page_id dest, page_header* src, const std::shared_ptr<void>& refcount);
      void write_pages(page_id                      dest,
                       const void*                  src,
                       std::size_t                  count,
                       const std::shared_ptr<void>& refcount);
      void write_page(page_header*                 page,
                      page_flags                   dirty_flag,
                      const std::shared_ptr<void>& refcount);
      bool write_tree(page_id                      page,
                      version_type                 version,
                      page_flags                   dirty_flag,
                      const std::shared_ptr<void>& refcount);
      void start_flush(const std::shared_ptr<checkpoint_data>& ptr, bool stable);

      // Raw file io
      void read_page(void* out, page_id id, std::size_t count = 1);
      void write_page(const void* in, page_id id);

      // Database header ops
      void read_header(database_header* header);
      void read_header();
      void prepare_flush(page_id& root);
      void prepare_header(database_header* header, const checkpoint_ptr& root);
      void write_header(const checkpoint_ptr& root, bool stable);

      struct write_queue_element
      {
         std::int64_t dest;
         const void*  src;
         std::size_t  size;
         // completion handler
         std::shared_ptr<void> counter;
      };

#if 0
      struct checkpoint_range {
      public:
         checkpoint_list::const_iterator begin() const { return _begin; }
         checkpoint_list::const_iterator end() const { return _end; }
      private:
         checkpoint_list::const_iterator _begin;
         checkpoint_list::const_iterator _end;
         std::unique_lock<std::mutex> _lock;
      };
#endif

      //allocator                         _allocator;
      //gc_manager                        _gc_manager;
      gc_allocator                      _allocator;
      int                               fd = -1;
      file_allocator                    _file_allocator;
      page_flags                        _dirty_flag    = page_flags::dirty0;
      bool                              _flush_pending = false;
      bool                              _flush_stable  = true;
      version_type                      _flush_version = 0;
      std::atomic<bool>                 _syncing       = false;
      shared_queue<write_queue_element> _write_queue;

      // What do we need:
      // - iterate over uncommitted transactions in order
      // - committed checkpoints can be freed as soon as they are no longer referenced.
      mutable std::mutex                      _checkpoint_mutex;
      boost::intrusive::list<checkpoint_data> _active_checkpoints;
      std::mutex                              _commit_mutex;
      checkpoint_ptr                          stable_checkpoint = nullptr;
      checkpoint_ptr                          last_commit       = nullptr;
      checkpoint_ptr                          head              = nullptr;

      mutex_set<page_id> _page_load_mutex;

      std::thread _write_worker{[this]() { write_worker(); }};
   };

}  // namespace psidb
