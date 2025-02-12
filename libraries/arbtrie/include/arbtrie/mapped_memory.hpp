#pragma once
#include <arbtrie/config.hpp>
#include <arbtrie/rdtsc.hpp>
#include <arbtrie/size_weighted_age.hpp>
#include <assert.h>

namespace arbtrie
{

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
         struct state_data
         {
            uint64_t free_space : 26;    // Max 128 MB in bytes
            uint64_t free_objects : 21;  // 128MB / 64 byte cacheline
            uint64_t last_sync_page: 15; // 128MB / 4096 byte pages
            uint64_t is_alloc : 1 = 0;
            uint64_t is_pinned: 1 = 0;

            static_assert( (1 << 26) > segment_size );
            static_assert( (1 << 21) > segment_size / cacheline_size );
            static_assert( (1 << 15) > segment_size / os_page_size );


            uint64_t to_int() const { return std::bit_cast<uint64_t>(*this); }
            explicit state_data(uint64_t x) { *this = std::bit_cast<state_data>(x); }

            state_data& set_last_sync_page( uint32_t page ) {
               assert( page <= segment_size/os_page_size );
               last_sync_page = page;
               return *this;
            }

            state_data& free(uint32_t size)
            {
               assert( size > 0 );
               assert( free_space + size <= segment_size );
               free_space += size;
               return *this;
            }
            state_data& free_object(uint32_t size)
            {
               assert( size > 0 );
               assert( free_space + size <= segment_size );

               free_space += size;
               ++free_objects;
               return *this;
            }
            state_data& set_alloc(bool s)
            {
               is_alloc = s;
               return *this;
            }
            state_data& set_pinned(bool s)
            {
               is_pinned = s;
               return *this;
            }
         };
         static_assert(sizeof(state_data) == sizeof(uint64_t));

         auto get_free_state() const
         {
            return state_data(_state_data.load(std::memory_order_relaxed));
         }

         // returns the free space in bytes, and number of objects freed
         auto get_free_space_and_objs() const
         {
            return get_free_state();
            //  uint64_t v = _free_space_and_obj.load(std::memory_order_relaxed);
            //  return std::make_pair(v >> 32, v & 0xffffffff);
         }

         // notes that an object of size was freed
         void free_object(uint32_t size)
         {
            auto expected = _state_data.load(std::memory_order_relaxed);
            auto updated  = state_data(expected).free_object(size).to_int();
            while (
                not _state_data.compare_exchange_weak(expected, updated, std::memory_order_relaxed))
               updated = state_data(expected).free_object(size).to_int();
            /*
            uint64_t so = size;
            so <<= 32;
            so += 1;
            _free_space_and_obj.fetch_add(so, std::memory_order_relaxed);
            */
         }

         // doesn't increment object count
         void free(uint32_t size)
         {
            auto expected = _state_data.load(std::memory_order_relaxed);
            auto updated  = state_data(expected).free(size).to_int();
            while (
                not _state_data.compare_exchange_weak(expected, updated, std::memory_order_relaxed))
               updated = state_data(expected).free(size).to_int();
         }

         // after allocating 
         void finalize_segment(uint32_t size)
         {
            auto expected = _state_data.load(std::memory_order_relaxed);

            assert( state_data(expected).is_alloc );

            auto updated  = state_data(expected).free(size).set_alloc(false).to_int();
            while (
                not _state_data.compare_exchange_weak(expected, updated, std::memory_order_relaxed))
               updated = state_data(expected).free(size).set_alloc(false).to_int();
         }

         void clear()
         {
            _state_data.store(0, std::memory_order_relaxed);
            //_last_sync_pos.store(segment_size, std::memory_order_relaxed);
            _base_time = size_weighted_age();
         }

         bool is_alloc() { return get_free_state().is_alloc; }
         void set_alloc_state(bool a)
         {
            auto expected = _state_data.load(std::memory_order_relaxed);
            auto updated  = state_data(expected).set_alloc(a).to_int();
            while (
                not _state_data.compare_exchange_weak(expected, updated, std::memory_order_relaxed))
               updated = state_data(expected).set_alloc(a).to_int();
         }


         uint64_t get_last_sync_pos()const {
            return state_data(_state_data.load(std::memory_order_relaxed)).last_sync_page * os_page_size;
         }

         void start_alloc_segment(  ) {
            auto expected = _state_data.load(std::memory_order_relaxed);
            assert( not state_data(expected).is_alloc );
            auto updated = state_data(expected).set_last_sync_page(0).set_alloc(true).to_int();
            assert( state_data(updated).is_alloc );

            while( not _state_data.compare_exchange_weak( expected, updated, std::memory_order_relaxed ) ) 
              updated = state_data(expected).set_last_sync_page(0).set_alloc(true).to_int();
            assert( state_data(updated).is_alloc );
         }

         void set_last_sync_pos( uint64_t pos ) {
            auto page_num = round_down_multiple<4096>(pos)/4096;
            auto expected = _state_data.load(std::memory_order_relaxed);
            auto updated = state_data(expected).set_last_sync_page( page_num ).to_int();
            while( not _state_data.compare_exchange_weak( expected, updated, std::memory_order_relaxed ) ) 
              updated = state_data(expected).set_last_sync_page( page_num ).to_int();
         }

         //std::atomic<uint64_t> _last_sync_pos;  
         // position of alloc pointer when last synced

         /**
          *   As data is written, this tracks the data-weighted
          *   average of time since data without read-bit set
          *   was written. By default this is the average allocation
          *   time, but when compacting data the incoming data may
          *   provide an alternative time to be averaged int. 
          *
          *   - written by allocator thread
          *   - read by compactor after allocator thread is done with segment
          *
          *   - sharing cacheline with _free_space_and_obj which is
          *     written when data is freed which could be any number of
          *     threads.
          *
          *   - not stored on the segment_header because compactor
          *   iterates over all segment meta and we don't want to 
          *   page in from disk segments just to read this time.
          *
          *   TODO: must this be atomic?
          */
         size_weighted_age _base_time;

         /// the total number of bytes freed by swap
         /// or by being moved to other segments.
         std::atomic<uint64_t> _state_data;

         // the avg time in ms between reads
         uint64_t read_frequency(uint64_t now = size_weighted_age::now())
         {
            return now - _base_time.time_ms;
         }
      };

      /// should align on a page boundary
      struct segment_header
      {
         uint32_t get_alloc_pos()const { return _alloc_pos.load(std::memory_order_relaxed); }

         // the next position to allocate data, only
         // used by the thread that owns this segment and
         // set to uint64_t max when this segment is ready
         // to be marked read only to the seg_allocator
         std::atomic<uint32_t> _alloc_pos = 64;  // aka sizeof(segment_header)

         // every time a segment is allocated it is assigned an age
         // which aids in reconstruction, newer values take priority over older ones
         uint32_t _age;

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

}  // namespace arbtrie
