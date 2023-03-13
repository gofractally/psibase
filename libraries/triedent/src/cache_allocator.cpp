#include <triedent/cache_allocator.hpp>

#include <cstring>

namespace triedent
{
   cache_allocator::cache_allocator(const std::filesystem::path& dir,
                                    const config&                cfg,
                                    access_mode                  mode,
                                    bool                         allow_gc)
       : _gc{256},
         _obj_ids(_gc, dir / "obj_ids", access_mode::read_write, allow_gc),
         _levels{ring_allocator{dir / "hot", cfg.hot_bytes, hot_cache, mode, true},
                 ring_allocator{dir / "warm", cfg.warm_bytes, warm_cache, mode, true},
                 ring_allocator{dir / "cool", cfg.cool_bytes, cool_cache, mode, true}},
         _cold{_gc, _obj_ids, dir / "cold", mode}
   {
      _swap_thread = std::thread(
          [this]()
          {
             thread_name("swap");
             pthread_setname_np(pthread_self(), "swap");
             swap_loop();
          });
   }

   cache_allocator::~cache_allocator()
   {
      _done.store(true);
      _swap_thread.join();
   }

   void cache_allocator::swap_loop()
   {
      while (!_done.load())
      {
         if (!swap())
         {
            // TODO: Stop busy waiting
            using namespace std::chrono_literals;
            std::this_thread::sleep_for(10us);
         }
      }
   }

   bool cache_allocator::swap()
   {
      constexpr uint64_t target   = 1024 * 1024 * 40ull;
      bool               did_work = false;
      auto               do_swap  = [&](auto& from, auto& to)
      {
         auto move_one = [&](object_header* o, object_location loc)
         {
            // When a block is initialized, id and o point to
            // each other. The block is valid as long as this
            // relationship is maintained.
            // - The object header cannot change while it is visible to swap
            // - id may be pointed to a different location. This
            //   makes the block free. Once a block is free, id cannot
            //   be made to point to it again until after the block
            //   is removed from the swap queue.
            //
            bool matched;
            if (auto lock = _obj_ids.try_lock({.id = o->id}, loc, &matched))
            {
               return to.allocate(lock.get_id(), o->size,
                                  [&](void* ptr, object_location loc)
                                  {
                                     std::memcpy(ptr, o->data(), o->size);
                                     _obj_ids.move(lock, loc);
                                  }) != nullptr;
            }
            return !matched;
         };
         if (auto p = from.swap(std::min(target, from.capacity()), move_one))
         {
            _gc.push(p);
            did_work = true;
         }
      };
      do_swap(hot(), warm());
      do_swap(warm(), cool());
      do_swap(cool(), cold());
      _gc.poll();
      return did_work;
   }

   void* cache_allocator::try_move_object(ring_allocator&      to,
                                          const location_lock& lock,
                                          void*                data,
                                          std::uint32_t        size)
   {
      auto info   = _obj_ids.get(lock.get_id());
      auto result = to.allocate(lock.get_id(), size,
                                [&](void* ptr, object_location loc)
                                {
                                   std::memcpy(ptr, data, size);
                                   _obj_ids.move(lock, loc);
                                });
      if (info.cache == cold_cache)
      {
         _cold.deallocate(info);
      }
      return result;
   }
}  // namespace triedent
