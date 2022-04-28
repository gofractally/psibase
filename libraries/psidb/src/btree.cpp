#include <cassert>
#include <cstdint>
#include <cstring>
#include <string_view>

#include <sys/mman.h>
#include <psidb/node_ptr.hpp>
#include <psidb/page_manager.hpp>
#include <psidb/page_types/internal_node.hpp>
#include <psidb/page_types/leaf_node.hpp>

using namespace psidb;

union page
{
   page_internal_node node;
   page_leaf          leaf;
};

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
   explicit cursor(page_manager* db, checkpoint c) : db(db), c(c) { version = db->get_version(c); }
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
   // \pre must already point to the lower_bound of \c key
   void insert(std::string_view key, std::string_view value)
   {
      // TODO: This isn't quite right as it dirties even nodes that we're going to make a copy of
      touch();
      std::uint32_t child;
      // Insert into the leaf
      {
         auto p = leaf.get_parent<page_leaf>();
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
         auto p   = stack[i - 1].get_parent<page_internal_node>();
         auto pos = stack[i - 1];
         if (p->insert(pos, key, child))
         {
            return;
         }
         // FIXME: Handle allocation failure
         auto [new_page, new_page_id] = db->allocate_page();
         key = p->split(static_cast<page_internal_node*>(new_page), p->get_offset(pos), key, child);
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
         auto p = stack[i - 1].get_parent<page_internal_node>();
         db->touch_page(p, version);
      }
      {
         db->touch_page(leaf.get_parent<page_leaf>(), version);
      }
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

#include <iostream>

auto make_kv(int i)
{
   return std::pair{std::to_string(i), std::to_string(i * 1024)};
}

int main(int argc, const char** argv)
{
   page_manager db("psi.dat", 65536);
   auto         trx = db.start_transaction();
   cursor       c(&db, trx);

   bool insert = (argc > 1 && argv[1] == std::string("--store"));
   if (insert)
   {
      for (int i = 0; i < 10; ++i)
      {
         auto [k, v] = make_kv(i);
         c.lower_bound(k);
         c.insert(k, v);
      }
   }
   db.commit_transaction(trx);
   for (int i = 0; i < 10; ++i)
   {
      auto [k, v] = make_kv(i);
      c.lower_bound(k);
      std::cout << c.get_key() << ": " << c.get_value() << std::endl;
   }
   db.async_flush();
}
