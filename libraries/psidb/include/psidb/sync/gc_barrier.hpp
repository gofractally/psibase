#pragma once

#include <atomic>

namespace psidb
{

   /**
    * This class is used to ensure that the garbage collector
    * does not release memory that is being accessed by any thread.
    *
    * Usage in reader threads:
    * lock/unlock the barrier around all accesses to memory controlled
    * by the barrier.  Coarse grained locking is preferable as long as
    * the lock is released in bounded time.  Readers do not block each other.
    *
    * Usage in the garbage collector:
    * - unlink page
    * - start
    * - wait
    * - page is now safe to reuse
    *
    * Thread safety overview:
    * - start/wait must not be called concurrently
    * - lock/unlock may be called concurrently
    *
    * Synchronization details:
    * - There is a total ordering of all calls to start/wait/try_wait/lock/unlock
    *   on a particular gc_barrier object
    * - start synchronizes with lock
    * - unlock synchronizes with wait or a successful try_wait
    * - Every unlock must be paired with a previous lock
    * - Every successful wait must be paired with a previous start
    * - Start and successful wait must strictly alternate.  Failed try_wait
    *   must happen between a start and the corresponding successful wait
    * - If a lock happens before a start, then the corresponding unlock
    *   happens before the corresponding successful wait
    * - wait may block.  start/try_wait/lock/unlock do not block
    *
    * Implementation limits:
    * - If there are more than 4095 concurrent locks, the behavior is undefined.
    */
   struct gc_barrier
   {
      /**
       * Starts a new active cycle of the barrier.
       *
       * \pre The barrer must be inactive
       * \post The barrier is active
       */
      void start()
      {
         auto state = _state.load(std::memory_order_relaxed);
         while (true)
         {
            auto new_state      = state;
            new_state.remaining = state.active;
            ++new_state.version;
            if (_state.compare_exchange_weak(state, new_state, std::memory_order_release,
                                             std::memory_order_relaxed))
            {
               return;
            }
         }
      }
      /**
       * Polls the barrier for completion of the current active cycle.
       *
       * \pre The barrier must be active
       * \return true if the barrier transitioned to inactive, false otherwise
       */
      bool try_wait()
      {
         auto state = _state.load(std::memory_order_acquire);
         return state.remaining == 0;
      }
      /**
       * Blocks until the current active cycle is complete.
       *
       * \pre The barrier must be active
       * \post The barrier is inactive
       */
      void wait()
      {
         auto state = _state.load(std::memory_order_acquire);
         while (state.remaining != 0)
         {
            _state.wait(state, std::memory_order_relaxed);
            state = _state.load(std::memory_order_acquire);
         }
      }
      class scoped_lock;
      friend class scoped_lock;
      class scoped_lock
      {
        public:
         scoped_lock(gc_barrier& parent) : _parent(parent), _version(parent.lock()) {}
         ~scoped_lock() { parent.unlock(version); }

        private:
         scoped_lock(const scoped_lock&) = delete;
         gc_barrier& parent;
         unsigned    _version;
      };

     private:
      unsigned lock()
      {
         auto state = barrier.load(std::memory_order_acquire);
         while (true)
         {
            auto new_state = state;
            new_state.active++;
            auto saved = state.version;
            if (barrier.compare_exchange_weak(state, new_state, std::memory_order_relaxed,
                                              std::memory_order_acquire))
            {
               return saved;
            }
         }
      }
      void unlock(unsigned prev_version)
      {
         auto state = _state.load(std::memory_order_relaxed);
         while (true)
         {
            auto new_state = state;
            --new_state.active;
            bool should_notify = false;
            if (new_state.version != prev_version)
            {
               --new_state.remaining;
               should_notify = true;
            }
            if (barrier.compare_exchange_weak(state, new_state, std::memory_order_release,
                                              std::memory_order_relaxed))
            {
               if (should_notify)
               {
                  _state.notify_one();
               }
               return;
            }
         }
      }
      // invariants: remaining == the number of threads that had the mutex locked
      // when the barrier was triggered and have not have not yet unlocked.
      struct barrier_state
      {
         unsigned active : 12;
         unsigned remaining : 12;
         unsigned version : 1;
         unsigned reserved : 7;
      };
      std::atomic<barrier_state> _state{{0, 0, 0, 0}};
   };

   // Per transaction state to reduce contention
   // Not implemented yet
   class trx_gc_barrier
   {
     public:
      explicit trx_gc_barrer(gc_barrier& parent) : _parent(parent) {}
      using scoped_lock = gc_barrier::scoped_lock;
      operator gc_barrier&() { return _parent; }

     private:
      gc_barrier& _parent;
   };

}  // namespace psidb
