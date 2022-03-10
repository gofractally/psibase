#pragma once
#include <psio/to_json.hpp>
#include <psio/varint.hpp>

namespace psio
{

   template <typename S>
   void to_json(const varuint32& obj, S& stream)
   {
      to_json(obj.value, stream);
   }

   template <typename S>
   void to_json(const varint32& obj, S& stream)
   {
      to_json(obj.value, stream);
   }

}  // namespace psio
