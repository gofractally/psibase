#pragma once
#include <arbtrie/beta_iterator.hpp>
#include <arbtrie/concepts.hpp>
#include <arbtrie/read_lock.hpp>
#include <arbtrie/seg_alloc_session.hpp>
#include <arbtrie/seg_allocator.hpp>
#include <utility>

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
         for (size_t i = 0; i < _path->size(); ++i)
         {
            const auto& entry = (*_path)[i];
            if (&entry > _path_back)
               break;

            if (i > 0)
               ss << " / ";
            // Print prefix
            ss << "'" << key_view(_branches->data() + pos, entry.prefix_size) << "'";
            pos += entry.prefix_size;
            // Print branch if it exists
            if (entry.branch_size > 0)
            {
               ss << " '" << key_view(_branches->data() + pos, entry.branch_size) << "'";
            }
            pos += entry.branch_size;
         }
         return ss.str();
      }

      template <iterator_caching_mode CacheMode>
      iterator<CacheMode> iterator<CacheMode>::subtree_iterator() const
      {
         id_address val_addr;
         read_value(
             [&](auto v)
             {
                if constexpr (is_id_address<decltype(v)>)
                   val_addr = v;
                else
                   throw std::runtime_error(
                       "cannot create subtree iterator from non-subtree value");
             });
         return iterator<CacheMode>(*_rs, val_addr);
      }

      template <iterator_caching_mode CacheMode>
      int32_t iterator<CacheMode>::read_value(auto& buffer) const
      {
         return read_value(
             [=](value_view v)
             {
                if constexpr (is_id_address<decltype(v)>)
                   throw std::runtime_error("subtree found in read_value");
                else
                {
                   buffer.resize(v.size());
                   memcpy(buffer.data(), v.data(), v.size());
                   return buffer.size();
                }
             });
      }

      template <iterator_caching_mode CacheMode>
      int32_t iterator<CacheMode>::read_value(char* s, uint32_t s_len) const
      {
         return read_value(
             [=](auto v)
             {
                if constexpr (is_id_address<decltype(v)>)
                   throw std::runtime_error("subtree found in read_value");
                else
                {
                   uint32_t bytes_to_copy = std::min(v.size(), s_len);
                   memcpy(s, v.data(), bytes_to_copy);
                   return bytes_to_copy;
                }
             });
      }

      template <iterator_caching_mode CacheMode>
      int32_t iterator<CacheMode>::read_value(auto&& callback) const
      {
         auto    state      = _rs->lock();
         auto    addr       = _path_back->oid;
         int32_t bytes_read = -1;
         while (true)
         {
            auto oref = state.get(addr);
            if (cast_and_call(oref.template header<node_header, CacheMode>(),
                              [&](const /*arbtrie::node*/ auto* n)
                              {
                                 auto val = n->get_value(local_index(_path_back->index));
                                 switch (val.type())
                                 {
                                    case value_type::types::value_node:
                                       addr = val.value_address();
                                       return false;  // continue to value_node
                                    case value_type::types::subtree:
                                       bytes_read = -2;
                                       callback(val.subtree_address());
                                       return true;  // done
                                    case value_type::types::data:
                                       bytes_read = callback(val.view());
                                    case value_type::types::remove:
                                    default:
                                       return true;  // done
                                 }
                              }))
               return bytes_read;
         }
         __builtin_unreachable();
      }

      template <iterator_caching_mode CacheMode>
      bool iterator<CacheMode>::lower_bound(key_view key)
      {
         auto state = _rs->lock();
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
                       {
                          pop_path();
                          next_impl(state);
                          return true;
                       }

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
         auto state = _rs->lock();
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
         auto state = _rs->lock();
         if (is_end()) [[unlikely]]
         {
            _path_back = _path->data();
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
                          if (_path_back != _path->data())
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
         auto state = _rs->lock();
         begin();
         if (not lower_bound_impl(state, search))
            return false;
         // If we found an exact match for the search key, move to the next element
         if (key() == search)
            return next_impl(state);
         return true;
      }

      template <iterator_caching_mode CacheMode>
      bool iterator<CacheMode>::last(key_view prefix)
      {
         if (not _root.address()) [[unlikely]]
            return end();

         if (prefix.size() > max_key_length)
            throw std::runtime_error("invalid key length");

         auto state = _rs->lock();
         begin();

         // If no prefix is provided, find the last key in the entire tree
         if (prefix.empty())
            return end(), prev_impl(state);

         // Create a search key that is the prefix followed by 0xFF bytes
         std::array<char, max_key_length> search_key;
         memcpy(search_key.data(), prefix.data(), prefix.size());
         memset(search_key.data() + prefix.size(), 0xff, max_key_length - prefix.size());

         // Try to find a key greater than or equal to our search key
         if (lower_bound_impl(state, key_view(search_key.data(), search_key.size())))
         {
            // If we found a key that starts with our prefix, we're done
            if (key().starts_with(prefix))
               return true;

            // Otherwise try the previous key
            if (prev_impl(state) and key().starts_with(prefix))
               return true;
         }
         return end();
      }

      template <iterator_caching_mode CacheMode>
      bool iterator<CacheMode>::first(key_view prefix)
      {
         if (not _root.address()) [[unlikely]]
            return end();

         if (prefix.size() > max_key_length)
            throw std::runtime_error("invalid key length");

         auto state = _rs->lock();
         begin();

         // If no prefix is provided, just move to the first key
         if (prefix.empty())
            return next_impl(state);

         // Find the first key that is greater than or equal to the prefix
         if (not lower_bound_impl(state, prefix))
            return end();

         // Check if the found key starts with our prefix
         if (not key().starts_with(prefix))
            return end();

         return true;
      }

      template <iterator_caching_mode CacheMode>
      bool iterator<CacheMode>::reverse_lower_bound(key_view prefix)
      {
         if (not _root.address()) [[unlikely]]
            return end();

         if (prefix.size() > max_key_length)
            throw std::runtime_error("invalid key length");

         auto state = _rs->lock();
         begin();

         // First try to find the exact prefix or the next key after it
         if (lower_bound_impl(state, prefix))
         {
            // If we found a key greater than the prefix, move back one
            if (key() > prefix)
               return prev_impl(state);
            assert(key() == prefix);
            return true;
         }

         // At this point:
         // 1. lower_bound(prefix) returned end(), meaning all keys are < prefix
         // 2. if prev_impl() succeeds, we're at the last key in the database
         // 3. Since all keys are < prefix, this last key must be first key less than prefix
         return end(), prev_impl(state);
      }

      template <iterator_caching_mode CacheMode>
      bool iterator<CacheMode>::find(key_view key, auto&& callback)
      {
         return false;
      }

      template <iterator_caching_mode CacheMode>
      bool iterator<CacheMode>::get(key_view key, auto&& callback)
      {
         if (not _root.address()) [[unlikely]]
            return false;

         if (key.size() > max_key_length)
            throw std::runtime_error("invalid key length");

         auto state = _rs->lock();
         return get_impl(state, key, std::forward<decltype(callback)>(callback));
      }

      template <iterator_caching_mode CacheMode>
      bool iterator<CacheMode>::get_impl(read_lock& state, key_view key, auto&& callback)
      {
         auto addr  = _path_back->oid;
         bool found = false;
         while (true)
         {
            auto oref = state.get(addr);
            if (cast_and_call(oref.template header<node_header, CacheMode>(),
                              [&](const /*arbtrie::node*/ auto* n)
                              {
                                 auto val = n->get_value_and_trailing_key(key);
                                 switch (val.type())
                                 {
                                    case value_type::types::value_node:
                                       addr = val.value_address();
                                       return false;  // continue to value_node
                                    case value_type::types::subtree:
                                    case value_type::types::data:
                                       found = true;
                                    case value_type::types::remove:
                                    default:
                                       return callback(val), true;  // done
                                 }
                              }))
               return found;
         }
         __builtin_unreachable();
      }

      template <iterator_caching_mode CacheMode>
      bool iterator<CacheMode>::is_begin() const
      {
         return (*_path)[0].index == rend_index.to_int();
      }

      template <iterator_caching_mode CacheMode>
      bool iterator<CacheMode>::is_end() const
      {
         return _path_back == _path->data() - 1;
      }

      template <iterator_caching_mode CacheMode>
      node_handle iterator<CacheMode>::get_root() const
      {
         return _root;
      }

      template <iterator_caching_mode CacheMode>
      key_view iterator<CacheMode>::key() const
      {
         return to_key(_branches->data(), _branches_end - _branches->data());
      }

      template <iterator_caching_mode CacheMode>
      bool iterator<CacheMode>::valid() const
      {
         return _path_back >= _path->data();
      }

      template <iterator_caching_mode CacheMode>
      node_handle iterator<CacheMode>::root_handle() const
      {
         return _root;
      }

      template <iterator_caching_mode CacheMode>
      template <typename... Args>
      void iterator<CacheMode>::debug_print(const Args&... args) const
      {
         return;
         std::cerr << std::string(_path->size() * 4, ' ');
         (std::cerr << ... << args) << "\n";
      }

      template <iterator_caching_mode CacheMode>
      bool iterator<CacheMode>::end()
      {
         return clear(), false;
      }

      template <iterator_caching_mode CacheMode>
      void iterator<CacheMode>::begin()
      {
         clear();
         push_rend(_root.address());
      }

      template <iterator_caching_mode CacheMode>
      void iterator<CacheMode>::push_rend(id_address oid)
      {
         _path_back++;
         *_path_back = {.oid = oid, .index = rend_index.to_int()};
      }

      template <iterator_caching_mode CacheMode>
      void iterator<CacheMode>::push_end(id_address oid)
      {
         _path_back++;
         *_path_back = {.oid = oid, .index = end_index.to_int()};
      }

      template <iterator_caching_mode CacheMode>
      void iterator<CacheMode>::push_path(id_address oid, local_index branch_index)
      {
         _path_back++;
         *_path_back = {.oid = oid, .index = branch_index.to_int()};
      }

      template <iterator_caching_mode CacheMode>
      void iterator<CacheMode>::pop_path()
      {
         _branches_end -= _path_back->key_size();
         --_path_back;
      }

      template <iterator_caching_mode CacheMode>
      void iterator<CacheMode>::push_prefix(key_view prefix)
      {
         memcpy(_branches_end, prefix.data(), prefix.size());
         _branches_end += prefix.size();
         _path_back->prefix_size = prefix.size();
         _path_back->branch_size = 0;
      }

      template <iterator_caching_mode CacheMode>
      void iterator<CacheMode>::update_branch(key_view new_branch, local_index new_index)
      {
         // Adjust size of branches to remove old key and make space for new key
         _branches_end -= _path_back->branch_size;
         memcpy(_branches_end, new_branch.data(), new_branch.size());
         _branches_end += new_branch.size();

         _path_back->branch_size = new_branch.size();
         _path_back->index       = new_index.to_int();
      }

      template <iterator_caching_mode CacheMode>
      void iterator<CacheMode>::update_branch(local_index new_index)
      {
         _branches_end -= _path_back->branch_size;
         _path_back->index       = new_index.to_int();
         _path_back->branch_size = 0;
      }

      template <iterator_caching_mode CacheMode>
      void iterator<CacheMode>::update_branch(char new_branch, local_index new_index)
      {
         // Adjust size of branches to remove old key and make space for new key
         _branches_end -= _path_back->branch_size;
         *_branches_end = new_branch;
         _branches_end++;
         _path_back->branch_size = 1;
         _path_back->index       = new_index.to_int();
      }

      template <iterator_caching_mode CacheMode>
      local_index iterator<CacheMode>::current_index() const
      {
         return local_index(_path_back->index);
      }

      template <iterator_caching_mode CacheMode>
      void iterator<CacheMode>::clear()
      {
         _branches_end = _branches->data();
         _path_back    = _path->data() - 1;
      }

   }  // namespace beta

}  // namespace arbtrie
