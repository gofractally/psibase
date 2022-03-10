#pragma once

#include <psio/from_json.hpp>
#include <psio/varint.hpp>

namespace psio
{

   template <typename S>
   void from_json(varuint32& obj, S& stream)
   {
      from_json(obj.value, stream);
   }

   template <typename S>
   void from_json(varint32& obj, S& stream)
   {
      from_json(obj.value, stream);
   }

}  // namespace psio
