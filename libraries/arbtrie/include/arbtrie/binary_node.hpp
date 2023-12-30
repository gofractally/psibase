#pragma once
#include <arbtrie/arbtrie.hpp>

namespace arbtrie
{

   /**
    *  Binary Node uses a binary search to find the leaf values
    *  in the tree. 
    *
    *  Values less than 64 bytes are stored inline with the binary node
    *  directly after the key. This small value optimization prevents
    *  a lookup of the value in another page and eliminates the need
    *  to do extra reference counting on small values. Note: the storage overhead
    *  of a "small value" is its object_id(5) + node_meta(8) + object_header(16), or 29 bytes,
    *  so for values less than 29 bytes this is a more compact solution. It also reduces
    *  the demand on the object_id database which must be pinned to memory.

       notional layout
       ------------------------
       uint16_t     key_offsets [num_branches] - offsets are measured from the tail()
       key_val      keys_vals[num_branches];
      
       Where a key_val has the layout:
         key_val_pair sizes;
         key [sizes.key_size]
         val [sizes.val_size]
    *
    */
   struct binary_node : node_header
   {
      static const uint8_t max_inline_value_size = 62;
      static const uint8_t value_node_flag       = 63;

      struct key_val_pair
      {
         uint16_t _key_size : 10;  // keys can be up to 1kb
         uint16_t _val_size : 6;   // values up to 62 bytes are stored inline,
                                   // if val_size == 63, then an object_id of size 5 is stored
         uint8_t _key[];

         inline bool           is_value_node() const { return _val_size > max_inline_value_size; }
         inline uint16_t       key_size() const { return _key_size; }
         inline uint16_t       value_size() const { return is_value_node() ? 5 : _val_size; }
         inline uint8_t*       key_ptr() { return _key; }
         inline const uint8_t* key_ptr() const { return _key; }
         inline uint8_t*       val_ptr() { return _key + _key_size; }
         inline const uint8_t* val_ptr() const { return _key + _key_size; }
         inline key_view       key() const { return key_view((char*)_key, _key_size); }
         inline value_view     value() const
         {
            return value_view((char*)_key + _key_size, value_size());
         }

         inline const object_id* value_id() const
         {
            if (is_value_node())
               return (const object_id*)(_key + _key_size);
            return nullptr;
         }

         inline object_id* value_id()
         {
            if (is_value_node())
               return (object_id*)(_key + _key_size);
            return nullptr;
         }

         key_val_pair*       next() { return (key_val_pair*)(_key + _key_size + value_size()); }
         const key_val_pair* next() const
         {
            return (const key_val_pair*)(_key + _key_size + value_size());
         }
      } __attribute((packed)) __attribute((aligned(1)));

      static_assert(sizeof(key_val_pair) == 2);

      uint16_t _key_offsets[];

      static const node_type type = node_type::binary;
      inline static bool can_inline(value_view val) { return val.size() <= max_inline_value_size; }

      // calculates the space required to store this key/val exclusive of node_header
      inline static uint16_t calc_key_val_pair_size(key_view key, value_view val)
      {
         return 2 + sizeof(key_val_pair) + key.size() +
                (val.size() <= max_inline_value_size ? val.size() : sizeof(object_id));
      }

      inline uint16_t* key_offsets() { return _key_offsets; }
      inline uint16_t& key_offset(int p) { return _key_offsets[p]; }

      inline const uint16_t* key_offsets() const { return _key_offsets; }
      inline const uint16_t& key_offset(int p) const { return _key_offsets[p]; }

      inline key_val_pair* start_keys() { return (key_val_pair*)(key_offsets() + num_branches()); }
      inline const key_val_pair* start_keys() const
      {
         return (const key_val_pair*)(key_offsets() + num_branches());
      }

      inline uint16_t key_val_section_size() const { return tail() - (char*)start_keys(); }

      inline key_val_pair* get_key_val_ptr(int n)
      {
         return (key_val_pair*)(tail() - key_offset(n));
      }
      inline const key_val_pair* get_key_val_ptr(int n) const
      {
         return (const key_val_pair*)(tail() - key_offset(n));
      }

      inline std::string_view get_key(int n) { return get_key_val_ptr(n)->key(); }
      inline std::string_view get_key(int n) const { return get_key_val_ptr(n)->key(); }

      key_val_pair* find_key_val(std::string_view key)
      {
         auto idx = find_key_idx(key);
         return idx >= 0 ? get_key_val_ptr(idx) : nullptr;
      }
      const key_val_pair* find_key_val(std::string_view key) const
      {
         auto idx = find_key_idx(key);
         return idx >= 0 ? get_key_val_ptr(idx) : nullptr;
      }

      int find_key_idx(std::string_view key) const
      {
         int idx = lower_bound_idx(key);
         if (idx >= num_branches())
            return -1;
         if (get_key(idx) != key)
            return -1;
         return idx;
      }
      int lower_bound_idx(std::string_view key) const
      {
         int left  = -1;
         int right = num_branches();
         while (right - left > 1)
         {
            int middle = (left + right) >> 1;
            if (get_key(middle) < key)
               left = middle;
            else
               right = middle;
         }
         return right;
      }

      bool validate()const {
         assert( _nsize < 65000 );
         auto nb = num_branches();
         for( int i = 0; i < nb; ++i ) {
            auto kvp = get_key_val_ptr(i);
            assert( (char*)kvp < tail() );
            assert( kvp->value_size() > 0 );
            assert( kvp->key_size() < 130);
         }

         return true;
      }

   } __attribute((packed));

}  // namespace arbtrie

#include <arbtrie/binary_node_impl.hpp>
