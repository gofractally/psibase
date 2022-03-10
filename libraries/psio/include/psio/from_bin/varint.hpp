#pragma once

#include <psio/from_bin.hpp>
#include <psio/varint.hpp>

namespace psio
{

   template <typename S>
   void from_bin(varuint32& obj, S& stream)
   {
      varuint32_from_bin(obj.value, stream);
   }

   template <typename S>
   void from_bin(varint32& obj, S& stream)
   {
      varint32_from_bin(obj.value, stream);
   }

}  // namespace psio
