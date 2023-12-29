#pragma once
#include <arbtrie/arbtrie.hpp>

namespace arbtrie
{

   /**
    *  Binary Node uses a binary search to find the leaf values
    *  in the tree.
    */
   struct binary_node : node_header
   {
      static const node_type type = node_type::binary;
      //      binary_node*           clone();
      //      binary_node*           clone_add(key_view key, object_id val) const;
      //      binary_node*           clone_range(key_view minus_prefix, int from, int to) const;
      //      binary_node*           clone_remove(key_view key);
      //      void                   release();

      //      static inline binary_node* make(key_view key, object_id val);

      uint16_t* key_offsets() { return (uint16_t*)body(); }
      uint16_t& key_offset(int p) { return key_offsets()[p]; }

      inline const uint16_t* key_offsets() const { return (const uint16_t*)body(); }
      inline const uint16_t& key_offset(int p) const { return key_offsets()[p]; }

      inline object_id*       values() { return (object_id*)(key_offsets() + num_branches()); }
      inline const object_id* values() const
      {
         return (const object_id*)(key_offsets() + num_branches());
      }
      inline object_id&       value(int b) { return *(values() + b); }
      inline const object_id& value(int b) const { return *(values() + b); }

      inline char*       start_keys() { return (char*)(values() + num_branches()); }
      inline const char* start_keys() const { return (const char*)(values() + num_branches()); }
      inline uint16_t    key_section_size() const
      {
         return tail() - (char*)(values() + num_branches());
      }

      // notional layout
      // ------------------------
      // uint16_t key_offsets [num_branches]
      // object_id values[num_branches];
      // char    keys[];

      inline auto      get_key_ptr(int n) { return tail() - key_offset(n); }
      inline auto      get_key_ptr(int n) const { return tail() - key_offset(n); }
      inline uint16_t get_key_size(int n) const { return uint8_t(*get_key_ptr(n)); }
      std::string_view get_key(int n)
      {
         auto p = get_key_ptr(n);
         return std::string_view((char*)p + 1, uint8_t(*p));
      }
      std::string_view get_key(int n) const
      {
         auto p = get_key_ptr(n);
         return std::string_view((const char*)p + 1, uint8_t(*p));
      }

      object_id* get_value(std::string_view key)
      {
         auto idx = find_key_idx(key);
         return idx >= 0 ? &value(idx) : nullptr;
      }
      const object_id* get_value(std::string_view key) const
      {
         auto idx = find_key_idx(key);
         return idx >= 0 ? &value(idx) : nullptr;
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

   } __attribute((packed));

}  // namespace arbtrie

#include <arbtrie/binary_node_impl.hpp>
