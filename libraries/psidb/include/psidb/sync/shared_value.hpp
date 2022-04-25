#pragma once

#include <atomic>
#include <cstdint>

namespace psidb
{

   /**
    * Stores a variable and allows writers to wait for readers accessing
    * the old state to complete.
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
    * - load_and_lock
    * - If 0, do work
    * - If 1, push work to queue
    * - unlock
    *
    * Exclusive writer:
    * - set queue
    * - store(1)
    * - do work
    * - store(0)
    * - process queue
    *
    */
   struct shared_value
   {
      void init() { _state.store({}, std::memory_order_relaxed); }
      /**
       * Fetches the current value and acquires a shared lock associated with it.
       */
      std::uint8_t load_and_lock()
      {
         auto state = _state.load(std::memory_order_relaxed);
         while (true)
         {
            auto new_state = state;
            // This could use a fetch_add without a loop, if we give up the bitfield syntax
            ++new_state.shared;
            if (_state.compare_exchange_weak(state, new_state, std::memory_order_acquire,
                                             std::memory_order_relaxed))
            {
               return new_state.value;
            }
         }
      }
      /**
       * Releases a shared lock.
       * \pre a shared lock is held for value.
       * Synchronizes with wait if the value has changed since it was locked.
       */
      void unlock(std::uint8_t value)
      {
         auto state = _state.load(std::memory_order_relaxed);
         while (true)
         {
            auto new_state = state;
            if (new_state.value == value)
            {
               --new_state.shared;
            }
            else
            {
               --new_state.prev;
            }
            if (_state.compare_exchange_weak(state, new_state, std::memory_order_release))
            {
               if (new_state.value != value && new_state.prev == 0)
               {
                  _state.notify_all();
               }
               return;
            }
         }
      }
      /**
       * Sets the value.
       * If the new value is the same as any currently locked value, the behavior is undefined.
       * (i.e. don't reuse previous values without calling wait)
       * Synchronizes with load_and_lock that reads the value stored.
       */
      void async_store(std::uint8_t value)
      {
         auto state = _state.load(std::memory_order_relaxed);
         while (true)
         {
            auto new_state = state;
            if (new_state.value == value)
            {
               return;
            }
            new_state.prev += new_state.shared;
            new_state.shared = 0;
            new_state.value  = value;
            if (_state.compare_exchange_weak(state, new_state, std::memory_order_release))
            {
               break;
            }
         }
      }

      /**
       * Blocks until there is only one active value.
       */
      void wait()
      {
         auto state = _state.load(std::memory_order_acquire);
         while (state.prev != 0)
         {
            _state.wait(state);
            state = _state.load(std::memory_order_acquire);
         }
      }

      void store(std::uint8_t value)
      {
         async_store(value);
         wait();
      }

     private:
      struct state_type
      {
         unsigned shared : 12;
         unsigned prev : 12;
         unsigned value : 8;
      };
      std::atomic<state_type> _state;
   };

}  // namespace psidb
