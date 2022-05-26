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
#include <psidb/page_map.hpp>
#include <psidb/page_types/free_list.hpp>
#include <psidb/sync/shared_queue.hpp>
#include <stdexcept>
#include <syncstream>
#include <utility>

namespace psidb
{

   class page_manager;

   struct obsolete_page
   {
      version_type version;
      page_id      page;
   };

   struct checkpoint_data : boost::intrusive::list_base_hook<>,
                            std::enable_shared_from_this<checkpoint_data>
   {
      checkpoint_data(page_manager* self, const checkpoint_root& value);
      // Creates a new checkpoint based on the head checkpoint
      checkpoint_data(page_manager* self);
      ~checkpoint_data();
      page_manager*   _self;
      checkpoint_root _root;

      // true if this checkpoint should be written to disk.
      bool _durable = false;

      // Pages that are used by this checkpoint, but not by any later checkpoint.
      // When a checkpoint is deleted, this list is merged into the previous checkpoint.
      // Optimized for few large transactions.
      // A mergeable priority queue would be faster for many small transactions.
      std::vector<std::vector<obsolete_page>> _pages_to_free;

      void add_free_pages(std::vector<obsolete_page>&& pages);
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
      std::pair<page_header*, page_id> allocate_page(page_header* src)
      {
         page_header* result = static_cast<page_header*>(_allocator.allocate_page(src));
         return {result, get_id(result)};
      }
      void pin_page(page_header* page) { page->pin(); }
      void unpin_page(page_header* page) { page->unpin(); }
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
         }
         head.reset(new checkpoint_data(this));
         return {head};
      }
      void commit_transaction(const checkpoint& c, std::vector<obsolete_page>&& obsolete_pages)
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
         if (last_commit->_durable)
         {
            if (last_commit != _auto_checkpoint)
            {
               _stable_checkpoints.push_back(last_commit);
            }
            try_flush();
         }
      }
      void abort_transaction(checkpoint&& c)
      {
         assert(c._root.get() == &_active_checkpoints.back());
         c._root.reset();
      }
      // Starts a flush if a flush is not alread in progress
      void try_flush()
      {
         if (_syncing.exchange(true, std::memory_order_relaxed) == false)
         {
            start_flush();
            if (_auto_checkpoint)
            {
               _auto_checkpoint->_durable = false;
            }
            _auto_checkpoint = std::move(_next_auto_checkpoint);
         }
      }
      void async_flush(bool stable = true)
      {
         if (head->_durable)
         {
            // TODO: if stable promote auto checkpoint to stable
            try_flush();
            return;
         }
         head->_durable = true;
         if (stable)
         {
            // A stable checkpoint will cause pending auto checkpoints to be dropped
            if (_auto_checkpoint)
            {
               _auto_checkpoint->_durable = false;
               _auto_checkpoint.reset();
            }
            if (_next_auto_checkpoint)
            {
               _next_auto_checkpoint->_durable = false;
               _next_auto_checkpoint.reset();
            }
         }
         else
         {
            // If we have a scheduled auto checkpoint, don't replace it.
            if (!_auto_checkpoint)
            {
               _auto_checkpoint = head;
            }
            else
            {
               if (_next_auto_checkpoint)
               {
                  _next_auto_checkpoint->_durable = false;
               }
               _next_auto_checkpoint = head;
            }
         }
         if (head == last_commit)
         {
            if (_flush_version != head->_root.version)
            {
               _flush_version = head->_root.version;
               _flush_pending = false;
               if (stable)
               {
                  _stable_checkpoints.push_back(head);
               }
            }
            try_flush();
         }
         else
         {
            _flush_stable  = true;
            _flush_pending = true;
         }
      }
      void sync()
      {
         while (_syncing)
         {
         }
      }
      // Removes a stable checkpoint.  The checkpoint may continue
      // to exist until the database is synced.
      void delete_stable_checkpoint(const checkpoint& c)
      {
         auto pos = std::find(_stable_checkpoints.begin(), _stable_checkpoints.end(), c._root);
         assert(pos != _stable_checkpoints.end());
         _stable_checkpoints.erase(pos);
      }
      std::vector<checkpoint> get_stable_checkpoints() const
      {
         std::vector<checkpoint> result;
         for (auto c : _stable_checkpoints)
         {
            result.push_back(std::move(c));
         }
         return result;
      }
      version_type flush_version() const { return _flush_version; }
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
            char*   data;
            page_id page;
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
                 static_cast<char*>(copy)};
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
         _allocator.sweep(std::move(cycle), _page_map);
      }

      void queue_gc(page_header* node);
      void queue_gc(obsolete_page);
      struct stats
      {
         file_allocator::stats file;
         gc_allocator::stats   memory;
         std::size_t           checkpoints;
         // The number of pages used by the current head
         std::size_t head_pages;
         // The number of disk pages that are not used by the current head
         std::size_t   obsolete_disk_pages;
         std::uint64_t pages_read;
      };
      stats get_stats() const
      {
         // HACK:
         auto mthis = const_cast<page_manager*>(this);
         return {_file_allocator.get_stats(), _allocator.get_stats(),  checkpoints(),
                 mthis->count_head(),         mthis->count_obsolete(), _pages_read};
      }
      std::size_t count_head();
      std::size_t count_obsolete();
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

      page_id allocate_file_page();
      page_id allocate_file_pages(std::size_t count);

      // Manage the in memory page cache
      void*        read_pages(page_id& id, std::size_t count);
      page_header* read_page(page_id& id);
      page_header* read_page(node_ptr ptr, page_id id);
      void         evict_page(node_ptr ptr);

      struct checkpoint_freelist_location
      {
         page_id       page;
         std::uint32_t size;
      };

      // Write dirty pages back to the filesystem
      void write_worker();
      void queue_write(page_id dest, page_header* src, const std::shared_ptr<void>& refcount);
      void write_pages(page_id                      dest,
                       void*                        src,
                       std::size_t                  count,
                       page_type                    type,
                       const std::shared_ptr<void>& refcount);
      void write_page(page_header* page, const std::shared_ptr<void>& refcount);
      bool write_tree(page_id                      page,
                      version_type                 version,
                      version_type                 prev_version,
                      const std::shared_ptr<void>& refcount);
      checkpoint_freelist_location write_checkpoint_freelist(
          const std::vector<checkpoint_ptr>& all_checkpoints,
          const std::shared_ptr<void>&       refcount);
      void start_flush();
      void sync_flush();

      // Raw file io
      void read_page(void* out, page_id id, std::size_t count = 1);
      void write_page(const void* in, page_id id);

      // Database header ops
      void read_checkpoint_freelist(void* data);
      void read_header(database_header* header);
      void read_header();
      void prepare_flush(page_id& root);
      void prepare_header(database_header*                   header,
                          const std::vector<checkpoint_ptr>& roots,
                          std::size_t                        auto_checkpoints);
      void write_header(const std::vector<checkpoint_ptr>& checkpoints,
                        std::size_t                        auto_checkpoints,
                        checkpoint_freelist_location       checkpoint_freelist);

      struct write_queue_element
      {
         std::int64_t dest;
         void*        src;
         std::size_t  size;
         page_type    type;
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
      page_map                          _page_map;
      bool                              _flush_pending = false;
      bool                              _flush_stable  = true;
      version_type                      _flush_version = 0;
      std::atomic<bool>                 _syncing       = false;
      shared_queue<write_queue_element> _write_queue;

      std::atomic<std::uint64_t> _pages_read;

      // What do we need:
      // - iterate over uncommitted transactions in order
      // - committed checkpoints can be freed as soon as they are no longer referenced.
      mutable std::mutex                      _checkpoint_mutex;
      boost::intrusive::list<checkpoint_data> _active_checkpoints;
      std::mutex                              _commit_mutex;
      std::vector<checkpoint_ptr>             _stable_checkpoints;
      checkpoint_ptr                          _last_durable_checkpoint = nullptr;
      checkpoint_ptr                          _auto_checkpoint         = nullptr;
      checkpoint_ptr                          _next_auto_checkpoint    = nullptr;
      checkpoint_ptr                          last_commit              = nullptr;
      checkpoint_ptr                          head                     = nullptr;

      std::thread _write_worker{[this]() { write_worker(); }};
   };

}  // namespace psidb
