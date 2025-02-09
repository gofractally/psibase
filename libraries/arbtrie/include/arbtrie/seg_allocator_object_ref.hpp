namespace arbtrie
{

   inline seg_allocator::session::read_lock::object_ref::object_ref(
       seg_allocator::session::read_lock& rlock,
       fast_meta_address                  adr,
       node_meta_type&                    met)
       : _rlock(rlock), _meta(met), _cached(_meta.load(std::memory_order_relaxed)), _address(adr)
   {
   }

   inline seg_allocator::session::read_lock::object_ref::object_ref(const object_ref& p)
       : _rlock(p._rlock), _address(p._address), _meta(p._meta), _cached(p._cached)
   {
   }
   inline void seg_allocator::session::read_lock::object_ref::store(temp_meta_type tmt,
                                                                auto           memory_order)
   {
      if constexpr (not debug_memory)
      {
         _meta.store(_cached = tmt, memory_order);
      }
      else
      {
         auto clok = _cached.loc();
         auto old  = _meta.exchange(_cached = tmt, memory_order);
         if (old.loc() != clok)
         {
            TRIEDENT_WARN(
                "stomping on location that changed from cache,"
                " this may result in memory leak until compacted");
         }
      }
   }

   template <typename Type, bool SetReadBit>
   const Type* seg_allocator::session::read_lock::object_ref::as() const
   {
      assert(header()->validate_checksum());
      assert(Type::type == header<SetReadBit>()->get_type());
      return reinterpret_cast<const Type*>(header());
   };

   inline auto seg_allocator::session::read_lock::object_ref::try_move(node_location expected_prior_loc,
                                                                   node_location move_to_loc)
   {
      return _meta.try_move(expected_prior_loc, move_to_loc);
   }

   template <typename T, bool SetReadBit>
   inline const T* seg_allocator::session::read_lock::object_ref::header() const
   {
      assert(_meta.load(std::memory_order_relaxed).ref());
      auto m = _meta.load(std::memory_order_acquire);
      auto r = (const T*)_rlock.get_node_pointer(m.loc());
      if constexpr (debug_memory)
      {
         if (not r->validate_checksum())
         {
            TRIEDENT_WARN("checksum: ", r->checksum);
            abort();
         }
         assert(r->validate_checksum());
      }
      if constexpr (SetReadBit)
      {
         if (not m.is_read())
         {
            uint64_t time = rdtsc();
            if( (time & 0xf) == 0xf ) {
               if (_meta.try_set_read(m))
               {
                  _rlock.update_read_stats( m.loc(), r->_nsize, time >> 4 );
               }
            }
         }
      }
      // TODO: determine if we need to set read bit on node
      return r;
   }

   /**
    *  Returns the last value of the node pointer prior to release so that
    *  its children may be released, or null if the children shouldn't be released.
    */
   inline const node_header* seg_allocator::session::read_lock::object_ref::release()
   {
      //      TRIEDENT_DEBUG( "  ", address(), "  ref: ", ref(), " type: ", node_type_names[type()] );
      auto prior = _meta.release();
      if (prior.ref() > 1)
         return nullptr;

      auto result = _rlock.get_node_pointer(prior.loc());

      //     TRIEDENT_DEBUG( "  free ", address() );

      auto ploc    = prior.loc();
      auto obj_ptr = _rlock.get_node_pointer(ploc);
      //    (node_header*)((char*)_rlock._session._sega._block_alloc.get(seg) + loc.abs_index());

      _rlock.free_meta_node(_address);
      _rlock._session._sega._header->seg_meta[ploc.segment()].free_object(
          obj_ptr->object_capacity());
      return result;
   }

}  // namespace arbtrie
