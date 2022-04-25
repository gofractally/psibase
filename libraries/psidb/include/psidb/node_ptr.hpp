#pragma once

#include <atomic>
#include <cassert>
#include <cstdint>
#include <psidb/page_header.hpp>

namespace psidb
{

   class node_ptr
   {
     public:
      node_ptr() = default;
      node_ptr(std::nullptr_t) : node_ptr(nullptr, nullptr) {}
      node_ptr(page_header* parent, std::atomic<std::uint32_t>* id) : id(id)
      {
         assert(parent == get_parent<page_header>());
      }
      std::atomic<page_id>* get() const { return id; }
      std::atomic<page_id>* operator->() const { return id; }
      page_id               operator*() const { return id->load(std::memory_order_acquire); }
      template <typename Page>
      Page* get_parent() const
      {
         return reinterpret_cast<Page*>(reinterpret_cast<std::uintptr_t>(id) &
                                        ~(static_cast<std::uintptr_t>(page_size - 1)));
      }
      explicit operator bool() const { return id != 0; }

     private:
      std::atomic<page_id>* id;
   };

}  // namespace psidb
