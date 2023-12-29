#pragma once
#include <cassert>
#include <string_view>
#include <iostream>

namespace arbtrie
{

   // must be a power of 2
   // size of the data segments data is allocated in
   // the smaller this value, the more overhead there is in
   // searching for segments to manage and the free list
   // each thread will have a segment this size, so larger values
   // may use more memory than necessary for idle threads
   // max value: 4 GB due to type of segment_offset
   static const uint64_t segment_size = 1024 * 1024 * 128;  // 256mb

   /// object pointers can only address 48 bits
   /// 128 TB limit on database size with 47 bits, this saves us
   /// 8MB of memory relative to 48 bits in cases with less than 128 TB
   static const uint64_t max_segment_count = (1ull << 47) / segment_size;

   struct node_header;
   struct binary_node;
   struct setlist_node;

   using key_view       = std::string_view;
   using value_view     = std::string_view;
   using segment_offset = uint32_t;
   using segment_number = uint64_t;

   enum node_type : uint8_t
   {
      freelist  = 0,  // not initialized/invalid
      binary    = 1,  // binary search
      setlist   = 2,  // list of branches
      value     = 3,  // just the data, no key
      roots     = 4,  // contains pointers to other root nodes
      merge     = 5,  // delta applied to existing node
      undefined = 6,  // no type has been defined yet

      // future
      index    = 7,  // 256 index buffer to id_type
      bitfield = 8,
      full     = 9,  // 256 full id_type
   };

   /**
    *  An offset/8 from object_db_header::alloc_segments encoded
    *  as 5 bytes. This allows addressing of 8TB worth of object IDs which
    *  is way beyond what will fit in RAM of most computers, 32 bits would
    *  have only supported 32GB of object IDs which clearly fits within the
    *  RAM of many laptops. 
    */
   struct object_id
   {
      uint64_t    id : 40 = 0;  // obj id
      explicit    operator bool() const { return id != 0; }
      friend bool operator==(object_id a, object_id b) = default;
      friend std::ostream& operator << ( std::ostream& out, const object_id& oid ) {
         return out << uint64_t(oid.id);
      }
   } __attribute__((packed)) __attribute__((aligned(1)));
   static_assert(sizeof(object_id) == 5, "unexpected padding");
   static_assert(alignof(object_id) == 1, "unexpected alignment");

   /**
    * Used to identify where an object can be found
    */
   struct object_location
   {
      uint32_t segment() const { return _offset / segment_size; }
      uint32_t index() const { return _offset & (segment_size - 1); }

      friend bool operator==(const object_location&, const object_location&) = default;

      uint64_t _offset;  // : 48; only 48 bits can be used/stored in object_meta
   };

   struct object_meta
   {
     private:
      struct bitfield
      {
         uint64_t ref : 15;
         uint64_t type : 3;
         uint64_t location : 46;  // the location divided by 16, 1024 TB addressable
      };

      union
      {
         uint64_t              iv = 0;
         bitfield              bf;
         std::atomic<uint64_t> av;
      } _value;
      static_assert(sizeof(_value) == sizeof(uint64_t));

     public:
      static const uint64_t ref_mask      = (1ull << 15) - 1;
      static const uint64_t max_ref_count = ref_mask - 64;  // allow some overflow bits for retain
      static const uint64_t type_mask     = 7 << 15;
      static const uint64_t location_mask = ~(type_mask | ref_mask);

      object_meta( const object_meta& c) {
         _value.iv = c._value.iv;
      }
      object_meta& operator=(const object_meta& in) {
         _value.iv = in._value.iv;
         return *this;
      }

      explicit object_meta(uint64_t v = 0) { _value.iv = v; };
      explicit object_meta(node_type t)
      {
         _value.bf.type     = int(t);
         _value.bf.location = 0;
         _value.bf.ref      = 0;
      }

      // does not divide loc by 16
      explicit object_meta(node_type t, uint64_t loc)
      {
         _value.bf.type     = int(t);
         _value.bf.location = loc;
         _value.bf.ref      = 0;
      }
      explicit object_meta(node_type t, object_location loc)
      {
         assert(not (loc._offset & 15));
         _value.bf.type     = int(t);
         _value.bf.location = loc._offset >> 4;
         _value.bf.ref      = 0;
      }
      explicit object_meta(node_type t, object_location loc, int r)
      {
         assert(not (loc._offset & 15));
         _value.bf.type     = int(t);
         _value.bf.location = loc._offset >> 4;
         _value.bf.ref      = r;
      }

      object_meta& set_ref(uint16_t ref)
      {
         static_assert( max_ref_count < (1 << 15) );
         assert(int64_t(ref) < max_ref_count);
         _value.bf.ref = ref;
         return *this;
      }
      object_meta& set_location(object_location loc)
      {
         assert(not (loc._offset & 15));
         assert((loc._offset >> 4) == (loc._offset / 16));
         _value.bf.location = loc._offset >> 4;
         /*
            _value.bf.location = loc >> 4;
            loc << (location_rshift-3);
            value = (value & ~location_mask) | loc;
            */
         return *this;
      }
      object_meta& set_type(node_type type)
      {
         _value.bf.type = int(type);
         return *this;
         //   value = (value & ~type_mask ) | (uint64_t(type) << type_lshift);
      }
      uint64_t  ref() const { return _value.bf.ref; }  //_value & ref_mask; }
      node_type type() const { return node_type(_value.bf.type); }

      object_location loc() const { return {uint64_t(_value.bf.location) << 4}; }

      // return the loc without mult by 16
      uint64_t raw_loc() const { return _value.bf.location; }

      uint64_t&       data() { return _value.iv; }
      const uint64_t& data() const { return _value.iv; }
      uint64_t        to_int() const { return _value.iv; }
   };
   static_assert(sizeof(object_meta) == sizeof(uint64_t));

}  // namespace arbtrie
