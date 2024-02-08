#pragma once

namespace arbtrie {

   struct value_node : public node_header
   {
      static const node_type type = node_type::value;
      uint32_t _vsize;


      static constexpr int alloc_size( value_view v ) { return round_up_multiple<64>(sizeof(value_node) + v.size()); }

      value_node( uint32_t asize, fast_meta_address nid, value_view v )
      :node_header( asize, nid, type ){
         assert( asize >= sizeof(value_node) + v.size() );
         _vsize = v.size();
         memcpy( data(), v.data(), v.size() );
      }

      const uint8_t* data()const { return (const uint8_t*)(this+1); }
      uint8_t* data(){ return (uint8_t*)(this+1); }

      void set_value( value_view v ) {
         assert( value_capacity() >= v.size() );

         _vsize = v.size();
         memcpy( data(), v.data(), v.size() );
      }

      uint32_t value_capacity()const { return _nsize - sizeof(value_node); }
      uint32_t value_size() const { return _vsize; }

      value_view value() const
      {
         assert(_nsize >= sizeof(node_header));
         return value_view(data(), value_size());
      }

      uint32_t calculate_checksum()const {
         return XXH3_64bits( ((const char*)this)+sizeof(checksum), 
                      _nsize - sizeof(checksum) );
      }
      void visit_branches( auto )const{};
   };
  
} // namespace arbtrie
