#pragma once
#include <algorithm>
#include <bit>
#include <boost/interprocess/offset_ptr.hpp>
#include <iostream>

namespace trie
{
   using boost::interprocess::offset_ptr;

   static constexpr uint32_t system_page_size  = 1 * 4096;
   static constexpr uint32_t object_resolution = 8;
   static constexpr uint32_t lower_bits        = std::countr_zero(system_page_size);
   struct arena;

   struct page_header
   {
      static constexpr uint32_t lower_bits = std::countr_zero(system_page_size);
      // at least two elements per page
      static inline constexpr uint16_t max_bucket_element_size()
      {
         return (system_page_size - sizeof(page_header)) / 2;
      }
      static inline constexpr uint16_t num_fixed_buckets()
      {
         return ((system_page_size - sizeof(page_header)) / 2) / object_resolution;
      }

      // for pages organized in a list or heap
      uint32_t                obj_size       = 0;  // may be larger than a page size
      uint16_t                num_free_slots = 0;
      uint16_t                bucket         = 0;
      /// TODO: offsetptr to arena this is allocated in
      /// now any object allocated in the arena can allocate memory
      offset_ptr<page_header> next;
      offset_ptr<page_header> prev;
      uint64_t free_slots[(system_page_size / object_resolution) / 64];  // 1 bit per object
      offset_ptr<arena>       alloc_arena;

      static inline constexpr size_t round_up_size(uint64_t size)
      {
         return object_resolution * ((size + (object_resolution - 1)) / object_resolution);
      }
      /**
       * Return the maximum number of object slots
       * @param size must be a multiple of 16 bytes
       */
      static inline constexpr size_t max_free_slots(uint64_t size)
      {
         return (system_page_size - sizeof(page_header)) / size;
      }

      /* give a desire to allocate size, what is the min obj_size that
       * is capable of holding size bytes such that obj_size+header_size
       * is a page boundary. 
       */
      static inline constexpr size_t min_obj_size_for(uint64_t size)
      {
         return page_bytes_required(size) - sizeof(page_header);
      }

      static inline constexpr size_t page_bytes_required(uint64_t size)
      {
         const uint64_t h = sizeof(page_header);
         const uint64_t p = system_page_size;
         return p * ((h + size) / p) + p;
      }

      inline char* data() { return ((char*)&alloc_arena)+ sizeof(alloc_arena); }
      inline char* end()
      {
         return data() + std::max<uint64_t>(obj_size, system_page_size - sizeof(page_header));
      }

      inline bool free(char* p)
      {
         assert(not(p < data() or p > end()));
         assert(obj_size != 0);

         if (obj_size <= max_bucket_element_size())
         {
            auto idx = (p - (data()/*padding + sizeof(padding)*/)) / obj_size;
            auto s   = idx / 64;

            // TODO: remove debug checks
            if (not(free_slots[s] & (1ull << (idx - s * 64))))
            {
               std::cerr<< "double free: " << idx << "\n";
               throw std::runtime_error( "double free" );
            }

            free_slots[s] ^= 1ull << (idx - s * 64);
            ++num_free_slots;
            return true;
         }
         return false;
      }

      inline char* alloc()
      {
         if (is_full())
            return nullptr;

         uint32_t idx = 0;
         uint32_t s   = -1;
         uint32_t pos = 0;
         do
         {
            idx += pos = std::countr_one(free_slots[++s]);
         } while (pos == 64);

         //  std::cout <<"alloc idx: " << idx <<" s: " << s <<"  pos: " << pos <<"\n";
         free_slots[s] |= 1ull << pos;
         //  std::cout << "fs: " <<free_slots[s] <<"\n";
         //  std::cout << "leading one: " <<std::countl_one(free_slots[s]);

         num_free_slots--;

         return data()/*padding + sizeof(padding)*/ + idx * obj_size;
      }

      inline bool is_full() const { return num_free_slots == 0; }
      inline bool is_empty() const { return num_free_slots == max_free_slots(obj_size); }

      page_header(uint64_t size, arena* a)
         :alloc_arena(a)
      {
         assert( (uint64_t(this)) % (system_page_size) == 0 ); 
         //next = nullptr;
         //prev = nullptr;

         // TODO: what happens if round_up_size later than max page
         obj_size       = round_up_size(size);
         num_free_slots = max_free_slots(obj_size);
         memset( free_slots, 0, sizeof(free_slots) );
      }

      page_header* unlink()
      {
         if (prev)
            prev->next = next;
         if (next)
            next->prev = prev;

         prev = nullptr;
         next = nullptr;

         return this;
      }
   };

   static constexpr uint16_t big_page_index = page_header::num_fixed_buckets() + 0;  // heap sorted
   static constexpr uint16_t empty_page_index  = big_page_index + 1;
   static constexpr uint16_t number_page_lists = empty_page_index + 1;

   static_assert(sizeof(page_header) % 16 == 0, "page header must align on 16 byte boundary");
}  // namespace trie
