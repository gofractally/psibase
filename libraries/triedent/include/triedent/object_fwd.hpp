#pragma once

#include <cstdint>
#include <cstring>

namespace triedent
{
   using segment_offset = uint32_t;  /// offset pointer from base of segment
   using segment_number = uint64_t;  /// segment_offset / segment_size
                                     
   class node;
   class value_node;
   class inner_node;
                                     

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

   /**
    *  An offset/8 from object_db_header::alloc_segments encoded
    *  as 5 bytes. This allows addressing of 8TB worth of object IDs which
    *  is way beyond what will fit in RAM of most computers, 32 bits would
    *  have only supported 32GB of object IDs which clearly fits within the
    *  RAM of many laptops. 8 TB 
    */
   struct object_id
   {
      uint64_t    id : 40 = 0;  // obj id
      explicit    operator bool() const { return id != 0; }
      friend bool operator==(object_id a, object_id b) = default;
   } __attribute__((packed)) __attribute__((aligned(1)));
   static_assert(sizeof(object_id) == 5, "unexpected padding");
   static_assert(alignof(object_id) == 1, "unexpected alignment");

   enum class node_type : std::uint8_t
   {
      inner     = 0,
      bytes     = 1,
      roots     = 2,
      undefined = 3
   };

   class object_info;
   struct object_location
   {
      uint32_t segment() const { return _offset / segment_size; }
      uint32_t index() const { return _offset & (segment_size - 1); }

      friend bool operator==(const object_location&, const object_location&) = default;

      friend class object_info;
      uint64_t _offset : 48;
   };

   class object_info
   {
     public:
      static const uint64_t ref_mask        = 0x7fff;
      static const uint64_t max_ref_count   = ref_mask - 64; // allow some overflow bits for retain
      static const uint64_t lock_mask       = 3 << 17;
      static const uint64_t type_mask       = 3 << 15;
      static const uint64_t location_mask   = ~(type_mask|lock_mask|ref_mask);
      static const uint32_t location_lshift = 45;
      static const uint32_t location_rshift = 64 - location_lshift;

      explicit constexpr object_info(uint64_t x)
          : _location(x >> location_rshift),
            _locked((x >> 17) & 3),
            _type((x >> 15) & 3),
            _ref(x & ref_mask)
      {
      }
      object_info( node_type t, uint64_t loc = -1):_type((int)t){
         _ref = 0;
         _locked = 0;
         _location = loc;
      };

      bool      locked() const { return _locked; }
      uint32_t  ref() const { return _ref; }
      node_type type() const { return static_cast<node_type>(_type); }
      auto      location() const { return object_location{_location * 8}; }

      void set_type(node_type t) { _type = (int)t; }

      // pre set location
      constexpr object_info& set_location(const object_location& loc)
      {
         _location = loc._offset / 8;
         return *this;
      }

      constexpr uint64_t to_int() const
      {
         return _ref | (_type << 15) | (_locked << 17) | (_location << 19);
      }
      constexpr operator object_location() const
      {
         return object_location{._offset = _location * 8};
      }

      //private:
      friend class object_location;
      uint64_t _ref : 15;
      uint64_t _type : 2;
      uint64_t _locked : 2;
      uint64_t _location : 45;
   };
   static_assert(sizeof(object_info) == sizeof(uint64_t), "unexpected padding");

   struct object_header
   {
      // size might not be a multiple of 8, next object is at data() + (size+7)&-8
      uint64_t size : 24;  // bytes of data, not including header
      uint64_t id : 40;

      inline uint64_t data_size() const { return size; }
      inline uint32_t data_capacity() const { return (size + 7) & -8; }
      inline char*    data() const { return (char*)(this + 1); }

      // returns the end of data_capacity() cast as another object_header
      inline object_header* next() const
      {
         return (object_header*)(((char*)this) + object_size());
      }

      // capacity + sizeof(object_header)
      inline uint32_t object_size()const {
         return data_capacity() + sizeof(object_header);
      }
   };
}  // namespace triedent
