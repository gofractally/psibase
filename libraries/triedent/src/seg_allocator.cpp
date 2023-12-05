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

      _compact_thread = std::thread(
          [this]()
          {
             thread_name("compactor");
             set_current_thread_name("compactor");
             compact_loop();
          });
      for (auto& sptr : _session_ptrs)
         sptr.store(-1ull);
      _done.store(false);
   }

   seg_allocator::~seg_allocator()
   {
      _done.store(true);
      if (_compact_thread.joinable())
         _compact_thread.join();
   }

   template <typename T>
   using object_ref = seg_allocator::session::read_lock::object_ref<T>;

   object_ref<char> seg_allocator::session::read_lock::alloc(uint32_t size, node_type type)
   {
      auto [loc, ptr] = _session.alloc_data(size + sizeof(object_header));

      // TODO: hopefully this isn't needed
      // memset(ptr, 0, size + sizeof(object_header));

      auto oh = ((object_header*)ptr);

      auto [atom, id] = _session._id_alloc.get_new_id();
      oh->id          = id.id;
      oh->size        = size;

      object_info info(atom.load(std::memory_order_relaxed));
      info.set_location(loc);
      info.set_type(type);
      atom.store(info.to_int(), std::memory_order_release);

      return object_ref(*this, id, atom, oh);
   }

   object_ref<char> seg_allocator::session::read_lock::get(object_header* oh)
   {
      object_id oid(oh->id);
      return object_ref(*this, oid, _session._sega._id_alloc.get(oid), nullptr);
   }

   object_header* seg_allocator::session::read_lock::get_object_pointer(object_location loc)
   {
      auto segment = (mapped_memory::segment_header*)_session._sega._block_alloc.get( loc.segment() );
      // 0 means we are accessing a swapped object on a segment that hasn't started new allocs
      // if alloc_pos > loc.index() then we haven't overwriten this object yet, we are accessing
      // data behind the alloc pointer which should be safe
      // to access data we had to get the location from obj id database and we should read
      // with memory_order_acquire, when updating an object_info we need to write with 
      // memory_order_release otherwise the data written may not be visible yet to the reader coming
      // along behind 
      assert( segment->_alloc_pos == 0 or segment->_alloc_pos > loc.index() );
      return (object_header*)((char*)_session._sega._block_alloc.get(loc.segment()) + loc.index());
   }

   /**
    * This must be called via a session because the session is responsible
    * for documenting what regions could be read
    *
    * All objects are const because they cannot be modified after being
    * written.
    */
   const object_header* seg_allocator::get_object(object_location loc) const
   {
      return nullptr;
   }
   const object_header* seg_allocator::get_object(object_id oid) const
   {
      return nullptr;
   }

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
      auto cses = start_session();

      std::cerr << "compact loop starting\n";
      while (not _done.load())
      {
         uint64_t most_empty_seg_num  = -1ll;
         uint64_t most_empty_seg_free = 0;
         auto     total_segs          = _block_alloc.num_blocks();
         for (uint32_t s = 0; s < total_segs; ++s)
         {
            auto fso = _header->seg_meta[s].get_free_space_and_objs();
            if (fso.first > most_empty_seg_free)
            {
               // only consider segs that are not actively allocing
               // or that haven't already been processed
               if ( get_segment(s)->_alloc_pos == uint32_t(-1))
               {
                  most_empty_seg_num  = s;
                  most_empty_seg_free = fso.first;
               }
            }
         }

         // segments must be at least 25% empty before compaction is considered
         if (most_empty_seg_num == -1ull or most_empty_seg_free < segment_size / 8)
         {
            using namespace std::chrono_literals;
            std::this_thread::sleep_for(2ms);
            continue;
         }

         compact_segment(cses, most_empty_seg_num);

         // find most empty segment
         // move it to my own personal write session
         // add it to the free segment queue
      }
      std::cerr << "compact loop ending\n";
   }

   void seg_allocator::compact_segment(session& ses, uint64_t seg_num)
   {
  //    std::cerr << "compacting segment: " << seg_num << " into " << ses._alloc_seg_num <<"\n";
      auto           state = ses.lock();
      auto           s     = get_segment(seg_num);
      auto           send  = (object_header*)((char*)s + segment_size);
      char*          foc   = (char*)s + 16;
      object_header* foo   = (object_header*)(foc);

      assert( s->_alloc_pos == segment_offset(-1) );
   //   std::cerr << "seg " << seg_num <<" alloc pos: " << s->_alloc_pos <<"\n";

      auto seg_state = seg_num * segment_size;
      auto seg_end   = (seg_num+1) * segment_size;

      madvise(s, segment_size, MADV_SEQUENTIAL);
      while (foo < send and foo->id)
      {
         auto obj_ref = state.get({foo->id},false);

         auto foo_idx = (char*)foo - (char*)s;
         auto loc = obj_ref.location()._offset;
         if( (loc & (segment_size-1)) != foo_idx or obj_ref.ref_count() == 0) {
            foo = foo->next();
            continue;
         }

         // optimistically we should move it, but first we must try to
         // lock the ID to prevent anyone else from moving it while we
         // move it.

         auto             lk = obj_ref.create_lock();
         std::unique_lock ul(lk);//, std::try_to_lock);
         if (ul.owns_lock())
         {
            obj_ref.refresh();

            {
               auto foo_idx = (char*)foo - (char*)s;
               auto loc = obj_ref.location()._offset;
               if( (loc & (segment_size-1)) != foo_idx or obj_ref.ref_count() == 0) {
                  foo = foo->next();
                  continue;
               }
            }

            auto obj_size   = foo->object_size();
            auto [loc, ptr] = ses.alloc_data(obj_size);
            memcpy(ptr, foo, obj_size);
            obj_ref.move(loc, ul);
         }
         auto check = state.get({foo->id},false);
         assert(foo->id == check.id().id);
         assert(check.obj()->id == foo->id );
         assert(check.obj()->data_capacity() == foo->data_capacity() );

         foo = foo->next();
      }

      s->_num_objects = 0;
      s->_alloc_pos   = 0;
      _header->seg_meta[seg_num].clear();

      munlock(s, segment_size);
      // it is unlikely to be accessed, and if it is don't pre-fetch
      madvise(s, segment_size, MADV_RANDOM);

      // only one thread can move the end_ptr or this will break
     // std::cerr<<"done freeing end_ptr: " << _header->end_ptr.load() <<" <== " << seg_num <<"\n";
      _header->free_seg_buffer[_header->end_ptr.load()] =  seg_num;
      _header->end_ptr.fetch_add(1, std::memory_order_release );
   //   _header->free_seg_buffer[_header->end_ptr.fetch_add(1)] = seg_num;
   //   _header->free_seg_buffer[_header->end_ptr.fetch_add(1)] = seg_num;
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

         auto shp = new (sp) mapped_memory::segment_header();
         assert( shp->_alloc_pos == 16 );

         return std::pair<segment_number, mapped_memory::segment_header*>(sn, shp);
      };
    //  std::cout <<"get new seg ap: " << ap << "  min: " << min <<"  min-ap:" << min - ap << "\n";

      while ( min - ap >= 1 )
      {
         if (_header->alloc_ptr.compare_exchange_weak(ap, ap + 1))
         {
            auto free_seg = _header->free_seg_buffer[ap];
            _header->free_seg_buffer[ap] = segment_number(-1);
     //       std::cerr << "reusing segment..." << free_seg <<"\n";
            return prepare_segment( free_seg );
         }
      }
      return prepare_segment(_block_alloc.alloc());
   }

   void seg_allocator::dump()
   {
      std::cerr << "\n--- segment allocator state ---\n";
      auto total_segs = _block_alloc.num_blocks();
      std::cerr << "total segments: " << total_segs << "\n";
      std::cerr << std::setw(6) << "#"
                << " | ";
      std::cerr << std::setw(12) << "freed bytes"
                << " | ";
      std::cerr << std::setw(12) << "freed obj"
                << " | ";
      std::cerr << std::setw(12) << "alloc pos"
                << " | ";
      std::cerr << std::setw(12) << "alloced obj"
                << " \n";
      for (uint32_t i = 0; i < total_segs; ++i)
      {
         auto seg        = get_segment(i);
         auto space_objs = _header->seg_meta[i].get_free_space_and_objs();

         std::cerr << std::setw(6) << i << " | ";
         std::cerr << std::setw(12) << space_objs.first << " | ";
         std::cerr << std::setw(12) << space_objs.second << " | ";
         std::cerr << std::setw(12)
                   << (seg->_alloc_pos == -1 ? "END" : std::to_string(seg->_alloc_pos)) << " | ";
         std::cerr << std::setw(12) << seg->_num_objects << " \n";
      }

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
