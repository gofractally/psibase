namespace arbtrie
{

   /// @pre refcount of id is 1
   inline object_ref seg_allocator::session::read_lock::realloc(
       object_ref& oref,
       uint32_t                 size,
       node_type                type,
       auto                     init)
   {
      auto adr = oref.address();
      assert(oref.meta().is_changing());

      auto l       = oref.loc();
      auto seg     = l.segment();
      auto obj_ptr = (node_header*)((char*)_session._sega._block_alloc.get(seg) + l.abs_index());

      _session._sega._header->seg_meta[seg].free_object(obj_ptr->object_capacity());

      //   std::cerr << "realloc " << id <<" size: " << size <<" \n";
      // TODO: mark the free space associated with the current location of id
      assert(size >= sizeof(node_header));
      assert(type != node_type::undefined);

      //auto& atom           = _session._sega._id_alloc.get(id);
      auto [loc, node_ptr] = _session.alloc_data(size, adr);

      init(node_ptr);
      if constexpr (update_checksum_on_modify)
         node_ptr->update_checksum();

      assert(type == node_type::value or node_ptr->_branch_id_region != 0);
      assert(node_ptr->_nsize == size);
      assert(node_ptr->_ntype == type);
      assert(node_ptr->_node_id == adr.to_int());

      oref.meta().set_location_and_type(loc, type, std::memory_order_release);
      oref.refresh(std::memory_order_relaxed);
      return oref;
   }

   inline std::pair<node_meta_type&, fast_meta_address>
   seg_allocator::session::read_lock::get_new_meta_node(id_region reg)
   {
      return _session._sega._id_alloc.get_new_id(reg);
      //auto [atom, id]      = _session._sega._id_alloc.get_new_id(reg);
   }

   inline object_ref seg_allocator::session::read_lock::alloc(id_region reg,
                                                                           uint32_t  size,
                                                                           node_type type,
                                                                           auto      init)
   {
      if constexpr (debug_memory)
      {
         assert(not _session._sega._in_alloc);
         _session._sega._in_alloc = true;
      }

      assert(size >= sizeof(node_header));
      assert(type != node_type::undefined);

      auto [atom, id]      = _session._sega._id_alloc.get_new_id(reg);
      auto [loc, node_ptr] = _session.alloc_data(size, id);
      //TRIEDENT_WARN( "alloc id: ", id, " type: " , node_type_names[type], " loc: ", loc._offset, " size: ", size);

      //init(node_ptr);
      init(node_ptr);
      if constexpr (update_checksum_on_modify)
         node_ptr->update_checksum();

      assert(type == node_type::value or node_ptr->_branch_id_region != 0);

      atom.store(temp_meta_type().set_type(type).set_location(loc).set_ref(1),
                 std::memory_order_release);

      assert(node_ptr->_nsize == size);
      assert(node_ptr->_ntype == type);
      assert(node_ptr->_node_id == id.to_int());
      assert(object_ref(*this, id, atom).type() != node_type::undefined);

      if constexpr (debug_memory)
      {
         _session._sega._in_alloc = false;
      }

      return object_ref(*this, id, atom);
   }

   inline bool seg_allocator::session::read_lock::is_synced(node_location loc)
   {
      int64_t seg = loc.segment();
      return _session._sega._header->seg_meta[seg]._last_sync_pos.load(std::memory_order_relaxed) >
             loc.abs_index();  // - seg * segment_size;
   }

   inline sync_lock& seg_allocator::session::read_lock::get_sync_lock(int seg)
   {
      return _session._sega._seg_sync_locks[seg];
   }
   inline node_header* seg_allocator::session::read_lock::get_node_pointer(node_location loc)
   {
      auto segment = (mapped_memory::segment_header*)_session._sega._block_alloc.get(loc.segment());
      // 0 means we are accessing a swapped object on a segment that hasn't started new allocs
      // if alloc_pos > loc.index() then we haven't overwriten this object yet, we are accessing
      // data behind the alloc pointer which should be safe
      // to access data we had to get the location from obj id database and we should read
      // with memory_order_acquire, when updating an object_info we need to write with
      // memory_order_release otherwise the data written may not be visible yet to the reader coming
      // along behind

      // only check this in release if this flag is set
      if constexpr (debug_memory)
      {
         auto ap = segment->_alloc_pos.load(std::memory_order_relaxed);
         if (not(ap == 0 or ap > loc.abs_index()))
         {
            TRIEDENT_WARN("ap: ", ap, "  loc: ", loc.aligned_index(), " abs: ", loc.abs_index(),
                          "loc.segment: ", loc.segment());
            abort();
         }
      }
      else  // always check in debug builds
         assert(segment->_alloc_pos == 0 or segment->_alloc_pos > loc.abs_index());

      return (node_header*)((char*)_session._sega._block_alloc.get(loc.segment()) +
                            loc.abs_index());
   }
   inline void seg_allocator::session::read_lock::update_read_stats(node_location loc, 
                                                                    uint32_t size, 
                                                                    uint64_t time ) {
      _session._segment_read_stat->read_bytes( loc.segment(), size, time );
   }

   inline void seg_allocator::session::read_lock::free_meta_node(fast_meta_address a)
   {
      _session._sega._id_alloc.free_id(a);
   }

   // returned mutable T is only valid while modify lock is in scope
   // TODO: compile time optimziation or a state variable can avoid sync_lock
   // the sync locks and atomic operations if we know for certain that
   // the process will not want to msync or is willing to risk
   // data not making it to disk.
   template <typename T>
   T* seg_allocator::session::read_lock::modify_lock::as()
   {
      if (_observed_ptr)
         return (T*)_observed_ptr;
      assert(_locked_val.ref());

      auto loc   = _locked_val.loc();
      auto lseg  = loc.segment();
      _sync_lock = &_rlock.get_sync_lock(lseg);
      if (_sync_lock->try_modify())
      {
         if (not _rlock.is_synced(loc))
            return (T*)(_observed_ptr = _rlock.get_node_pointer(loc));
         _sync_lock->end_modify();
      }
      _sync_lock    = nullptr;
      auto cur_ptr  = _rlock.get_node_pointer(loc);
      auto old_oref = _rlock.get(cur_ptr->address());
      auto oref     = _rlock.realloc(old_oref, cur_ptr->_nsize, cur_ptr->get_type(),
                                     [&](auto ptr) { memcpy(ptr, cur_ptr, cur_ptr->_nsize); });
      return (T*)(_observed_ptr = _rlock.get_node_pointer(oref.loc()));
   }

   template <typename T>
   void seg_allocator::session::read_lock::modify_lock::as(std::invocable<T*> auto&& call_with_tptr)
   {
      assert(_locked_val.ref());
      call_with_tptr(as<T>());
   }

   inline void seg_allocator::session::read_lock::modify_lock::release()
   {
      _released = true;
      unlock();
   }

   inline void seg_allocator::session::read_lock::modify_lock::unlock()
   {
      if (_observed_ptr)
      {
         if constexpr (update_checksum_on_modify)
            _observed_ptr->update_checksum();
         else
            _observed_ptr->checksum = 0;
      }
      // allow msync to continue
      if (_sync_lock)
         _sync_lock->end_modify();
      // allow compactor to copy
      _meta.end_modify();
   }
}  // namespace arbtrie
