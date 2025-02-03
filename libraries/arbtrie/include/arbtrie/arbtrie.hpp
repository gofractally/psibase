#pragma once
#include <arbtrie/node_header.hpp>
#include <cassert>

namespace arbtrie
{


};  // namespace arbtrie

#include <arbtrie/setlist_node.hpp>
#include <arbtrie/value_node.hpp>
#include <arbtrie/full_node.hpp>
#include <arbtrie/index_node.hpp>
#include <arbtrie/binary_node.hpp>
#include <arbtrie/bitset_node.hpp>

namespace arbtrie {

   template <typename T>
      requires is_node_header<T>
   inline auto cast_and_call(node_type t, T* h, auto&& func)
   {
      switch (t)
      {
         // sparse internal nodes are assumed most likely, because only one
         // binary node is at the end of each traversal, the likely/unlikely
         // attributes impact the order in which the compiler places the code
         // to reduce instruction cache misses... in theory. Exceptions are
         // always predicted extremely unlikely.
         [[likely]] case node_type::setlist:
            return func(static_cast<transcribe_const_t<T, setlist_node>*>(h));
       //  [[likely]] case node_type::bitset:
       //     return func(static_cast<transcribe_const_t<T, bitset_node>*>(h));
         [[likely]] case node_type::full:
            return func(static_cast<transcribe_const_t<T, full_node>*>(h));
         case node_type::binary:
            return func(static_cast<transcribe_const_t<T, binary_node>*>(h));
         [[unlikely]] case node_type::value:
            return func(static_cast<transcribe_const_t<T, value_node>*>(h));
         [[unlikely]] case node_type::freelist:
            assert( !"cast and call on freelist" );
            throw std::runtime_error("cast and call on node type freelist");
         [[unlikely]] default:
            assert( !"cast and call on unknown node type" );
            throw std::runtime_error("cast and call on unknown node type");
      }
   }

   template <typename T>
      requires is_node_header<T>
   inline auto cast_and_call(T* h, auto&& func)
   {
      return cast_and_call( h->get_type(), h, std::forward<decltype(func)>(func) );
   }



}


