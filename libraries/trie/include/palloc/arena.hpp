#pragma once
#include <boost/interprocess/offset_ptr.hpp>
#include <palloc/page_header.hpp>

namespace palloc
{
   struct arena
   {

      arena(size_t bytes)
      {
         assert( (uint64_t(this)) % (4096) == 0 ); 
         static_assert(sizeof(arena) <= 2 * system_page_size, "unexpected header size");
         assert(bytes > 2 * system_page_size);
         arena_size = bytes;
         for( auto& i : free_lists )
            assert( i.get() == nullptr );

         free_area = 2*system_page_size + system_page_size  - (uint64_t(this))%system_page_size;
      }

      /* @return 0 if invalid, and non-zero (-1) if valid
       */
      inline uint64_t validate_offset(uint64_t o) { return -(o < free_area); }

      /**
       * Given an offset, return a pointer to the memory or nullptr if
       * it isn't valid.
       */
      template <typename T = char>
      T* get(uint64_t o)
      {
         return reinterpret_cast<T*>(((uint64_t(this)) + o) & validate_offset(o));
      }

      template <typename T>
      uint64_t get_offset(T* p)
      {
         return (char*)p - (char*)this;
      }

      /** returns the maximum size that can be used without
       * moving the memory 
       */
      uint32_t get_max_realloc_size(uint64_t o)
      {
         auto p  = get(o);
         auto ph = (page_header*)(uint64_t(p) & (-1ull << lower_bits));
         return ph->obj_size;
      }

      char                    padding[8];  /// just to steal the pointer
      int64_t                 arena_size = 0;
      int64_t                 free_area  = 2 * system_page_size;  // first page is the header
      offset_ptr<page_header> free_lists[number_page_lists];
      offset_ptr<char>        root_objects[16]; /// 16 objects we can fetch by index

      inline static constexpr uint16_t bucket_for_size(const uint64_t size)
      {
         if (size > page_header::max_bucket_element_size())
            return big_page_index;
         return ((size + (object_resolution - 1)) / object_resolution) - 1;
      }

      static page_header* get_page( const void* p ) {
         return (page_header*)(uint64_t(p) & (-1ull << lower_bits));
      }

      static arena& get_from( const void* p ) {
         return *get_page(p)->alloc_arena;
      }

      static void free( void* p ) {
         get_page(p)->alloc_arena->deallocate(p);
      }

      static arena& get_arena( void* p ) {
            return *get_page(p)->alloc_arena;
      }

      bool deallocate(void* p ) { return deallocate((char*)p); }
      bool deallocate(char* p)
      {
         assert(not(p < (char*)this or p > ((char*)this) + arena_size));
         auto ph = (page_header*)(uint64_t(p) & (-1ull << lower_bits));
         // std::cout << "free ph->obj_size: " << ph->obj_size << "\n";

         bool was_full = ph->is_full();

         if (ph->free(p))
         {
            if (was_full)
            {
               assert(ph->next == nullptr);
               assert(ph->prev == nullptr);

               push_page(free_lists[ph->bucket], ph);
            }
            else if (ph->is_empty())
            {
               if (not ph->prev)
               {
                  assert(free_lists[ph->bucket] == ph);
                  push_page(free_lists[empty_page_index], pop_page(free_lists[ph->bucket]));
               }
               else
               {
                  push_page(free_lists[empty_page_index], ph->unlink());
               }
            }
            return true;
         }

         return false;
      }

      page_header* new_page(size_t num_bytes)
      {
         //assert(not free_lists[empty_page_index]);

         auto b = page_header::page_bytes_required(num_bytes);
         assert(b % system_page_size == 0);

         if (free_area + b > arena_size)
            return nullptr;  // arena full

         memset( padding+free_area, 0, b );
         auto p = new (padding + free_area) page_header(num_bytes, this);
         free_area += b;

         return p;
      }

      char* alloc(size_t num_bytes)
      {
         auto bucket = bucket_for_size(num_bytes);
         if (bucket < page_header::num_fixed_buckets())
         {
            auto& p = free_lists[bucket];
            if (not p)
            {
               auto np = alloc_page(num_bytes);

               np->bucket = bucket;
               push_page(p, np);
            }

            char* r = p->alloc();
            if (p->is_full())
            {
               pop_page(p);
            }
            return r;
         }
         else
         {
            auto p = alloc_page(num_bytes);
            return p->data();
         }
      }

      /* viewing the big page index as the root of a max heap, find the
       * best fit and if too big, split it. If nothing is big enough,
       * then create a new page big enough.
       *
       * TODO: for now the heap is linear search as freed big pages
       *       are maintained in insertion sort order single linked list
       */
      page_header* pop_big_page(size_t num_bytes)
      {
         offset_ptr<page_header>* prev = nullptr;
         offset_ptr<page_header>* p    = &free_lists[big_page_index];
         if (not *p)
            return new_page(num_bytes);
         if ((*p)->obj_size < num_bytes)
            return new_page(num_bytes);
         while ((*p)->next and (*p)->next->obj_size >= num_bytes)
         {
            prev = p;
            p    = &(*p)->next;
         }
         if (prev)
            *prev = (*p)->next;
         (*p)->next = nullptr;

         auto& bpage    = *p;
         auto  min_size = page_header::min_obj_size_for(num_bytes);
         if (bpage->obj_size - min_size)
         {
            //   offset_ptr<page_header> = bpage +
         }
         // trim the page if there are any full pages at the tail
         //  if( bpage->obj_size + sizeof(page_header) )
         //     return (*p);
         return nullptr;
      }

      /* allocates a page (or sequence of pages) sufficient to hold num_bytes */
      page_header* alloc_page(size_t num_bytes)
      {
         page_header* p = nullptr;
         if (num_bytes < system_page_size - sizeof(page_header))
            p = &*pop_page(free_lists[empty_page_index]);
         if (not p)
            p = pop_big_page(num_bytes);
         if (not p)
            p = new_page(num_bytes);
         if (not p)
            throw std::runtime_error( "unable to allocate page" );

         return new (p) page_header(num_bytes, this);
      }

      /*
      page_header* pop_page(uint16_t idx)
      {
         page_header* p = &*free_lists[idx];
         if( p ) {
            if( p->next) p->next->prev = nullptr;
            p->next = nullptr;
         }
         return p;
      }
      */

      offset_ptr<page_header> pop_page(offset_ptr<page_header>& to)
      {
         assert(!to or (to and to->prev == nullptr));
         if (not to)
            return to;

         offset_ptr<page_header> p = to;
         to                        = p->next;
         if (to)
         {
            to->prev = nullptr;
         }
         p->next = nullptr;
         return p;
      }

      void push_page(offset_ptr<page_header>& to, offset_ptr<page_header> p)
      {
         assert(not p->next);
         assert(not p->prev);
         p->next = to;
         if (p->next)
            p->next->prev = p;
         to = p;
      }

      void check_invariants()
      {
         int pages_found = 2;
         for (uint32_t i = 0; i < number_page_lists; ++i)
         {
            //   std::cout << i << "  " << !!free_lists[i] << "\n";
            if (free_lists[i])
            {
               ++pages_found;
               auto p = free_lists[i];
               assert(not p->prev);
               auto next = p->next;
               while (next)
               {
                  ++pages_found;
                  assert(next->prev == p);
                  p    = next;
                  next = p->next;
               }
            }
         }
         std::cout << "pages_found: " << pages_found << "\n";
         std::cout << "pages_alloc: " << free_area / system_page_size << "\n";
         assert(free_area / system_page_size == pages_found);
      }
   };

}  // namespace palloc
