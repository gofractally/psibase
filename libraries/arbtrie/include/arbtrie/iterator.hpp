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

   // clang-format off
   /**
    * Concept for buffer types that can be used with iterator value functions.
    * Requires the type to be resizable and provide contiguous memory access.
    */
   template <typename T>
   concept Buffer = requires(T b) {
      { b.resize(std::size_t{}) } -> std::same_as<void>;
      { b.data() } -> std::convertible_to<void*>;
   };

   /**
    * Extended Buffer concept that also requires default constructibility.
    * Used for value() function that constructs a new buffer.
    */
   template <typename T>
   concept ConstructibleBuffer = Buffer<T> && requires { T(); };
   // clang-format on

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
      iterator(read_session& s, node_handle r);

     public:
      iterator(const iterator& other);
      iterator(iterator&& other) noexcept;

      iterator& operator=(const iterator& other);
      iterator& operator=(iterator&& other) noexcept;

      static constexpr const int32_t value_nothing = -1;
      static constexpr const int32_t value_subtree = -2;

      static constexpr local_index rend_index  = local_index(-1);
      static constexpr local_index begin_index = local_index(-1);
      static constexpr local_index end_index   = local_index(257);

      static constexpr const std::array<char, max_key_length> npos_data = []()
      {
         std::array<char, max_key_length> ar;
         ar.fill(0xff);
         return ar;
      }();
      static constexpr const key_view npos = key_view(npos_data.data(), npos_data.size());
      static_assert(npos > key_view());

      /// @brief an alias for is_start()
      bool is_rend() const { return is_start(); }
      /// @brief true if the iterator is before the first key
      bool is_start() const;
      /// @brief true if the iterator is after the last key
      bool is_end() const;

      // the key the iterator is currently pointing to
      // @note the key is not valid after the iterator is destroyed
      // @note the key is undefined if the iterator is not valid
      key_view key() const;

      // moves to the next key, return valid()
      bool next();

      // moves to the previous key, return is_rend()
      bool prev();

      // first key greater than search
      // similar to std::map::upper_bound
      bool upper_bound(key_view search);

      // moves to the first key >= prefix from the begin, return valid()
      // similar to std::map::lower_bound
      bool lower_bound(key_view prefix = {});

      // finds the largest key <= prefix and moves to rend() if no such key
      //
      // ```c++
      //    auto reverse_lower_bound( std::map<K,V> map ) {
      //        auto ub = map.upper_bound(key);
      //        return ub == map.begin() ?  return map.rend() : return std::map<K,V>::reverse_iterator(ub);
      //    }
      // ```
      bool reverse_lower_bound(key_view prefix = npos);

      // if reverse_lower_bound(key) == key,
      // this returns the prior key, othewise equal to reverse_lower_bound(key)
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
      auto get(key_view key, std::invocable<value_type> auto&& callback)
          -> decltype(callback(value_type()));

      // Like get(), but also positions the iterator at the found key
      // Returns true if found and positions iterator at the key
      // Returns false and positions iterator at the end() if not found
      bool find(key_view key);

      // true if the tree is not empty
      bool valid() const;

      // if the value is a subtree, return an iterator into that subtree
      // else throw an exception
      iterator subtree_iterator() const;

      // @return node_handle of subtree iff the value is a subtree
      // @throw if not a subtree
      node_handle subtree() const;

      // @return a handle to the root of the tree this iterator is traversing
      node_handle  root_handle() const;
      node_handle& root_handle() { return _root; }

      // return the root this iterator is based on
      // TODO: remove redundancy
      node_handle get_root() const;
      void        set_root(node_handle root)
      {
         _root = std::move(root);
         clear();
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
      int32_t value(Buffer auto&& buffer) const;

      /**
       * Read value at current iterator position and invoke callback with the value
       * @tparam Callback Callable type that accepts value_type parameter
       * @param callback Function to call with the value
       * @return Value returned by callback on success
       */
      auto value(std::invocable<value_type> auto&& callback) const;

      /** 
       * constructs a new Buffer and reads the value into it,
       * this is the lowest performance way to read the value, unless
       * you were going to construct the buffer anyway.
       */
      template <typename B>
         requires ConstructibleBuffer<B>
      B value() const;

      /**
       * Read value into a contiguous memory buffer
       * @tparam ByteType Type of the buffer (e.g., char, unsigned char, etc.)
       * @param s Pointer to the buffer
       * @param s_len Length of the buffer
       * @return Number of bytes read into buffer on success
       *   iterator::value_nothing: Value not found
       *   iterator::value_subtree: Found subtree value (use subtree_iterator() instead)
       */
      template <typename ByteType>
      int32_t value(ByteType* s, uint32_t s_len) const;

      // Returns a formatted string showing the path decomposition with each node's prefix and branch components
      std::string pretty_path() const;

      // moves to the key after the last key in the database, aka end()
      bool end();

      // moves to the key before the first key in the database, (e.g. std::map::rend())
      bool start();

      // moves to the first key in the database, (e.g std::map::begin()),
      // @return is_end()
      bool begin();

     private:
      template <typename... Args>
      void debug_print(const Args&... args) const;

      bool next_impl(read_lock& state);
      bool prev_impl(read_lock& state);
      bool find_impl(read_lock& state, key_view key);
      bool lower_bound_impl(read_lock& state, key_view key);

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

      read_session* _rs;
      node_handle   _root;

      auto get_impl(read_lock& state, key_view key, auto&& callback)
          -> decltype(callback(value_type()));
   };

}  // namespace arbtrie
