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
            if (&entry > _path_back)
               break;

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
         while (true)
         {
            auto oref = state.get(_path_back->oid);

            // Cast to appropriate node type and process
            if (cast_and_call(
                    oref.template header<node_header, CacheMode>(),
                    [&](const /*arbtrie::node*/ auto* n)
                    {
                       const local_index start_idx = current_index();
                       // on transition from before the first key,
                       // push the common prefix
                       if (start_idx == begin_index)
                          push_prefix(n->get_prefix());

                       // Get the next index in this node
                       auto nidx = n->next_index(start_idx);

                       if (nidx >= n->end_index())
                          return pop_path(), is_end();

                       // if the branch key is empty, that means the branch is EOF
                       auto bkey = n->get_branch_key(nidx);

                       if constexpr (std::is_same_v<decltype(n), const setlist_node*> or
                                     std::is_same_v<decltype(n), const full_node*>)
                       {
                          if (not bkey.size())  // eof value
                             return update_branch(nidx), true;
                          update_branch(bkey.front(), nidx);  // on just swap the last byte
                          return push_path(n->get_value(nidx).value_address(), begin_index), false;
                       }
                       else  // on binary nodes / value nodes we have to swap the entire key
                          return update_branch(bkey, nidx), true;
                    }))
               return not is_end();
         }
         throw std::runtime_error("iterator::next: attempt to move past end");
      }

      template <iterator_caching_mode CacheMode>
      bool iterator<CacheMode>::prev()
      {
         auto state = _rs.lock();
         if (is_end()) [[unlikely]]
         {
            _path_back = _path.data();
            auto oref  = state.get(_path_back->oid);
            _path_back->index =
                cast_and_call(oref.template header<node_header, CacheMode>(),
                              [&](const /*arbtrie::node*/ auto* n) { return n->end_index(); })
                    .to_int();
         }
         return prev_impl(state);
      }

      /**
       * @brief Move to the previous key in the iterator
       * 
       * @param state the segment allocator state
       * @return true if the iterator is now at a valid key, false if the iterator is at the beginning
       */
      template <iterator_caching_mode CacheMode>
      bool iterator<CacheMode>::prev_impl(read_lock& state)
      {
         // Loop until we reach the beginning of the iterator
         while (true)
         {
            //   std::cerr << "prev_impl: " << pretty_path() << "\n";
            auto oref = state.get(_path_back->oid);

            // Cast to appropriate node type and process
            if (cast_and_call(
                    oref.template header<node_header, CacheMode>(),
                    [&](const /*arbtrie::node*/ auto* n)
                    {
                       const local_index start_idx = current_index();
                       // on transition from after the last key,
                       // push the common prefix
                       if (start_idx >= n->end_index())
                          push_prefix(n->get_prefix());

                       // Get the previous index in this node
                       auto nidx = n->prev_index(start_idx);

                       if (nidx <= n->begin_index())
                       {
                          if (_path_back != _path.data())
                             return pop_path(), false;  // continue up the tree

                          // if we are at the top of the tree, we are done
                          _path_back->index = rend_index.to_int();
                          return true;
                       }

                       // if the branch key is empty, that means the branch is EOF
                       auto bkey = n->get_branch_key(nidx);

                       if constexpr (std::is_same_v<decltype(n), const setlist_node*> or
                                     std::is_same_v<decltype(n), const full_node*>)
                       {
                          if (not bkey.size())  // eof value
                             return update_branch(nidx), true;
                          update_branch(bkey.front(), nidx);  // on just swap the last byte
                          return push_path(n->get_value(nidx).value_address(), end_index), false;
                       }
                       else  // on binary nodes / value nodes we have to swap the entire key
                          return update_branch(bkey, nidx), true;
                    }))
               return not is_rend();
         }
         throw std::runtime_error("iterator::prev: attempt to move before beginning");
      }

   }  // namespace beta

}  // namespace arbtrie
