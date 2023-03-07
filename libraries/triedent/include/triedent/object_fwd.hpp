#pragma once

#include <cstdint>

namespace triedent
{
   struct object_id
   {
      std::uint64_t id : 40 = 0;  // obj id
      explicit      operator bool() const { return id != 0; }
      friend bool   operator==(object_id a, object_id b) = default;
   } __attribute__((packed)) __attribute__((aligned(1)));
   static_assert(sizeof(object_id) == 5, "unexpected padding");
   static_assert(alignof(object_id) == 1, "unexpected alignment");

   enum class node_type : std::uint8_t
   {
      inner,
      bytes,
      roots,
   };

   struct object_location
   {
      std::uint64_t offset : 48;
      std::uint64_t cache : 2;
      friend bool   operator==(const object_location&, const object_location&) = default;
   };
}  // namespace triedent
