#pragma once

#include <atomic>

namespace psidb
{

   /**
    * Maintains a set of lock pools.  Allows acquiring shared lock in the current pool.
    *
    * This is intended for conflict detection in a single exclusive
    * writer / multiple shared writer scenario.  The exclusive writer
    * can switch pools to shunt the shared writers into an alternate
    * implementation.
    *
    * Example usage (and primary motivation):
    *
    * push data to a queue on conflict using the following algorithm
    *
    * Shared writer:
    * - lock_shared
    * - If pool 0, do work
    * - If pool 1, push work to queue
    * - unlock shared
    *
    * Exclusive writer:
    * - set queue
    * - set_pool(1)
    * - do work
    * - set_pool(0)
    * - process queue
    *
    */
   struct shared_pool_mutex
   {
      /**
       * Acquires a shared lock and returns the current pool
       */
      unsigned lock_shared()
      {
         auto state = _state.load(std::memory_order_acquire);
         while (true)
         {
            auto new_state = state;
            // This could use a fetch_add without a loop, if we give up the bitfield syntax
            ++new_state.shared if (_state.compare_exchange_weak(state, new_state,
                                                                std::memory_order_acq_rel))
            {
               return new_state.pool;
            }
         }
      }
      /**
       * \pre a shared lock is held for pool.
       */
      void unlock_shared(unsigned pool)
      {
         auto state = _state.load(std::memory_order_acquire);
         while (true)
         {
            auto new_state = state;
            if (new_state.pool == pool)
            {
               --new_state.shared;
            }
            else
            {
               --new_state.prev;
            }
            if (_state.compare_exchange_weak(state, new_state, std::memory_order_acq_rel))
            {
               if (new_state.pool != pool && new_state.prev == 0)
               {
                  _state.notify_all();
               }
               return;
            }
         }
      }
      /**
       * Sets the current pool and blocks until no threads remain the in old pool.
       * Might not block if the new pool is the same as the old one.
       * If there are multiple concurrent calls to set_pool(), it is unspecified
       * which one is the last one set.
       */
      void set_pool(unsigned pool)
      {
         assert(pool < 256 && "Only allow 256 pools");
         auto state = _state.load(std::memory_order_acquire);
         while (true)
         {
            auto new_state = state;
            if (new_state.prev != 0)
            {
               // Another thread is in set_pool, we don't care
               // which one wins, as long as we don't return before
               // the previous pool is cleared out.
               break;
            }
            if (new_state.pool == pool)
            {
               return;
            }
            new_state.prev   = new_state.shared;
            new_state.shared = 0;
            new_state.pool   = pool;
            if (_state.compare_exchange_weak(state, new_state, std::memory_order_acq_rel))
            {
               break;
            }
         }
         while (state.prev != 0)
         {
            _state.wait(new_state);
            state = _state.load(std::memory_order_acquire);
         }
      }

     private:
      struct state_type
      {
         unsigned shared : 12;
         unsigned prev : 12;
         unsigned pool : 8;
      };
      std::atomic<state_type> _state;
   };

}  // namespace psidb
