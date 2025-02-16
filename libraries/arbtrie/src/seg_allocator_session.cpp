#include <arbtrie/seg_allocator.hpp>
#include <cassert>

namespace arbtrie
{
   seg_alloc_session::seg_alloc_session(seg_alloc_session&& mv)
       : _sega(mv._sega),
         _session_num(mv._session_num),
         _alloc_seg_num(mv._alloc_seg_num),
         _alloc_seg_ptr(mv._alloc_seg_ptr),
         _session_lock_ptr(mv._session_lock_ptr),
         _segment_read_stat(mv._segment_read_stat),
         _rcache_queue(mv._rcache_queue)
   {
      mv._session_num = -1;
   }

   seg_alloc_session::seg_alloc_session(seg_allocator& a, uint32_t ses_num)
       : _session_num(ses_num),
         _alloc_seg_num(-1ull),
         _alloc_seg_ptr(nullptr),
         _session_lock_ptr(a._session_lock_ptrs[ses_num]),
         _segment_read_stat(a._session_seg_read_stats[ses_num]),
         _sega(a),
         _rcache_queue(*a._rcache_queues[ses_num])
   {
   }

   seg_alloc_session::~seg_alloc_session()
   {
      if (_session_num == -1)
         return;
      if (_alloc_seg_ptr)  // not moved
      {
         if (segment_size - _alloc_seg_ptr->_alloc_pos >= sizeof(node_header))
         {
            memset(((char*)_alloc_seg_ptr) + _alloc_seg_ptr->_alloc_pos, 0,
                   sizeof(node_header));  // mark last object
         }
         _sega._header->seg_meta[_alloc_seg_num].free(segment_size - _alloc_seg_ptr->_alloc_pos);
         _alloc_seg_ptr->_alloc_pos = uint32_t(-1);
         _alloc_seg_num             = -1ull;
      }
      _sega.release_session_num(_session_num);
   }

   std::pair<node_location, node_header*> seg_alloc_session::alloc_data(uint32_t   size,
                                                                        id_address adr,
                                                                        uint64_t   time)
   {
      assert(size < segment_size - round_up_multiple<64>(sizeof(mapped_memory::segment_header)));
      // A - if no segment get a new segment
      if (not _alloc_seg_ptr or
          _alloc_seg_ptr->_alloc_pos.load(std::memory_order_relaxed) > segment_size) [[unlikely]]
      {
         auto [num, ptr] = _sega.get_new_segment();
         _alloc_seg_num  = num;
         _alloc_seg_ptr  = ptr;
         //  if (not _alloc_seg_ptr->_write_lock.try_lock())
         //  {
         //     TRIEDENT_WARN("unable to get write lock on segment");
         //  }
         //_sega._header->seg_meta[_alloc_seg_num].set_last_sync_pos(0);
         _sega._header->seg_meta[_alloc_seg_num].start_alloc_segment();
      }

      auto* sh           = _alloc_seg_ptr;
      auto  rounded_size = round_up_multiple<64>(size);

      auto cur_apos = sh->_alloc_pos.load(std::memory_order_relaxed);

      auto spec_pos   = uint64_t(cur_apos) + rounded_size;
      auto free_space = segment_size - cur_apos;

      // TODO: should we cache this pointer on the session rather
      // than do several indirections...
      auto& smeta = _sega._header->seg_meta[_alloc_seg_num];

      // B - if there isn't enough space, notify compactor go to A
      if (spec_pos > (segment_size - sizeof(node_header))) [[unlikely]]
      {
         if (free_space >= sizeof(node_header))
         {
            assert(cur_apos + sizeof(uint64_t) <= segment_size);
            memset(((char*)sh) + cur_apos, 0, sizeof(node_header));
         }
         //smeta.free(segment_size - sh->_alloc_pos);
         smeta.finalize_segment(segment_size - sh->_alloc_pos);  // not alloc
         sh->_alloc_pos.store(uint32_t(-1), std::memory_order_release);
         _sega.push_dirty_segment(_alloc_seg_num);
         _alloc_seg_ptr = nullptr;
         _alloc_seg_num = -1ull;

         return alloc_data(size, adr, time);  // recurse
      }

      auto obj  = ((char*)sh) + sh->_alloc_pos.load(std::memory_order_relaxed);
      auto head = (node_header*)obj;
      head      = new (head) node_header(size, adr);

      smeta._base_time.update(round_up_multiple<64>(size) / 64, time);

      auto new_alloc_pos =
          rounded_size + sh->_alloc_pos.fetch_add(rounded_size, std::memory_order_relaxed);
      //sh->_num_objects++;

      auto loc = _alloc_seg_num * segment_size + cur_apos;

      return {node_location::from_absolute(loc), head};
   }
   void seg_alloc_session::unalloc(uint32_t size)
   {
      auto rounded_size = round_up_multiple<64>(size);
      if (_alloc_seg_ptr) [[likely]]
      {
         auto cap = _alloc_seg_ptr->_alloc_pos.load(std::memory_order_relaxed);
         if (cap and cap < segment_size) [[likely]]
         {
            auto cur_apos =
                _alloc_seg_ptr->_alloc_pos.fetch_sub(rounded_size, std::memory_order_relaxed);
            cur_apos -= rounded_size;
            memset(((char*)_alloc_seg_ptr) + cur_apos, 0, sizeof(node_header));
         }
         //_alloc_seg_ptr->_num_objects--;
      }
   }

   void seg_alloc_session::sync(sync_type st)
   {
      _sega.push_dirty_segment(_alloc_seg_num);
      _sega.sync(st);
   }

   uint64_t seg_alloc_session::count_ids_with_refs()
   {
      return _sega.count_ids_with_refs();
   }
}  // namespace arbtrie
