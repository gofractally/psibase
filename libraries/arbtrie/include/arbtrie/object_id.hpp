#pragma once
#include <cstdint>
#include <iostream>

namespace arbtrie
{

   struct object_id;

   struct id_region
   {
      constexpr id_region(uint16_t r = 0) : region(r) {}
      constexpr uint16_t to_int() const { return region; }
      uint16_t           region;
      friend bool        operator==(id_region a, id_region b) = default;

      friend std::ostream& operator<<(std::ostream& out, id_region r) { return out << r.region; }
   } __attribute__((aligned(1)));
   static_assert(sizeof(id_region) == 2);

   struct id_index
   {
      constexpr id_index(uint32_t r = 0) : index(r) {}
      uint16_t index;
      operator bool() const { return index; }
      friend bool operator==(id_index a, id_index b) { return a.index == b.index; };
   } __attribute__((packed)) __attribute__((aligned(1)));
   static_assert(sizeof(id_index) == 2);

   struct id_address
   {
      constexpr id_address()                  = default;
      constexpr id_address(const id_address&) = default;
      constexpr id_address(id_region r, id_index i) : _region(r), _index(i.index) {}
      constexpr id_address(object_id oid);

      operator object_id() const;

      uint32_t  to_int() const { return (uint32_t(_region.region) << 16) | _index.index; }
      uint16_t  region() const { return _region.region; }
      uint32_t  index() const { return _index.index; }
      id_region _region;
      id_index  _index;

      friend std::ostream& operator<<(std::ostream& out, id_address a)
      {
         return out << a.region() << "." << a.index();
      }
      friend bool operator==(id_address a, id_address b) = default;
      friend bool operator!=(id_address a, object_id b);

      operator bool() const { return _index; }
      void reset()
      {
         _region.region = 0;
         _index.index   = 0;
      }
   } __attribute__((packed)) __attribute__((aligned(1)));

   /**
    *  This type isn't for storage, but for computation 
    */
   struct fast_meta_address
   {
      uint16_t region = 0;
      uint32_t index  = 0;

      constexpr fast_meta_address() = default;
      constexpr fast_meta_address(id_region r, id_index i) : region(r.region), index(i.index) {}

      constexpr fast_meta_address(id_address a) : region(a.region()), index(a.index()) {}

      constexpr static inline fast_meta_address from_int(uint32_t i)
      {
         return {i >> 16, i & 0xffff};
      }
      constexpr uint32_t to_int() const { return (uint32_t(region) << 16) | uint32_t(index); }
      static_assert(sizeof(id_region) + sizeof(id_index) == sizeof(uint32_t));

      constexpr void reset()
      {
         region = 0;
         index  = 0;
      }

      operator bool() const { return index; }
      explicit             operator id_address() const { return {region, index}; }
      constexpr id_address to_address() const { return {region, index}; }

      friend std::ostream& operator<<(std::ostream& out, fast_meta_address a)
      {
         return out << a.region << "." << a.index;
      }
      friend bool operator!=(fast_meta_address a, fast_meta_address b) = default;
      friend bool operator==(fast_meta_address a, fast_meta_address b) = default;
   };

   inline fast_meta_address operator+(id_region r, id_index i)
   {
      return fast_meta_address(r, i);
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
      explicit             operator bool() const { return (id & 0xffff) != 0; }
      friend bool          operator==(object_id a, object_id b) = default;
      friend std::ostream& operator<<(std::ostream& out, const object_id& oid)
      {
         return out << id_address(oid);
      }
      constexpr object_id() : id(0) {}
      explicit constexpr object_id(uint64_t i) : id(i) {}

      explicit object_id(id_address a) : id(a.to_int()) {}

      uint64_t to_int() const { return id; }

      void reset() { id = 0; }

     private:
      uint64_t id : 40 = 0;  // obj id
   } __attribute__((packed)) __attribute__((aligned(1)));
   static_assert(sizeof(object_id) == 5, "unexpected padding");
   static_assert(alignof(object_id) == 1, "unexpected alignment");
   //static_assert( sizeof(id_address) == sizeof(object_id) );

   constexpr inline id_address::id_address(object_id oid)
   {
      auto i         = oid.to_int();
      _index.index   = i & 0xffff;
      _region.region = i >> 16;
   }

   inline id_address::operator object_id() const
   {
      return object_id(to_int());
   }
   inline bool operator!=(id_address a, object_id b)
   {
      return a.to_int() != b.to_int();
   }

}  // namespace arbtrie
