#pragma once
#include <arbtrie/read_lock.hpp>
#include <arbtrie/seg_alloc_session.hpp>
#include <arbtrie/seg_allocator.hpp>

namespace arbtrie
{
   class object_ref;

   // copy E to R*
   inline void seg_alloc_session::retain_read_lock()
   {
      if (++_nested_read_lock != 1)
         return;

      uint64_t cur = _session_lock_ptr.load(std::memory_order_acquire);

      //cur.locked_end = cur.view_of_end;
      uint32_t view_of_end = cur >> 32;
      uint32_t cur_end     = uint32_t(cur);
      // it should be unlocked which signaled by max
      assert(cur_end == uint32_t(-1));
      auto diff = cur_end - view_of_end;

      // an atomic sub should leave the higher-order bits in place where the view
      // from the compactor is being updated.
      _session_lock_ptr.fetch_sub(diff, std::memory_order_release);
   }

   // R* goes to inifinity and beyond
   inline void seg_alloc_session::release_read_lock()
   {
      // set it to max uint32_t
      if (not --_nested_read_lock)
         _session_lock_ptr.fetch_or(uint32_t(-1));
      assert(_nested_read_lock >= 0);
   }

   inline modify_lock::modify_lock(node_meta_type& m, read_lock& rl)
       : _meta(m), _rlock(rl), _sync_lock(nullptr)
   {
      _locked_val = _meta.start_modify();
   }

   inline modify_lock::~modify_lock()
   {
      if (not _released)
         unlock();
   }

   inline id_region read_lock::get_new_region()
   {
      return _session._sega._id_alloc.get_new_region();
   }
   inline object_ref read_lock::get(id_address adr)
   {
      return object_ref(*this, adr, _session._sega._id_alloc.get(adr));
   }

   inline read_lock seg_alloc_session::lock()
   {
      return read_lock(*this);
   }
}  // namespace arbtrie
