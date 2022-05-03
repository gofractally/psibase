#pragma once

#include <sys/mman.h>
#include <boost/intrusive/set.hpp>
#include <cstddef>
#include <new>
#include <psidb/page_header.hpp>

namespace psidb
{

   struct allocator
   {
      allocator(std::size_t max_size)
      {
         max_size = round_to_page(max_size);
         _base =
             ::mmap(nullptr, max_size, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
         _size      = max_size;
         auto* node = new (_base) node_type;
         node->size = max_size;
         freelist_by_addr.insert(*node);
         freelist_by_size.insert(*node);
      }
      ~allocator()
      {
         freelist_by_addr.clear();
         freelist_by_size.clear();
         ::munmap(_base, _size);
      }
      void* allocate(std::size_t size)
      {
         auto pool = get_pool(size);
         if (pool == max_pools)
         {
            return allocate_block(round_to_page(size));
         }
         else
         {
            return allocate_pool(pool);
         }
      }
      void deallocate(void* ptr, std::size_t size)
      {
         auto pool = get_pool(size);
         if (pool == max_pools)
         {
            return deallocate_block(ptr, round_to_page(size));
         }
         else
         {
            return deallocate_pool(ptr, pool);
         }
      }
      static std::size_t round_to_page(std::size_t size)
      {
         return (size + page_size - 1) & ~(page_size - 1);
      }
      static constexpr std::size_t get_pool(std::size_t size)
      {
         if (size > page_size)
         {
            // Use page aligned memory
            return max_pools;
         }
         else
         {
            if (size < 16)
               size = 16;
            auto pool = (32 - __builtin_clz(size - 1));
            pool      = 2 * (pool - 4) - (size <= (3 << (pool - 2)));
            return pool;
         }
      }

      static constexpr std::size_t mmap_threshold = 256 * 1024 * 1024;
      static constexpr std::size_t max_pools      = 16 + 1;

      static constexpr std::size_t pool_element_size(std::size_t pool)
      {
         return (2 + (pool & 1)) << ((pool >> 1) + 3);
      }
      void* populate_pool(std::size_t pool)
      {
         std::size_t size = pool_element_size(pool);
         // TODO: pool memory is never released back to the general
         // allocator.  Keep it separate to reduce fragmentation.
         // TODO: handle the excess for non-power of two pools.
         void* page = allocate_block(page_size);
         for (std::size_t i = 1; (i + 1) * size <= page_size; ++i)
         {
            deallocate_pool(reinterpret_cast<char*>(page) + i * size, pool);
         }
         return page;
      }
      void* allocate_block(std::size_t size)
      {
         if (size >= mmap_threshold)
         {
            return ::mmap(nullptr, size, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1,
                          0);
         }
         auto pos = freelist_by_size.lower_bound(size);
         if (pos == freelist_by_size.end())
         {
            throw std::bad_alloc();
         }
         if (pos->size == size)
         {
            void* result = &*pos;
            freelist_by_size.erase(pos);
            return result;
         }

         void*      next      = reinterpret_cast<char*>(&*pos) + size;
         auto       next_size = size - pos->size;
         node_type* result    = &*pos;
         freelist_by_size.erase(pos);
         auto* node = new (next) node_type;
         node->size = next_size;
         freelist_by_addr.replace_node(freelist_by_addr.iterator_to(*result), *node);
         result->~node_type();
         freelist_by_size.insert(*node);
         return result;
      }
      static bool is_adjacent(const void* ptr, std::size_t size, const void* next)
      {
         return reinterpret_cast<const char*>(ptr) + size == next;
      }
      void deallocate_block(void* ptr, std::size_t size)
      {
         if (size >= mmap_threshold)
         {
            ::munmap(ptr, size);
         }
         // coalesce adjacent free blocks
         auto        pos      = freelist_by_addr.lower_bound(ptr);
         node_type*  next     = nullptr;
         node_type*  prev     = nullptr;
         std::size_t new_size = size;
         if (pos != freelist_by_addr.end())
         {
            if (is_adjacent(ptr, size, &*pos))
            {
               next = &*pos;
               new_size += next->size;
            }
         }
         if (pos != freelist_by_addr.begin())
         {
            --pos;
            if (is_adjacent(&*pos, pos->size, ptr))
            {
               prev = &*pos;
               new_size += prev->size;
            }
         }
         if (prev)
         {
            freelist_by_size.erase(freelist_by_size.iterator_to(*prev));
            prev->size = new_size;
            freelist_by_size.insert(*prev);
         }
         else
         {
            auto* node = new (ptr) node_type;
            node->size = new_size;
            freelist_by_addr.insert(*node);
            freelist_by_size.insert(*node);
         }
         if (next)
         {
            freelist_by_size.erase(freelist_by_size.iterator_to(*next));
            freelist_by_addr.erase(freelist_by_addr.iterator_to(*next));
            next->~node_type();
         }
      }
      void* allocate_pool(std::size_t pool)
      {
         if (!pools[pool])
         {
            return populate_pool(pool);
         }
         pool_type* result = pools[pool];
         pools[pool]       = result->next;
         return result;
      }
      void deallocate_pool(void* ptr, std::size_t pool)
      {
         pools[pool] = new (ptr) pool_type{pools[pool]};
      }
      void* base() { return _base; }
      struct pool_type
      {
         pool_type* next;
      };
      struct node_type;
      struct by_size
      {
         using type = std::size_t;
         std::size_t operator()(const node_type& n) { return n.size; }
      };
      struct by_addr
      {
         using type = const void*;
         const void* operator()(const node_type& n) { return &n; }
      };
      struct node_type : boost::intrusive::set_base_hook<boost::intrusive::tag<by_size>>,
                         boost::intrusive::set_base_hook<boost::intrusive::tag<by_addr>>
      {
         std::size_t size;
      };
      void*       _base            = nullptr;
      std::size_t _size            = 0;
      pool_type*  pools[max_pools] = {};
      template <typename K>
      using freelist = boost::intrusive::set<
          node_type,
          boost::intrusive::base_hook<boost::intrusive::set_base_hook<boost::intrusive::tag<K>>>,
          boost::intrusive::key_of_value<K>>;
      freelist<by_size> freelist_by_size;
      freelist<by_addr> freelist_by_addr;
   };

}  // namespace psidb
