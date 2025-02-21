#pragma once
#include <arbtrie/value_type.hpp>
#include <compare>
#include <concepts>
#include <cstdint>
#include <ostream>

namespace arbtrie
{
   // Forward declarations
   struct node_header;
   class binary_node;
   class setlist_node;
   class full_node;
   class value_node;

   template <typename T>
   struct inner_node;

   /**
    * A branch can be identified by either characters of the key or by an integer index local to the node.
    * 
    * For example, the setlist_node has an index into the setlist which is local and not related to the key,
    * the value in the setlist at the local_index is the key_index; Likewise, the binary_node has an index 
    * int a set of key bytes. Incrimenting the local_index will move to the next branch in the node, even
    * if that branch is not the next increment of the key.
    * 
    * A key_index type is an integer type that can be mapped directly to a
    * character in the key.  Each byte of a key can be 0x00 to 0xff (a range from 0 to 255),
    * key can also be terminated at a node and that represents a 256th potential value. Because
    * a termination branch comes before any other branches, the key_index type for the
    * terminator byte is 0, and a key byte of 0x00 becomes 1 and 0xff becomes 0x100(aka 256)
    */
   enum class index_types
   {
      local_index,
      key_index
   };

   /**
    * Wraps an integer type to provide a type-safe way to convert to and from a character and
    * prevent accidental use of the wrong index type while making the code more readable.
    */
   template <index_types T>
   struct index_type
   {
      using local_index = index_type<index_types::local_index>;
      using key_index   = index_type<index_types::key_index>;

     private:
      int_fast16_t value;

     public:
      constexpr char             to_char() const { return char(value - 1); }
      static constexpr key_index from_char(char c) { return key_index(uint8_t(c) + 1); }
      int_fast16_t               to_int() const { return value; }

      constexpr explicit index_type(int_fast16_t v) : value(v) {}
      constexpr index_type& operator++() { return ++value, *this; }
      constexpr index_type& operator--() { return --value, *this; }
      constexpr index_type  operator++(int)
      {
         index_type tmp = *this;
         ++(*this);
         return tmp;
      }
      constexpr index_type operator--(int)
      {
         index_type tmp = *this;
         --(*this);
         return tmp;
      }
      index_type& operator=(const index_type& other) { return value = other.value, *this; }
      constexpr index_type& operator+=(int n) { return value += n, *this; }
      constexpr index_type& operator-=(int n) { return value -= n, *this; }
      constexpr bool operator==(const index_type& other) const { return value == other.value; }
      constexpr bool operator!=(const index_type& other) const { return value != other.value; }
      constexpr bool operator<(const index_type& other) const { return value < other.value; }
      constexpr bool operator>(const index_type& other) const { return value > other.value; }
      constexpr bool operator<=(const index_type& other) const { return value <= other.value; }
      constexpr bool operator>=(const index_type& other) const { return value >= other.value; }
   };

   template <index_types T>
   std::ostream& operator<<(std::ostream& s, const index_type<T>& idx)
   {
      return s << idx.to_int();
   }

   using local_index = index_type<index_types::local_index>;
   using key_index   = index_type<index_types::key_index>;

   static constexpr local_index local_end_index  = local_index(257);
   static constexpr local_index local_rend_index = local_index(-1);

   /// aka eof value, the value on the node itself
   static constexpr key_index key_value_index = key_index(0);
   static constexpr key_index key_end_index   = key_index(257);
   static constexpr key_index key_rend_index  = key_index(-1);

   struct node_header;

   /**
    * The search_result is used to return the result of a search operation a node.
    * If the search found nothing then the address is invalid, and the local_index
    * is set to local_end_index.
    */
   struct search_result
   {
      // represents the part of the key that matched
      key_view prefix;
      key_view matched_branch;
      // the most efficient way to reference this branch on the node
      local_index loc_idx = local_end_index;
      // represents the node to search for the rest of the key, if any
      id_address address;

      operator bool() const { return valid(); }
      bool valid() const { return loc_idx != local_end_index; }

      static constexpr search_result rend() { return search_result{.loc_idx = local_rend_index}; }
      // represents the end of a search, no match found
      static constexpr search_result end() { return search_result{.loc_idx = local_end_index}; }
      bool operator==(const search_result& other) const { return loc_idx == other.loc_idx; }
      bool operator!=(const search_result& other) const { return loc_idx != other.loc_idx; }
   };

   /**
    * A static array of all possible branch characters.
    * 
    * This is used to return key_views for single bytes because 
    * key_views require memory address reference the character
    */
   static constexpr std::array<char, 256> branch_chars = []() consteval
   {
      std::array<char, 256> arr{};
      for (int i = 0; i < 256; ++i)
      {
         arr[i] = static_cast<char>(i);
      }
      return arr;
   }();

   // clang-format off
   /**
    * All nodes must implement the following interface and be derived from node_header
    * because even value_node can be thought of as an inner node with a single branch,
    * and inner nodes have a value. If nodes could have a virtual base class then this is the
    * interface that would be inherited from, but because they are memory mapped they cannot 
    * utilize a vtable.
    * 
    * The prefix is the part of a key that all branches have in common, and in a value_node
    * the prefix is the entire key.
    * 
    * When iterating over a node incrementing the relative index is the most efficient way to 
    * get to the next branch on a node
    */
   template <typename T>
   concept node =
    requires(const T& node, local_index bindex, arbtrie::key_index kindex, key_view key) {
        // Required member functions

         /**
          * A branch is defined as the number of id_address entries pointing below
          * this node. The maximum value is 257, which would be a full node with
          * one branch for each possible byte value in the key and one branch for
          * the eof (aka end of key) value.
         */
         { node.num_branches() } -> std::same_as<uint16_t>; 

         /**
          * @param key is the key to search for including the prefix, if any on the node.
          * @return a search_result struct containing the matched portion of the key, the local index of the branch,
          * and the address of the node to search for the rest of the key (if any)
          */
        { node.get_branch(key) } -> std::same_as<search_result>; // point lookup
        { node.get_type(bindex) } -> std::same_as<value_type::types>; // get the type of the node
        /**
         * Returns the first branch that is greater than or equal to the key.
         */
        { node.lower_bound(key) } -> std::same_as<search_result>; // range lookup
        { node.next_index(bindex) } -> std::same_as<local_index>; // next branch
        { node.prev_index(bindex) } -> std::same_as<local_index>; // previous branch
        { node.get_prefix() } -> std::same_as<key_view>; // get the prefix of the node


        /**
         * Returns the key for a local index, does not check that the index is valid
         * and may return keys for branches that do not exist.
         */
        { node.get_branch_key(bindex) } -> std::same_as<key_view>; 
        /**
         * Returns the local index for a key, a key may or may not exist at that index and
         * this method does not check for validity of the key.
         */
        { node.get_branch_index(key) } -> std::same_as<local_index>; // get the local index for a key
        { node.get_value(bindex) } -> std::same_as<value_type>; // get the value for a local index
        { node.begin_index() } -> std::same_as<local_index>; // begin of the local index
        { node.end_index() } -> std::same_as<local_index>; // end of the local index

        /**
         * Every node has a "value" which coresponds to the end of a key,
         * (e.g. the root node's value is the empty key).
         */
        { node.has_value() } -> std::same_as<bool>; // check if the node has a value
        { node.validate() } -> std::same_as<bool>; // check if the node is valid
        /**
         * Get the value of the node.
         * If there is no value, then the return type is value_type::remove.
         */
        { node.value() } -> std::same_as<value_type>; 
        /**
         * Get the type of the value.
         * If there is no value, then the return type is value_types::remove.
         */
        { node.get_value_type() } -> std::same_as<value_type::types>; // get the type of the value

        /**
         * Returns the value at the given key and modifies the key to contain only the trailing portion.
         * If no value is found, returns a remove value_type.
         * This is optimized for point lookups and is used by iterator get_impl.
         * @param key - The key to look up, will be modified to contain only the trailing portion if a match is found
         * @return value_type - The value if found, or remove type if not found
         */
        { node.get_value_and_trailing_key(key) } -> std::same_as<value_type>;

        // Required concepts
        requires std::derived_from<T, node_header>; // must be derived from node_header
    };


   template <typename T>
   concept inner_node_derived = 
       node<T> &&
       requires(T node, key_index br, id_address addr, const T& const_node) {
           // Required static members
           requires requires { T::type; } && std::is_same_v<decltype(T::type), const node_type>;

           // Required member functions
           { node.add_branch(br, addr) } -> std::same_as<T&>;
           { node.remove_branch(br) } -> std::same_as<T&>;
           { node.set_branch(br, addr) } -> std::same_as<T&>;
           { const_node.get_branch(br) } -> std::same_as<id_address>;
           { const_node.can_add_branch() } -> std::convertible_to<bool>;
           // @todo: remove this once converted to .value() and .has_value()
           //      { const_node.has_eof_value() } -> std::convertible_to<bool>;
           //      { const_node.get_eof_value() } -> std::same_as<id_address>;
       };
   // clang-format on

   // Helper type traits for node type checking
   template <typename T>
   concept is_binary_node =
       std::is_same_v<std::remove_cv_t<std::remove_pointer_t<std::remove_cv_t<T>>>, binary_node>;

   template <typename T>
   concept is_setlist_node =
       std::is_same_v<std::remove_cv_t<std::remove_pointer_t<std::remove_cv_t<T>>>, setlist_node>;

   template <typename T>
   concept is_full_node =
       std::is_same_v<std::remove_cv_t<std::remove_pointer_t<std::remove_cv_t<T>>>, full_node>;

   template <typename T>
   concept is_value_node =
       std::is_same_v<std::remove_cv_t<std::remove_pointer_t<std::remove_cv_t<T>>>, value_node>;

   template <typename T>
   concept is_inner_node = is_setlist_node<T> or is_full_node<T>;

   template <typename T>
   concept is_id_address =
       std::is_same_v<std::remove_cv_t<std::remove_pointer_t<std::remove_cv_t<T>>>, id_address>;

}  // namespace arbtrie
