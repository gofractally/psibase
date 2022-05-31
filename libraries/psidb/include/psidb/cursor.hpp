#pragma once

#include <cstdint>
#include <psidb/checkpoint.hpp>
#include <psidb/node_ptr.hpp>
#include <psidb/page_manager.hpp>
#include <psidb/page_types/internal_node.hpp>
#include <psidb/page_types/leaf_node.hpp>
#include <string_view>

namespace psidb
{

   template <typename F>
   decltype(auto) visit(F&& f, page_header* root)
   {
      switch (root->type)
      {
         case page_type::leaf:
            return f(static_cast<page_leaf*>(root));
         case page_type::node:
            return f(static_cast<page_internal_node*>(root));
      }
      __builtin_unreachable();
   }

   class transaction;

   class cursor
   {
     public:
      cursor(page_manager* db, checkpoint c) : db(db), c(c) { version = db->get_version(c); }
      // FIXME: figure out actual bound.  64 is definitely safe
      static constexpr std::size_t max_depth = 64;

      void lower_bound(std::string_view key)
      {
         auto l = db->gc_lock();
         lower_bound_impl(key);
         make_valid();
      }
      void make_valid()
      {
         if (!valid())
         {
            for (std::size_t i = depth; i > 0; --i)
            {
               auto p      = stack[i - 1].get_parent<page_internal_node>();
               auto offset = p->get_offset(stack[i - 1]);
               if (offset < p->_size)
               {
                  stack[i - 1] = p->child(offset + 1);
                  front(i, get_page(stack[i - 1]));
                  break;
               }
            }
         }
         access();
      }
      void back()
      {
         auto         l = db->gc_lock();
         page_header* p = db->root(c, 0);
         depth          = 0;
         while (true)
         {
            if (p->type == page_type::leaf)
            {
               break;
            }
            assert(p->type == page_type::node);
            assert(depth < max_depth);
            node_ptr node  = static_cast<page_internal_node*>(p)->back();
            stack[depth++] = node;
            p              = get_page(node);
         }
         leaf = static_cast<page_leaf*>(p)->back();
      }
      void back(std::size_t i, page_header* parent)
      {
         for (; i < depth; ++i)
         {
            stack[i] = static_cast<page_internal_node*>(parent)->back();
            parent   = get_page(stack[i]);
         }
         leaf = static_cast<page_leaf*>(parent)->back();
      }
      void front(std::size_t i, page_header* parent)
      {
         for (; i < depth; ++i)
         {
            stack[i] = static_cast<page_internal_node*>(parent)->child(0);
            parent   = get_page(stack[i]);
         }
         leaf = static_cast<page_leaf*>(parent)->child(0);
      }
      // This may point to the end of a leaf which is the appropriate point
      // for insertion but needs to be fixed up in lower_bound.
      void lower_bound_impl(std::string_view key)
      {
         page_header* p = db->root(c, 0);
         depth          = 0;
         while (node_ptr node = lower_bound(p, key))
         {
            // FIXME: runtime check is probably needed
            assert(depth < max_depth);
            stack[depth++] = node;
            p              = get_page(node);
         }
         access();
      }
      void put(transaction& trx, std::string_view key, std::string_view value)
      {
         lower_bound(key);
         if (valid() && get_key() == key)
         {
            // TODO: replace value in a single operation
            erase(trx);
         }
         insert(trx, key, value);
      }
      void insert(transaction& trx, std::string_view key, std::string_view value);
      void erase(transaction& trx);
      void next()
      {
         auto p = leaf.get_parent<page_leaf>();
         leaf   = p->child(p->get_offset(leaf) + 1);
         auto l = db->gc_lock();
         make_valid();
      }
      bool previous()
      {
         auto p = leaf.get_parent<page_leaf>();
         if (p->get_offset(leaf) != 0)
         {
            leaf = p->child(p->get_offset(leaf) - 1);
            access();
            return true;
         }
         for (std::size_t i = depth; i > 0; --i)
         {
            auto node   = stack[i - 1].get_parent<page_internal_node>();
            auto offset = node->get_offset(stack[i - 1]);
            if (offset != 0)
            {
               auto l       = db->gc_lock();
               stack[i - 1] = node->child(offset - 1);
               back(i, get_page(stack[i - 1]));
               access();
               return true;
            }
         }
         return false;
      }
      void touch(transaction& trx);
      bool valid() const
      {
         auto p = leaf.get_parent<page_leaf>();
         return p->get_offset(leaf) < p->size;
      }
      std::string_view get_key() const
      {
         auto p = leaf.get_parent<page_leaf>();
         return page_leaf::unpad(p->get_key(p->get_offset(leaf)));
      }
      std::string_view get_value() const
      {
         auto p              = leaf.get_parent<page_leaf>();
         auto [value, flags] = p->get_value(p->get_offset(leaf));
         if (flags)
         {
            page_manager::value_reference data;
            assert(value.size() == sizeof(data));
            std::memcpy(&data, value.data(), sizeof(data));
            if (data.flags == page_manager::value_reference_flags::memory)
            {
               return {data.data, data.size};
            }
            else
            {
               void* page_base = db->get_pages(data.page, (data.size + page_size - 1) / page_size);
               return {reinterpret_cast<const char*>(page_base) + data.offset, data.size};
            }
         }
         else
         {
            return page_leaf::unpad(value);
         }
      }

     private:
      void access()
      {
         for (std::size_t i = 0; i < depth; ++i)
         {
            stack[i].get_parent<page_internal_node>()->access();
         }
         leaf.get_parent<page_leaf>()->access();
      }
      template <typename Page, typename Ptr>
      Page*        maybe_clone(transaction& trx, Ptr& node, std::size_t i);
      void         relink_after_copy(transaction& trx, std::size_t depth, page_id page);
      page_header* get_page(node_ptr p) { return db->get_page(p, version); }
      node_ptr     lower_bound(page_header* p, key_type key)
      {
         return visit([&](auto* p) { return lower_bound(p, key); }, p);
      }
      node_ptr lower_bound(page_leaf* p, key_type key)
      {
         leaf = p->lower_bound(key);
         return nullptr;
      }
      node_ptr      lower_bound(page_internal_node* p, key_type key) { return p->lower_bound(key); }
      page_manager* db;
      checkpoint    c;
      std::size_t   depth = 0;
      node_ptr      stack[max_depth];
      leaf_ptr      leaf;
      version_type  version = 0;
   };

   inline cursor checkpoint::get_cursor() const { return cursor{_root->_self, *this}; }

}  // namespace psidb
