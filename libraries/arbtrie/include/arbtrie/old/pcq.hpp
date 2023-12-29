#pragma once
#include <memory>
#include <bit>

#include <iostream>

namespace triedent
{

   template <typename T>
   class pcqueue
   {
     public:
      pcqueue() : ready(0), set(0), next(0) {}

      bool enqueue(T v)
      {
         std::unique_lock ul(_qm);
         queue.push_back(v);
         return true;

         // don't attempt to increment if already backed up
         if( not ~ready.load(std::memory_order_relaxed) ) {
            return false;
         }

         const auto slot = next.fetch_add(1, std::memory_order_relaxed) & (64 - 1);

         // signal to other producers to detect a wrap of 64
         auto reserved = ready.fetch_or(1ull << slot, std::memory_order_relaxed);
         if (reserved & (1ull << slot))
         {
            return false;  // queue is backed up
         }
         data[slot] = std::move(v);

         // memory order release so that data[slot] is synchronzied with consumer
         set.fetch_or(1 << slot, std::memory_order_release);
         return true;
      }

      //std::optional<T> deque()
      std::vector<T> deque()
      {
         std::unique_lock ul(_qm);
         auto r = queue;
         queue.resize(0);
         return r;

         /*
         if( queue.size() )
         {
            auto r = queue.back();
            queue.pop_back();
            return r;
         }
         return std::optional<T>();

         uint64_t setbits = set.load(std::memory_order_acquire);
         if (not setbits)
            return std::optional<T>();
         const auto slot = std::countr_zero(setbits);
         auto       tmp  = std::move(data[slot]);
         ready.fetch_and(~(1ull << slot), std::memory_order_relaxed);
         set.fetch_and(~(1ull << slot), std::memory_order_relaxed);
         ++consumed;
         return tmp;
         */
      }

      void dump() {
         std::cerr << "next: " << next <<"  consumed: "<<consumed<<"\n";
         std::cerr << "ready: " << std::bitset<64>(ready.load()) <<"\n";
         std::cerr << "set: " << std::bitset<64>(set.load()) <<"\n";
         for( uint32_t i = 0; i < 64 ; ++i ) 
            std::cerr << data[i] <<" ";
         std::cerr<<"\n";
      }

     private:
      std::vector<T> queue;
      std::mutex     _qm;

      std::atomic<uint64_t> ready;
      std::atomic<uint64_t> set;
      std::atomic<uint64_t> next;
      T                     data[64];
      uint64_t              consumed = 0;
   };

}  // namespace triedent
