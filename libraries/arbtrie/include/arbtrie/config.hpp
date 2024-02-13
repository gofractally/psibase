#pragma once
#include <string_view>

namespace arbtrie {

   static constexpr const uint32_t num_top_roots = 488;

   static constexpr const uint64_t MB = 1024ull*1024ull;
   static constexpr const uint64_t GB = 1024ull * MB;
   static constexpr const uint64_t TB = 1024ull * GB;

   static constexpr const int cacheline_size = 64;

   /**
    *  Certain 
    */
   static constexpr const uint64_t max_database_size = 64 * TB; 

   /**
    * This impacts the number of reference count bits that are reserved in case
    * all threads attempt to increment one atomic variable at the same time and
    * overshoot.  This would mean 32 cores all increment the same atomic at
    * the same instant before any core can realize the overshoot and subtract out.
    *
    * The session allocation algo uses a 64 bit atomic to alloc session numbers,
    * so going beyond 64 would require a refactor of thatcode.
    */
   static constexpr const uint32_t max_threads = 64;

   /**
    * Each ID region can store 512 IDs before the ID
    * file needs to grow becuase each ID takes 8 bytes, making
    * this larger grows the minimum meta_index size by
    * 2^16 * id_page_size.  
    *
    * id_page_size of 4096 means 256MB minimum node_meta index size
    * that grows in increments of 256MB
    *
    * Each node must allocate all of their children into
    * the same region, so that means up to 256 children or
    * 2 full nodes will fill one page.  
    *
    * For this reason it is critical that nodes be evenly
    * spread across all regions to prevent premature growth to
    * 512MB or more just because one region is too dense.
    */
   static constexpr const uint32_t id_page_size = 4096;

   // must be a power of 2
   // size of the data segments file grows
   //
   // the smaller this value, the more overhead there is in
   // searching for segments to compact and the pending 
   // free queue. 
   //
   // the larger this value the longer the stall when things
   // need to grow, but stalls happen less frequently. Larger
   // values also mean it takes longer to reclaim free space because
   // free space in an allocating segment cannot be reclaimed until
   // the allocations reach the end.  TODO: should the allocator 
   // consider abandoing a segment early if much of what has been
   // allocated has already been freed? This may improve cache-locality
   // by not needing to load in the rest of the segment.
   //
   // each thread will have a segment this size, so larger values
   // may use more memory than necessary for idle threads
   // max value: 4 GB due to type of segment_offset
   static constexpr const uint64_t segment_size = 128*MB;

   // the number of empty bytes allowed in a segment before it gets
   // compacted
   static constexpr const uint64_t segment_empty_threshold = segment_size/2;
   static_assert( segment_empty_threshold < segment_size );
                                                            
   // the maximum value a node may have
   static constexpr const uint64_t max_value_size = segment_size / 2;

   // more than 1024 and the bit fields in nodes need adjustment
   static constexpr const uint16_t max_key_length = 1024; 
   static_assert( max_key_length <= 1024 );
                                                            
   // the number of branches at which an inner node is automatically
   // upgraded to a full node
   static constexpr const int full_node_threshold = 128;

   static constexpr const uint64_t binary_refactor_threshold = 4096;
   static constexpr const uint64_t binary_node_max_size  = 4096;
   static constexpr const int      binary_node_max_keys  = 253; /// must be less than 255
   static constexpr const int      binary_node_initial_size = 2048;
   static constexpr const int      binary_node_initial_branch_cap = 64;

   using key_view       = std::basic_string_view<uint8_t>;
   using value_view     = std::basic_string_view<uint8_t>;
   using segment_offset = uint32_t;
   using segment_number = uint64_t;

   struct recover_args
   {
   //   recover_args() noexcept : validate_checksum(false), recover_unsync(false){};
      bool validate_checksum = false;
      bool recover_unsync    = false;
   };
}
