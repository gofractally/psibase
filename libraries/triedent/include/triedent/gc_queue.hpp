#pragma once

#include <atomic>
#include <cassert>
#include <condition_variable>
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
      explicit gc_queue(std::size_t max_size)
          : _end(0), _size(0), _queue(max_size + 1), _waiting{false}
      {
      }
      // A single session may not be accessed concurrently
      class session
      {
        public:
         explicit session(gc_queue&);
         ~session();
         void lock();
         void unlock();

        private:
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

      // Removes some elements from the queue. Blocks until at least
      // one element is removed.
      void run();

     private:
      auto      make_sequence_order(size_type end);
      size_type next(size_type pos);
      // requires _queue_mutex to be locked
      void do_run(size_type start, size_type end);
      // If any session is locking start, sets _waiting and ensures
      //   that there is a session that will notify _queue_cond.
      // returns the lowest sequence that is locked
      size_type start_wait(size_type start, size_type end);
      // Indicates an unlocked session
      static constexpr size_type npos = ~size_type(0);
      // At most one locked session has its wait_bit set.
      // If waiting is true, then a session will eventually
      // notify _queue_cond.
      static constexpr size_type wait_bit = ~(npos >> 1);
      friend class session;
      std::mutex                         _session_mutex;
      std::vector<session*>              _sessions;
      std::mutex                         _queue_mutex;
      std::condition_variable            _queue_cond;
      std::atomic<size_type>             _end;
      std::size_t                        _size;
      std::vector<std::shared_ptr<void>> _queue;
      bool                               _waiting;
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
      while (true)
      {
         assert(_sequence.load() == npos);
         // if the second load sees the value written by P or a later push, then P happens before L
         // if the second load sees a value written by an earlier push, then
         // - the second load is before P in seq_cst
         // - the store is sequenced before the second load
         // - P happens before W (by definition)
         // - therefore the store is before W in seq_cst (store < load2 < P < W)
         //
         // Therefore, if W is before store in seq_cst, then P happens before L
         auto val = _queue->_end.load();
         _sequence.store(val);
         if (_queue->_end.load() == val)
         {
            return;
         }
         unlock();
      }
   }
   inline void gc_queue::session::unlock()
   {
      auto value = _sequence.exchange(npos);
      assert(value != npos);
      if (value & wait_bit)
      {
         {
            std::lock_guard l{_queue->_queue_mutex};
            assert(_queue->_waiting);
            _queue->_waiting = false;
         }
         _queue->_queue_cond.notify_all();
      }
   }
}  // namespace triedent
