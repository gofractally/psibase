#include <psidb/cursor.hpp>
#include <psidb/transaction.hpp>

using namespace psidb;

void psidb::cursor::touch(transaction& trx)
{
   bool found_some = false;
   for (std::size_t i = 0; i < depth; ++i)
   {
      if (leaf.get_parent<page_internal_node>()->version <= trx.always_clone_version())
      {
         maybe_clone<page_internal_node>(trx, stack[i], i);
         found_some = true;
      }
      else
      {
         // An old parent should never point to a new child
         assert(!found_some);
      }
   }
   if (leaf.get_parent<page_leaf>()->version <= trx.always_clone_version())
   {
      maybe_clone<page_leaf>(trx, leaf, depth);
   }
   else
   {
      assert(!found_some);
   }
}

void psidb::cursor::insert(transaction& trx, std::string_view key, std::string_view value)
{
   auto l = db->gc_lock();
   lower_bound_impl(key);
   touch(trx);
   std::uint32_t child;
   // Insert into the leaf
   {
      char         buf[16];
      std::uint8_t flags = 0;
      if (value.size() > page_leaf::max_inline_value_size)
      {
         page_manager::value_reference ref = db->clone_value(value);
         std::memcpy(&buf, &ref, sizeof(buf));
         static_assert(sizeof(buf) == sizeof(ref));
         flags = 1;
         value = {buf, buf + sizeof(buf)};
      }
      auto p = maybe_clone<page_leaf>(trx, leaf, depth);
      if (p->insert(leaf, key, value, flags))
      {
         return;
      }
      auto [new_page, new_page_id] = db->allocate_page(p);
      key = p->split(static_cast<page_leaf*>(new_page), p->get_offset(leaf), key, value, flags);
      new_page->id = 0;
      new_page->access();
      new_page->type    = page_type::leaf;
      new_page->version = version;
      new_page->prev.store(gc_allocator::null_page, std::memory_order_relaxed);
      child = new_page_id;
   }
   // Insert into internal nodes
   for (std::size_t i = depth; i > 0; --i)
   {
      auto p   = maybe_clone<page_internal_node>(trx, stack[i - 1], i - 1);
      auto pos = stack[i - 1];
      if (p->insert(pos, key, child))
      {
         return;
      }
      // FIXME: Handle allocation failure
      auto [new_page, new_page_id] = db->allocate_page(p);
      key = p->split(static_cast<page_internal_node*>(new_page), p->get_offset(pos), key, child);
      new_page->id = 0;
      new_page->access();
      new_page->type    = page_type::node;
      new_page->version = version;
      new_page->prev.store(gc_allocator::null_page, std::memory_order_relaxed);
      child = new_page_id;
   }
   // Create a new root, increasing the depth of the tree
   {
      auto [new_page, new_page_id] = db->allocate_page(nullptr);
      static_cast<page_internal_node*>(new_page)->init();
      static_cast<page_internal_node*>(new_page)->set(db->get_root_id(c, 0), key, child);
      new_page->id = 0;
      new_page->access();
      new_page->type    = page_type::node;
      new_page->version = version;
      new_page->prev.store(gc_allocator::null_page, std::memory_order_relaxed);
      db->set_root(c, 0, new_page_id);
   }
}

void psidb::cursor::erase(transaction& trx)
{
   touch(trx);
   auto l = db->gc_lock();
   auto p = maybe_clone<page_leaf>(trx, leaf, depth);
   // TODO: rebalancing
   p->erase(leaf);
   if (p->size == 0)
   {
      for (std::size_t i = depth; i > 0; --i)
      {
         auto node = maybe_clone<page_internal_node>(trx, stack[i - 1], i - 1);
         if (node->_size != 0)
         {
            node->erase(stack[i - 1]);
            return;
         }
      }
      // FIXME: deallocate
      db->set_root(c, 0, db->get_id(p));
   }
}

template <typename Page, typename Ptr>
Page* psidb::cursor::maybe_clone(transaction& trx, Ptr& node, std::size_t i)
{
   Page* p = node.template get_parent<Page>();
   if (p->version < version)
   {
      // clone p
      auto [copy, copy_id] = db->allocate_page(p);
      copy                 = new (copy) Page;
      p->copy(static_cast<Page*>(copy));
      copy->type = p->type;
      copy->id   = 0;
      copy->access();
      copy->prev.store(db->get_id(p), std::memory_order_release);
      copy->version = version;
      relink_after_copy(trx, i, copy_id);
      node = static_cast<Page*>(copy)->child(p->get_offset(node));
      p    = static_cast<Page*>(copy);
   }
   return p;
}

void psidb::cursor::relink_after_copy(transaction& trx, std::size_t depth, page_id page)
{
   if (depth == 0)
   {
      trx.on_delete(db->root(c, 0));
      db->set_root(c, 0, page);
   }
   else
   {
      stack[depth - 1]->store(page, std::memory_order_release);
      trx.on_copy(stack[depth - 1]);
   }
}
