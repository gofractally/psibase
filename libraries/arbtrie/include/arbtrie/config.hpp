#pragma once

namespace arbtrie {

   static const uint64_t MB = 1024ull*1024ull;
   static const uint64_t GB = 1024ull * MB;
   static const uint64_t TB = 1024ull * GB;
   static const uint64_t max_database_size = 64 * TB; 

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
   static const uint32_t id_page_size = 4096;

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
   static const uint64_t segment_size = 64*MB;
                                                            
   // the maximum value a node may have
   static const uint64_t max_value_size = segment_size / 2;

   // more than 1024 and the bit fields in nodes need adjustment
   static const uint16_t max_key_length = 1024; 
   static_assert( max_key_length <= 1024 );
                                                            
   // the number of branches at which an inner node is automatically
   // upgraded to a full node
   static const int full_node_threshold = 128;

   static const uint64_t binary_refactor_threshold = 4096;
   static const uint64_t binary_node_max_size  = 4096;
   static const uint64_t binary_node_max_keys  = 400;
}
