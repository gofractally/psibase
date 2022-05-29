#if 0
#include <boost/interprocess/offset_ptr.hpp>
#include <palloc/page_header.hpp>

namespace palloc
{
   struct arena_header
   {
      arena_header( size_t bytes ):arena_size(bytes) {}
      int64_t                 arena_size  = 0;
      int64_t                 total_alloc = 0;
      int64_t                 total_pages = 0;
      offset_ptr<page_header> begin_free_lists[number_page_lists];
      offset_ptr<page_header> end_free_lists[number_page_lists];

      inline static constexpr uint8_t bucket_for_size(const uint64_t size)
      {
         if (size > page_header::max_bucket_element_size())
            return big_page_index;
         return ((size + 15) / 16) - 1;
      }

      offset_ptr<char> alloc(size_t num_bytes)
      {
         auto bucket = bucket_for_size(num_bytes);
         if (bucket < page_header::num_fixed_buckets())
         {
            if (not begin_free_lists[bucket])
            {
               end_free_lists[bucket] = begin_free_lists[bucket] = alloc_page(num_bytes);
            }
            auto& b = begin_free_lists[bucket];
            offset_ptr<char> p = b->alloc();
            if( b->is_full())
            {
               remove_head_bucket(bucket);
            }
            return p;
         }
         else
         {
            auto p = alloc_page(num_bytes);
            return ((char*)&*p)+sizeof(page_header);
         }
      }

      void remove_head_bucket( uint16_t b ) {
      }

      /* viewing the big page index as the root of a max heap, find the
       * best fit and if too big, split it. If nothing is big enough,
       * then create a new page big enough.
       *
       * TODO: for now the heap is linear search as freed big pages
       *       are maintained in insertion sort order single linked list
       */
      offset_ptr<page_header> pop_big_page(size_t num_bytes)
      {
         offset_ptr<page_header>* prev = nullptr;
         offset_ptr<page_header>* p    = &begin_free_lists[big_page_index];
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
         auto min_size = page_header::min_obj_size_for(num_bytes);
         if (bpage->obj_size - min_size)
         {
            //   offset_ptr<page_header> = bpage +
         }
         // trim the page if there are any full pages at the tail
       //  if( bpage->obj_size + sizeof(page_header) )
            return (*p);
      }

      offset_ptr<page_header> new_page(size_t num_bytes) {
         return {};
      }

      /* allocates a page (or sequence of pages) sufficient to hold num_bytes */
      offset_ptr<page_header> alloc_page(size_t num_bytes)
      {
         offset_ptr<page_header> p;
         if (num_bytes < system_page_size - sizeof(page_header))
            p = pop_page(empty_page_index);
         if (not p)
            p = pop_big_page(num_bytes);
         if (not p)
            p = new_page(num_bytes);
         if (not p)
            return p;

         new (&*p) page_header(num_bytes);

         // attempts to pull a page from the empty page list
         // then attempts to pull a page from the big page index
         // then attempts to grow the number of pages
         // then must increase the size of the file
         return {};
      }

      offset_ptr<page_header> pop_page( uint16_t idx ) {
         return {};
      }
   };

}  // namespace palloc
#endif 
