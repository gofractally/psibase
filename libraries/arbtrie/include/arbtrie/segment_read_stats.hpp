#pragma once
#include <arbtrie/size_weighted_age.hpp>
namespace arbtrie
{
   /**
    * Each session maintains a count of the total size of all
    * objects that they set the read bit to true on. This is so
    * that one read session does not interfer with the counts on
    * other read sessions.
    *
    * For each segment we need to maintain:
    * 1. weighted average time of reads
    * 2. total cachelines read
    *
    *
    * The compactor will iterate over all sessions and sum the
    * total read bytes of all segments from time to time. 
    *
    * The compactor will do an atomic exchange restoring the count
    * to 0
    */
   struct segment_read_stat
   {

      /*
      uint32_t bytes_read(uint32_t segment_num) const
      {
         auto& atom = _stats[segment_num / 3];
         // memory order relaxed can be used because no other memory
         // is being synchronized on this.
         auto group       = atom.load(std::memory_order_relaxed);
         auto cache_lines = (group >> 21 * (segment_num % 3)) & 0x1fffff;
         return cache_lines * cacheline_size;
      }
      */

      uint64_t total_bytes_read() const { return _total.load(std::memory_order_relaxed); }

      /**
       *  Records that a certian number of bytes have been read and when
       */
      void read_bytes(uint32_t segment_num, uint32_t bytes, int64_t time)
      {
         uint64_t clines = (bytes + (cacheline_size-1))/cacheline_size;

         auto expected = _stats[segment_num].load(std::memory_order_relaxed);
         auto updated  = size_weighted_age(expected).update(clines, time).to_int();
         while (not _stats[segment_num].compare_exchange_weak(expected, updated,
                                                              std::memory_order_relaxed))
            updated = size_weighted_age(expected).update(clines, time).to_int();

         _total.fetch_add(clines, std::memory_order_relaxed);
      }

      void set_age_weight( uint32_t seg, size_weighted_age v ) {
         _stats[seg].store( std::bit_cast<uint64_t>(v), std::memory_order_relaxed );
      }
      size_weighted_age get_age_weight( uint32_t seg ) {
         assert( seg < max_segment_count );
         return std::bit_cast<size_weighted_age> (_stats[seg].load(std::memory_order_relaxed) );
      }

      /**
       * adds the data from other into this and clears other, the compactor
       * thread will accumulate the read stats from all other threads.
       */
      segment_read_stat& accumulate(segment_read_stat& other, uint32_t num)
      {
         static_assert(segment_size / cacheline_size <= (1 << 21));
         assert(num <= _stats.size());

         if (other.total_bytes_read() == 0)
            return *this;

         auto* opos = other._stats.data();
         auto* oend = opos + num;
         auto* mpos = _stats.data();

         uint64_t tlines = 0;

         while (opos != oend)
         {
            size_weighted_age insd( opos->exchange(0, std::memory_order_relaxed) );
            tlines += insd.read_cl;

            auto expected = mpos->load(std::memory_order_relaxed);
            auto updated = size_weighted_age(expected).update( insd.read_cl, insd.time_ms ).to_int();

            while (not mpos->compare_exchange_weak(expected, updated,
                                                                 std::memory_order_relaxed))
               updated = size_weighted_age(expected).update( insd.read_cl, insd.time_ms ).to_int();

            ++opos;
            ++mpos;
         }
         other._total.fetch_sub(tlines, std::memory_order_relaxed);
         return *this;
      }

     private:
      std::atomic<uint64_t>                                _total;
      std::array<std::atomic<uint64_t>, max_segment_count> _stats;
   };
}  // namespace arbtrie
