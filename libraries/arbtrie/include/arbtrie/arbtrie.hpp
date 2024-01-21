#pragma once
#include <arbtrie/node_header.hpp>
#include <cassert>

namespace arbtrie
{

   struct value_node : public node_header
   {
      static const node_type type = node_type::value;

      uint32_t calculate_checksum()const {
         return XXH3_64bits( ((const char*)this)+sizeof(checksum), 
                      _nsize - sizeof(checksum) );
      }
      void visit_branches( auto )const{};
   };

   /*
   struct bitfield_node : node_header
   {
      static const node_type type = node_type::bitfield;
      uint64_t               present[4];
      uint8_t                has_value;  // because there are 257 possible branches
      //id_type                branches[N];
      //char                   prefix[];
   } __attribute((packed));
   */

};  // namespace arbtrie

#include <arbtrie/setlist_node.hpp>
#include <arbtrie/full_node.hpp>
#include <arbtrie/index_node.hpp>
#include <arbtrie/binary_node.hpp>


namespace arbtrie {

   template <typename T>
      requires is_node_header<T>
   inline auto cast_and_call(T* h, auto func)
   {
      switch (h->get_type())
      {
         // sparse internal nodes are assumed most likely, because only one
         // binary node is at the end of each traversal, the likely/unlikely
         // attributes impact the order in which the compiler places the code
         // to reduce instruction cache misses... in theory. Exceptions are
         // always predicted extremely unlikely.
         [[likely]] case node_type::setlist:
            return func(static_cast<transcribe_const_t<T, setlist_node>*>(h));
         [[likely]] case node_type::full:
            return func(static_cast<transcribe_const_t<T, full_node>*>(h));
         case node_type::binary:
            return func(static_cast<transcribe_const_t<T, binary_node>*>(h));
         [[unlikely]] case node_type::value:
            return func(static_cast<transcribe_const_t<T, value_node>*>(h));
         //[[unlikely]] case node_type::index:
         //   throw std::runtime_error("index node not implimented");
         [[unlikely]] case node_type::freelist:
            assert( !"cast and call on freelist" );
            throw std::runtime_error("cast and call on node type freelist");
         [[unlikely]] default:
            assert( !"cast and call on unknown node type" );
            throw std::runtime_error("cast and call on unknown node type");
      }
   }



}




//#include <arbtrie/binary_node.hpp>
//#include <arbtrie/upsert_impl.hpp>

#if 0 
TREE TRANSFORM BY EXAMPLE

initial condition:
   nullptr

upsert("larimer", "larimer");
   binary_node
        larimer = larimer

upsert("larimer1..250", "larimer1");
   binary_node
        larimer    = larimer
        larimer1   = larimer1
        ...
        larimer250 = larimer250

refactor because binary node is too big
   radix_node w/ prefix 'larimer'
        ''  = larimer
        '1' -> binary_node
              ''   = larimer1
              '0'  = larimer10
              '1'  = larimer11
              '00' = larimer100
        '2' -> binary_node
              ''   = larimer2
              ...
              '49' = larimer249
              '50' = larimer250

insert lary
    radix_node w/ prefix 'lar;
       'i' -> radix_node w/ prefix 'mer'
            ... samve as above
       'y' = lary

remove lary  - radix node has one child, combine prefix back to larimer
       

Assume initial condition
   binary_node
        daniel     = daniel
        larimer    = larimer
        larimer1   = larimer1
        ...
        larimer250 = larimer250

refactor to..
    radix_node w/prefix ''
        'd' -> binary_node
             aniel = "daniel"
        'l' -> binary_node
             arimer    = larimer
             arimer1   = larimer1
             ...
             arimer250 = larimer250


Rules:
   binary nodes don't have prefixes 
   binary nodes don't have other inner nodes as children
      - this is logical because binary search assumes equally dividing the
        available key space, but if one branch has a million keys under it
        then the searc is giving too much weight to the leaves near the
        top of the tree. 
      - therefore, a sparse tree with a dense branch can have may
        smaller radix nodes like a traditional radix tree.

   refactor a subtree into a binary node when total nested children are less than 125

#endif
