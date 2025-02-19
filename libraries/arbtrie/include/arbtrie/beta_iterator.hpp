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
       * 
       *   The iterator is technically copyable, but the copy is expensive
       *   and should be avoided, use move semantics instead. This is because
       *   the iterator pre-allocates the maximum possible memory for the path
       *   and branches arrays so it doesn't have to allocate memory or perform
       *   checks while in use.
       *   
       *   Iterators should be long-lived and not recreated for each query.
       */
      template <iterator_caching_mode CacheMode = noncaching>
      class iterator
      {
         friend class arbtrie::read_session;
         iterator(read_session& s, node_handle r)
             : _size(-1),
               _rs(&s),
               _root(std::move(r)),
               _path(std::make_unique<std::array<path_entry, max_key_length + 1>>()),
               _branches(std::make_unique<std::array<char, max_key_length>>())
         {
            clear();
            push_rend(_root.address());
         }

         // Copy constructor
         iterator(const iterator& other)
             : _size(other._size),
               _rs(other._rs),
               _root(other._root),
               _path(std::make_unique<std::array<path_entry, max_key_length + 1>>(*other._path)),
               _branches(std::make_unique<std::array<char, max_key_length>>(*other._branches)),
               _path_back(_path->data() + (other._path_back - other._path->data())),
               _branches_end(_branches->data() + (other._branches_end - other._branches->data()))
         {
         }

         // Move constructor
         iterator(iterator&& other) noexcept
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

         // Copy assignment operator
         iterator& operator=(const iterator& other)
         {
            if (this != &other)
            {
               _size = other._size;
               _rs   = other._rs;
               _root = other._root;
               _path = std::make_unique<std::array<path_entry, max_key_length + 1>>(*other._path);
               _branches     = std::make_unique<std::array<char, max_key_length>>(*other._branches);
               _path_back    = _path->data() + (other._path_back - other._path->data());
               _branches_end = _branches->data() + (other._branches_end - other._branches->data());
            }
            return *this;
         }

         // Move assignment operator
         iterator& operator=(iterator&& other) noexcept
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
         bool is_begin() const;
         bool is_end() const;

         static constexpr const key_view npos = key_view(nposa.data(), nposa.size());
         static_assert(npos > key_view());

         // return the root this iterator is based on
         node_handle get_root() const;
         // the key the iterator is currently pointing to
         key_view key() const;

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

         // This method does not move the iterator, it looks for
         // an exact match of the key and calls the callback with the value
         // if found.
         //
         // @note the read lock is held while the callback is executed, so
         // get the data you need quickly and return from the callback.
         // @return true if found, false otherwise
         bool get(key_view key, auto&& callback);

         // Like get(), but also positions the iterator at the found key
         // Returns true if found and positions iterator at the key
         // Returns false and positions iterator at the end() if not found
         bool find(key_view key, auto&& callback);

         // true if the iterator isn't at the end()
         bool valid() const;

         // if the value is a subtree, return an iterator into that subtree
         iterator subtree_iterator() const;
         bool     is_subtree() const;
         bool     is_data() const;

         // @return node_handle of subtree iff is_subtree()
         // @throw if not is_subtree()
         node_handle subtree() const;

         // @return a handle to the root of the tree this iterator is traversing
         node_handle root_handle() const;

         // resizes v to the and copies the value into it
         int32_t read_value(auto& buffer) const;

         // copies the value into [s,s+s_len)
         //
         // @throw if type is a subtree or iterator is at end() or rend()
         // @return total bytes copied
         //
         int32_t read_value(char* s, uint32_t s_len) const;

         // calls the callback with value_view of the data,
         // throws if type is a subtree or iterator is at end() or rend()
         // @return total bytes copied
         int32_t read_value(auto&& callback) const;

         // Returns a formatted string showing the path decomposition with each node's prefix and branch components
         std::string pretty_path() const;

        private:
         template <typename... Args>
         void debug_print(const Args&... args) const;

         bool next_impl(read_lock& state);
         bool prev_impl(read_lock& state);
         bool lower_bound_impl(read_lock& state, key_view key);

         bool end();
         void begin();

         void push_rend(id_address oid);
         void push_end(id_address oid);
         void push_path(id_address oid, local_index branch_index);
         void pop_path();

         void push_prefix(key_view prefix);

         void update_branch(key_view new_branch, local_index new_index);
         void update_branch(local_index new_index);
         void update_branch(char new_branch, local_index new_index);

         local_index current_index() const;

         void clear();

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

         std::unique_ptr<std::array<path_entry, max_key_length + 1>> _path;
         std::unique_ptr<std::array<char, max_key_length>>           _branches;
         path_entry*                                                 _path_back;
         char*                                                       _branches_end;

         int           _size;  // -1 if unknown of value at current key
         read_session* _rs;
         node_handle   _root;

         bool get_impl(read_lock& state, key_view key, auto&& callback);
      };

   }  // namespace beta

}  // namespace arbtrie
