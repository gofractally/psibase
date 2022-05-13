#pragma once

#include <psidb/allocator.hpp>
#include <psidb/file_allocator.hpp>
#include <psidb/page_header.hpp>
#include <psidb/sync/shared_value.hpp>

namespace psidb
{

   struct page_free_list : page_header
   {
      page_id                      _size = 0;
      static constexpr std::size_t capacity =
          (page_size - sizeof(page_header)) / sizeof(page_id) - 1;
      page_id _children[capacity];
   };

   struct pending_gc_list
   {
      page_free_list* _head;
      std::mutex      _mutex;
      void            queue_gc(allocator& alloc, page_header* page)
      {
         //std::cerr << "queue_gc" << std::endl;
         std::lock_guard l{_mutex};
         if (_head == nullptr || _head->_size == page_free_list::capacity)
         {
            auto new_head = new (alloc.allocate(page_size)) page_free_list;
            if (_head)
            {
               new_head->_children[0] = alloc.get_id(_head);
            }
            else
            {
               // FIXME: figure out better null page
               new_head->_children[0] = 0xffffffff;
            }
            new_head->_size = 1;
            _head           = new_head;
         }
         _head->_children[_head->_size++] = alloc.get_id(page);
      }
      // TODO: single page deallocation can integrate with the allocator's free list
      // to allow this function to run in constant time.
      void free(allocator& alloc, file_allocator& falloc)
      {
         std::lock_guard l{_mutex};
         auto            head = _head;
         _head                = nullptr;
         while (head)
         {
            for (std::size_t i = 1; i < head->_size; ++i)
            {
               page_header* p = alloc.translate_page_address(head->_children[i]);
               if (p->id)
               {
                  falloc.deallocate(p->id, 1);
               }
               alloc.deallocate(p, page_size);
            }
            if (head->_children[0] == 0xffffffff)
            {
               alloc.deallocate(head, page_size);
               break;
            }
            auto old_head = head;
            head = static_cast<page_free_list*>(alloc.translate_page_address(head->_children[0]));
            alloc.deallocate(old_head, page_size);
         }
      }
   };

   struct gc_manager
   {
      pending_gc_list lists[2] = {};
      shared_value    manager;
      void            queue_gc(allocator& alloc, page_header* page)
      {
         auto val = manager.load_and_lock();
         lists[val].queue_gc(alloc, page);
         // FIXME: RAII
         manager.unlock(val);
      }
      void process_gc(allocator& alloc, file_allocator& falloc)
      {
         if (manager.try_wait())
         {
            auto val = manager.load(std::memory_order_relaxed);
            lists[val ^ 1].free(alloc, falloc);
            manager.async_store(val ^ 1);
         }
      }
   };

}  // namespace psidb
