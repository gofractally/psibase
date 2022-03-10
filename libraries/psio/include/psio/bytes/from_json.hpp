#pragma once
#include <psio/bytes.hpp>
#include <psio/from_json.hpp>

namespace psio
{

   template <typename S>
   void from_json(bytes& obj, S& stream)
   {
      psio::from_json_hex(obj.data, stream);
   }

}  // namespace psio
