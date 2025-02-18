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
      bool iterator<CacheMode>::lower_bound(key_view key)
      {
         auto state = _rs.lock();
         begin();
         return lower_bound_impl(state, key);
      }

      template <iterator_caching_mode CacheMode>
      bool iterator<CacheMode>::lower_bound_impl(read_lock& state, key_view key)
      {
         while (true)
         {
            auto oref = state.get(_path_back->oid);
            if (cast_and_call(
                    oref.template header<node_header, CacheMode>(),
                    [&](const /*arbtrie::node*/ auto* n)
                    {
                       if constexpr (not is_binary_node<decltype(n)>)
                       {
                          auto pre = n->get_prefix();
                          if (pre > key) [[unlikely]]  // then go up the tree
                             return end(), true;

                          auto cpre = common_prefix(pre, key);
                          if (cpre != pre)  // then go to first branch
                             return next_impl(state);

                          push_prefix(cpre);
                          key = key.substr(cpre.size());
                       }

                       auto nidx = n->lower_bound_index(key);
                       if (nidx >= n->end_index())
                          return pop_path(), next_impl(state);

                       auto bkey = n->get_branch_key(nidx);

                       if constexpr (is_inner_node<decltype(n)>)
                       {
                          if (not bkey.size())  // eof value
                             return update_branch(nidx), true;
                          update_branch(bkey.front(), nidx);
                          key = key.substr(key.size() > 0);  // remove the first byte, and recurse
                          return push_path(n->get_value(nidx).value_address(), begin_index), false;
                       }
                       else  // on binary nodes / value nodes we have to swap the entire key
                          return update_branch(bkey, nidx), true;
                    }))
               return not is_end();
         }
         throw std::runtime_error("iterator::lower_bound: attempt to move past end");
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

                       // on transition from before the first key push the common prefix
                       if constexpr (not is_binary_node<decltype(n)>)
                          if (start_idx == begin_index)
                             push_prefix(n->get_prefix());

                       // Get the next index in this node
                       auto nidx = n->next_index(start_idx);

                       if (nidx >= n->end_index())
                          return pop_path(), is_end();

                       // if the branch key is empty, that means the branch is EOF
                       auto bkey = n->get_branch_key(nidx);

                       if constexpr (is_inner_node<decltype(n)>)
                       {
                          if (not bkey.size())  // eof value
                             return update_branch(nidx), true;
                          update_branch(bkey.front(), nidx);
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

                       // on transition from after the last key, push the common prefix
                       if constexpr (not is_binary_node<decltype(n)>)
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

                       if constexpr (is_inner_node<decltype(n)>)
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

      template <iterator_caching_mode CacheMode>
      bool iterator<CacheMode>::upper_bound(key_view search)
      {
         auto state = _rs.lock();
         begin();
         if (not lower_bound_impl(state, search))
            return false;
         // If we found an exact match for the search key, move to the next element
         if (key() == search)
            return next_impl(state);
         return true;
      }

   }  // namespace beta

}  // namespace arbtrie
