#pragma once
#include <arbtrie/beta_iterator.hpp>
#include <arbtrie/concepts.hpp>
#include <arbtrie/read_lock.hpp>
#include <arbtrie/seg_alloc_session.hpp>
#include <arbtrie/seg_allocator.hpp>

namespace arbtrie
{
   namespace beta
   {

      template <iterator_caching_mode CacheMode>
      std::string iterator<CacheMode>::pretty_path() const
      {
         std::stringstream ss;
         ss << "'" << key() << "' => ";
         size_t pos = 0;
         for (size_t i = 0; i < _path.size(); ++i)
         {
            const auto& entry = _path[i];
            if (i > 0)
               ss << " / ";
            // Print prefix
            ss << "'" << key_view(_branches.data() + pos, entry.prefix_size) << "'";
            pos += entry.prefix_size;
            // Print branch if it exists
            if (entry.branch_size > 0)
            {
               ss << " '" << key_view(_branches.data() + pos, entry.branch_size) << "'";
            }
            pos += entry.branch_size;
         }
         return ss.str();
      }

      template <iterator_caching_mode CacheMode>
      bool iterator<CacheMode>::next()
      {
         auto state = _rs.lock();
         return next_impl(state);
      }

      /**
    * @brief Move to the next key in the iterator
    * 
    * @param state the segment allocator state
    * @return true if the iterator is now at a valid key, false if the iterator is at the end
    */
      template <iterator_caching_mode CacheMode>
      bool iterator<CacheMode>::next_impl(read_lock& state)
      {
         // Loop until we reach the end of the iterator
         while (true)  //not is_end())
         {
            auto oref = state.get(_path_back->oid);
            //   debug_print("Node ", _path.back().oid, " key: ", key());

            // Cast to appropriate node type and process
            if (cast_and_call(oref.template header<node_header, CacheMode>(),
                              [&](const /*arbtrie::node*/ auto* n)
                              {
                                 const local_index start_idx = current_index();
                                 // debug_print("  Type: ", node_type_names[n->get_type()],
                                 //             " start_idx: ", start_idx.to_int());

                                 // on transition from before the first key,
                                 // push the common prefix
                                 if (start_idx == begin_index)
                                 {
                                    // debug_print("  Pushing prefix: ", n->get_prefix());
                                    push_prefix(n->get_prefix());
                                 }

                                 // Get the next index in this node
                                 auto nidx = n->next_index(start_idx);
                                 // debug_print("  Next index: ", nidx.to_int());

                                 if (nidx >= n->end_index())
                                 {
                                    // debug_print("  At end of node");
                                    // if we are at the top of the tree, we are done
                                    if (_path_back == _path.data())
                                    {
                                       // debug_print("  At root - setting end index");
                                       _path_back->index = end_index.to_int();
                                       return true;
                                    }

                                    // If at end of node, pop it and continue searching up the tree
                                    // debug_print("  Popping node and continuing up");
                                    pop_path();
                                    return false;  // continue the outer loop
                                 }

                                 // on setlist and full nodes just swap the last byte
                                 // on binary nodes we have to swap the entire key
                                 // debug_print("  Updating branch key for index ", nidx.to_int());
                                 update_branch(n->get_branch_key(nidx), nidx);

                                 // I have either arrived at the next value, or need to continue down the tree
                                 switch (n->get_type(nidx))
                                 {
                                    case value_type::types::subtree:
                                       // debug_print("  Found subtree - stopping");
                                       return true;  // stop searching
                                    case value_type::types::data:
                                       // debug_print("  Found data - stopping");
                                       return true;  // stop searching
                                    case value_type::types::value_node:
                                       // debug_print("  Found value node - continuing down");
                                       push_path(n->get_value(nidx).value_address(), begin_index);
                                       return false;  // continue down the tree
                                    case value_type::types::remove:
                                       throw std::runtime_error(
                                           "iterator::next: remove type found");
                                 }
                              }))
               return not is_end();
         }
         throw std::runtime_error("iterator::next: attempt to move past end");
      }

   }  // namespace beta

}  // namespace arbtrie
