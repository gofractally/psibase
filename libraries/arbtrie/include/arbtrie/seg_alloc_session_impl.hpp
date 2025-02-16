#pragma once
#include <arbtrie/seg_alloc_session.hpp>
#include <arbtrie/seg_allocator.hpp>

namespace arbtrie
{

   inline id_region seg_alloc_session::read_lock::get_new_region()
   {
      return _session._sega._id_alloc.get_new_region();
   }
   inline object_ref seg_alloc_session::read_lock::get(id_address adr)
   {
      return object_ref(*this, adr, _session._sega._id_alloc.get(adr));
   }
}  // namespace arbtrie
