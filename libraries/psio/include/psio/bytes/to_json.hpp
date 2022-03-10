#pragma once
#include <psio/bytes.hpp>
#include <psio/to_json.hpp>

namespace psio
{

   template <typename S>
   void to_json(const bytes& obj, S& stream)
   {
      psio::to_json_hex(obj.data.data(), obj.data.size(), stream);
   }

}  // namespace psio
