#pragma once
#include <cstdint>
#include <iostream>

namespace arbtrie {

   struct object_id;

   struct id_region {
      id_region( uint16_t r = 0 ):region(r){}
      uint16_t region;
   } __attribute__((aligned(1)));
   static_assert( sizeof(id_region) == 2 );

   struct id_index {
      id_index( uint32_t r = 0 ):index(0){}
      uint32_t index:24;
   } __attribute__((packed)) __attribute__((aligned(1)));
   static_assert( sizeof(id_index) == 3 );

   struct id_address {
      id_address( id_region r, id_index i ):_region(r),_index(i){}

      id_address( object_id oid ); 
      uint64_t to_int()const { return (uint64_t(_region.region)<<24) | _index.index; }
      uint16_t region()const { return _region.region; }
      uint32_t index()const  { return _index.index; }
      id_region _region;
      id_index  _index;

      friend std::ostream& operator  << ( std::ostream& out, id_address a) {
         return out << a.region() <<"."<<a.index();
      }
   }__attribute__((packed)) __attribute__((aligned(1)));

   inline id_address operator + ( id_region r, id_index i ) {
      return id_address{ r, i };
   }

   /**
    *  An offset/8 from object_db_header::alloc_segments encoded
    *  as 5 bytes. This allows addressing of 8TB worth of object IDs which
    *  is way beyond what will fit in RAM of most computers, 32 bits would
    *  have only supported 32GB of object IDs which clearly fits within the
    *  RAM of many laptops. 
    */
   struct object_id
   {
      explicit             operator bool() const { return id != 0; }
      friend bool          operator==(object_id a, object_id b) = default;
      friend std::ostream& operator<<(std::ostream& out, const object_id& oid)
      {
         return out << id_address(oid);
      }
      constexpr object_id():id(0){}
      explicit constexpr object_id( uint64_t i ):id(i){}

      explicit object_id( id_address a ):id(a.to_int()){}

      uint64_t to_int()const { return id; }
      
      void reset(){id=0;}
      private:
      uint64_t             id : 40 = 0;  // obj id
   } __attribute__((packed)) __attribute__((aligned(1)));
   static_assert(sizeof(object_id) == 5, "unexpected padding");
   static_assert(alignof(object_id) == 1, "unexpected alignment");
   static_assert( sizeof(id_address) == sizeof(object_id) );

   inline id_address::id_address( object_id oid ) {
      auto i = oid.to_int();
      _index.index   = i & 0xffffff;
      _region.region = i >> 24;
   }

} // namespace arbtrie
