#pragma once

#include "from_bin.hpp"
#include "from_json.hpp"
#include "to_bin.hpp"
#include "to_json.hpp"
#include <compare>

namespace psio
{
   /**
    * @defgroup varint Variable Length Integer Type
    * @ingroup core
    * @ingroup types
    * @brief Defines variable length integer type which provides more efficient serialization
    */

   /**
    * Variable Length Unsigned Integer. to_bin() and from_bin() use [VLQ or Base-128
    * encoding](https://en.wikipedia.org/wiki/Variable-length_quantity)
    *
    *  @ingroup varint
    */
   struct varuint32
   {
      uint32_t value = 0;

      friend auto operator<=>(varuint32, varuint32) noexcept = default;
   };
   PSIO_REFLECT(varuint32, value);

   template <typename S>
   void from_bin(varuint32& obj, S& stream)
   {
      return varuint32_from_bin(obj.value, stream);
   }

   template <typename S>
   void to_bin(const varuint32& obj, S& stream)
   {
      return varuint32_to_bin(obj.value, stream);
   }

   template <typename S>
   void from_json(varuint32& obj, S& stream)
   {
      return from_json(obj.value, stream);
   }

   template <typename S>
   void to_json(const varuint32& obj, S& stream)
   {
      return to_json(obj.value, stream);
   }

   template <typename S>
   void to_key(const varuint32& obj, S& stream)
   {
      return to_key_varuint32(obj.value, stream);
   }

   /**
    * Variable Length Signed Integer. to_bin() and from_bin() use [Zig-Zag
    * encoding](https://developers.google.com/protocol-buffers/docs/encoding#signed-integers)
    *
    *  @ingroup varint
    */
   struct varint32
   {
      int32_t value = 0;

      friend auto operator<=>(varint32, varint32) noexcept = default;
   };
   PSIO_REFLECT(varint32, value);

   template <typename S>
   void from_bin(varint32& obj, S& stream)
   {
      return varint32_from_bin(obj.value, stream);
   }

   template <typename S>
   void to_bin(const varint32& obj, S& stream)
   {
      return varuint32_to_bin((uint32_t(obj.value) << 1) ^ uint32_t(obj.value >> 31), stream);
   }

   template <typename S>
   void from_json(varint32& obj, S& stream)
   {
      return from_json(obj.value, stream);
   }

   template <typename S>
   void to_json(const varint32& obj, S& stream)
   {
      return to_json(obj.value, stream);
   }

   template <typename S>
   void to_key(const varint32& obj, S& stream)
   {
      to_key_varint32(obj.value, stream);
   }
}  // namespace psio
