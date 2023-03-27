#pragma once

#include <triedent/debug.hpp>

#include <atomic>
#include <cassert>
#include <condition_variable>
#include <cstdint>
#include <memory>
#include <mutex>
#include <vector>

namespace triedent
{
   // gc_queue is a utility to ensure correct cleanup of resources that are part
   // of a single shared state. Cleanup of resources is correct when every access
   // to a resource happens before that resource is destroyed.
   //
   // Resources should be cleaned up using the following process:
   // - Remove references to the resource from the shared state
   // - Push the resource onto the queue
   //
   // Resources should be accessed as follows:
   // - lock a session
   // - access resources from the shared state
   // - unlock the session
   //
   // The gc_queue guarantees that an element pushed onto the queue will
   // not be destroyed until all session locks that were active at the
   // time of the push are released.
   //
   // Given
   //   - L and U are pair of calls to lock/unlock for a session
   //   - P is the call to push(element)
   //   - D is the destructor of element
   // Then gc_queue guarantees that:
   //   - Either P happens before L or U happens before D.
   //
   // Both cases guarantee correctness:
   // - If P happens before L, then the resource has been removed from the
   //   shared state, and therefore will not be accessed.
   // - If U happens before D, then the access happens before the destructor
   //   and is therefore safe.
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
      // Items are NOT guaranteed to be destroyed in order
      //
      // \pre The thread calling push MUST NOT hold a lock on any associated session.
      void push(std::shared_ptr<void> element);
      // Removes some elements from the queue.
      //
      // \pre The thread calling poll MUST NOT hold a lock on any associated session.
      void poll();

      // Clears the queue
      // \pre There are no active sessions
      void flush();

      // Processes the queue until done becomes true
      void run(std::atomic<bool>* done);

      // Wakes up threads that are blocked in run
      void notify_run();

     private:
      auto      make_sequence_order(size_type end);
      size_type next(size_type pos);
      // requires _queue_mutex to be locked
      void pop_some(std::vector<std::shared_ptr<void>>& out, size_type start, size_type end);
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
         // Let P be the push for some resource
         // Let L be the second load here (the first load is speculative)
         // Let W be the read of _sequence by a call to wait that is after P
         //
         // (Note: wait and push are both protected by the same mutex,
         // and are therefore totally ordered. A call to wait cannot
         // possibly destroy a resource that has not been pushed yet)
         //
         // (1) If L sees the value written by P or a later push, P happens before L (acquire/release)
         // (2) If L sees the value written by an earlier push,
         // (3)    - L is before P in seq_cst (seq_cst load sees the most recent seq_cst store)
         // (4)    - The store is sequenced before L
         // (5)    - P happens before W (by definition)
         // (6)    - therefore the store is before W in seq_cst (store < L < P < W)
         //
         // Therefore if W is before the store in seq_cst, then P happens before L (denying (6) implies (1))
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
