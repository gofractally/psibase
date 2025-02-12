#include <arbtrie/binary_node.hpp>
#include <arbtrie/file_fwd.hpp>
#include <arbtrie/seg_allocator.hpp>
#include <bit>
#include <cassert>
#include <new>

static const uint64_t page_size      = getpagesize();
static const uint64_t page_size_mask = ~(page_size - 1);

namespace arbtrie
{
   seg_allocator::seg_allocator(std::filesystem::path dir)
       : _id_alloc(dir / "ids"),
         _block_alloc(dir / "segs", segment_size, max_segment_count),
         _header_file(dir / "header", access_mode::read_write, true),
         _seg_sync_locks(max_segment_count),
         _dirty_segs(max_segment_count)
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

      for (auto& i : _mlocked)
         i.store(-1, std::memory_order_relaxed);
      ;
   }

   seg_allocator::~seg_allocator()
   {
      stop_compact_thread();
      _compactor_session.reset();
   }
   uint32_t seg_allocator::alloc_session_num()
   {
      auto fs_bits = _free_sessions.load(std::memory_order_relaxed);
      if (fs_bits == 0)
         throw std::runtime_error("max of 64 sessions can be in use");

      auto fs          = std::countr_zero(fs_bits);
      auto new_fs_bits = fs_bits & ~(1 << fs);

      while (not _free_sessions.compare_exchange_strong(fs_bits, new_fs_bits))
      {
         if (fs_bits == 0)
            throw std::runtime_error("max of 64 sessions can be in use");

         fs          = std::countr_zero(fs_bits);
         new_fs_bits = fs_bits & ~(1 << fs);
      }
      if (not _session_seg_read_stats[fs])
         _session_seg_read_stats[fs].reset(new segment_read_stat);
      if (not _rcache_queues[fs])
         _rcache_queues[fs].reset(new circular_buffer<1024 * 1024>());
      //    std::cerr << "   alloc session bits: " << fs << " " <<std::bitset<64>(new_fs_bits) << "\n";
      //    std::cerr << "   new fs bits: " << std::bitset<64>(new_fs_bits) << "\n";
      //    _free_sessions.store(new_fs_bits);
      return fs;
   }

   void seg_allocator::release_session_num(uint32_t sn)
   {
      _free_sessions.fetch_or(uint64_t(1) << sn);
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

         // Start read bit clearer thread
         _read_bit_clearer = std::thread(
             [this]()
             {
                thread_name("read_bit_clearer");
                set_current_thread_name("read_bit_clearer");
                clear_read_bits_loop();
             });
      }
   }
   void seg_allocator::stop_compact_thread()
   {
      _done.store(true);
      if (_compact_thread.joinable())
         _compact_thread.join();
      if (_read_bit_clearer.joinable())
         _read_bit_clearer.join();
   }

   void seg_allocator::clear_read_bits_loop()
   {
      using namespace std::chrono;
      using namespace std::chrono_literals;

      uint16_t current_region = 0;

      while (!_done)
      {
         // Calculate target regions per iteration to finish in time
         const auto target_regions_per_iteration = std::max<uint32_t>(
             1u, id_alloc::max_regions /
                     (_cache_frequency_window.count() / 100));  // Based on 100ms sleep

         // Process regions
         _id_alloc.clear_some_read_bits(current_region, target_regions_per_iteration);

         // Update current_region for next iteration, wrapping around because uint16_t
         current_region += target_regions_per_iteration;

         // Sleep for a fixed interval
         std::this_thread::sleep_for(100ms);
      }
   }

   void seg_allocator::aggregate_read_stats()
   {
      auto& srs        = _session_seg_read_stats;
      auto& msrs       = srs[_compactor_session->_session_num];
      auto  num_blocks = _block_alloc.num_blocks();

      // TODO: we know the "max session number" so
      // there is no need to iterate over all 64
      // TODO: if we can prove that the compactor session
      // is always session 0, then we can skip the
      // check for ses.
      //
      // These optimizations should only help
      // compactor CPU usage and are likely hardly
      // measurable.
      for (auto& ptr : srs)
      {
         if (&ptr != &msrs and bool(ptr))
            msrs->accumulate(*ptr, num_blocks);
      }
   }

   void seg_allocator::select_segments()
   {
      auto num_segs = _block_alloc.num_blocks();
      /*
      auto& rstats  = _compactor_session->get_read_stats();

      for( uint32_t seg = 0; seg < num_segs; ++seg ) {
         // don't include segments that are in active allocation
         // ... how do I know that without looking at header?
         auto& sm = _header->seg_meta[seg];

         auto free_data                  = sm.get_free_space_and_objs();
         size_weighted_age& unread_data  = sm._base_time;
         size_weighted_age& read_data    = rstats.get_age_weight(seg);

         if( fs.
         if( fs.first > compact_free_space_threshold )
            // schedule..
      }
      */
   }
   void seg_allocator::sort_selected_segments() {}

   /**
    *  1. aggregate read stats from per-thread counters
    */
   void seg_allocator::compact_loop2()
   {
      if (not _compactor_session)
         _compactor_session.emplace(start_session());

      while (not _done.load())
      {
         aggregate_read_stats();
         // read frequency 2x unread frequency or 50% freed data
         select_segments();
         // segments are sorted by frequency with each segment appearing
         // twice.. once for its read frequency and once for its unread frequency
         sort_selected_segments();

         // process them in order moving the data to a new segment in the
         // order of most frequently accessed to least. The frequency of the
         // "read items" is the difference between the base time and the read time.

         // do not move unread data from a segment unless it
         // comprises less than 50% of a segment size and it is a space
         // recovery justification.
      }
      _compactor_session.reset();
   }
   void seg_allocator::compact_loop()
   {
      TRIEDENT_WARN("compact_loop");
      using namespace std::chrono_literals;
      if (not _compactor_session)
         _compactor_session.emplace(start_session());

      TRIEDENT_WARN("compact_loop start: ", _done.load());
      while (not _done.load())
      {
         if (not compact_next_segment())
         {
            /// don't let the alloc threads starve for want of a free segment
            /// if the free segment queue is getting low, top it up... but
            /// don't top it up just because read threads have things blocked
            /// because they could "block" for a long time...

            auto min = get_min_read_ptr();
            auto ap  = _header->alloc_ptr.load(std::memory_order_relaxed);
            auto ep  = _header->end_ptr.load(std::memory_order_relaxed);
            if (min - ap <= 1 and (ep - ap) < 3)
            {
               auto seg = get_new_segment();
               munlock(seg.second, segment_size);
               madvise(seg.second, segment_size, MADV_RANDOM);
               seg.second->_alloc_pos.store(0, std::memory_order_relaxed);
               seg.second->_age = -1;

               _header->seg_meta[seg.first].clear();
               _header->free_seg_buffer[_header->end_ptr.load(std::memory_order_relaxed) &
                                        (max_segment_count - 1)] = seg.first;
               auto prev = _header->end_ptr.fetch_add(1, std::memory_order_release);
               set_session_end_ptrs(prev);
            }
            /*
            std::cerr << "sleeping because most seg: " << most_empty_seg_num
                      << " empty: " << most_empty_seg_free << " "
                      << 100 * most_empty_seg_free / double(segment_size) << "\n";
                      */
            using namespace std::chrono_literals;
            std::this_thread::sleep_for(100ms);
         }
         promote_rcache_data();
      }
      TRIEDENT_WARN("compact_loop end: ", _done.load());
      TRIEDENT_WARN("compact_loop done");
      _compactor_session.reset();
   }

   void seg_allocator::promote_rcache_data()
   {
      uint32_t read_ids[1024];
      for (auto& rcache : _rcache_queues)
      {
         if (not rcache)
            break;
         auto state      = _compactor_session->lock();
         auto num_loaded = rcache->pop(read_ids, 1024);

         //if (num_loaded > 0)
         //   std::cerr << "num_loaded: " << num_loaded << "\n";
         for (uint32_t i = 0; i < num_loaded; ++i)
         {
            auto addr    = fast_meta_address::from_int(read_ids[i]);
            auto obj_ref = state.get(addr);
            if (auto [header, loc] = obj_ref.try_move_header(); header)
            {
               auto [new_loc, new_header] = _compactor_session->alloc_data(header->size(), addr);
               memcpy(new_header, header, header->size());

               if constexpr (update_checksum_on_compact)
               {
                  if (not new_header->has_checksum())
                     new_header->update_checksum();
               }

               if (node_meta_type::success == obj_ref.try_move(loc, new_loc))
               {
                  _total_promoted_bytes += header->size();
                  // TRIEDENT_WARN("moved header, total promoted: ", _total_promoted_bytes);
               }
               else
               {
                  //     TRIEDENT_DEBUG("failed to move header");
               }
            }
            else
            {
               //    TRIEDENT_WARN("failed to try_move_header");
            }
            obj_ref.meta().end_pending_cache();
         }
      }
   }

   bool seg_allocator::compact_next_segment()
   {
      if (not _compactor_session)
         _compactor_session.emplace(start_session());

      uint64_t most_empty_seg_num  = -1ll;
      uint64_t most_empty_seg_free = 0;
      auto     total_segs          = _block_alloc.num_blocks();
      auto     oldest              = -1ul;
      for (uint32_t s = 0; s < total_segs; ++s)
      {
         auto fso = _header->seg_meta[s].get_free_space_and_objs();
         if (fso.free_space > most_empty_seg_free)
            if (fso.free_space > segment_size / 8)  // most_empty_seg_free)
            {
               auto seg = get_segment(s);
               // only consider segs that are not actively allocing
               // or that haven't already been processed
               if (seg->_alloc_pos.load(std::memory_order_relaxed) == uint32_t(-1))
               {
                  //      if (seg->_age <= oldest)
                  {
                     most_empty_seg_num  = s;
                     most_empty_seg_free = fso.free_space;
                     oldest              = seg->_age;
                  }
               }
            }
      }

      // segments must be at least 25% empty before compaction is considered
      if (most_empty_seg_num == -1ull or most_empty_seg_free < segment_empty_threshold)
      {
         return false;
      }

      compact_segment(*_compactor_session, most_empty_seg_num);
      return true;
   }

   void seg_allocator::compact_segment(session& ses, uint64_t seg_num)
   {
      auto state = ses.lock();
      auto s     = get_segment(seg_num);
      //  if( not s->_write_lock.try_lock() ) {
      //     TRIEDENT_WARN( "unable to get write lock while compacting!" );
      //     abort();
      //  }
      auto*        shead = (mapped_memory::segment_header*)s;
      auto         send  = (node_header*)((char*)s + segment_size);
      char*        foc   = (char*)s + round_up_multiple<64>(sizeof(mapped_memory::segment_header));
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

      auto start_seg_ptr = ses._alloc_seg_ptr;
      auto start_seg_num = ses._alloc_seg_num;

      std::vector<std::pair<node_header*, temp_meta_type>> skipped;
      std::vector<node_header*>                            skipped_ref;
      std::vector<node_header*>                            skipped_try_start;

      auto& smeta    = _header->seg_meta[seg_num];
      auto  src_time = smeta._base_time.time_ms;

      madvise(s, segment_size, MADV_SEQUENTIAL);
      while (foo < send and foo->address())
      {
         assert(intptr_t(foo) % 64 == 0);

         if constexpr (update_checksum_on_modify)
            assert(foo->validate_checksum());

         auto foo_address = foo->address();
         // skip anything that has been freed
         // note the ref can go to 0 before foo->check is set to -1
         auto obj_ref = state.get(foo_address);
         if (obj_ref.ref() == 0)
         {
            if constexpr (debug_memory)
               skipped_ref.push_back(foo);
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
            if constexpr (debug_memory)
               skipped.push_back({foo, obj_ref.meta_data()});
            foo = foo->next();
            continue;
         }

         auto obj_size   = foo->size();
         auto [loc, ptr] = ses.alloc_data(obj_size, foo_address, src_time);

         if (obj_ref.try_start_move(obj_ref.loc())) [[likely]]
         {
            if (obj_ref.type() == node_type::binary)
            {
               copy_binary_node((binary_node*)ptr, (const binary_node*)foo);
            }
            else
            {
               memcpy(ptr, foo, obj_size);
            }
            if constexpr (update_checksum_on_compact)
            {
               if (not ptr->has_checksum())
                  ptr->update_checksum();
            }
            if constexpr (validate_checksum_on_compact)
            {
               if constexpr (update_checksum_on_modify)
               {
                  if (not ptr->has_checksum())
                     TRIEDENT_WARN("missing checksum detected: ", foo_address,
                                   " type: ", node_type_names[ptr->_ntype]);
               }
               if (not ptr->validate_checksum())
               {
                  TRIEDENT_WARN("invalid checksum detected: ", foo_address,
                                " checksum: ", foo->checksum, " != ", foo->calculate_checksum(),
                                " type: ", node_type_names[ptr->_ntype]);
               }
            }
            if (node_meta_type::success != obj_ref.try_move(obj_ref.loc(), loc))
               ses.unalloc(obj_size);
         }
         else
         {
            if constexpr (debug_memory)
               skipped_try_start.push_back(foo);
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
            sync_segment(start_seg_num, sync_type::sync);
            start_seg_ptr = ses._alloc_seg_ptr;
            start_seg_num = ses._alloc_seg_num;
         }
         foo = foo->next();
      }  // segment object iteration loop

      if constexpr (debug_memory)
      {
         if ((char*)send - (char*)foo > 4096)
         {
            TRIEDENT_WARN("existing compact loop earlier than expected: ",
                          (char*)send - (char*)foo);
         }

         foo = (node_header*)(foc);
         while (foo < send and foo->address())
         {
            auto obj_ref     = state.get(foo->address());
            auto foo_idx     = (char*)foo - (char*)s;
            auto current_loc = obj_ref.loc();
            if (current_loc.to_abs() == seg_num * segment_size + foo_idx)
            {
               for (auto s : skipped)
               {
                  if (s.first == foo)
                  {
                     TRIEDENT_WARN("obj_ref: ", obj_ref.ref());
                     TRIEDENT_WARN("obj_type: ", node_type_names[obj_ref.type()]);
                     TRIEDENT_WARN("obj_loc: ", current_loc.abs_index(),
                                   " seg: ", current_loc.segment());
                     TRIEDENT_WARN("ptr: ", (void*)foo);
                     TRIEDENT_WARN("pos in segment: ", segment_size - ((char*)send - (char*)foo));

                     TRIEDENT_WARN("SKIPPED BECAUSE POS DIDN'T MATCH");
                     TRIEDENT_DEBUG("  old meta: ", s.second.to_int());
                     TRIEDENT_DEBUG("  null_node: ", null_node.abs_index(),
                                    " seg: ", null_node.segment());
                     TRIEDENT_DEBUG("  old loc: ", s.second.loc().abs_index(),
                                    " seg: ", s.second.loc().segment());
                     TRIEDENT_DEBUG("  old ref: ", s.second.ref());
                     TRIEDENT_DEBUG("  old type: ", node_type_names[s.second.type()]);
                     TRIEDENT_DEBUG("  old is_con: ", s.second.is_const());
                     TRIEDENT_DEBUG("  old is_ch: ", s.second.is_copying());
                     assert(current_loc.to_abs() != seg_num * segment_size + foo_idx);
                  }
               }
               for (auto s : skipped_ref)
               {
                  if (s == foo)
                  {
                     TRIEDENT_WARN("SKIPPED BECAUSE REF 0");
                  }
               }
               for (auto s : skipped_try_start)
               {
                  if (s == foo)
                  {
                     TRIEDENT_WARN("SKIPPED BECAUSE TRY START");
                  }
               }
            }
            foo = foo->next();
         }
      }

      // in order to maintain the invariant that the segment we just cleared
      // can be reused, we must make sure that the data we moved out has persisted to
      // disk.
      if (start_seg_ptr)
      {
         // TODO: don't hardcode MS_SYNC here, this will cause unnessary SSD wear on
         //       systems that opt not to flush
         //
         //       In theory, this should only be done with segments that were
         //       previously msync.
         if (-1 == msync(start_seg_ptr, start_seg_ptr->_alloc_pos, MS_SYNC))
         {
            std::cerr << "msync errorno: " << strerror(errno) << "\n";
         }
         /**
          * before any sync can occur we must grab the sync lock which will
          * block until all modifications on the segment have completed and
          * then prevent new modifications until after sync is complete.
          *
          * There is no need for a global sync lock if each segment has its
          * own sync lock!
          */
         _header->seg_meta[seg_num].set_last_sync_pos(start_seg_ptr->get_alloc_pos());
      }

      //   s->_write_lock.unlock();
      //   s->_num_objects = 0;
      s->_alloc_pos.store(0, std::memory_order_relaxed);
      s->_age = -1;
      // the segment we just cleared, so its free space and objects get reset to 0
      // and its last_sync pos gets put to the end because there is no need to sync it
      // because its data has already been synced by the compactor
      _header->seg_meta[seg_num].clear();

      // TODO: if I store the index in _mlocked then I don't have to search for it
      for (auto& ml : _mlocked)
         if (ml.load(std::memory_order_relaxed) == seg_num)
         {
            ml.store(-1, std::memory_order_relaxed);
            break;
         }

      munlock(s, segment_size);
      // it is unlikely to be accessed, and if it is don't pre-fetch
      madvise(s, segment_size, MADV_RANDOM);
      //madvise(s, segment_size, MADV_DONTNEED);

      // only one thread can move the end_ptr or this will break
      // std::cerr<<"done freeing end_ptr: " << _header->end_ptr.load() <<" <== " << seg_num <<"\n";

      assert(seg_num != segment_number(-1));
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
      auto min = _min_read_ptr.load(std::memory_order_acquire);

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
               if (uint32_t p = _session_lock_ptrs[i].load(std::memory_order_acquire); p < min)
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

   void seg_allocator::set_session_end_ptrs(uint32_t e)
   {
      auto     fs      = ~_free_sessions.load();
      auto     num_ses = std::popcount(fs);
      uint32_t min     = -1;
      for (uint32_t i = 0; fs and i < max_session_count; ++i)
      {
         if (fs & (1ull << i))
         {
            uint64_t p = _session_lock_ptrs[i].load(std::memory_order_relaxed);

            if (uint32_t(p) < min)
               min = uint32_t(p);

            p &= ~uint64_t(uint32_t(-1));  // clear the lower bits, to get accurate diff
            auto delta = (uint64_t(e) << 32) - p;
            assert((delta << 32) == 0);
            auto ep = _session_lock_ptrs[i].fetch_add(delta, std::memory_order_release);
         }
      }
      if (e > (1 << 20))
      {
         TRIEDENT_WARN(
             "TODO: looks like ALLOC P and END P need to be renormalized, they have wrapped the "
             "buffer too many times.");
      }

      if (min > e)  // only possible
         min = e;
      _min_read_ptr.store(min, std::memory_order_release);
   }

   /**
    *  reads allocator_header::reuse_ptr and if it is less than
    *  allocator_header::min_read_ptr then attempts increment the
    *  reuse pointer by exactly 1, if so then it uses the segment
    *  at _free_segments[reuse_ptr.old] 
    *
    *  If reuse_ptr == min_read_ptr then advance the alloc_ptr by
    *  segment_size to claim a new segment.
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

         // TODO: only do this if not already mlock, to avoid sys call
         // - on many systems there must be a all to munlock for each call to mlock
         //   because mlock nests (see man); therefore, we should track this better
         auto r = mlock(sp, segment_size);

         if (r)
         {
            std::cerr << "MLOCK RETURNED: " << r << "  EINVAL:" << EINVAL << "  EAGAIN:" << EAGAIN
                      << "\n";
         }
         else
         {
            auto prev    = _total_mlocked.fetch_add(1, std::memory_order_relaxed);
            int  idx     = prev % _mlocked.size();
            auto cur_val = _mlocked[idx].load(std::memory_order_relaxed);
            if (cur_val != -1)
            {
               auto olock = _block_alloc.get(cur_val);
               munlock(olock, segment_size);
            }
            _mlocked[idx].store(sn, std::memory_order_relaxed);
         }

         // for debug we clear the memory
         // assert(memset(sp, 0xff, segment_size));  // TODO: is this necessary?

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

            auto     apidx    = ap & (max_segment_count - 1);
            uint64_t free_seg = _header->free_seg_buffer[apidx];
            if (free_seg == segment_number(-1)) [[unlikely]]
            {
               TRIEDENT_WARN("something bad happend!");
               abort();
            }

            _header->free_seg_buffer[apidx] = segment_number(-1);

            if (free_seg == segment_number(-1)) [[unlikely]]
            {
               TRIEDENT_WARN("something bad happend!");
               abort();
            }
            //  TRIEDENT_DEBUG( "prepare segment: ", free_seg, "     end_ptr: ", _header->end_ptr.load() );
            //       std::cerr << "reusing segment..." << free_seg <<"\n";
            auto sp = (mapped_memory::segment_header*)_block_alloc.get(free_seg);
            //  This lock is not needed, but just there to prove the read-lock system
            //  is working as intened. If re-enabled, it probably need to be moved to
            //  prepare segment because new segments don't end up locked... only reused ones
            //    if( not sp->_write_lock.try_lock() ) {
            //       TRIEDENT_WARN( "write lock on get_new_segment!" );
            //    }
            return prepare_segment(free_seg);
         }
      }
      return prepare_segment(_block_alloc.alloc());
   }

   void seg_allocator::sync_segment(int s, sync_type st) noexcept
   {
      auto seg = get_segment(s);
      // TODO BUG: when syncing we must sync to the end of a page,
      // but start the next sync from the beginning of the page
      // since we only store the last paged synced... we no longer
      // know if the alloc_pos was in the middle of that page and
      // therefore it may be dirty again. We may need to
      // subtract 1 page from the last sync pos (assuming it doesn't go neg)
      // and sync the page before.
      //
      // If we store last_sync_pos as the rounded down position, then
      // getting this will work!
      auto last_sync  = _header->seg_meta[s].get_last_sync_pos();
      auto last_alloc = seg->get_alloc_pos();

      if (last_alloc > segment_size)
         last_alloc = segment_size;

      if (last_alloc > last_sync)
      {
         auto sync_bytes   = last_alloc - (last_sync & page_size_mask);
         auto seg_sync_ptr = (((intptr_t)seg + last_sync) & page_size_mask);

         static uint64_t total_synced = 0;
         if (-1 == msync((char*)seg_sync_ptr, sync_bytes, msync_flag(st)))
         {
            std::cerr << "ps: " << getpagesize() << " len: " << sync_bytes << " rounded:  \n";
            std::cerr << "msync errno: " << std::string(strerror(errno))
                      << " seg_alloc::sync() seg: " << s << "\n";
         }
         else
         {
            total_synced += sync_bytes;
            //           TRIEDENT_DEBUG( "total synced: ", add_comma(total_synced), " flag: ", msync_flag(st), " MS_SYNC: ", MS_SYNC );
         }
         _header->seg_meta[s].set_last_sync_pos(last_alloc);
      }
   }
   void seg_allocator::sync(sync_type st)
   {
      if (st == sync_type::none)
         return;

      std::unique_lock lock(_sync_mutex);

      auto ndsi = get_last_dirty_seg_idx();
      while (_last_synced_index < ndsi)
      {
         auto lsi = _last_synced_index % max_segment_count;
         _seg_sync_locks[lsi].start_sync();
         sync_segment(_dirty_segs[ndsi % max_segment_count], st);
         _seg_sync_locks[lsi].end_sync();
         ++_last_synced_index;
      }
   }

   void seg_allocator::dump()
   {
      std::cerr << "\n--- segment allocator state ---\n";
      auto     total_segs       = _block_alloc.num_blocks();
      auto     total_retained   = 0;
      uint64_t total_free_space = 0;
      uint64_t total_read_bytes = 0;
      uint32_t total_read_nodes = 0;
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
      std::cerr << std::setw(12) << "is alloc"
                << " | ";
      std::cerr << std::setw(12) << "is pinned"
                << " | ";
      std::cerr << std::setw(8) << "age"
                << " | ";
      std::cerr << std::setw(12) << "read nodes"
                << " | ";
      std::cerr << std::setw(12) << "read bytes"
                << " \n";
      for (uint32_t i = 0; i < total_segs; ++i)
      {
         auto  seg                     = get_segment(i);
         auto& meta                    = _header->seg_meta[i];
         auto  space_objs              = meta.get_free_space_and_objs();
         auto [read_nodes, read_bytes] = calculate_segment_read_stats(i);
         total_read_nodes += read_nodes;
         total_read_bytes += read_bytes;

         std::cerr << std::setw(6) << i << " | ";
         std::cerr << std::setw(8) << int(100 * double(space_objs.free_space) / segment_size)
                   << " | ";
         total_free_space += space_objs.free_space;
         std::cerr << std::setw(12) << space_objs.free_space << " | ";
         std::cerr << std::setw(12) << space_objs.free_objects << " | ";
         std::cerr << std::setw(12)
                   << (seg->_alloc_pos == -1 ? "END" : std::to_string(seg->get_alloc_pos()))
                   << " | ";
         std::cerr << std::setw(12) << (space_objs.is_alloc ? "alloc" : "") << " | ";
         std::cerr << std::setw(12) << (space_objs.is_pinned ? "pin" : "") << " | ";
         std::cerr << std::setw(8) << seg->_age << " | ";
         std::cerr << std::setw(12) << read_nodes << " | ";
         std::cerr << std::setw(12) << read_bytes << " \n";
      }
      std::cerr << "total free: " << total_free_space / 1024 / 1024. << "Mb  "
                << (100 * total_free_space / double(total_segs * segment_size)) << "%\n";
      std::cerr << "total retained: " << total_retained << " objects\n";
      std::cerr << "total read nodes: " << total_read_nodes << "\n";
      std::cerr << "total read bytes: " << total_read_bytes / 1024 / 1024. << "Mb  "
                << (100 * total_read_bytes / double(total_segs * segment_size)) << "%\n";

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
      std::cerr << "free release +/- = " << _id_alloc.free_release_count() << " \n";
   }

   std::pair<uint32_t, uint64_t> seg_allocator::calculate_segment_read_stats(segment_number seg_num)
   {
      uint32_t nodes_with_read_bit = 0;
      uint64_t total_bytes         = 0;

      auto        seg  = get_segment(seg_num);
      auto        send = (node_header*)((char*)seg + segment_size);
      const char* foc =
          (const char*)seg + round_up_multiple<64>(sizeof(mapped_memory::segment_header));
      node_header* foo = (node_header*)(foc);

      while (foo < send && foo->address())
      {
         // Get the object reference for this node
         auto  foo_address = foo->address();
         auto& obj_ref     = _id_alloc.get(foo_address);

         // Check if the read bit is set and if the location matches
         if (obj_ref.is_read())
         {
            auto foo_idx     = (char*)foo - (char*)seg;
            auto current_loc = obj_ref.loc();

            // Only count if the object reference is pointing to this exact node
            if (current_loc.to_abs() == seg_num * segment_size + foo_idx)
            {
               nodes_with_read_bit++;
               total_bytes += foo->size();
            }
         }

         foo = foo->next();
      }

      return {nodes_with_read_bit, total_bytes};
   }

};  // namespace arbtrie
