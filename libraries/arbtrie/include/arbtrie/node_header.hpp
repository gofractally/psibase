#pragma once
#include <arbtrie/debug.hpp>
#include <arbtrie/node_meta.hpp>
#include <arbtrie/util.hpp>
#include <string_view>

#define XXH_INLINE_ALL
#include <arbtrie/xxhash.h>

namespace arbtrie
{
   uint32_t calculate_checksum(const node_header* h);

   /**
    *  keysize limit of 1024 requires 10 bits, longer keys would 
    *  require either:
    *    1. less inlining values into binary_node
    *       a. 30 bytes inline limit for 2048 key length
    *    2. an extra byte per value in binary_node +
    *       a. increasing the _prefix_capacity bit width
    *       b. increasing the _prefix_trunc bit width
    *
    *  RocksDB keysize limit = 8MB
    *  LMDB keysize limit    = 512b
    */
   struct node_header
   {
      uint32_t checksum;
      uint32_t _ntype : 4;             // bytes allocated for this node
      uint32_t _nsize : 28;            // bytes allocated for this node
      uint64_t _num_branches : 9;      // number of branches that are set
      uint64_t _eof_branch : 1;        // does the node have a value on it
      uint64_t _unused_pad : 4;        // does the node have a value on it
      uint64_t _prefix_capacity : 10;  // number of bytes in up to 1024
      uint64_t _node_id : 40;

      inline node_header(uint32_t  size,
                         object_id nid,
                         node_type type       = node_type::freelist,
                         uint16_t  num_branch = 0,
                         uint8_t   prefix_cap = 0)
          : checksum(0),
            _ntype(type),
            _nsize(size),
            _num_branches(num_branch),
            _eof_branch(0),
            _unused_pad(0),
            _prefix_capacity(prefix_cap),
            _node_id(nid.id)
      {
      }

      //inline node_header* clone();

      template <typename T>
      T* as()
      {
         assert(T::type == (node_type)_ntype);
         return static_cast<T*>(this);
      }
      template <typename T>
      const T* as() const
      {
         assert(T::type == (node_type)_ntype);
         return static_cast<const T*>(this);
      }

      //template <typename T>
      //inline static T* make(uint32_t size, uint16_t num_branch, uint8_t prefix_len = 0);

      void set_type(node_type t) { _ntype = (int)t; }
      void set_id(object_id i) { _node_id = i.id; }

      uint32_t       size() const { return _nsize; }
      object_id      id() const { return object_id(_node_id); }
      node_type      get_type() const { return (node_type)_ntype; }
      uint16_t       num_branches() const { return _num_branches; }
      uint16_t       prefix_capacity() const { return _prefix_capacity; }
      char*          body() { return (char*)(this + 1); }
      const char*    body() const { return (const char*)(this + 1); }
      char*          tail() { return ((char*)this) + _nsize; }
      const uint8_t* tail() const { return ((const uint8_t*)this) + _nsize; }
      uint32_t       value_size() const { return _nsize - sizeof(node_header); }
      value_view     value() const
      {
         assert(_nsize >= sizeof(node_header));
         return value_view(body(), value_size());
      }

      // size rounded up to the nearest 16 bytes
      inline uint32_t     object_capacity() const { return (_nsize + 15) & -16; }
      inline node_header* next() const { return (node_header*)(((char*)this) + object_capacity()); }

      uint32_t calculate_checksum() const;

      void update_checksum() { checksum = calculate_checksum(); }
      bool validate_checksum() { return checksum == calculate_checksum(); }
   } __attribute((packed));
   static_assert(sizeof(node_header) == 16);

   struct full_node;
   struct setlist_node;
   struct binary_node;
   struct value_node;
   struct index_node;

   template <typename T>
   concept is_node_header = std::is_same_v<std::remove_cv_t<T>, node_header>;

   template <typename T>
   concept is_value_type = std::is_same_v<std::remove_cv_t<T>, value_view> or
                           std::is_same_v<std::remove_cv_t<T>, object_id>;

}  // namespace arbtrie

