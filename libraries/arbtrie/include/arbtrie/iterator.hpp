#pragma once
#include <arbtrie/arbtrie.hpp>
#include <arbtrie/concepts.hpp>
#include <arbtrie/database.hpp>
#include <arbtrie/node_handle.hpp>
#include <arbtrie/seg_alloc_session.hpp>
#include <arbtrie/seg_allocator.hpp>
#include <arbtrie/value_type.hpp>
#include <concepts>
#include <memory>
#include <optional>
#include <sstream>
#include <vector>

namespace arbtrie
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

   class read_session;
   class write_session;
   class write_transaction;
   struct path_entry;
   template <iterator_caching_mode CacheMode>
   class mutable_iterator;

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


   /**
    * Concept for types that can be implicitly converted to a std::string_view
    */
   template <typename T>
   concept ImplicitValueViewConvertible = requires(const T& t) {
      { std::string_view{t} } -> std::same_as<std::string_view>;
   };

   /**
    * Concept for types that provide data() and size() methods compatible with std::string_view construction
    */
   template <typename T>
   concept DataSizeValueViewConvertible = requires(const T& t) {
      { t.data() } -> std::convertible_to<const char*>;
      { t.size() } -> std::convertible_to<std::size_t>;
   };

   /**
    * Concept for types that can be converted to a std::string_view through either method
    */
   template <typename T>
   concept ValueViewConvertible = ImplicitValueViewConvertible<T> || DataSizeValueViewConvertible<T>;

   /**
    * Concept for types that can be used as values in the trie (either convertible to value_view or a node_handle)
    */
   template <typename T>
   concept ValueViewConvertibleOrNode = ValueViewConvertible<T> || std::same_as<T, node_handle>;
   // clang-format on

   namespace detail
   {
      template <typename T>
      value_view to_value_view(const T& val)
      {
         if constexpr (ImplicitValueViewConvertible<T>)
            return std::string_view{val};
         else
         {
            static_assert(DataSizeValueViewConvertible<T>);
            return value_view(val.data(), val.size());
         }
      }
      template <typename T>
      auto to_value_arg(T&& val)
      {
         if constexpr (std::same_as<std::remove_cvref_t<T>, node_handle>)
         {
            return std::move(val);
         }
         else
         {
            static_assert(ValueViewConvertible<T>);
            return to_value_view(std::forward<T>(val));
         }
      }
   }  // namespace detail

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
      friend class arbtrie::write_session;
      friend class arbtrie::mutable_iterator<CacheMode>;
      friend class arbtrie::write_transaction;

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
      auto get(key_view key, std::invocable<value_type> auto&& callback) const
          -> decltype(callback(value_type()));

      /**
       * Get the value at the specified key into a buffer
       * @tparam Buffer Type that supports resize() and data() for contiguous memory access
       * @param key The key to get the value for
       * @param buffer Pointer to the buffer to read the value into
       * @return 
       *   >= 0: Number of bytes read into buffer on success
       *   iterator::value_nothing: Value not found
       *   iterator::value_subtree: Found subtree value (use get_subtree() instead)
       */
      int32_t get(key_view key, Buffer auto* buffer) const;

      /**
       * Get the value at the specified key and return it in a newly constructed buffer
       * @tparam ConstructibleBufferType Type that supports resize(), data() and default construction
       * @param key The key to get the value for
       * @return std::optional containing the constructed buffer with the value if found and not a subtree,
       *         empty optional if not found or if the value is a subtree
       */
      template <ConstructibleBuffer ConstructibleBufferType>
      std::optional<ConstructibleBufferType> get(key_view key) const;

      // get the size of the value at key, note if key is a subtree, size will be 4
      // if key does not exist, size will be -1
      int32_t get_size(key_view key) const
      {
         return get(key,
                    [](value_type t)
                    {
                       assert(not t.is_value_node());
                       return t.size();
                    });
      }
      std::optional<iterator<CacheMode>> get_subtree(key_view key) const;

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
      const node_handle& root_handle() const;
      node_handle&       root_handle() { return _root; }

      // return the root this iterator is based on
      // TODO: remove redundancy
      node_handle get_root() const;

      // return a subtree value_type for the root node
      value_type as_subtree() const { return value_type::make_subtree(root_handle()); }

      // set the root of the iterator and moves the iterator to the start
      void set_root(node_handle root)
      {
         _root = std::move(root);
         start();
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

      /**
       * Count the number of keys in the range [from,to)
       * @param from The start key (inclusive)
       * @param to The end key (exclusive)
       * @return The number of keys in the range
       */
      uint32_t count_keys(key_view from = {}, key_view to = {}) const;

     protected:
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

      auto get_impl(read_lock& state, key_view key, auto&& callback) const
          -> decltype(callback(value_type()));
   };

   /**
    * A mutable iterator that adds write operations to the base iterator class.
    * This iterator requires a write_session pointer and can perform upsert, insert,
    * remove, and update operations at the current iterator position.
    */
   template <iterator_caching_mode CacheMode = noncaching>
   class mutable_iterator : public iterator<CacheMode>
   {
     protected:
      friend class write_transaction;
      mutable_iterator(write_session& ws, node_handle r)
          : iterator<CacheMode>(ws, std::move(r)), _ws(&ws)
      {
      }

     public:
      using iterator<CacheMode>::root_handle;
      using iterator<CacheMode>::key;
      using iterator<CacheMode>::start;
      using iterator<CacheMode>::next;
      using iterator<CacheMode>::find;
      using iterator<CacheMode>::is_end;
      using iterator<CacheMode>::is_start;
      using iterator<CacheMode>::is_rend;
      using iterator<CacheMode>::valid;
      using iterator<CacheMode>::count_keys;
      using iterator<CacheMode>::subtree_iterator;
      using iterator<CacheMode>::subtree;
      using iterator<CacheMode>::get;
      using iterator<CacheMode>::value;
      using iterator<CacheMode>::get_size;
      using iterator<CacheMode>::pretty_path;
      using iterator<CacheMode>::end;
      using iterator<CacheMode>::prev;
      using iterator<CacheMode>::lower_bound;
      using iterator<CacheMode>::upper_bound;
      using iterator<CacheMode>::reverse_lower_bound;
      using iterator<CacheMode>::reverse_upper_bound;

      /**
       * Get a mutable iterator to the subtree at the specified key
       * @param key The key to get the subtree from
       * @return An optional containing the mutable iterator if a subtree exists at the key, nullopt otherwise
       */
      std::optional<mutable_iterator<CacheMode>> get_subtree(key_view key) const;

      /**
       * Update or insert a value at the specified key, move to the start()
       * @param key The key to upsert at
       * @param val The value to upsert (can be a ValueViewConvertible or node_handle)
       * @return -1 on insert, otherwise the size of the old value
       * @return if upserting a subtree, the old subtree optional<node_handle> is returned
       */
      auto upsert(key_view key, ValueViewConvertibleOrNode auto&& val) -> decltype(auto);

      /**
       * Update or insert a value at the specified key, move to the key
       * 
       * If you don't need the iterator at key postion, use upsert() instead
       * 
       * @param key The key to upsert at
       * @param val The value to upsert (can be a ValueViewConvertible or node_handle)
       * @return -1 on insert, otherwise the size of the old value
       * @return if upserting a subtree, the old subtree optional<node_handle> is returned
       * @pre valid()
       */
      auto upsert_find(key_view key, ValueViewConvertibleOrNode auto&& val) -> decltype(auto);

      /**
       * Insert a value at the specified key, move to start()
       * @param key The key to insert at
       * @param val The value to insert (can be a ValueViewConvertible or node_handle)
       * @throws if a value already exists at this position
       */
      void insert(key_view key, ValueViewConvertibleOrNode auto&& val);

      /**
       * Insert a value at the specified key, move to the key
       * @param key The key to insert at
       * @param val The value to insert (can be a ValueViewConvertible or node_handle)
       * @throws if a value already exists at this position
       */
      void insert_find(key_view key, ValueViewConvertibleOrNode auto&& val);

      /**
       * Update the value at the current iterator position, move to start()
       * 
       * Because updating a value may change the path in the tree, we move
       * to the start() of the tree after the update. If you want to update
       * and preserve the iterator position, use update_find() instead which
       * will move back to the key after the update. 
       * 
       * @param val The value to update with (can be a ValueViewConvertible or node_handle)
       * @return size of the old value
       * @pre valid(), not is_end() and not is_start()
       */
      int update(ValueViewConvertibleOrNode auto&& val);

      /**   
       * Update the value at the current iterator position, move to the key
       * 
       * If you don't need the iterator to remain in its current position,
       * use update() instead which moves to start() after the update and
       * is faster.
       * 
       * @param val The value to update with (can be a ValueViewConvertible or node_handle)
       * @return size of the old value
       * @pre valid(), not is_end() and not is_start()   
       */
      int update_find(ValueViewConvertibleOrNode auto&& val);

      /**
       * Remove the value at the current iterator position, move to the start()
       * @return size of the removed value
       * @throws if no value exists at this position
       * @pre valid(), not is_end(), not is_start()
       */
      int remove_end();

      /**
       * Remove the value at the specified key, move to the start()
       * @param key The key to remove
       * @return size of the removed value, or -1 if no value exists
       * @pre valid(), not is_end(), not is_start()
       */
      int remove(key_view key);

      /**
       * Remove the current key and move the iterator to the next key
       * @return size of the removed value
       * @pre valid(), not is_end(), not is_start()
       */
      int remove_advance();

     private:
      write_session* _ws;
   };

}  // namespace arbtrie

#include <arbtrie/transaction.hpp>
