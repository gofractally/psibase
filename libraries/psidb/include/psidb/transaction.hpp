#pragma once

#include <psidb/cursor.hpp>
#include <psidb/page_manager.hpp>

namespace psidb
{

   // general invariants:
   //
   // Each fat node forms a circular singly linked list
   //
   // Every node has a minimum and maximum version that it is accessible from
   //
   // A node can have multiple parents
   // A parent node points to the highest relevant version of the child node
   //
   // There is a set of live versions
   //
   // A node becomes obsolete when no version in its lifetime is live
   //
   // An obsolete node is removed from its fat node list
   //
   // To prove: if a node is obsolete, then any direct parents are also obsolete
   //
   // - A node is made obsolete when a transaction that replaces it is committed
   //   and there are no live versions in the range [creation, replacement)
   //
   // problem:
   // - copy node n0 = [0, 4), n1 = [4, *)
   // - copy parent p0 = [0, 5), p1 = [5, *)
   // - copy node n1 = [4, 6), n2 = [6,*)
   // p0 -> n1, p1 -> n2
   // Therefore, p0 relies on n1 to access n0
   //
   // Limiting fat nodes to a single extra copy solves most of these problems. or does it?
   // what if we link the other way?
   //
   // - version field represents xxx version
   // - when a node becomes obsolete, its parents need to be relinked
   //
   // Suppose we keep a record of the parent:
   // - The parent is live as long as this checkpoint is live
   // - When folding checkpoints, if parent is newer the checkpoint, switch to parent prev
   // - What if... parent is a split node...
   //
   // - Or, when a node is freed.
   //
   // - or, unlink the node, fix

   class transaction
   {
     public:
      transaction(page_manager* db, const checkpoint& ck) : _db(db), _checkpoint(ck) {}
      cursor get_cursor() { return {_db, _checkpoint}; }

      // when a transaction is destroyed
      // - if is committed or aborted do nothing
      // - if it is the head, abort
      // - if it is not the head, fold it into the next transaction

      // move constructor is allowed
      // move assignement is equivalent to destroying the lhs and then moving

      void insert(std::string_view key, std::string_view value)
      {
         cursor c = get_cursor();
         insert(c, key, value);
      }
      void insert(cursor& c, std::string_view key, std::string_view value)
      {
         c.insert(*this, key, value);
      }
      void erase(std::string_view key)
      {
         cursor c = get_cursor();
         erase(c, key);
      }
      void erase(cursor& c, std::string_view key)
      {
         c.lower_bound(key);
         if (c.valid() && c.get_key() == key)
         {
            erase(c);
         }
      }
      void erase(cursor& c) { c.erase(*this); }

      void commit() { _db->commit_transaction(_checkpoint, std::move(obsolete_nodes)); }
      // A transaction can only be aborted if it is the current head.
      void abort()
      {
         // iterate through new_nodes and revert them.
         for (node_ptr node : modified_nodes)
         {
            // relaxed load is safe because anything that wrote them
            // has already synchronized with us.  The last write was
            // either in this transaction or in a later transaction
            // that was aborted.
            // TODO: are we certain that this page is in memory?
            page_header* page = _db->translate_page_address(node->load(std::memory_order_relaxed));
            auto         prev = page->prev.load(std::memory_order_relaxed);
            // We don't need to synchronize with readers before
            // the next gc cycle.
            node->store(prev, std::memory_order_relaxed);
            // pages cannot be freed until it is certain
            // that no read transaction is accessing them.
            _db->queue_gc(page);
         }
         // TODO: check all roots
         page_header* root = _db->root(_checkpoint, 0);
         if (root->version == _db->get_version(_checkpoint))
         {
            _db->queue_gc(root);
         }
         _db->abort_transaction(std::move(_checkpoint));
         // Clean up state
         _db = nullptr;
         modified_nodes.clear();
      }

      void on_delete(page_header* p) { obsolete_nodes.push_back(p); }

      void on_copy(node_ptr ptr)
      {
         obsolete_nodes.push_back(_db->translate_page_address(
             _db->translate_page_address(ptr->load(std::memory_order_relaxed))->prev));
         modified_nodes.push_back(ptr);
      }

     private:
      page_manager* _db;
      checkpoint    _checkpoint;
      // list of pages obsoleted by this transaction
      std::vector<page_header*> obsolete_nodes;
      // list of pages created by this transaction
      std::vector<node_ptr> modified_nodes;
   };

}  // namespace psidb
