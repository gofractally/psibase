#pragma once
#include <arbtrie/circular_buffer.hpp>
#include <arbtrie/mapped_memory.hpp>
#include <arbtrie/mapping.hpp>
#include <arbtrie/node_header.hpp>
#include <arbtrie/node_meta.hpp>
#include <arbtrie/segment_read_stats.hpp>
#include <arbtrie/sync_lock.hpp>
#include <atomic>
#include <memory>

namespace arbtrie
{
   class seg_allocator;
   class read_lock;

   class seg_alloc_session
   {
     public:
      // before any objects can be read, the session must note the
      // current state of the free segment queue so that no segments that
      // could be read while the return value of this method is in scope can
      // be reused (overwritten)
      read_lock lock();
      void      sync(sync_type st);

      ~seg_alloc_session();
      seg_alloc_session(seg_alloc_session&& mv);

      uint64_t count_ids_with_refs();

     private:
      friend class read_lock;
      friend class modify_lock;
      friend class seg_allocator;
      friend class object_ref;

      void retain_read_lock();
      void release_read_lock();

      seg_alloc_session(seg_allocator& a, uint32_t ses_num);
      seg_alloc_session()                         = delete;
      seg_alloc_session(const seg_alloc_session&) = delete;

      void                                   unalloc(uint32_t size);
      std::pair<node_location, node_header*> alloc_data(uint32_t   size,
                                                        id_address adr,
                                                        uint64_t   time = size_weighted_age::now());

      uint32_t _session_num;  // index into _sega's active sessions list

      segment_number                 _alloc_seg_num = -1ull;
      mapped_memory::segment_header* _alloc_seg_ptr = nullptr;
      bool                           _in_alloc      = false;

      std::atomic<uint64_t>&              _session_lock_ptr;
      std::unique_ptr<segment_read_stat>& _segment_read_stat;
      seg_allocator&                      _sega;
      int                                 _nested_read_lock = 0;

      // Reference to the read cache queue from seg_allocator
      circular_buffer<1024 * 1024>& _rcache_queue;
   };
}  // namespace arbtrie
