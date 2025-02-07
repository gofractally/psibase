#pragma once
#include <string_view>
#include <arbtrie/xxh32.hpp>

namespace arbtrie {

   // designed to fit within 4096 bytes with other header information
   // so msync the page doesn't waste data.
   static constexpr const uint32_t num_top_roots = 488;

   /**
    * This will slow down performance, but ensures the checksum should
    * be accurate at all times. If this is not set, the checksum will
    * be zeroed on modify until a later point (eg. compaction, or setroot)
    * chooses to update it.
    */
   static constexpr const bool update_checksum_on_modify     = false;

   static constexpr const bool use_binary_nodes = true;
   /**
    *  Checksum's are deferred until just before msync so that data
    *  at rest always has a checksum. The idea is that until the user
    *  chooses to flush to disk there is no gaurantee that the data
    *  will survivie a hardware crash.
    */
   static constexpr const bool update_checksum_on_msync      = false and not update_checksum_on_modify;
   static constexpr const bool update_checksum_on_compact    = true and not update_checksum_on_modify;
   static constexpr const bool validate_checksum_on_compact  = true; 

   static_assert( not (update_checksum_on_msync and update_checksum_on_modify) );
   static_assert( not (update_checksum_on_compact and update_checksum_on_modify) );

   static constexpr const uint64_t MB = 1024ull*1024ull;
   static constexpr const uint64_t GB = 1024ull * MB;
   static constexpr const uint64_t TB = 1024ull * GB;

   static constexpr const uint32_t cacheline_size = 64;


   /**
    *  Certain parameters depend upon reserving space for eventual growth
    *  of the database. 
    */
   static constexpr const uint64_t max_database_size = 8 * TB; 

   /**
    * This impacts the number of reference count bits that are reserved in case
    * all threads attempt to increment one atomic variable at the same time and
    * overshoot.  This would mean 32 cores all increment the same atomic at
    * the same instant before any core can realize the overshoot and subtract out.
    *
    * The session allocation algo uses a 64 bit atomic to alloc session numbers,
    * so going beyond 64 would require a refactor of that code.
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
   // the segment size impacts the largest possible value
   // to be stored, which can be no larger than 50% of the
   // segment size.
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
   // allocated has already been freed? 
   //
   // each thread will have a segment this size, so larger values
   // may use more memory than necessary for idle threads
   // max value: 4 GB due to type of segment_offset
   static constexpr const uint64_t segment_size = 32*MB;

   static_assert( segment_size < 4*GB, "size must be less than 4GB" );
   static_assert( std::popcount(segment_size) == 1, "size must be power of 2" );

   // the number of empty bytes allowed in a segment before it gets
   // compacted
   static constexpr const uint64_t segment_empty_threshold = segment_size/2;
   static_assert( segment_empty_threshold < segment_size );
                                                            
   // the maximum value a node may have
   static constexpr const uint64_t max_value_size = segment_size / 2;
   static_assert( max_value_size <= segment_size/2 );

   // more than 1024 and the bit fields in nodes need adjustment
   static constexpr const uint16_t max_key_length = 1024; 
   static_assert( max_key_length <= 1024 );
                                                            
   // the number of branches at which an inner node is automatically
   // upgraded to a full node, a full node has 2 bytes per branch,
   // and a setlist node has 1 byte over head per branch present.
   //
   // At 128 branches, a full node would be 128 bytes larger, but
   // a full node is able to dispatch faster by not having to
   // scane the setlist. 128 represents 2 cachelines in the setlist
   // that must be scanned. Since cacheline loading is one of the
   // major bottlenecks, this number should be a multiple of the
   // cacheline size so no loaded memory is wasted. 
   //
   // In practice 128 was found to be a good speed/space tradeoff. 
   static constexpr const int full_node_threshold = 128;

   static constexpr const uint64_t binary_refactor_threshold = 4096;
   static constexpr const uint64_t binary_node_max_size  = 4096; // 1 page
   static constexpr const int      binary_node_max_keys  = 254; /// must be less than 255
   static_assert( binary_refactor_threshold <= binary_node_max_size );

   // initial space reserved for growth in place, larger values
   // support faster insertion, but have much wasted space if your
   // keys are not dense.
   static constexpr const int      binary_node_initial_size = 2048;

   // extra space reserved for growth in place
   static constexpr const int      binary_node_initial_branch_cap = 64;

   static_assert( binary_node_max_keys < 255);

   using byte_type      = char;
   using key_view       = std::string_view;
   using value_view     = std::string_view;
   using segment_offset = uint32_t;
   using segment_number = uint64_t;


   struct recover_args
   {
      bool validate_checksum = false;
      bool recover_unsync    = false;
   };

   struct config_state {
        int64_t  max_database_size = arbtrie::max_database_size;
        uint32_t max_threads = arbtrie::max_threads;
        uint32_t cacheline_size = arbtrie::cacheline_size;
        uint32_t id_page_size = arbtrie::id_page_size;
        uint32_t segment_size = arbtrie::segment_size;
        uint32_t max_key_length = arbtrie::max_key_length;
   };
   inline const std::uint32_t file_magic = ([](){
      static constexpr const config_state state;
      char buffer[sizeof(state)];
      std::memcpy( buffer, &state, sizeof(state) );
      return xxh32::hash( buffer, sizeof(state), 0 );
   })();
}
