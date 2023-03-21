#pragma once

#include <triedent/file_fwd.hpp>
#include <triedent/gc_queue.hpp>
#include <triedent/mapping.hpp>
#include <triedent/object_fwd.hpp>

#include <cassert>
#include <condition_variable>
#include <cstdint>
#include <mutex>
#include <span>
#include <stdexcept>

#include <iostream>

namespace triedent
{
   struct object_header
   {
      // size might not be a multiple of 8, next object is at data() + (size+7)&-8
      uint64_t size : 24;  // bytes of data, not including header
      uint64_t id : 40;

      inline uint64_t data_size() const { return size; }
      inline uint32_t data_capacity() const { return (size + 7) & -8; }
      inline void*    data() const { return (char*)(this + 1); }
   };

   // ring_allocator allocates memory from a single circular buffer.
   // The buffer is divided into three regions
   // - Allocated memory holds live objects
   // - Free memory is available for allocation
   // - Swapped memory contains dead objects that might still be accessed by other threads
   //
   // Thread safety:
   //
   // - allocate can run concurrently
   // - swap and swap_wait can run concurrently with allocate
   // - two calls to swap or swap_wait MUST NOT run concurrently
   //
   // Representation notes:
   // - The three regions are represented by their boundaries. The pointers
   //   are ordered, swap_p <= alloc_p <= end_free_p.
   // - Each pointer is represented as an offset with an additional bit
   //   to track wrapping. This bit is flipped each time a pointer wraps
   //   back to the beginning of the buffer.  This extra bit serves to
   //   disambiguate the case where one or more of the regions is empty.
   // - The boundary between free and swapped memory is not stored in
   //   the file because it is transient.  On process exit, all swapped
   //   memory automatically becomes free.
   // - header fields are always updated atomically to ensure consistency
   //   after a crash.
   // - Even though swapped memory contains valid objects, _end_free_p
   //   might point into the middle of an object, because of the way
   //   it is updated.  The implementation must not make any assumptions
   //   about the contents of non-allocated memory.
   //
   // Synchronization notes:
   // - swap_p is only written by swap. It can be read by allocate,
   //   but the value only affects the behavior if the swap thread
   //   is in wait_swap.
   // - alloc_p and end_free_p are protected by free_mutex.
   // - All other fields are immutable
   // - object headers are written while holding free_mutex,
   //   and are not modified after creation.
   class ring_allocator
   {
     public:
      ring_allocator(const std::filesystem::path& path,
                     std::uint64_t                size,
                     std::uint8_t                 level,
                     access_mode                  mode,
                     bool                         pin);
      struct header
      {
         std::uint32_t magic;
         std::uint32_t flags;
         // TODO: should we include a UUID as well?
         std::atomic<std::uint64_t> start;
         std::atomic<std::uint64_t> size;
         alignas(64) std::atomic<std::uint64_t> alloc_p;
         alignas(64) std::atomic<std::uint64_t> swap_p;
      };
      // returns a pointer that owns any swapped memory. The shared pointer
      // must be preserved until any current accesses complete.
      //
      // swap only makes a best effort to make target bytes available.
      //
      // The signature of move_object is bool(object_header*, object_location)
      // move_object should return true if it successfully moved the object
      // OR if the object is already dead. move_object MUST NOT block.
      //
      // The target size should be no smaller than the maximum allocation size
      // including padding.
      std::shared_ptr<void> swap(std::uint64_t target, auto&& move_object);

      // Blocks until potential_free_bytes becomes less than min_swap or done is true
      // This MUST NOT be called concurrently with itself or swap.
      void wait_swap(std::uint64_t min_swap, std::atomic<bool>* done);

      // Wakes up a thread that is blocked in wait_swap
      void notify_swap();

      // Blocking overload of allocate.
      // The session lock may be released and reaquired, invaliding any pointers
      // that it protects. The init function will be executed before the
      // new object becomes available to swap.
      template <typename F>
      void* allocate(std::unique_lock<gc_queue::session>& session,
                     object_id                            id,
                     std::size_t                          size,
                     F&&                                  init);
      // Non-blocking overload of allocate.  If there is not enough available
      // memory, returns null.
      // The init function will be executed before the new object becomes available to swap.
      template <typename F>
      void* try_allocate(session_lock_ref<>, object_id id, std::size_t size, F&& init);

      // \pre offset is an offset that was previously returned by allocate.
      //
      // This should NOT be used internally to ring_allocator.
      // The internal pointers have additional bits that need
      // to be masked out.
      object_header* get_object(std::uint64_t offset)
      {
         return reinterpret_cast<object_header*>(_base + offset);
      }
      std::uint64_t         capacity() const { return _header->size.load(); }
      bool                  pinned() const { return _file.pinned(); }
      std::span<const char> span() const
      {
         return {reinterpret_cast<const char*>(_file.data()), _file.size()};
      }

      // NOT thread-safe
      template <typename F>
      allocator_stats get_stats(F&& is_live);

     private:
      // Returns the total memory required to allocate an object,
      // including the object header and any padding.
      static constexpr std::uint64_t alloc_size(std::size_t size)
      {
         return ((size + 7) & -8) + sizeof(object_header);
      }
      // \pre _free_mutex must be held
      void* allocate_impl(std::uint64_t size, std::uint64_t used_size, object_id id, auto&& init)
      {
         auto alloc_p = _header->alloc_p.load();
         auto result  = get_obj(alloc_p);
         auto offset  = split_p(alloc_p).first;
         new (result) object_header{.size = size, .id = id.id};
         // Updating alloc_p makes the new object visible to swap.
         // The object_header must be written first, although the
         // mutex protects us in every case except a crash.
         _header->alloc_p.store(next(alloc_p, result));
         // init should run after alloc_p is updated, so that the
         // memory won't vanish after a crash. The mutex prevents
         // swap from seeing the new alloc_p too soon.
         init(result->data(), object_location{.offset = offset, .cache = _level});
         return result->data();
      }
      // \pre _free_mutex must be held
      // \post if the result is true, then there is at least used_size
      // contiguous free space starting at _alloc_p.
      bool check_contiguous_free_space(std::uint64_t used_size)
      {
         // This is the maximum that can be available without wrapping around
         auto [alloc_p, alloc_x]       = split_p(_header->alloc_p.load());
         auto trailing_bytes           = _header->size.load() - alloc_p;
         auto [end_free_p, end_free_x] = split_p(_end_free_p);
         if (used_size > trailing_bytes)
         {
            if (end_free_x != alloc_x)
            {
               // If we wrapped around, fill the trailing space with a dummy object
               allocate_impl(trailing_bytes - sizeof(object_header), trailing_bytes, {},
                             [](auto&&...) {});
               if (end_free_p >= used_size)
               {
                  return true;
               }
            }
            return false;
         }
         else
         {
            return end_free_x != alloc_x || end_free_p >= alloc_p + used_size;
         }
      }
      // Thread safety:
      // - locks free_mutex
      // - reads swap_p
      std::uint64_t potential_free_bytes()
      {
         std::lock_guard l{_free_mutex};
         return potential_free_bytes_unlocked();
      }
      std::uint64_t potential_free_bytes_unlocked()
      {
         auto [alloc_p, alloc_x] = split_p(_header->alloc_p.load());
         auto [swap_p, swap_x]   = split_p(_header->swap_p.load());
         if (alloc_x == swap_x)
         {
            assert(swap_p <= alloc_p);
            return swap_p + (_header->size.load() - alloc_p);
         }
         else
         {
            assert(alloc_p <= swap_p);
            return swap_p - alloc_p;
         }
      }
      static std::pair<std::uint64_t, std::uint64_t> split_p(std::uint64_t p)
      {
         return {p & _mask, p & ~_mask};
      }
      static std::uint64_t get_offset(std::uint64_t p) { return split_p(p).first; }
      object_header*       get_obj(std::uint64_t p)
      {
         return reinterpret_cast<object_header*>(_base + get_offset(p));
      }
      std::uint64_t next(std::uint64_t p, object_header* obj, std::uint64_t* size = nullptr)
      {
         auto object_size = sizeof(object_header) + get_obj(p)->data_capacity();
         auto result      = p + object_size;
         if (size)
         {
            *size += object_size;
         }
         if ((result & _mask) == _header->size.load())
         {
            // Set to 0 and flip the wrap bit
            result = (result & ~_mask) ^ (_mask + 1);
         }
         return result;
      }
      std::shared_ptr<void>   make_update_free(std::uint64_t bytes);
      mapping                 _file;
      std::mutex              _free_mutex;
      std::condition_variable _free_cond;
      header*                 _header;
      char*                   _base;
      std::uint64_t           _end_free_p;
      std::condition_variable _swap_cond;
      std::uint64_t           _free_min;

      std::uint8_t                   _level;
      static constexpr std::uint64_t _mask = ~std::uint64_t{0} >> 1;
   };

   std::shared_ptr<void> ring_allocator::swap(std::uint64_t target, auto&& move_object)
   {
      assert(target <= _header->size.load());
      std::uint64_t freed      = 0;
      std::uint64_t free_bytes = potential_free_bytes();
      auto          swap_p     = _header->swap_p.load();
      while (freed + free_bytes < target)
      {
         auto p = get_obj(swap_p);
         if (!move_object(p, object_location{.offset = get_offset(swap_p), .cache = _level}))
         {
            break;
         }
         swap_p = next(swap_p, p, &freed);
      }
      _header->swap_p.store(swap_p);
      return make_update_free(freed);
   }

   template <typename F>
   void* ring_allocator::allocate(std::unique_lock<gc_queue::session>& session,
                                  object_id                            id,
                                  std::size_t                          size,
                                  F&&                                  init)
   {
      uint64_t used_size = alloc_size(size);

      std::unique_lock l{_free_mutex};
      {
         relocker rl{session};
         _free_cond.wait(l, [&] { return check_contiguous_free_space(used_size); });
      }

      void* result = allocate_impl(size, used_size, id, init);
      if (potential_free_bytes_unlocked() < _free_min)
      {
         _swap_cond.notify_one();
      }
      return result;
   }

   template <typename F>
   void* ring_allocator::try_allocate(session_lock_ref<>, object_id id, std::size_t size, F&& init)
   {
      uint64_t used_size = alloc_size(size);

      std::unique_lock l{_free_mutex};
      if (check_contiguous_free_space(used_size))
      {
         return allocate_impl(size, used_size, id, init);
      }
      else
      {
         return nullptr;
      }
   }

   template <typename F>
   allocator_stats ring_allocator::get_stats(F&& is_live)
   {
      allocator_stats result{};
      auto            swap_p  = _header->swap_p.load();
      auto            alloc_p = _header->alloc_p.load();
      result.total_bytes      = _header->size.load();
      result.available_bytes  = potential_free_bytes_unlocked();
      result.free_bytes       = result.available_bytes;
      while (swap_p != alloc_p)
      {
         auto ptr = get_obj(swap_p);
         auto loc = object_location{.offset = get_offset(swap_p), .cache = _level};
         if (is_live(object_id{.id = ptr->id}, loc))
         {
            result.num_objects++;
         }
         else
         {
            result.free_bytes += sizeof(object_header) + ptr->data_capacity();
         }
         swap_p = next(swap_p, ptr);
      }
      result.used_bytes = result.total_bytes - result.free_bytes;
      return result;
   }

}  // namespace triedent
