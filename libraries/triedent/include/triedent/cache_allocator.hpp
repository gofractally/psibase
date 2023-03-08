#pragma once

#include <triedent/gc_queue.hpp>
#include <triedent/object_db.hpp>
#include <triedent/ring_allocator.hpp>

#include <array>
#include <atomic>
#include <filesystem>
#include <span>
#include <tuple>
#include <utility>

namespace triedent
{
   // Cache allocator manages all storage for the database.
   //
   // It maintains multiple buffers and moves accessed data to the hot
   // buffer. Objects that are not accessed will be moved to successively
   // lower buffers over time.
   //
   // Objects may be moved at any time. All data
   // reads must be protected by a session lock which ensures that
   // existing pointers remain valid.  All writes must be protected
   // by a location_lock, which prevents the data from being moved.
   class cache_allocator
   {
     public:
      using id = object_id;

      struct config
      {
         uint64_t max_ids    = 100 * 1000 * 1000ull;
         uint64_t hot_bytes  = 1000 * 1000ull;
         uint64_t warm_bytes = 1000 * 1000ull;
         uint64_t cool_bytes = 1000 * 1000ull;
         uint64_t cold_bytes = 1000 * 1000ull;
      };

      cache_allocator(const std::filesystem::path& path,
                      const config&                cfg,
                      access_mode                  mode,
                      bool                         allow_gc = false);
      ~cache_allocator();

      auto start_session() { return gc_queue::session{_gc}; }

      bool          bump_count(object_id id) { return _obj_ids.bump_count(id); }
      location_lock lock(object_id id) { return _obj_ids.spin_lock(id); }

      // WARNING: alloc temporarily unlocks the session, which invalidates
      // all existing pointers to allocated objects
      //
      // WARNING: alloc is blocking. It should not be called while
      // holding any locks other than the session. It should also
      // not be called by the swap thread.
      std::pair<location_lock, void*> alloc(std::unique_lock<gc_queue::session>& session,
                                            std::size_t                          num_bytes,
                                            node_type                            type);

      std::pair<void*, node_type> release(id i);

      // The returned pointer will remain valid until the session lock is released
      // get_cache is non-blocking.
      template <bool CopyToHot>
      std::tuple<void*, node_type, std::uint16_t> get_cache(session_lock_ref<> session, id i);

      std::uint16_t ref(id i) { return _obj_ids.ref(i); }

      static std::uint32_t object_size(void* ptr)
      {
         return reinterpret_cast<object_header*>(ptr)[-1].size;
      }

      bool is_slow() const { return !_obj_ids.pinned() || !hot().pinned() || !warm().pinned(); }

      std::array<std::span<const char>, 5> span() const
      {
         return {_obj_ids.span(), hot().span(), warm().span(), cool().span(), cold().span()};
      }

      bool gc_retain(object_id i) { return _obj_ids.gc_retain(i); }
      void gc_start() { _obj_ids.gc_start(); }
      void gc_finish() { _obj_ids.gc_finish(); }

      void validate(id i) { _obj_ids.validate(i); }

     private:
      bool  swap();
      void* try_move_object(ring_allocator&      to,
                            const location_lock& lock,
                            void*                data,
                            std::uint32_t        size);

      void swap_loop();

      ring_allocator& hot() { return _levels[hot_cache]; }
      ring_allocator& warm() { return _levels[warm_cache]; }
      ring_allocator& cool() { return _levels[cool_cache]; }
      ring_allocator& cold() { return _levels[cold_cache]; }

      const ring_allocator& hot() const { return _levels[hot_cache]; }
      const ring_allocator& warm() const { return _levels[warm_cache]; }
      const ring_allocator& cool() const { return _levels[cool_cache]; }
      const ring_allocator& cold() const { return _levels[cold_cache]; }

      gc_queue       _gc;
      object_db      _obj_ids;
      ring_allocator _levels[4];

      std::atomic<bool> _done{false};
      std::thread       _swap_thread;
   };

   inline std::pair<location_lock, void*> cache_allocator::alloc(  //
       std::unique_lock<gc_queue::session>& session,
       std::size_t                          num_bytes,
       node_type                            type)
   {
      if (num_bytes > 0xffffff - 8) [[unlikely]]
         throw std::runtime_error("obj too big");

      auto lock = _obj_ids.alloc(session, type);
      // lock does not control any valid memory yet
      auto ptr = hot().allocate(session, lock.get_id(), num_bytes,
                                [&](void*, object_location loc) { lock.move(loc); });

      return {std::move(lock), ptr};
   }

   inline std::pair<void*, node_type> cache_allocator::release(id i)
   {
      auto l = _obj_ids.release(i);
      return {(l.ref > 0 ? nullptr : (char*)_levels[l.cache].get_object(l.offset())->data()),
              {l.type}};
   }

   // The returned pointer will remain valid until the session lock is released
   template <bool CopyToHot>
   std::tuple<void*, node_type, uint16_t> cache_allocator::get_cache(session_lock_ref<> session,
                                                                     id                 i)
   {
      auto loc = _obj_ids.get(i);
      auto obj = _levels[loc.cache].get_object(loc.offset());

      if constexpr (CopyToHot)
      {
         if (loc.cache != hot_cache && obj->size <= 4096)
         {
            // MUST NOT wait for free memory while holding a location lock
            if (auto copy = try_move_object(hot(), _obj_ids.spin_lock(i), obj->data(), obj->size))
            {
               return {copy, {loc.type}, loc.ref};
            }
         }
      }

      return {obj->data(), {loc.type}, static_cast<std::uint16_t>(loc.ref)};
   }

}  // namespace triedent
