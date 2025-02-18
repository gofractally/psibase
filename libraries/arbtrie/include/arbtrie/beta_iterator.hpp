#pragma once
#include <arbtrie/arbtrie.hpp>
#include <arbtrie/database.hpp>
#include <arbtrie/node_handle.hpp>
#include <arbtrie/seg_alloc_session.hpp>
#include <sstream>
#include <vector>

namespace arbtrie
{
   class read_session;  // Forward declaration

   namespace beta
   {
      /**
    * In caching mode, every node that is visited is marked as
    * read so that the compactor can better sort the most frequently
    * used items.
    */
      enum iterator_caching_mode
      {
         noncaching = 0,
         caching    = 1
      };

      /**
       *   An iterator grabs a read-only snapshot of the database
       *   and provides a consistent view. It can be used in one
       *   of two modes: caching or non-caching. 
       *
       *   In caching mode, every node that is visited is potentially
       *   marked as read so that the compactor can better sort the most
       *   frequently used items. This has some overhead, so it is
       *   recommended to use non-caching mode when speed of the 
       *   present iteration is more important than the speed of future, 
       *   or if you don't want your query of odd items to affect the cache.
       * 
       *   The iterator API is modeled after std::map, so you can go forward
       *   and backward through the database. 
       * 
       *   begin() and rend() point before the first element and end() points
       *   after the last element. first() and last() point to the first and
       *   last elements of the database, respectively. You cannot use next()
       *   from end() or prev() from begin()/rend().
       * 
       *   The iterator is not thread safe. Do not use the same iterator
       *   in multiple threads.
       */
      template <iterator_caching_mode CacheMode = noncaching>
      class iterator
      {
         friend class arbtrie::read_session;
         iterator(read_session& s, node_handle r) : _size(-1), _rs(s), _root(std::move(r))
         {
            clear();
            push_rend(_root.address());
         }
         void clear()
         {
            _branches_end = _branches.data();
            _path_back    = _path.data() - 1;
         }

        public:
         static constexpr local_index rend_index  = local_index(-1);
         static constexpr local_index begin_index = local_index(-1);
         static constexpr local_index end_index   = local_index(257);

         // TODO: npos size == 1024 / max key length
         static constexpr const std::array<char, max_key_length> nposa = []()
         {
            std::array<char, max_key_length> ar;
            ar.fill(0xff);
            return ar;
         }();

         bool is_rend() const { return is_begin(); }
         bool is_begin() const { return _path[0].index == rend_index.to_int(); }
         bool is_end() const { return _path[0].index == end_index.to_int(); }

         static constexpr const key_view npos = key_view(nposa.data(), nposa.size());
         static_assert(npos > key_view());

         // return the root this iterator is based on
         node_handle get_root() const { return _root; }
         // the key the iterator is currently pointing to
         key_view key() const { return to_key(_branches.data(), _branches_end - _branches.data()); }

         bool next();  // moves to next key, return valid()
         bool prev();  // moves to the prv key, return valid()

         // lower_bound(search) + next()
         // similar to std::map::upper_bound
         bool upper_bound(key_view search);

         // moves to the first key >= prefix from the begin, return valid()
         // similar to std::map::lower_bound
         bool lower_bound(key_view prefix = {});

         // moves to the last key <= prefix from the end, return valid()
         //  reverse_lower_bound(key) == lower_bound(key) when key exists
         //  otherwise it equals the key before lower_bound(key)
         bool reverse_lower_bound(key_view prefix = npos);

         // if reverse_lower_bound(key) == key,
         // this returns the prior key, othewise equal to
         // reverse_lower_bound(key)
         bool reverse_upper_bound(key_view prefix = npos);

         // moves to the last key with prefix
         // if no keys contain prefix, return false
         // valid() will return false if this returns false
         bool last(key_view prefix = {});

         // moves to the first key with prefix
         // if no keys contain prefix, return false
         // valid() will return false if this returns false
         bool first(key_view prefix = {});

         // returns false if not found
         template <typename Callback>
         bool get(key_view key, Callback&& callback) const;

         // Like get(), but also positions the iterator at the found key
         // Returns true if found and positions iterator at the key
         // Returns false and calls end() if not found
         template <typename Callback>
         bool get2(key_view key, Callback&& callback);

         // true if the iterator points to a key/value pair
         bool valid() const { return _path_back != _path.data() - 1; }

         // if the value is a subtree, return an iterator into that subtree
         iterator subtree_iterator() const;
         bool     is_subtree() const;
         bool     is_data() const;

         // @return node_handle of subtree iff is_subtree()
         // @throw if not is_subtree()
         node_handle subtree() const;

         // @return a handle to the root of the tree this iterator is traversing
         node_handle root_handle() const { return _root; }

         // return -1 if no
         int32_t value_size() const { return _size; }

         // resizes v to the and copies the value into it
         int32_t read_value(auto& buffer);

         // copies the value into [s,s+s_len)
         //
         // @throw if type is a subtree
         // @return total bytes copied
         //
         int32_t read_value(char* s, uint32_t s_len);

         std::string value_as_string() const;

         // Returns a formatted string showing the path decomposition with each node's prefix and branch components
         std::string pretty_path() const;

        private:
         template <typename... Args>
         void debug_print(const Args&... args) const
         {
            return;
            std::cerr << std::string(_path.size() * 4, ' ');
            (std::cerr << ... << args) << "\n";
         }

         bool next_impl(read_lock& state);

         void end()
         {
            clear();
            push_end(_root.address());
         }
         void begin()
         {
            clear();
            push_rend(_root.address());
         }

         void push_rend(id_address oid)
         {
            _path_back++;
            *_path_back = {.oid = oid, .index = rend_index.to_int()};
         }
         void push_end(id_address oid)
         {
            _path_back++;
            *_path_back = {.oid = oid, .index = end_index.to_int()};
         }
         void push_path(id_address oid, local_index branch_index)
         {
            _path_back++;
            *_path_back = {.oid = oid, .index = branch_index.to_int()};
         }
         void pop_path()
         {
            _branches_end -= _path_back->key_size();
            --_path_back;
         }

         void push_prefix(key_view prefix)
         {
            memcpy(_branches_end, prefix.data(), prefix.size());
            _branches_end += prefix.size();
            _path_back->prefix_size = prefix.size();
            _path_back->branch_size = 0;
         }

         void update_branch(key_view new_branch, local_index new_index)
         {
            // Adjust size of branches to remove old key and make space for new key
            _branches_end -= _path_back->branch_size;
            memcpy(_branches_end, new_branch.data(), new_branch.size());
            _branches_end += new_branch.size();

            _path_back->branch_size = new_branch.size();
            _path_back->index       = new_index.to_int();
         }
         void update_branch(local_index new_index)
         {
            _branches_end -= _path_back->branch_size;
            _path_back->index       = new_index.to_int();
            _path_back->branch_size = 0;
         }
         void update_branch(char new_branch, local_index new_index)
         {
            // Adjust size of branches to remove old key and make space for new key
            _branches_end -= _path_back->branch_size;
            *_branches_end = new_branch;
            _branches_end++;
            _path_back->branch_size = 1;
            _path_back->index       = new_index.to_int();
         }

         local_index current_index() const { return local_index(_path_back->index); }

         struct path_entry
         {
            id_address oid;
            // the length of prefix leading to the value stored at oid
            uint32_t prefix_size : 11 = 0;
            uint32_t branch_size : 11 = 0;
            // -1 for reverse end, analogous to std::map<K,V>::rend()
            // 257 for end, binary_node may not have more than 257 branches
            // node type specific index into the node's branches, not always char_to_branch_index()
            int32_t  index : 10 = -1;
            uint32_t key_size() const { return uint32_t(prefix_size) + branch_size; }
         };
         static_assert(sizeof(path_entry) == sizeof(id_address) + sizeof(uint32_t));

         std::array<path_entry, max_key_length + 1> _path;
         std::array<char, max_key_length>           _branches;
         path_entry*                                _path_back;
         char*                                      _branches_end;

         int           _size;  // -1 if unknown of value at current key
         read_session& _rs;
         node_handle   _root;
      };

   }  // namespace beta

}  // namespace arbtrie
