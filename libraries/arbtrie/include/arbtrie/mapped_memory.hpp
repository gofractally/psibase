#pragma once 
#include <arbtrie/config.hpp>

namespace arbtrie {

   /// index into meta[free_segment_index]._free_segment_number
   using free_segment_index = uint64_t;

   // types that are memory mapped
   namespace mapped_memory
   {

      // meta data about each segment,
      // stored in an array in allocator_header indexed by segment number
      // data is reconstructed on crash recovery and not synced
      struct segment_meta
      {
         // returns the free space in bytes, and number of objects freed
         std::pair<uint32_t, uint32_t> get_free_space_and_objs() const
         {
            uint64_t v = _free_space_and_obj.load(std::memory_order_relaxed);
            return std::make_pair(v >> 32, v & 0xffffffff);
         }

         // notes that an object of size was freed
         void free_object(uint32_t size)
         {
            uint64_t so = size;
            so <<= 32;
            so += 1;
            _free_space_and_obj.fetch_add(so, std::memory_order_relaxed);
         }

         // doesn't increment object count
         void free(uint32_t size)
         {
            uint64_t so = size;
            so <<= 32;
            _free_space_and_obj.fetch_add(so, std::memory_order_relaxed);
         }

         void clear()
         {
            _free_space_and_obj.store(0, std::memory_order_relaxed);
            _last_sync_pos.store(segment_size, std::memory_order_relaxed);
         }

         /// the total number of bytes freed by swap
         /// or by being moved to other segments.
         std::atomic<uint64_t> _free_space_and_obj;
         std::atomic<uint64_t> _last_sync_pos;  // position of alloc pointer when last synced
      };

      /// should align on a page boundary
      struct segment_header
      {
         // the next position to allocate data, only
         // used by the thread that owns this segment and
         // set to uint64_t max when this segment is ready
         // to be marked read only to the seg_allocator
         std::atomic<uint32_t> _alloc_pos = 64;  // sizeof(segment_header)
         uint32_t              _age;  // every time a segment is allocated it is assigned an age
             // which aids in reconstruction, newer values take priority over
             // older ones

         /**
          *  This determines the sort-order of the segment in cache based upon
          *  an approximation of the time the data was last read. 
          */
         uint32_t _cache_time;
         // used to calculate object density of segment header,
         // to establish madvise
         // uint32_t _num_objects = 0;  // inc on alloc
         uint32_t _checksum = 0;
      };
      static_assert(sizeof(segment_header) <= 64);

      /**
        * The data stored in the alloc header is not written to disk on sync
        * and may be in a corrupt state after a hard crash. All values contained
        * within the allocator_header must be reconstructed from the segments
       */
      struct allocator_header
      {
         // when no segments are available for reuse, advance by segment_size
         alignas(64) std::atomic<segment_offset> alloc_ptr;    // A below
         alignas(64) std::atomic<free_segment_index> end_ptr;  // E below

         // set to 0 just before exit, set to 1 when opening database
         std::atomic<bool>     clean_exit_flag;
         std::atomic<uint32_t> next_alloc_age = 0;

         // meta data associated with each segment, indexed by segment number
         segment_meta seg_meta[max_segment_count];

         // circular buffer described, big enough to hold every
         // potentially allocated segment which is subseuently freed.
         //
         // |-------A----R1--R2---E-------------| max_segment_count
         //
         // A = alloc_ptr where recycled segments are used
         // R* = session_ptrs last known recycled segment by each session
         // E = end_ptr where the next freed segment is posted to be recycled
         // Initial condition A = R* = E = 0
         // Invariant A <= R* <= E unless R* == -1
         //
         // If A == min(R*) then we must ask block_alloc to create a new segment
         //
         // A, R*, and E are 64 bit numbers that count to infinity, the
         // index in the buffer is A % max_segment_count which should be
         // a simple bitwise & operation if max_segment_count is a power of 2.
         // The values between [A-E) point to recyclable segments assuming no R*
         // is present. Values before A or E and after point to no valid segments
         segment_number free_seg_buffer[max_segment_count];
      };

      /// crash recovery:
      /// 1. scan all segments to find those that were mid-allocation:
      ///    if a lot of free space, then swap them and push to free seg buffer
      /// 2. Update reference counts on all objects in database
      /// 3. ? pray ?

   }  // namespace mapped_memory

}
