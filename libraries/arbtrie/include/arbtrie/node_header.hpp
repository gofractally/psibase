#pragma once
#include <arbtrie/node_meta.hpp>
#include <string_view>

namespace arbtrie
{
   struct node_header
   {
      uint32_t checksum;
      uint32_t _ntype : 4;         // bytes allocated for this node
      uint32_t _nsize : 28;        // bytes allocated for this node
      uint64_t _num_branches : 9;  // number of branches space is reserved for
      uint64_t _unused : 5;        // number of branches actually set
      uint64_t _prefix_len : 10;   // number of bytes in up to 1024
      uint64_t _node_id : 40;

      inline node_header(uint32_t size, node_type type, uint16_t num_branch, uint8_t prefix_len = 0)
          : _ntype(type), _nsize(size), _num_branches(num_branch), _prefix_len(prefix_len)
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

      uint32_t    size() const { return _nsize; }
      object_id   id() const { return object_id(_node_id); }
      node_type   get_type() const { return (node_type)_ntype; }
      uint16_t    num_branches() const { return _num_branches; }
      uint16_t    prefix_capacity() const { return _prefix_len; }
      char*       body() { return (char*)(this + 1); }
      const char* body() const { return (const char*)(this + 1); }
      char*       tail() { return ((char*)this) + _nsize; }
      const char* tail() const { return ((const char*)this) + _nsize; }
      uint32_t    value_size() const { return _nsize - sizeof(node_header); }
      value_view  value() const
      {
         assert(_nsize >= sizeof(node_header) );
         return value_view(body(), value_size());
      }

      // size rounded up to the nearest 16 bytes
      inline uint32_t     object_capacity() const { return (_nsize + 15) & -16; }
      inline node_header* next() const { return (node_header*)(((char*)this) + object_capacity()); }

      bool validate_checksum() const
      {
         return true;  // TODO
      }
      void update_checksum() {}
   } __attribute((packed)) __attribute((aligned(16)));

   static_assert(sizeof(node_header) == 16);

}  // namespace arbtrie
