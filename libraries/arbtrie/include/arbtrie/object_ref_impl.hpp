#pragma once
#include <assert.h>
#include <arbtrie/node_header.hpp>
#include <arbtrie/object_ref.hpp>
#include <arbtrie/read_lock.hpp>

namespace arbtrie
{
   inline object_ref::object_ref(read_lock& rlock, id_address adr, node_meta_type& met)
       : _rlock(rlock), _meta(met), _cached(_meta.load(std::memory_order_relaxed)), _address(adr)
   {
   }

   inline object_ref::object_ref(const object_ref& p)
       : _rlock(p._rlock), _address(p._address), _meta(p._meta), _cached(p._cached)
   {
   }

   inline void object_ref::store(temp_meta_type tmt, auto memory_order)
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
   const Type* object_ref::as() const
   {
      assert(header()->validate_checksum());
      assert((Type::type == header<Type, SetReadBit>()->get_type()));
      return reinterpret_cast<const Type*>(header());
   }

   inline auto object_ref::try_move(node_location expected_prior_loc, node_location move_to_loc)
   {
      return _meta.try_move(expected_prior_loc, move_to_loc);
   }

   template <typename T, bool SetReadBit>
   inline const T* object_ref::header() const
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
         maybe_update_read_stats();
      return r;
   }

   template <typename T>
   std::pair<const T*, node_location> object_ref::try_move_header()
   {
      if (auto opt_loc = _meta.try_move_location())
      {
         return {_rlock.get_node_pointer(*opt_loc), *opt_loc};
      }
      return {nullptr, node_location::from_absolute(0)};
   }

   inline void object_ref::maybe_update_read_stats() const
   {
      // Generate random number using rdtsc hashed with XXHash for better distribution
      uint64_t tsc    = rdtsc();
      uint32_t random = XXH32(&tsc, sizeof(uint64_t), 0);

      // Check if random number exceeds difficulty threshold
      if (random > _rlock._session._sega._read_difficulty)
      {
         // Try to set read bit
         auto m = _meta.load(std::memory_order_relaxed);
         if (_meta.try_set_read())
         {
            // try_set_read() returns true if read bit was already set
            _meta.start_pending_cache();
            _rlock._session._rcache_queue.push(address().to_int());
         }
      }
   }

   inline const node_header* object_ref::release()
   {
      auto prior = _meta.release();
      if (prior.ref() > 1)
         return nullptr;

      auto result = _rlock.get_node_pointer(prior.loc());

      auto ploc    = prior.loc();
      auto obj_ptr = _rlock.get_node_pointer(ploc);

      _rlock.free_meta_node(_address);
      _rlock._session._sega._header->seg_meta[ploc.segment()].free_object(
          obj_ptr->object_capacity());
      return result;
   }

}  // namespace arbtrie