#pragma once
#include <cstdint>
#include <iostream>

namespace arbtrie
{
   /**
    * type safe identifier for the region of an object
    */
   class id_region
   {
      uint16_t region;
      friend class id_address;

     public:
      constexpr id_region(uint16_t r = 0) : region(r) {}
      constexpr uint16_t to_int() const { return region; }
      bool               operator!() const { return region == 0; }
      explicit           operator bool() const { return region != 0; }

      friend bool          operator==(id_region a, id_region b) { return a.region == b.region; }
      friend bool          operator!=(id_region a, id_region b) { return a.region != b.region; }
      friend std::ostream& operator<<(std::ostream& out, id_region r) { return out << r.region; }

   } __attribute__((packed)) __attribute__((aligned(1)));
   static_assert(sizeof(id_region) == 2);

   /**
    * type safe identifier for the index of an object
    */
   class id_index
   {
      uint16_t index;
      friend class id_address;

     public:
      constexpr id_index(uint16_t r = 0) : index(r) {}
      explicit             operator bool() const { return index; }
      constexpr uint16_t   to_int() const { return index; }
      friend bool          operator==(id_index a, id_index b) { return a.index == b.index; };
      friend std::ostream& operator<<(std::ostream& out, id_index i) { return out << i.index; }
   } __attribute__((packed)) __attribute__((aligned(1)));
   static_assert(sizeof(id_index) == 2);

   static constexpr id_index null_index = id_index(0);

   /**
    * type safe identifier for the address of an object 
    */
   class id_address
   {
      uint32_t _address = 0;

     public:
      constexpr id_address()                  = default;
      constexpr id_address(const id_address&) = default;
      constexpr id_address(id_region r, id_index i) : _address(uint32_t(r.region) << 16 | i.index)
      {
      }
      constexpr explicit id_address(uint32_t addr) : _address(addr) {}
      static constexpr id_address from_int(uint32_t addr) { return id_address(addr); }

      uint32_t  to_int() const { return _address; }
      id_region region() const { return id_region(_address >> 16); }
      id_index  index() const { return id_index(_address & 0xffff); }

      friend std::ostream& operator<<(std::ostream& out, id_address a)
      {
         return out << a.region() << "." << a.index();
      }
      friend auto operator<=>(const id_address&, const id_address&) = default;
      id_address& operator=(const id_address&)                      = default;

      /** every region has a null address */
      explicit operator bool() const { return bool(index()); }
   } __attribute__((packed)) __attribute__((aligned(1)));

   static_assert(alignof(id_address) == 1, "unexpected alignment");
   static_assert(alignof(id_index) == 1, "unexpected alignment");
   static_assert(alignof(id_region) == 1, "unexpected alignment");

   /**
    * operator to combine a region and index into an address
    */
   inline id_address operator+(id_region r, id_index i)
   {
      return id_address(r, i);
   }

   using object_id  = id_address;
   using id_address = id_address;

}  // namespace arbtrie
