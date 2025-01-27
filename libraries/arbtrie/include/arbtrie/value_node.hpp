#pragma once
#include <arbtrie/value_type.hpp>

namespace arbtrie {

   struct value_node : public node_header
   {
      static const node_type type = node_type::value;
      uint32_t _vsize = 0;
      uint16_t _is_subtree:1 = 0;
      uint16_t _ksize:15 = 0;

      static constexpr int alloc_size( value_view v ) { return round_up_multiple<64>(sizeof(value_node) + v.size()); }
      static constexpr int alloc_size( const value_type& v ) { return round_up_multiple<64>(sizeof(value_node) + v.size()); }
      static constexpr int alloc_size( key_view k, value_view v ) { 
         return round_up_multiple<64>(sizeof(value_node) + k.size() + v.size()); }

      static constexpr int alloc_size( key_view k, const value_type& v ) { 
         return round_up_multiple<64>(sizeof(value_node) + k.size() + v.size()); }

      value_node( uint32_t asize, fast_meta_address nid, key_view k, value_view v )
      :node_header( asize, nid, type ){
         assert( asize >= alloc_size( k, v ) );
         _ksize = k.size();
         memcpy( (char*)key_ptr(), k.data(), k.size() );
         set_value(v);
      }

      value_node( uint32_t asize, fast_meta_address nid, key_view k, const value_type& v )
      :node_header( asize, nid, type ){
         assert( asize >= alloc_size( k, v ) );
         _ksize = k.size();
         memcpy( (char*)key_ptr(), k.data(), k.size() );
         set_value(v);
      }

      value_node( uint32_t asize, fast_meta_address nid, value_view v )
      :node_header( asize, nid, type ),_ksize(0){
         assert( asize >= sizeof(value_node) + v.size() );
         set_value(v);
      }
      value_node( uint32_t asize, fast_meta_address nid, const value_type& v )
      :node_header( asize, nid, type ),_ksize(0){
         assert( asize >= sizeof(value_node) + v.size() );
         set_value(v);
      }

      const uint8_t* key_ptr()const { return ((const uint8_t*)(this+1)); }
      key_view key()const { return { key_ptr(), _ksize }; }
      const uint8_t* data()const { return ((const uint8_t*)(this+1)) + _ksize; }
      uint8_t* data(){ return ((uint8_t*)(this+1))+_ksize; }

      fast_meta_address subtree()const {
         fast_meta_address result;
         if( _is_subtree ) {
            result = *((const id_address*)data());
         }
         return result;
      }
      fast_meta_address set_value( const value_type& v ) {
         assert( value_capacity() >= v.size() );
         fast_meta_address result = subtree();
         v.visit( [&]( auto&& val ){ set_value(val); } );
         return result;

      }
      void set_value( fast_meta_address a ) {
         set_value(a.to_address());
      }
      void set_value( id_address a ) {
         assert( value_capacity() >= sizeof(a) );
         _is_subtree = true;
         _vsize = sizeof(a);
         *((id_address*)data()) = a;
      }
      void set_value( value_view v ) {
         assert( value_capacity() >= v.size() );
         _is_subtree = false;
         _vsize = v.size();
         memcpy( data(), v.data(), v.size() );
      }

      uint32_t value_capacity()const { return _nsize - sizeof(value_node) - _ksize; }
      uint32_t value_size() const { return _vsize; }

      bool is_subtree()const { return _is_subtree; }
      value_type get_value()const {
         if( _is_subtree )
            return subtree();
         return value();
      }

      value_view value() const
      {
         assert(_nsize >= sizeof(node_header));
         return value_view(data(), value_size());
      }

      uint32_t calculate_checksum()const {
         return XXH3_64bits( ((const char*)this)+sizeof(checksum), 
                      _nsize - sizeof(checksum) );
      }
      void visit_branches( auto&& cb )const{
         if( _is_subtree ) cb( subtree() );
      };
   } __attribute((packed)) __attribute((aligned(1)));
  
} // namespace arbtrie
