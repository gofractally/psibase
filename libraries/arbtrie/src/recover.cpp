#include <arbtrie/database.hpp>

namespace arbtrie
{
   /**
 *
 *
 */

   bool database::validate()
   {
      // make sure all nodes are reachable
      // make sure no stuck modify bits
      return false;
   }

   void recusive_retain_all(object_ref<node_header>&& r)
   {
      r.retain();
      auto retain_id = [&](fast_meta_address b) { recusive_retain_all(r.rlock().get(b)); };
      cast_and_call(r.type(), r.header(), [&](const auto* ptr) { ptr->visit_branches(retain_id); });
   }

   /**
 *  Data is stored in "segments" and each segment has a
 *  data range that has been synced, once synced it is imutable.
 *  
 *  As new segments are allocated they are assigned an age, the 
 *  higher the age the more resent the writes. 
 *
 *  A node may appear on multiple segments of different ages,
 *  but only the one on the highest age is valid. Each node
 *  has the address/object id associated with it which can
 *  be used to re-establish the meta_node.
 *
 *  Start with the newest segment and work to the oldest segment,
 *  as you come across objects, set their location in the node meta
 *  database and increment their reference count to 1. If a location
 *  has already been set then skip it because there is clearly a
 *  newer value already set, be sure to update the "free space" stats.
 *
 *  Starting with the top root, recursively retain all nodes. At this
 *  point all reachable nodes have a ref count of 2+. Scan through the
 *  node_meta and decrement reference count of all nodes while putting
 *  any node_meta with refcount of 0 or 1 into the free list.
 *
 *  Recovery Modes:
 *    1. OS / Hardware Recovery - 
 *         - Assumes Last user was using sync mode
 *         - rebuild node_meta from segments
 *         - optional checksum validation
 *    2. App Crash Recovery 
 *         - Last user was using OS sync
 *         - assumes the OS/Hardware didn't fail
 *         - only resets reference counts to what is reachable
 *         - recovers leaked memory
 *    3. User was updating the top-root in place and therefore
 *        the tree is potentially corrupt and partially written
 *         (bad,bad user....)
 *         - similar to App Crash Recovery... except..
 *         - scan for modify bits that are set
 *         - check integrity of relevant nodes
 *         - produce report and/or sandbox subtree 
 */
   void database::recover(recover_args args)
   {
      TRIEDENT_WARN( "Recovering... reset meta nodes!" );
      // all recovered nodes have a ref of 1
      _sega.reset_meta_nodes(args);

      // all refs of reachable nodes now >= 2
      {
         auto s     = start_read_session();
         auto state = s._segas.lock();
         for( int i = 0; i < num_top_roots; ++i ) {
            auto r     = s.get_root(i);
            if( r.address() )
               recusive_retain_all(state.get(r.address()));
         }
      }

      // all refs that are > 0 go down by 1
      // if a ref was 1 it is added to free list
      _sega.release_unreachable();
   }
   void seg_allocator::reset_reference_counts() {
      _id_alloc.reset_all_refs();
   }

   void database::reset_reference_counts() {
      // set all refs > 1 to 1
      _sega.reset_reference_counts();

      // retain all reachable nodes, sending reachable refs to 2+
      {
         auto s     = start_read_session();
         auto state = s._segas.lock();
         for( int i = 0; i < num_top_roots; ++i ) {
            auto r     = s.get_root(i);
            if( r.address() )
               recusive_retain_all(state.get(r.address()));
         }
      }

      // all refs that are > 0 go down by 1
      // if a ref was 1 it is added to free list
      // free list gets reset
      _sega.release_unreachable();
   }

   void seg_allocator::reset_meta_nodes( recover_args args )
   {
      _id_alloc.clear_all();

      std::vector<int> age_index;
      age_index.resize(_block_alloc.num_blocks()); 
      for (int i = 0; i < age_index.size(); ++i)
         age_index[i] = i;

      std::sort(age_index.begin(), age_index.end(),
                [&](int a, int b) { return get_segment(a)->_age > get_segment(b)->_age; });
      int next_free_seg = 0;
      for (auto i : age_index)
      {
         if (get_segment(i)->_age < 0) {
            _header->free_seg_buffer[next_free_seg++] = i;
            continue;
         }
         auto seg  = get_segment(i);
         auto send = (node_header*)((char*)seg + segment_size);

         const char* foc = (const char*)seg + round_up_multiple<64>(sizeof(mapped_memory::segment_header));
         node_header* foo = (node_header*)(foc);

         madvise(seg, segment_size, MADV_SEQUENTIAL);
         int free_space = 0;
         while (foo < send and foo->address())
         {
            // TODO:
            //   validate foo < last sync position,
            //      data written beyond sync should be unreachable from top root
            //   validate size and type are reasonable
            //   optionally validate checksum (if set), store checksum if not
            //
            node_meta_type& met = _id_alloc.get_or_alloc(foo->address());
            auto            loc = met.loc();

            //  null or in the same segment it should be updated because
            //  objects in a segment are ordered from oldest to newest
            //  and we are iterating segments from newest to oldest
            if ((not loc.to_aligned()) or (loc.segment() == i))
            {
               if( loc.segment() == i ) 
                  free_space += ((const node_header*)((const char*)seg + loc.abs_index()))->_nsize;
               met.store(temp_meta_type()
                             .set_location(node_location::from_absolute(i * segment_size +
                                                                        ((char*)foo) - (char*)seg))
                             .set_ref(1)
                             .set_type(foo->get_type()),
                         std::memory_order_relaxed);
            } else {
               free_space += foo->_nsize;
            }

            foo = foo->next();
         }
         // TODO:
         //   make sure all segments indicate they are fully synced to the last foo position
         //   make sure _alloc_pos of each segment is in good working order
         //   make sure free space calculations are up to date for the segment
      }
      _header->alloc_ptr.store(0);
      _header->end_ptr.store(next_free_seg);
      _header->clean_exit_flag.store( false );
      _header->next_alloc_age.store( get_segment( age_index[0] )->_age + 1 );
   }

   void seg_allocator::release_unreachable()
   {
      _id_alloc.release_unreachable();
   }
   int64_t seg_allocator::clear_lock_bits()
   {
      return _id_alloc.clear_lock_bits();
   }
   int64_t id_alloc::clear_lock_bits() {
      int64_t count = 0;
      const auto num_block = _block_alloc.num_blocks();
      for (int block = 0; block < num_block; ++block)
         for (int region = 0; region < 0xffff; ++region)
            for (int index = block ? 0 : 8; index < ids_per_page; ++index)
            {
               fast_meta_address fma  = {region, ids_per_page * block + index};
               auto&             meta = get(fma);
               auto mval = meta.to_int();
               if( mval & (node_meta<>::copy_mask | node_meta<>::modify_mask) )
               {
                  count += bool(mval & node_meta<>::modify_mask);
                  meta.store( mval & ~(node_meta<>::copy_mask | node_meta<>::modify_mask), std::memory_order_relaxed );
               }
            }
      return count;
   }

   void id_alloc::clear_all()
   {
      const auto num_block = _block_alloc.num_blocks();
      for (int block = 0; block < num_block; ++block)
      {
         auto ptr = _block_alloc.get(block);
         memset(ptr, 0, id_block_size);
      }
      for (int region = 0; region < 0xffff; ++region)
      {
         _state->regions[region].use_count.store(0, std::memory_order_relaxed);
         _state->regions[region].next_alloc.store(0, std::memory_order_relaxed);
         _state->regions[region].first_free.store(
             temp_meta_type().set_location(end_of_freelist).to_int(), std::memory_order_relaxed);
         new (&_state->regions[region].alloc_mutex) std::mutex();
      }
   }

   // set all refs greater than 1 to 1
   void id_alloc::reset_all_refs() {
      const auto num_block = _block_alloc.num_blocks();
      for (int block = 0; block < num_block; ++block)
         for (int region = 0; region < 0xffff; ++region)
            for (int index = block ? 0 : 8; index < ids_per_page; ++index)
            {
               fast_meta_address fma  = {region, ids_per_page * block + index};
               auto&             meta = get(fma);
               if( meta.ref() > 0 )
                  meta.set_ref(1);
            }
   }
   uint64_t id_alloc::count_ids_with_refs() {
      uint64_t count = 0;
      const auto num_block = _block_alloc.num_blocks();
      for (int block = 0; block < num_block; ++block)
         for (int region = 0; region < 0xffff; ++region)
            for (int index = block ? 0 : 8; index < ids_per_page; ++index)
            {
               fast_meta_address fma  = {region, ids_per_page * block + index};
               auto&             meta = get(fma);
               count += meta.ref() > 0;
            }
      return count;
   }

   void id_alloc::release_unreachable()
   {
      const auto num_block = _block_alloc.num_blocks();
      for (int region = 0; region < 0xffff; ++region) {
         _state->regions[region].use_count.store(0, std::memory_order_relaxed);
         _state->regions[region].first_free.store(
             temp_meta_type().set_location(end_of_freelist).to_int(), std::memory_order_relaxed);
         _state->regions[region].next_alloc.store(num_block*ids_per_page, std::memory_order_relaxed);
      }
      for (int block = 0; block < num_block; ++block)
      {
         for (int region = 0; region < 0xffff; ++region)
         {
            _state->regions[region].use_count.fetch_add(ids_per_page);
            for (int index = block ? 0 : 8; index < ids_per_page; ++index)
            {
               fast_meta_address fma  = {region, ids_per_page * block + index};
               auto&             meta = get(fma);
               if (meta.ref() == 0)
                  free_id(fma);
               else if (meta.release().ref() == 1)
                  free_id(fma);
            }
         }
      }
   }
}  // namespace arbtrie
