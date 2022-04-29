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
   decltype(auto) visit(page_header* root, F&& f)
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

   class cursor
   {
     public:
      cursor(page_manager* db, checkpoint c) : db(db), c(c) { version = db->get_version(c); }
      // FIXME: figure out actual bound.  64 is definitely safe
      static constexpr std::size_t max_depth = 64;
      void                         lower_bound(std::string_view key)
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
      }
      void insert(std::string_view key, std::string_view value)
      {
         lower_bound(key);
         // TODO: This isn't quite right as it dirties even nodes that we're going to make a copy of
         touch();
         std::uint32_t child;
         // Insert into the leaf
         {
            auto p = maybe_clone<page_leaf>(leaf, depth);
            if (p->insert(leaf, key, value))
            {
               return;
            }
            auto [new_page, new_page_id] = db->allocate_page();
            key   = p->split(static_cast<page_leaf*>(new_page), p->get_offset(leaf), key, value);
            child = new_page_id;
            db->touch_page(new_page, version);
         }
         // Insert into internal nodes
         for (std::size_t i = depth; i > 0; --i)
         {
            auto p   = maybe_clone<page_internal_node>(stack[i - 1], i - 1);
            auto pos = stack[i - 1];
            if (p->insert(pos, key, child))
            {
               return;
            }
            // FIXME: Handle allocation failure
            auto [new_page, new_page_id] = db->allocate_page();
            key   = p->split(static_cast<page_internal_node*>(new_page), p->get_offset(pos), key,
                             child);
            child = new_page_id;
            db->touch_page(new_page, version);
         }
         // Create a new root, increasing the depth of the tree
         {
            auto [new_page, new_page_id] = db->allocate_page();
            static_cast<page_internal_node*>(new_page)->set(db->get_root_id(c, 0), key, child);
            db->set_root(c, 0, new_page_id);
            db->touch_page(new_page, version);
         }
      }
      void touch()
      {
         for (std::size_t i = 0; i < depth; ++i)
         {
            auto p = stack[i].get_parent<page_internal_node>();
            db->touch_page(p, version);
         }
         {
            db->touch_page(leaf.get_parent<page_leaf>(), version);
         }
      }
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
         auto p = leaf.get_parent<page_leaf>();
         return page_leaf::unpad(p->get_value(p->get_offset(leaf)));
      }

     private:
      template <typename Page, typename Ptr>
      Page* maybe_clone(Ptr& node, std::size_t i)
      {
         Page* p = node.template get_parent<Page>();
         if (p->version < version)
         {
            // clone p
            auto [copy, copy_id] = db->allocate_page();
            copy                 = new (copy) Page;
            p->copy(static_cast<Page*>(copy));
            copy->prev.store(db->get_id(p), std::memory_order_release);
            copy->version = version;
            relink_after_copy(i, copy_id);
            node = static_cast<Page*>(copy)->child(p->get_offset(node));
            p    = static_cast<Page*>(copy);
            db->touch_page(copy, version);
         }
         return p;
      }
      void relink_after_copy(std::size_t depth, page_id page)
      {
         if (depth == 0)
         {
            db->set_root(c, 0, page);
         }
         else
         {
            stack[depth - 1]->store(page, std::memory_order_release);
         }
      }
      page_header* get_page(node_ptr p) { return db->get_page(p, version); }
      node_ptr     lower_bound(page_header* p, key_type key)
      {
         return visit(p, [&](auto* p) { return lower_bound(p, key); });
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

}  // namespace psidb
