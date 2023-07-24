#pragma once

#include <triedent/object_fwd.hpp>

#include <algorithm>
#include <atomic>
#include <cassert>
#include <mutex>

namespace triedent
{
   struct location_mutex
   {
     public:
      void lock(object_id id)
      {
         assert(!!id);
         lock();
         while (!insert(id))
         {
            wait();
         }
         unlock();
      }
      bool try_lock(object_id id)
      {
         assert(!!id);
         lock();
         bool result = insert(id);
         unlock();
         return result;
      }
      void unlock(object_id id)
      {
         assert(!!id);
         lock();
         erase(id);
         auto waiting = _waiting;
         unlock();
         if (waiting)
         {
            _wait_seq.fetch_add(1);
            _wait_seq.notify_all();
         }
      }

     private:
      // 0 = free
      // 1 = locked
      // 2 = waiters
      void lock()
      {
         if (_mutex.fetch_add(1))
         {
            while (_mutex.exchange(2))
            {
               _mutex.wait(2);
            }
         }
      }
      void unlock()
      {
         if (_mutex.fetch_sub(1) != 1)
         {
            _mutex.store(0);
            _mutex.notify_one();
         }
      }
      using int_type = std::uint32_t;
      bool insert(object_id id)
      {
         for (auto& locked : _locked_ids)
         {
            if (locked == id)
            {
               return false;
            }
            else if (!locked)
            {
               locked = id;
               return true;
            }
         }
         return false;
      }
      void erase(object_id id)
      {
         auto end = _locked_ids + max_locks;
         auto pos = std::find(_locked_ids, end, id);
         assert(pos != end && "id was not locked");
         std::copy(pos + 1, end, pos);
         end[-1] = object_id{};
      }
      void wait()
      {
         ++_waiting;
         auto val = _wait_seq.load();
         unlock();
         _wait_seq.wait(val);
         lock();
         --_waiting;
      }
      std::atomic<int_type>        _mutex;
      std::atomic<int_type>        _wait_seq;
      std::uint32_t                _waiting = 0;
      static constexpr std::size_t max_locks =
          (64 - sizeof(_waiting) - 2 * sizeof(_mutex)) / sizeof(object_id);
      object_id _locked_ids[max_locks];
   };
   static_assert(sizeof(location_mutex) == 64);

   class location_lock
   {
     public:
      location_lock() : _mutex{nullptr} {}
      location_lock(location_mutex& mutex, object_id id) : _mutex(&mutex), _id(id)
      {
         mutex.lock(id);
      }
      location_lock(location_mutex& mutex, object_id id, std::try_to_lock_t)
          : _mutex(&mutex), _id(id)
      {
         if (!mutex.try_lock(id))
         {
            _mutex = nullptr;
         }
      }
      location_lock(location_lock&& other) : _mutex(other._mutex), _id(other._id)
      {
         other._mutex = nullptr;
      }
      ~location_lock()
      {
         if (_mutex)
         {
            _mutex->unlock(_id);
         }
      }
      explicit  operator bool() const { return !!_mutex; }
      object_id get_id() const { return _id; }

     private:
      location_mutex* _mutex;
      object_id       _id;
   };
}  // namespace triedent
