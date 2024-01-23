#include <arbtrie/file_fwd.hpp>
#include <arbtrie/seg_allocator.hpp>

#undef NDEBUG
#include <assert.h>

namespace arbtrie
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

      for (auto& sptr : _session_lock_ptrs)
         sptr.store(uint32_t(-1ull));
      _done.store(false);
   }

   seg_allocator::~seg_allocator()
   {
      stop_compact_thread();
      cses.reset();
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
   void seg_allocator::stop_compact_thread() {
      _done.store(true);
      if (_compact_thread.joinable())
         _compact_thread.join();
   }

   /**
    * This must be called via a session because the session is responsible
    * for documenting what regions could be read
    *
    * All objects are const because they cannot be modified after being
    * written.
   const node_header* seg_allocator::get_object(object_location loc) const
   {
      return nullptr;
   }
   const node_header* seg_allocator::get_object(object_id oid) const
   {
      return nullptr;
   }
    */

   /**
    *  After all writes are complete, and there is not enough space
    *  to allocate the next object the alloc_ptr gets set to MAX and
    *  the page gets 
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
    */

   /**
    *  After all data has been removed from a segment
    * - madvise free/don't need 
    * - add the segment number to the free segments at allocator_header::end_ptr
    * - increment allocator_header::end_ptr
   void seg_allocator::release_segment(segment_number) {}
    */

   void seg_allocator::compact_loop()
   {
      using namespace std::chrono_literals;
      if (not cses)
         cses.emplace(start_session());

      while (not _done.load())
      {
         if (not compact_next_segment())
         {
            /*
            std::cerr << "sleeping because most seg: " << most_empty_seg_num
                      << " empty: " << most_empty_seg_free << " "
                      << 100 * most_empty_seg_free / double(segment_size) << "\n";
                      */
            using namespace std::chrono_literals;
            std::this_thread::sleep_for(100ms);
         }

         // find most empty segment
         // move it to my own personal write session
         // add it to the free segment queue
      }
   }

   bool seg_allocator::compact_next_segment()
   {
      if (not cses)
         cses.emplace(start_session());

      uint64_t most_empty_seg_num  = -1ll;
      uint64_t most_empty_seg_free = 0;
      auto     total_segs          = _block_alloc.num_blocks();
      auto     oldest              = -1ul;
      for (uint32_t s = 0; s < total_segs; ++s)
      {
         auto fso = _header->seg_meta[s].get_free_space_and_objs();
         if (fso.first > most_empty_seg_free)
            if (fso.first > segment_size / 8)  // most_empty_seg_free)
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
      auto         state = ses.lock();
      auto         s     = get_segment(seg_num);
      auto         send  = (node_header*)((char*)s + segment_size);
      char*        foc   = (char*)s + sizeof(mapped_memory::segment_header);
      node_header* foo   = (node_header*)(foc);

      
      
      /*
      std::cerr << "compacting segment: " << seg_num << " into " << ses._alloc_seg_num << " "
      << "seg free: " << _header->seg_meta[seg_num].get_free_space_and_objs().first << " "
      << "seg alloc_pos: " << s->_alloc_pos <<" ";
      if( ses._alloc_seg_ptr ) {
         std::cerr << "calloc: " << ses._alloc_seg_ptr->_alloc_pos <<" cfree: " << _header->seg_meta[ses._alloc_seg_num].get_free_space_and_objs().first <<"\r";
      } else std::cerr<<"\r";
      */
      
      

      assert(s->_alloc_pos == segment_offset(-1));
      //   std::cerr << "seg " << seg_num <<" alloc pos: " << s->_alloc_pos <<"\n";

      auto seg_state = seg_num * segment_size;
      auto seg_end   = (seg_num + 1) * segment_size;

      auto start_seg_ptr = ses._alloc_seg_ptr;
      auto start_seg_num = ses._alloc_seg_num;

      madvise(s, segment_size, MADV_SEQUENTIAL);
      while (foo < send and foo->address())
      {
         assert( foo->validate_checksum() );
         auto foo_address = foo->address();
         // skip anything that has been freed
         // note the ref can go to 0 before foo->check is set to -1
         auto obj_ref = state.get(foo_address);
         if (obj_ref.ref() == 0)
         {
            foo = foo->next();
            continue;
         }

         // skip anything that isn't pointing
         // to foo, it may have been moved *or*
         // it may have been freed and the id reallocated to
         // another object. We cannot replace this with obj_ref.obj() == foo
         // because obj_ref could be pointing to an ID in the free list
         auto foo_idx     = (char*)foo - (char*)s;
         auto current_loc = obj_ref.loc();
         if (current_loc.to_abs() != seg_num * segment_size + foo_idx)
         {
            foo = foo->next();
            continue;
         }

         {
            auto obj_size   = foo->size();
            auto [loc, ptr] = ses.alloc_data(obj_size, foo_address);

            // TODO:
            //    This code probably doesn't work in the case that
            //    foo is modified by changing its address, it will
            //    probably detect that the old obj_ref has been
            //    freed not realizing that foo is no longer pointing
            //    at the old object ref after the move This happens
            //    in a currently disabled case on upsert.
            //
            auto try_move   = [&]()
            {
               int count = 0;
               while (obj_ref.try_start_move(obj_ref.loc()))
               {
                  assert( foo->validate_checksum() );
                  memcpy(ptr, foo, obj_size);
                //  if( ptr->validate_checksum()) 
                  switch (obj_ref.try_move(obj_ref.loc(), loc))
                  {
                     case node_meta_type::freed:
                         TRIEDENT_WARN("object freed while copying");
                        return false;
                     case node_meta_type::moved:
                        // realloc or
                         TRIEDENT_WARN("object moved while copying");
                        return false;
                     case node_meta_type::dirty:
                        // TODO: verify whether foo->address() == foo_address
                        if( foo->address() != foo_address ) {
                           TRIEDENT_WARN( "The Address of Foo Changed! HELP ME" );
                           abort();
                        }
                        TRIEDENT_WARN("compactor moving dirty obj, try again");
                        obj_ref.refresh();
                        ++count;
                        continue;
                     case node_meta_type::success:
                        if( count ) {
                           TRIEDENT_WARN( "success on attempt: ", count );
                        }
                        return true;
                  }
               }
           //    TRIEDENT_WARN( "try_move failed in try_start_move" );
               return false;
            };

            if (not try_move())
            {
             //  TRIEDENT_WARN("try move failed, unalloc...", foo->id());
                //auto start_seg_num = ses._alloc_seg_num;
               _header->seg_meta[ses._alloc_seg_num].free_object(foo->size());
               // TODO: retry
              // ses.unalloc(ptr->_nsize);
            }
            //if (not foo->validate_checksum())
            {
           //    TRIEDENT_WARN("moved object with invalid checksum: expected: ",
            //                 foo->calculate_checksum(), " != ", foo->checksum);
            }
         }

         // release() does not grab the lock, so while we were copying the
         // object may have been released (and realloc) and foo->check set to -1
         // - this fixed bugs in mutex based version, TBD if this is needed now
         /*
         if (moved_foo->checksum == uint32_t(-1))
         {
            // since we alocated data, we need to indicate that it is not being
            // used. TODO: investigating resetting the alloc_ptr by -foo->object_size()
            _header->seg_meta[start_seg_num].free_object(foo->object_capacity());
         }
         */

         // after moving the data, check to make sure that the checksum is still
         // valid. This will difinitively prove that a clean copy was made.
         // this is not safe because anyone could modify it while doing this calc,
         // so a try_start_move, end_move would be required and this would have to
         // run in a loop in case it was modified.
         /*if (not ptr->validate_checksum())
         {
            bool source_still_valid = foo->validate_checksum();
            // if it was invalid it means a modification in place was made without a lock
            // it could also mean memory corruption in the application and this error
            // should be raised to the user todo: how to report errors from the
            // background process
            std::cerr << foo->id() << ": mv checksum invalid: '" << moved_foo->checksum
                      << "' src check: " << foo->checksum << " src valid:" << source_still_valid
                      << "\n";
            _header->seg_meta[start_seg_num].free_object(foo->object_capacity());
         }
         */

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
      }  // segment object iteration loop

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
      //madvise(s, segment_size, MADV_DONTNEED);

      // only one thread can move the end_ptr or this will break
      // std::cerr<<"done freeing end_ptr: " << _header->end_ptr.load() <<" <== " << seg_num <<"\n";
   
      assert( seg_num != segment_number(-1) );
      _header->free_seg_buffer[_header->end_ptr.load(std::memory_order_relaxed) &
                               (max_segment_count - 1)] = seg_num;
      auto prev = _header->end_ptr.fetch_add(1, std::memory_order_release);
      set_session_end_ptrs(prev);

      
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
    *
    * Min automatically advances every time compactor pushes a new segment
    * to the end, but sometimes the compactor did its work while a read
    * lock was in place and once the read lock was released the min could
    * be updated.
    */
   uint64_t seg_allocator::get_min_read_ptr()
   {
      auto ap  = _header->alloc_ptr.load(std::memory_order_relaxed);
      auto ep  = _header->end_ptr.load(std::memory_order_acquire);
      auto min = _min_read_ptr.load(std::memory_order_relaxed);

      if (ap >= min and ep > min)  // then check to see if there is more
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
               if( uint32_t p = _session_lock_ptrs[i].load( std::memory_order_relaxed ); p < min )
                  min = p;

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

   void seg_allocator::set_session_end_ptrs( uint32_t e ) {
      auto fs      = ~_free_sessions.load();
      auto num_ses = std::popcount(fs);
      uint32_t min = -1;
      for (uint32_t i = 0; fs and i < max_session_count; ++i)
      {
         if (fs & (1ull << i))
         {
            uint64_t p = _session_lock_ptrs[i].load( std::memory_order_relaxed );

            if( uint32_t(p) < min ) 
               min = uint32_t(p);

            p &= ~uint64_t(uint32_t(-1)); // clear the lower bits, to get accurate diff
            auto delta = (uint64_t(e)<<32) - p;
            assert( (delta << 32) == 0 );
            auto ep = _session_lock_ptrs[i].fetch_add(delta, std::memory_order_release );
         }
      }
      if( e > (1<<20) ) {
         TRIEDENT_WARN( "TODO: looks like ALLOC P and END P need to be renormalized, they have wrapped the buffer too many times." );
      }
      
      if (min > e) // only possible 
         min = e;
      _min_read_ptr.store(min, std::memory_order_relaxed);
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

     // TRIEDENT_DEBUG( " get new seg session min ptr: ", min );
     // TRIEDENT_WARN( "end ptr: ", _header->end_ptr.load(), " _header: ", _header );
      auto prepare_segment = [&](segment_number sn)
      {
         auto sp = _block_alloc.get(sn);
     //    madvise(sp, segment_size, MADV_FREE);  // zero's pages if they happen to be accessed
         madvise(sp, segment_size, MADV_RANDOM);

         // TODO: only do this if not already mlock
         auto r = mlock(sp, segment_size);

         if (r)
            std::cerr << "MLOCK RETURNED: " << r << "  EINVAL:" << EINVAL << "  EAGAIN:" << EAGAIN << "\n";

         // for debug we clear the memory
         assert( memset(sp, 0xff, segment_size) );  // TODO: is this necessary?

         auto shp  = new (sp) mapped_memory::segment_header();
         shp->_age = _header->next_alloc_age.fetch_add(1, std::memory_order_relaxed);
         return std::pair<segment_number, mapped_memory::segment_header*>(sn, shp);
      };
     //  std::cout <<"get new seg ap: " << ap << "  min: " << min <<"  min-ap:" << min - ap << "\n";

      auto min = get_min_read_ptr();
      auto ap  = _header->alloc_ptr.load(std::memory_order_relaxed);
      while (min - ap > 1)
      {
      //   TRIEDENT_WARN( "REUSE SEGMENTS" );
         if (_header->alloc_ptr.compare_exchange_weak(ap, ap + 1))
         {
      //      TRIEDENT_DEBUG( "ap += 1: ", ap + 1 );
      //   TRIEDENT_DEBUG( "     end_ptr: ", _header->end_ptr.load() );

            auto apidx                          = ap & (max_segment_count - 1);
            uint64_t free_seg                   = _header->free_seg_buffer[apidx];
            if( free_seg == segment_number(-1) )[[unlikely]] {
               TRIEDENT_WARN( "something bad happend!" );
               abort();
            }

            _header->free_seg_buffer[apidx] = segment_number(-1);

            if( free_seg == segment_number(-1) )[[unlikely]] {
               TRIEDENT_WARN( "something bad happend!" );
               abort();
            }
       //  TRIEDENT_DEBUG( "prepare segment: ", free_seg, "     end_ptr: ", _header->end_ptr.load() );
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
         if (auto p = _session_lock_ptrs[i].load(); uint32_t(p) != uint32_t(-1))
            std::cerr << "R" << i << ": " << uint32_t(p) << "\n";
      }

      std::cerr << "E - end idx: " << _header->end_ptr.load() << "\n";

      auto fs      = ~_free_sessions.load();
      auto num_ses = std::popcount(fs);
      std::cerr << "active sessions: " << num_ses << "\n";
      for (uint32_t i = 0; i < max_session_count; ++i)
      {
         if (fs & (1ull << i))
         {
            if (auto p = _session_lock_ptrs[i].load(); uint32_t(p) == uint32_t(-1))
               std::cerr << "R" << i << ": UNLOCKED \n";
         }
      }

      std::cerr << "------- pending free segments -----------\n";
      for (auto x = _header->alloc_ptr.load(); x < _header->end_ptr.load(); ++x)
      {
         std::cerr << x << "] " << _header->free_seg_buffer[x & (max_segment_count - 1)] << "\n";
      }
      std::cerr << "--------------------------\n";
      std::cerr << "free release +/- = " << _id_alloc.free_release_count() <<" \n";
   }
};  // namespace arbtrie
