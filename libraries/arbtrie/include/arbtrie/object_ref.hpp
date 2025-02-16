#pragma once
#include <arbtrie/node_meta.hpp>

namespace arbtrie
{
   class read_lock;
   class seg_allocator;
   class seg_alloc_session;
   class modify_lock;
   class node_header;

   class object_ref
   {
     public:
      object_ref(const object_ref& p);

      id_address    address() const { return _address; }
      uint32_t      ref() const { return _cached.ref(); }
      node_type     type() const { return _cached.type(); }
      node_location loc() const { return _cached.loc(); }

      // return false if ref count overflow
      bool retain() { return _meta.retain(); }

      // return last value of pointer if object is deleted, so children can
      // be released... otherwise null
      const node_header* release();

      modify_lock modify() { return modify_lock(_meta, _rlock); }
      bool        try_start_move(node_location loc) { return _meta.try_start_move(loc); }
      auto        try_move(node_location expected_prior_loc, node_location move_to_loc);

      template <typename T = node_header, bool SetReadBit = false>
      const T* header() const;

      template <typename T = node_header>
      std::pair<const T*, node_location> try_move_header();

      template <typename Type, bool SetReadBit = false>
      const Type* as() const;

      void store(temp_meta_type tmt, auto memory_order);

      void refresh(auto memory_order) { _cached = _meta.load(memory_order); }

      auto& rlock() { return _rlock; }
      auto& rlock() const { return _rlock; }

      temp_meta_type meta_data() { return _cached; }

      void            prefetch() { __builtin_prefetch(&_meta, 1, 1); }
      node_meta_type& meta() { return _meta; }

      void maybe_update_read_stats() const;

     protected:
      friend class seg_allocator;
      friend class seg_alloc_session;
      friend class read_lock;
      friend class modify_lock;

      object_ref(read_lock& rlock, id_address adr, node_meta_type& met);

      read_lock&      _rlock;
      node_meta_type& _meta;
      temp_meta_type  _cached;  // cached read of atomic _atom_loc
      id_address      _address;
   };  // object_ref
}  // namespace arbtrie

#include <arbtrie/object_ref_impl.hpp>
