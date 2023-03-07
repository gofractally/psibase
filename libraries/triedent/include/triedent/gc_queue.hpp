#pragma once

#include <atomic>
#include <cstdint>
#include <memory>
#include <mutex>
#include <vector>

namespace triedent
{
   // gc_queue serializes cleanup of various data structures.
   //
   // Intended Usage:
   // - Each thread should have its own session.
   // - All accesses to a resource should be wrapped in lock/unlock.
   //   Pointers must not be retained after unlock.
   // - When removing a resource, first remove all references to it,
   //   then push it onto the queue.
   //
   // An element pushed onto the queue will not be destroyed until
   // all active locks are released.
   //
   // Formally,
   //
   // Given
   //   - L and U are pair of calls to lock/unlock for a session
   //   - P is the call to push(element)
   //   - D is the destructor of element
   // Then gc_queue guarantees that:
   //   Either U happens before D or P happens before L
   class gc_queue
   {
      using size_type = std::uint32_t;

     public:
      explicit gc_queue(std::size_t max_size) : _end(0), _size(0), _queue(max_size + 1) {}
      // A single session may not be accessed concurrently
      class session
      {
        public:
         explicit session(gc_queue&);
         ~session();
         void lock();
         void unlock();

        private:
         size_type wait(size_type value);
         friend class gc_queue;
         std::atomic<size_type> _sequence;
         gc_queue*              _queue;
      };
      // Pushes an element onto the queue. The queue will retain a copy
      // of the shared pointer until it is safe to destroy.
      //
      // push may block if the queue is full.
      //
      // \pre The destructor of element MUST NOT call any member of
      //      this gc_queue or any associated session.
      // \pre The thread calling push MUST NOT hold a lock on any associated session.
      void push(std::shared_ptr<void> element);
      // Removes some elements from the queue.
      //
      // \pre The thread calling poll MUST NOT hold a lock on any associated session.
      void poll();

     private:
      auto      make_sequence_order(size_type end);
      size_type next(size_type pos);
      // requires _queue_mutex to be locked
      void do_run(size_type start, size_type end);
      // blocks until no sessions are locking start
      // returns the lowest lock.
      size_type                  wait(size_type start, size_type end);
      static constexpr size_type npos     = ~size_type(0);
      static constexpr size_type wait_bit = ~(npos >> 1);
      friend class session;
      std::mutex                         _session_mutex;
      std::vector<session*>              _sessions;
      std::mutex                         _queue_mutex;
      std::atomic<size_type>             _end;
      std::size_t                        _size;
      std::vector<std::shared_ptr<void>> _queue;
   };

   using gc_session = gc_queue::session;

   template <typename T>
   class relocker
   {
     public:
      relocker(std::unique_lock<T>& l) : _lock(l) { _lock.unlock(); }
      ~relocker() { _lock.lock(); }

     private:
      std::unique_lock<T>& _lock;
   };

   template <bool UniqueLock>
   struct session_lock_impl
   {
      using type = session_lock_impl;
      session_lock_impl(std::unique_lock<gc_queue::session>&) {}
      session_lock_impl(std::lock_guard<gc_queue::session>&) {}
   };

   template <>
   struct session_lock_impl<true>
   {
      using type = std::unique_lock<gc_queue::session>&;
   };

   template <bool UniqueLock = false>
   using session_lock_ref = typename session_lock_impl<UniqueLock>::type;

   inline void gc_queue::session::lock()
   {
      _sequence.store(_queue->_end.load());
   }
   inline void gc_queue::session::unlock()
   {
      auto value = _sequence.load();
      bool notify;
      do
      {
         notify = value & wait_bit;
      } while (!_sequence.compare_exchange_weak(value, npos));
      if (notify)
      {
         _sequence.notify_one();
      }
   }
}  // namespace triedent
