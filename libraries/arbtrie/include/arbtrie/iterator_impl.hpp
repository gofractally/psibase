#pragma once
#include <arbtrie/beta_iterator.hpp>
#include <arbtrie/concepts.hpp>
#include <arbtrie/read_lock.hpp>
#include <arbtrie/seg_alloc_session.hpp>
#include <arbtrie/seg_allocator.hpp>
#include <utility>

namespace arbtrie
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
      return iterator<CacheMode>(*_rs, subtree());
   }
   template <iterator_caching_mode CacheMode>
   node_handle iterator<CacheMode>::subtree() const
   {
      return node_handle(*_rs, value(
                                   [&](value_type v)
                                   {
                                      if (not v.is_subtree())
                                         return id_address(0);
                                      return v.subtree_address();
                                   }));
   }

   /**
    * Read value into a resizeable buffer of contiguous memory
    * @tparam Buffer Type that supports resize() and data() for contiguous memory access
    * @param buffer The buffer to read the value into
    * @return 
    *   >= 0: Number of bytes read into buffer on success
    *   iterator::value_nothing: Value not found
    *   iterator::value_subtree: Found subtree value (use subtree_iterator() instead)
    */
   template <iterator_caching_mode CacheMode>
   int32_t iterator<CacheMode>::value(Buffer auto&& buffer) const
   {
      return value(
          [&](value_type v) -> int32_t
          {
             if (!v.is_view()) [[unlikely]]
                return value_nothing - v.is_subtree();
             auto view = v.view();
             buffer.resize(view.size());
             memcpy(buffer.data(), view.data(), view.size());
             return static_cast<int32_t>(view.size());
          });
   }

   template <iterator_caching_mode CacheMode>
   template <typename B>
      requires ConstructibleBuffer<B>
   B iterator<CacheMode>::value() const
   {
      B buffer;
      switch (value(buffer))
      {
         case value_nothing:
            throw std::runtime_error("value not found");
         case value_subtree:
            throw std::runtime_error("subtree value found, use subtree_iterator() instead");
         default:
            return buffer;
      }
      __builtin_unreachable();
   }

   /**
    * Read value into a contiguous memory buffer
    * @tparam ByteType Type of the buffer (e.g., char, unsigned char, etc.)
    * @param s Pointer to the buffer
    * @param s_len Length of the buffer
    * @return Number of bytes read into buffer on success
    *   iterator::value_nothing: Value not found
    *   iterator::value_subtree: Found subtree value (use subtree_iterator() instead)
    */
   template <iterator_caching_mode CacheMode>
   template <typename ByteType>
   int32_t iterator<CacheMode>::value(ByteType* s, uint32_t s_len) const
   {
      static_assert(sizeof(ByteType) == 1, "ByteType must be a single byte type");
      return value(
          [&](value_type v) -> int32_t
          {
             if (!v.is_view()) [[unlikely]]
                return value_nothing - v.is_subtree();
             auto     view          = v.view();
             uint32_t bytes_to_copy = std::min<uint32_t>(view.size(), s_len);
             memcpy(s, view.data(), bytes_to_copy);
             return bytes_to_copy;
          });
   }
   /**
    * Read value at current iterator position and invoke callback with the value
    * @tparam Callback Callable type that accepts value_type parameter
    * @param callback Function to call with the value
    * @return Value returned by callback on success
    */
   template <iterator_caching_mode CacheMode>
   auto iterator<CacheMode>::value(std::invocable<value_type> auto&& callback) const
   {
      auto state = _rs->lock();
      auto addr  = _path_back->oid;

      std::optional<decltype(callback(value_type()))> result;
      auto                                            idx = _path_back->index;

      while (true)
      {
         auto oref = state.get(addr);
         if (cast_and_call(oref.template header<node_header, CacheMode>(),
                           [&](const /*arbtrie::node*/ auto* n)
                           {
                              auto val = n->get_value(local_index(idx));
                              switch (val.type())
                              {
                                 case value_type::types::value_node:
                                    addr = val.value_address();
                                    idx  = 0;
                                    return false;  // continue to value_node
                                 default:
                                    result.emplace(callback(val));
                                    return true;  // done
                              }
                           }))
            return *result;
      }
      __builtin_unreachable();
   }

   template <iterator_caching_mode CacheMode>
   bool iterator<CacheMode>::lower_bound(key_view key)
   {
      if (not _root.address()) [[unlikely]]
         return false;
      auto state = _rs->lock();
      begin();
      return lower_bound_impl(state, key);
   }

   /**
    * Implementation of the lower_bound algorithm for finding the first key greater than or equal to a search key.
    * The algorithm traverses the tree structure while maintaining the following invariants:
    * 1. The path from root to current node represents the common prefix between search key and any potential match
    * 2. At each node, we either:
    *    a) Match the prefix and continue down
    *    b) Find the prefix is greater than search key and move to next key
    *    c) Find a mismatch in prefix and need to backtrack
    *
    * Algorithm steps:
    * 1. At each node:
    *    - For non-binary nodes (inner/radix):
    *      a) Compare node's prefix with search key
    *      b) If prefix > key: Move to next key as all following keys will be greater
    *      c) Find common prefix between node's prefix and search key
    *      d) If common prefix != node's prefix (aka prefix < key):
    *            then all keys down this branch will be less than key
    *            therefore pop back up and move to next key above current branch
    *      e) Otherwise: Push common prefix and continue with remaining key
    *
    * 2. Find insertion point in current node:
    *    - Get lower_bound_index for remaining key
    *    - If index >= end: Pop up and move to next key as all keys in node are smaller
    *    - If at begin_index: Move to next key as we need something greater
    *
    * 3. Process found branch:
    *    - For inner nodes:
    *      a) Handle EOF branch specially
    *      b) Update branch with first byte
    *      c) Check if we've moved past search key
    *      d) Push path and continue or return based on comparison
    *    - For binary/value nodes:
    *      Simply update entire branch key
    *
    * The algorithm maintains correctness by:
    * - Always comparing full prefixes before descending
    * - Properly handling backtracking when prefixes mismatch
    * - Ensuring movement to next key when current path can't contain target
    * - Maintaining proper state during tree traversal
    *
    * @param state The read lock state for accessing nodes
    * @param key The search key to find lower bound for
    * @return true if a valid key was found, false if we reached the end
    */
   template <iterator_caching_mode CacheMode>
   bool iterator<CacheMode>::lower_bound_impl(read_lock& state, key_view key)
   {
      const bool should_debug = false;  //to_hex(key) == "598dd6d3bc4f";
      size_t     depth        = 0;

      while (true)
      {
         depth++;
         if (should_debug)
         {
            TRIEDENT_DEBUG(std::string(depth * 4, ' '),
                           "lower_bound_impl starting search for key: '", to_hex(key), "'");
         }
         auto oref = state.get(_path_back->oid);
         // clang-format off
         if (cast_and_call(oref.template header<node_header, CacheMode>(),
              [&](const /*arbtrie::node*/ auto* n) -> bool
              {
               if( should_debug ) TRIEDENT_DEBUG( node_type_names[n->type] );
                 if constexpr (not is_binary_node<decltype(n)>)
                 {
                    auto pre = n->get_prefix();
                    if (should_debug) {
                       TRIEDENT_DEBUG(std::string(depth*4, ' '), "Checking prefix: '", to_hex(pre), "' against key: '", to_hex(key), "'");
                    }
                    if (pre > key) [[unlikely]]  // then go up the tree
                    {
                       if (should_debug) {
                          TRIEDENT_DEBUG(std::string(depth*4, ' '), "Prefix > key, go to next");
                       }
                       return next_impl(state), true;  // All keys in this subtree will be greater than search key
                    }

                    auto cpre = common_prefix(pre, key);
                    if (should_debug) {
                       TRIEDENT_DEBUG(std::string(depth*4, ' '), "Common prefix length: ", cpre.size(), " prefix length: ", pre.size());
                    }

                    // then go to the next branch of the parent
                    if (cpre != pre)  {  // Prefix mismatch - current branch cannot contain target
                       if (should_debug) {
                          TRIEDENT_DEBUG(std::string(depth*4, ' '), "Prefix mismatch, popping path");
                       }
                       pop_path(); 
                       if (not is_end())
                          next_impl(state);  // Try next key at parent level
                       return true;  // Reached end of tree
                    }

                    push_prefix(cpre);  // Record matched prefix
                    key = key.substr(cpre.size());  // Continue with remaining key portion
                    if (should_debug) {
                       TRIEDENT_DEBUG(std::string(depth*4, ' '), "Pushed prefix, remaining key: '", to_hex(key), "'");
                    }
                 } // end not binary node 

                 auto nidx = n->lower_bound_index(key);  // Find insertion point for remaining key
                 if (should_debug) {
                    TRIEDENT_DEBUG(std::string(depth*4, ' '), "Found index: ", nidx.to_int(), " of ", n->end_index().to_int());
                 }
                 if (nidx >= n->end_index())  // All keys in node are smaller
                 {
                    if (should_debug) {
                       TRIEDENT_DEBUG(std::string(depth*4, ' '), "All keys in node are smaller, popping path");
                    }
                    pop_path();
                    if (not is_end())
                       next_impl(state);  // Try next key at parent
                    return true;  // Found valid key or reached end
                 }

                 if( nidx == n->begin_index() )  // Need something greater than current
                 {
                    if (should_debug) {
                       TRIEDENT_DEBUG(std::string(depth*4, ' '), "At begin index, moving to next");
                    }
                    return next_impl(state), true;
                 }

                 auto bkey = n->get_branch_key(nidx);
                 if (should_debug) {
                    TRIEDENT_DEBUG(std::string(depth*4, ' '), "Branch key: '", to_hex(bkey), "'");
                 }

                 if constexpr (is_inner_node<decltype(n)>)
                 {
                    if (not bkey.size())  // eof value
                    {
                       if (should_debug) {
                          TRIEDENT_DEBUG(std::string(depth*4, ' '), "Found EOF value");
                       }
                       return update_branch(nidx), true;  // Record EOF branch and we're done
                    }
                    update_branch(bkey.front(), nidx);  // Record first byte of branch

                    bool past_key = not key.size() or uint8_t(bkey.front()) > uint8_t(key.front());  // Check if we've moved past search key
                    if (should_debug) {
                       TRIEDENT_WARN(" bkey: ", to_hex(bkey), "> key: ", to_hex(key));
                       TRIEDENT_DEBUG(std::string(depth*4, ' '), "Past key: ", past_key);
                    }

                    key = key.substr(key.size() > 0);  // Remove first byte for recursion
                    push_path(n->get_value(nidx).value_address(), begin_index);  // Descend to child node

                    if (past_key)
                    {
                       if (should_debug) {
                          TRIEDENT_DEBUG(std::string(depth*4, ' '), "Past key, moving to next_impl");
                       }
                       return next_impl(state), true;  // Found first key greater than search key
                    }
                    return false;  // Continue search in child node
                 }
                 else  // on binary nodes / value nodes we have to swap the entire key
                 {
                    if (should_debug) {
                       TRIEDENT_DEBUG(std::string(depth*4, ' '), "On binary/value node, updating branch with full key");
                    }
                    update_branch(bkey, nidx);

                    if( bkey >= key )
                    {
                       if (should_debug) 
                          TRIEDENT_DEBUG(std::string(depth*4, ' '), "Branch key >= search key, we're done");
                       return true;
                    }
                     if (should_debug) {
                        TRIEDENT_DEBUG(std::string(depth*4, ' '), "Branch key < search key, moving to next");
                     }
                     return next_impl(state), true;

                 }
              }))
            return not is_end();
         // clang-format on
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
         if (cast_and_call(oref.template header<node_header, CacheMode>(),
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
                                 return push_path(n->get_value(nidx).value_address(), begin_index),
                                        false;
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
         if (cast_and_call(oref.template header<node_header, CacheMode>(),
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
                                 return push_path(n->get_value(nidx).value_address(), end_index),
                                        false;
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
      if (not _root.address().to_int()) [[unlikely]]
      {
         TRIEDENT_WARN("upper_bound: no root: ", _root.address());
         return false;
      }

      auto state = _rs->lock();
      begin();
      if (not lower_bound_impl(state, search))
         return false;

      //TRIEDENT_DEBUG(" lower_bound: ", to_hex(key()), " >= ", to_hex(search));
      assert(key() >= search);
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
      end();
      push_end(_root.address());
      return prev_impl(state);
   }

   template <iterator_caching_mode CacheMode>
   auto iterator<CacheMode>::find(key_view key, std::invocable<value_type> auto&& callback)
       -> decltype(callback(value_type()))
   {
      auto state = _rs->lock();
      return get_impl(state, key, std::forward<decltype(callback)>(callback));
   }

   template <iterator_caching_mode CacheMode>
   auto iterator<CacheMode>::get(key_view key, std::invocable<value_type> auto&& callback)
       -> decltype(callback(value_type()))
   {
      if (not _root.address()) [[unlikely]]
         return callback(value_type());

      if (key.size() > max_key_length)
         throw std::runtime_error("invalid key length");

      auto state = _rs->lock();
      return get_impl(state, key, std::forward<decltype(callback)>(callback));
   }

   template <iterator_caching_mode CacheMode>
   auto iterator<CacheMode>::get_impl(read_lock& state, key_view key, auto&& callback)
       -> decltype(callback(value_type()))
   {
      auto                             addr = _path_back->oid;
      decltype(callback(value_type())) result;

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
                                 default:
                                    result = callback(val);
                                    return true;
                              }
                           }))
            return result;
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
      return _path_back >= _path->data() and _path_back->oid != id_address();
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

   template <iterator_caching_mode CacheMode>
   iterator<CacheMode>::iterator(read_session& s, node_handle r)
       : _size(-1),
         _rs(&s),
         _root(std::move(r)),
         _path(std::make_unique<std::array<path_entry, max_key_length + 1>>()),
         _branches(std::make_unique<std::array<char, max_key_length>>())
   {
      clear();
      push_rend(_root.address());
   }

   template <iterator_caching_mode CacheMode>
   iterator<CacheMode>::iterator(const iterator& other)
       : _size(other._size),
         _rs(other._rs),
         _root(other._root),
         _path(std::make_unique<std::array<path_entry, max_key_length + 1>>(*other._path)),
         _branches(std::make_unique<std::array<char, max_key_length>>(*other._branches)),
         _path_back(_path->data() + (other._path_back - other._path->data())),
         _branches_end(_branches->data() + (other._branches_end - other._branches->data()))
   {
   }

   template <iterator_caching_mode CacheMode>
   iterator<CacheMode>::iterator(iterator&& other) noexcept
       : _size(other._size),
         _rs(other._rs),
         _root(std::move(other._root)),
         _path(std::move(other._path)),
         _branches(std::move(other._branches)),
         _path_back(other._path_back),
         _branches_end(other._branches_end)
   {
      other._path_back    = nullptr;
      other._branches_end = nullptr;
      other._rs           = nullptr;
   }

   template <iterator_caching_mode CacheMode>
   iterator<CacheMode>& iterator<CacheMode>::operator=(const iterator& other)
   {
      if (this != &other)
      {
         _size         = other._size;
         _rs           = other._rs;
         _root         = other._root;
         _path         = std::make_unique<std::array<path_entry, max_key_length + 1>>(*other._path);
         _branches     = std::make_unique<std::array<char, max_key_length>>(*other._branches);
         _path_back    = _path->data() + (other._path_back - other._path->data());
         _branches_end = _branches->data() + (other._branches_end - other._branches->data());
      }
      return *this;
   }

   template <iterator_caching_mode CacheMode>
   iterator<CacheMode>& iterator<CacheMode>::operator=(iterator&& other) noexcept
   {
      if (this != &other)
      {
         _size               = other._size;
         _rs                 = other._rs;
         _root               = std::move(other._root);
         _path               = std::move(other._path);
         _branches           = std::move(other._branches);
         _path_back          = other._path_back;
         _branches_end       = other._branches_end;
         other._path_back    = nullptr;
         other._branches_end = nullptr;
         other._rs           = nullptr;
      }
      return *this;
   }

}  // namespace arbtrie
