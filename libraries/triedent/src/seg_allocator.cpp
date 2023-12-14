#include <triedent/file_fwd.hpp>
#include <triedent/seg_allocator.hpp>

namespace triedent
{
   seg_allocator::seg_allocator(std::filesystem::path dir)
       : _id_alloc(dir / "ids"),
         _block_alloc(dir / "segs", segment_size, max_segment_count),
         _header_file(dir / "header", access_mode::read_write, true)
   {
      if (_header_file.size() == 0)
      {
         _header_file.resize(round_to_page(sizeof(mapped_memory::allocator_header)));
         new (_header_file.data()) mapped_memory::allocator_header();
      }
      _header = reinterpret_cast<mapped_memory::allocator_header*>(_header_file.data());

      for (auto& sptr : _session_ptrs)
         sptr.store(-1ull);
      _done.store(false);
   }

   seg_allocator::~seg_allocator()
   {
      cses.reset();
      _done.store(true);
      if (_compact_thread.joinable())
         _compact_thread.join();
   }

   void seg_allocator::start_compact_thread()
   {
      if (not _compact_thread.joinable())
      {
         _compact_thread = std::thread(
             [this]()
             {
                thread_name("compactor");
                set_current_thread_name("compactor");
                compact_loop();
             });
      }
   }

   /**
    * This must be called via a session because the session is responsible
    * for documenting what regions could be read
    *
    * All objects are const because they cannot be modified after being
    * written.
   const object_header* seg_allocator::get_object(object_location loc) const
   {
      return nullptr;
   }
   const object_header* seg_allocator::get_object(object_id oid) const
   {
      return nullptr;
   }
    */

   /**
    *  After all writes are complete, and there is not enough space
    *  to allocate the next object the alloc_ptr gets set to MAX and
    *  the page gets 
    */
   void seg_allocator::finalize_segment(segment_number)
   {
      /// add maxsegsize - (seg_end-alloc_ptr) to free space
      /// set seg.alloc_ptr = max
      /// set seg as read only
      /// mark seg as random access if average object size is
      /// less than 2x page size.
      /// mark seg as seq access if average object size is greater than 1mb
      /// else mark seg as normal access
   }

   /**
    *  After all data has been removed from a segment
    * - madvise free/don't need 
    * - add the segment number to the free segments at allocator_header::end_ptr
    * - increment allocator_header::end_ptr
    */
   void seg_allocator::release_segment(segment_number) {}

   void seg_allocator::compact_loop()
   {
      using namespace std::chrono_literals;
      if( not cses ) 
         cses.emplace(start_session());

      while (not _done.load())
      {

         if( not compact_next_segment() ) {
            /*
            std::cerr << "sleeping because most seg: " << most_empty_seg_num
                      << " empty: " << most_empty_seg_free << " "
                      << 100 * most_empty_seg_free / double(segment_size) << "\n";
                      */
            using namespace std::chrono_literals;
            std::this_thread::sleep_for(2ms);
         }

         // find most empty segment
         // move it to my own personal write session
         // add it to the free segment queue
      }
   }

   bool seg_allocator::compact_next_segment() {
      if( not cses ) 
         cses.emplace(start_session());

      uint64_t most_empty_seg_num  = -1ll;
      uint64_t most_empty_seg_free = 0;
      auto     total_segs          = _block_alloc.num_blocks();
      auto     oldest              = -1ul;
      for (uint32_t s = 0; s < total_segs; ++s)
      {
         auto fso = _header->seg_meta[s].get_free_space_and_objs();
         if (fso.first > most_empty_seg_free)
         if (fso.first > segment_size / 16)  // most_empty_seg_free)
         {
            auto seg = get_segment(s);
            // only consider segs that are not actively allocing
            // or that haven't already been processed
            if (seg->_alloc_pos.load(std::memory_order_relaxed) == uint32_t(-1))
            {
         //      if (seg->_age <= oldest)
               {
                  most_empty_seg_num  = s;
                  most_empty_seg_free = fso.first;
                  oldest              = seg->_age;
               }
            }
         }
      }

      // segments must be at least 25% empty before compaction is considered
      if (most_empty_seg_num == -1ull or most_empty_seg_free < segment_size / 16)
      {
         return false;
      }

      compact_segment(*cses, most_empty_seg_num);
      return true;
   }

   void seg_allocator::compact_segment(session& ses, uint64_t seg_num)
   {
      auto           state = ses.lock();
      auto           s     = get_segment(seg_num);
      auto           send  = (object_header*)((char*)s + segment_size);
      char*          foc   = (char*)s + 16;
      object_header* foo   = (object_header*)(foc);

      /*
      std::cerr << "compacting segment: " << seg_num << " into " << ses._alloc_seg_num << " "
      << "seg free: " << _header->seg_meta[seg_num].get_free_space_and_objs().first << " "
      << "seg alloc_pos: " << s->_alloc_pos <<" ";
      if( ses._alloc_seg_ptr ) {
         std::cerr << "comp-alloc: " << ses._alloc_seg_ptr->_alloc_pos <<" comp-free: " << _header->seg_meta[ses._alloc_seg_num].get_free_space_and_objs().first <<"\n";
      } else std::cerr<<"\n";
      */

      assert(s->_alloc_pos == segment_offset(-1));
      //   std::cerr << "seg " << seg_num <<" alloc pos: " << s->_alloc_pos <<"\n";

      auto seg_state = seg_num * segment_size;
      auto seg_end   = (seg_num + 1) * segment_size;

      auto start_seg_ptr = ses._alloc_seg_ptr;
      auto start_seg_num = ses._alloc_seg_num;

      madvise(s, segment_size, MADV_SEQUENTIAL);
      while (foo < send and foo->id)
      {
         auto obj_ref = state.get({foo->id});

         auto foo_idx = (char*)foo - (char*)s;
         auto loc     = obj_ref.location()._offset;
         if ((loc & (segment_size - 1)) != foo_idx or obj_ref.ref_count() == 0)
         {
            foo = foo->next();
            continue;
         }


         {
         // optimistically we should move it, but first we must try to
         // lock the ID to prevent anyone else from moving it while we
         // move it.
            std::unique_lock ul(obj_ref.get_mutex());  
            obj_ref.refresh();

            {
               auto foo_idx = (char*)foo - (char*)s;
               auto loc     = obj_ref.location()._offset;
               if ((loc & (segment_size - 1)) != foo_idx or obj_ref.ref_count() == 0)
               {
                  foo = foo->next();
                  continue;
               }
            }

            auto obj_size   = foo->object_size();
            auto [loc, ptr] = ses.alloc_data(obj_size, {foo->id});
            memcpy(ptr, foo, obj_size);
            obj_ref.move(loc);
         }
         // it is possible that the object was released between locking
         // and copying, if it was 0 after the move then we must mark the space
         // free even though we just alloced it, womp, womp...
         if( obj_ref.ref_count() == 0 ) {
            _header->seg_meta[start_seg_num].free_object(foo->object_size());
         }
         

         // if ses.alloc_data() was forced to make space in a new segment
         // then we need to sync() the old write segment before moving forward
         if (not start_seg_ptr)
         {
            start_seg_ptr = ses._alloc_seg_ptr;
            start_seg_num = ses._alloc_seg_num;
         }
         else if (start_seg_ptr != ses._alloc_seg_ptr)
         {
            // TODO: only sync from alloc pos at last sync
            msync(start_seg_ptr, segment_size, MS_SYNC);
            _header->seg_meta[start_seg_num]._last_sync_pos.store(segment_size,
                                                                  std::memory_order_relaxed);
            start_seg_ptr = ses._alloc_seg_ptr;
            start_seg_num = ses._alloc_seg_num;
         }
         foo = foo->next();
      }

      // in order to maintain the invariant that the segment we just cleared
      // can be reused, we must make sure that the data we moved out has persisted to
      // disk.
      if (start_seg_ptr)
      {
         if (-1 == msync(start_seg_ptr, start_seg_ptr->_alloc_pos, MS_SYNC))
         {
            std::cerr << "msync errorno: " << errno << "\n";
         }
         _header->seg_meta[seg_num]._last_sync_pos.store(start_seg_ptr->_alloc_pos,
                                                         std::memory_order_relaxed);
      }

      s->_num_objects = 0;
      s->_alloc_pos   = 0;
      s->_age         = -1;
      // the segment we just cleared, so its free space and objects get reset to 0
      // and its last_sync pos gets put to the end because there is no need to sync it
      // because its data has already been synced by the compactor
      _header->seg_meta[seg_num].clear();

      munlock(s, segment_size);
      // it is unlikely to be accessed, and if it is don't pre-fetch
      madvise(s, segment_size, MADV_RANDOM);

      // only one thread can move the end_ptr or this will break
      // std::cerr<<"done freeing end_ptr: " << _header->end_ptr.load() <<" <== " << seg_num <<"\n";
      _header->free_seg_buffer[_header->end_ptr.load()] = seg_num;
      _header->end_ptr.fetch_add(1, std::memory_order_release);
      //
   }

   /**
    * The min read pointer, aka min(R*), must be A <= R* <= E.
    * A, R, and E only ever increase
    * The last value of this function is stored in _min_read_ptr
    *
    * So long as the last value is greater than A, A can advance without
    * updating _min_read_ptr; however, if A >= _min_read_ptr then 
    * we want to check all active R* to find the min. If all sessions
    * are idle, the the min becomes E.
    */
   uint64_t seg_allocator::get_min_read_ptr()
   {
      auto ap  = _header->alloc_ptr.load(std::memory_order_relaxed);
      auto ep  = _header->end_ptr.load(std::memory_order_acquire);
      auto min = _min_read_ptr.load(std::memory_order_acquire);

      if (ap >= min)  // then check to see if there is more
      {
         min = ep;
         // find new last min
         // TODO: only iterate over active sessions instead of all sessions
         // this is so infrequent it probably doesn't matter.
         auto fs      = ~_free_sessions.load();
         auto num_ses = std::popcount(fs);
         for (uint32_t i = 0; fs and i < max_session_count; ++i)
         {
            if (fs & (1ull << i))
            {
               if (auto p = _session_ptrs[i].load(std::memory_order_relaxed); p < min)
               {
                  min = p;
               }

               // we can't find anything lower than this
               if (min == ap)
               {
                  _min_read_ptr.store(min, std::memory_order_release);
                  return min;
               }
            }
         }
      }
      if (min > ep)
         min = ep;
      _min_read_ptr.store(min, std::memory_order_release);
      return min;
   }

   /**
    *  reads allocator_header::reuse_ptr and if it is less than
    *  allocator_header::min_read_ptr then attempts increment the
    *  reuse pointer by exactly 1, if so then it uses the segment
    *  at _free_segments[reuse_ptr.old] 
    *
    *  If reuse_ptr == min_read_ptr then advance the alloc_ptr by
    *  segment_size to claim a new segment.
    *
    *
    */
   std::pair<segment_number, mapped_memory::segment_header*> seg_allocator::get_new_segment()
   {
      auto ap  = _header->alloc_ptr.load(std::memory_order_relaxed);
      auto min = get_min_read_ptr();

      auto prepare_segment = [&](segment_number sn)
      {
         auto sp = _block_alloc.get(sn);
         madvise(sp, segment_size, MADV_WILLNEED);
         /*
         auto r = mlock(sp, segment_size);

         if (r)
            std::cerr << "MLOCK: " << r << "  " << EINVAL << "  " << EAGAIN << "\n";
            */

         //memset( sp, 0, segment_size );

         auto shp  = new (sp) mapped_memory::segment_header();
         shp->_age = _header->next_alloc_age.fetch_add(1, std::memory_order_relaxed);

         return std::pair<segment_number, mapped_memory::segment_header*>(sn, shp);
      };
      //  std::cout <<"get new seg ap: " << ap << "  min: " << min <<"  min-ap:" << min - ap << "\n";

      while (min - ap >= 1)
      {
         if (_header->alloc_ptr.compare_exchange_weak(ap, ap + 1))
         {
            auto free_seg                = _header->free_seg_buffer[ap];
            _header->free_seg_buffer[ap] = segment_number(-1);
            //       std::cerr << "reusing segment..." << free_seg <<"\n";
            return prepare_segment(free_seg);
         }
      }
      return prepare_segment(_block_alloc.alloc());
   }
   void seg_allocator::sync(sync_type st)
   {
      if (st == sync_type::none)
         return;

      auto total_segs = _block_alloc.num_blocks();

      for (uint32_t i = 0; i < total_segs; ++i)
      {
         auto seg        = get_segment(i);
         auto last_sync  = _header->seg_meta[i]._last_sync_pos.load(std::memory_order_relaxed);
         auto last_alloc = seg->_alloc_pos.load(std::memory_order_relaxed);

         if (last_alloc > segment_size)
            last_alloc = segment_size;

         static const uint64_t page_size      = getpagesize();
         static const uint64_t page_size_mask = ~(page_size - 1);

         auto sync_bytes   = last_alloc - (last_sync & page_size_mask);
         auto seg_sync_ptr = (((intptr_t)seg + last_sync) & page_size_mask);

         if (last_alloc > last_sync)
         {
            if (-1 == msync((char*)seg_sync_ptr, sync_bytes, msync_flag(st)))
            {
               std::cerr << "ps: " << getpagesize() << " len: " << sync_bytes << " rounded:  \n";
               std::cerr << "msync errno: " << std::string(strerror(errno))
                         << " seg_alloc::sync() seg: " << i << "\n";
            }
            _header->seg_meta[i]._last_sync_pos.store(last_alloc);
         }
      }
   }

   void seg_allocator::dump()
   {
      std::cerr << "\n--- segment allocator state ---\n";
      auto     total_segs       = _block_alloc.num_blocks();
      auto     total_retained   = 0;
      uint64_t total_free_space = 0;
      std::cerr << "total segments: " << total_segs << "\n";
      std::cerr << std::setw(6) << "#"
                << " | ";
      std::cerr << std::setw(8) << "freed %"
                << " | ";
      std::cerr << std::setw(12) << "freed bytes"
                << " | ";
      std::cerr << std::setw(12) << "freed obj"
                << " | ";
      std::cerr << std::setw(12) << "alloc pos"
                << " | ";
      std::cerr << std::setw(12) << "alloced obj"
                << " | ";
      std::cerr << std::setw(12) << "num obj"
                << " | ";
      std::cerr << std::setw(8) << "age"
                << " \n";
      for (uint32_t i = 0; i < total_segs; ++i)
      {
         auto seg        = get_segment(i);
         auto space_objs = _header->seg_meta[i].get_free_space_and_objs();

         std::cerr << std::setw(6) << i << " | ";
         std::cerr << std::setw(8) << int(100 * double(space_objs.first) / segment_size) << " | ";
         total_free_space += space_objs.first;
         std::cerr << std::setw(12) << space_objs.first << " | ";
         std::cerr << std::setw(12) << space_objs.second << " | ";
         std::cerr << std::setw(12)
                   << (seg->_alloc_pos == -1 ? "END" : std::to_string(seg->_alloc_pos)) << " | ";
         std::cerr << std::setw(12) << seg->_num_objects << " | ";
         total_retained += seg->_num_objects - space_objs.second;
         std::cerr << std::setw(12) << seg->_num_objects - space_objs.second << " | ";
         std::cerr << std::setw(8) << seg->_age << " \n";
      }
      std::cerr << "total free: " << total_free_space / 1024 / 1024. << "Mb  "
                << (100 * total_free_space / double(total_segs * segment_size)) << "%\n";
      std::cerr << "total retained: " << total_retained << " objects\n";

      std::cerr << "---- free segment Q ------\n";
      std::cerr << "[---A---R*---E------]\n";
      std::cerr << "A - alloc idx: " << _header->alloc_ptr.load() << "\n";
      for (uint32_t i = 0; i < max_session_count; ++i)
      {
         if (auto p = _session_ptrs[i].load(); p != -1ull)
            std::cerr << "R" << i << ": " << p << "\n";
      }

      std::cerr << "E - end idx: " << _header->end_ptr.load() << "\n";

      auto fs      = ~_free_sessions.load();
      auto num_ses = std::popcount(fs);
      std::cerr << "active sessions: " << num_ses << "\n";
      for (uint32_t i = 0; i < max_session_count; ++i)
      {
         if (fs & (1ull << i))
         {
            if (auto p = _session_ptrs[i].load(); p == -1ull)
               std::cerr << "R" << i << ": UNLOCKED \n";
         }
      }

      std::cerr << "------- pending free segments -----------\n";
      for (auto x = _header->alloc_ptr.load(); x < _header->end_ptr.load(); ++x)
      {
         std::cerr << x << "] " << _header->free_seg_buffer[x & (max_segment_count - 1)] << "\n";
      }
      std::cerr << "--------------------------\n";
   }
};  // namespace triedent
