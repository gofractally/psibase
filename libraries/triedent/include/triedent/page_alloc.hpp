#pragma once
#include <triedent/object_db.hpp>

namespace triedent {

   class page_allocator {
      struct alloc_region {
         std::atomic<uint64_t> alloc_p;
         std::atomic<uint64_t> end_p;

         uint64_t free_space()const {
            return end_p.load( std::memory_order_relaxed ) - alloc_p.load(std::memory_order_relaxed);
         }

         alignas(64)std::atomic<uint64_t> logical_swap_p; /// when this can be marked free
         std::atomic<uint32_t>            page_num;    
      };

      struct header {
         std::atomic<uint64_t>  free_pages[64]; // 1 bit per 1GB page for 4TB 
         std::atomic<uint32_t>  free_space_per_page[64*64];      
         std::atomic<uint64_t>  swap_p_per_page[64*64];      

         // increases every time a new free page is allocated for either swap or compact
         std::atomic<uint64_t>  swap_p; // logical swap ptr, monotonically increasing

         alloc_region swap_region;
         alloc_region compact_region;
      };

      char* _base_ptr = nullptr;

      // this thread tracks stats to help the compactor identify 
      // the pages with the most empty space
      void free( object_header* obj ) {
         auto absp = ((char*)obj - _base_ptr) - sizeof(header);
         auto page_num = absp / page_size; /// TODO: use mask instead of divide
         free_space_per_page[page_num].fetch_add( obj->data_capacity() + sizeof(object_header), std::memory_order_relaxed );
      }
   
      // called from swap thread to move from cool to cold, swap thread is responsible for
      // updating object_db with the new location returned by store
      char* store( alloc_region& reg, object_header* obj ) {
         auto obj_size = obj->data_capacity() + 8;
          auto ap = reg.alloc_p.load( std::memory_order_relaxed );
          auto ep = reg.end_p.load( std::memory_order_relaxed );

          if( (ep-ap) < obj_size ) 
             alloc_freepage(reg);

          auto aptr = _base_ptr + ap;

          memcpy( aptr, obj, obj_size );
          reg.alloc_p.store( ap + obj_size, std::memory_order_release );

          return aptr;
      }

      void alloc_free_page( alloc_region& reg ) {
         // tell the compactor how much free space is left when we abandoned allocing here
         free_space_per_page[reg.page_num].store( reg.free_space(), std::memory_order_relaxed );

         auto p = _swap_pos.fetch_add(1, std::memory_order_release )+1;
         swap_p_per_page[reg.page_num].store( p, std::memory_order_release );

         uint32_t new_page = alloc_free_page();
         uint64_t new_alloc_p = sizeof(header) + new_page * page_size; // + base
         uint64_t new_page_end    = new_alloc_p + page_size;

         reg.alloc_p.store( new_alloc_p, std::memory_order_relaxed )
         reg.end_p.store( new_page_end, std::memory_order_relaxed)
         reg.page_num.store( new_page, std::memory_order_relaxed );
      }

      uint32_t alloc_free_page() {
         for( auto& fp : head->free_pages ) {
            if( std::popcount( fb.load( std::memory_order_acquire) ) == 64 ) {
               swap_page_num += 64; 
               continue;
            }

            uint64_t old_bits;
            for(;;) {
               uint64_t old_bits = fb.load( std::memory_order_acquire );
               auto idx = std::countr_zero( bits );
               if( idx >= 64 ) {
                  swap_page_num += 64; 
                  break;
               }

               auto new_bits = old_bits ^ (1ull << idx);
               if( fp.compare_exchange_strong( bits, new_bits, std::memory_order_release ) )
                  return swap_page_num + idx;
            }
         }
         throw std::runtime_error( "no more free pages" );
      }

      void select_next_swap_page() {


         uint64_t swap_page_num = 0;

      }


   };


}
