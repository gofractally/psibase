#include <triedent/cache_allocator.hpp>

#include <cstring>

namespace triedent
{
   std::filesystem::path get_subpath(const std::filesystem::path& dir,
                                     const char*                  name,
                                     open_mode                    mode)
   {
      if (mode == open_mode::temporary)
         return dir;
      else
         return dir / name;
   }

   cache_allocator::cache_allocator(const std::filesystem::path& dir,
                                    const config&                cfg,
                                    open_mode                    mode)
       : _gc{256},
         _obj_ids(_gc, get_subpath(dir, "obj_ids", mode), mode),
         _levels{
             ring_allocator{get_subpath(dir, "hot", mode), cfg.hot_bytes, hot_cache, mode, true},
             ring_allocator{get_subpath(dir, "warm", mode), cfg.warm_bytes, warm_cache, mode, true},
             ring_allocator{get_subpath(dir, "cool", mode), cfg.cool_bytes, cool_cache, mode,
                            true}},
         _cold{_gc, _obj_ids, get_subpath(dir, "cold", mode), mode, cfg.cold_bytes}
   {
      if (mode != open_mode::read_only)
      {
         // resize ring buffers if needed. This is not safe to run
         // concurrently with the swap thread or any allocation.
         if (mode == open_mode::resize)
         {
            gc_session       session{_gc};
            std::unique_lock sl{session};
            auto             move_one = [&](object_header* o, object_location loc)
            {
               if (auto lock = _obj_ids.lock({.id = o->id}, loc))
               {
                  void* p = _cold.try_allocate(sl, lock.get_id(), o->size,
                                               [&](void* ptr, object_location newloc)
                                               {
                                                  std::memcpy(ptr, o->data(), o->size);
                                                  _obj_ids.compare_and_move(lock, loc, newloc);
                                               });
                  return p != nullptr;
               }
               return true;
            };
            hot().unsafe_resize(cfg.hot_bytes, move_one);
            warm().unsafe_resize(cfg.warm_bytes, move_one);
            cool().unsafe_resize(cfg.cool_bytes, move_one);
         }

         // Start background threads
         _swap_thread = std::thread(
             [this]()
             {
                thread_name("swap");
                set_current_thread_name("swap");
                swap_loop();
             });
         _gc_thread = std::thread{[this]
                                  {
                                     set_current_thread_name("swap");
                                     _gc.run(&_done);
                                  }};
      }
   }

   cache_allocator::~cache_allocator()
   {
      _done.store(true);
      hot().notify_swap();
      _gc.notify_run();
      if (_swap_thread.joinable())
         _swap_thread.join();
      _cold.stop();
      if (_gc_thread.joinable())
         _gc_thread.join();
      _gc.flush();
   }

   void cache_allocator::swap_loop()
   {
      gc_session session{_gc};
      while (swap(session))
      {
      }
   }

   bool cache_allocator::swap(gc_session& session)
   {
      constexpr uint64_t      target     = 1024 * 1024 * 40ull;
      constexpr std::uint64_t min_target = 1024 * 1024 * 33ull;
      bool                    did_work   = false;
      auto                    do_swap    = [&](auto& from, auto& to)
      {
         std::unique_lock sl{session};
         auto             move_one = [&](object_header* o, object_location loc)
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
            if (auto lock = _obj_ids.lock({.id = o->id}, loc))
            {
               void* p = to.try_allocate(sl, lock.get_id(), o->size,
                                         [&](void* ptr, object_location newloc)
                                         {
                                            std::memcpy(ptr, o->data(), o->size);
                                            _obj_ids.compare_and_move(lock, loc, newloc);
                                         });
               return p != nullptr;
            }
            return true;
         };
         if (auto p = from.swap(std::min(target, from.capacity()), move_one))
         {
            _gc.push(p);
            did_work = true;
         }
      };
      hot().wait_swap(min_target, &_done);
      if (_done.load())
         return false;
      do_swap(cool(), cold());
      if (_done.load())
         return false;
      do_swap(warm(), cool());
      if (_done.load())
         return false;
      do_swap(hot(), warm());
      _gc.poll();
      return true;
   }

   void* cache_allocator::try_move_object(session_lock_ref<>   session,
                                          ring_allocator&      to,
                                          const location_lock& lock,
                                          void*                data,
                                          std::uint32_t        size)
   {
      auto info   = _obj_ids.get(lock.get_id());
      auto result = to.try_allocate(session, lock.get_id(), size,
                                    [&](void* ptr, object_location loc)
                                    {
                                       std::memcpy(ptr, data, size);
                                       _obj_ids.move(lock, loc);
                                    });
      if (result && info.cache == cold_cache)
      {
         _cold.deallocate(info);
      }
      return result;
   }

   namespace
   {
      std::string make_size(std::uint64_t val)
      {
         for (auto suffix : {"B", "KiB", "MiB", "GiB", "TiB", "PiB"})
         {
            if (val < 1024)
            {
               return std::to_string(val) + " " + suffix;
            }
            val /= 1024;
         }
         return std::to_string(val) + " EiB";
      }
   }  // namespace

   void cache_allocator::print_stats(std::ostream& os, bool detail)
   {
      auto print_level = [&](auto& level)
      {
         auto stats = level.get_stats(
             [&](object_id id, object_location loc)
             {
                auto info = _obj_ids.get(id);
                return info.ref != 0 && info == loc;
             });
         os << "Used: " << make_size(stats.used_bytes) << std::endl;
         os << "Free: " << make_size(stats.free_bytes) << std::endl;
         os << "Capacity: " << make_size(stats.total_bytes) << std::endl;
         os << "Available: " << make_size(stats.available_bytes) << std::endl;
      };
      os << "File: hot\n";
      print_level(hot());
      os << "File: warm\n";
      print_level(warm());
      os << "File: cool\n";
      print_level(cool());
      os << "File: cold\n";
      print_level(cold());
      os << "File: obj_ids\n";
      _obj_ids.print_stats(os);
   }

}  // namespace triedent
