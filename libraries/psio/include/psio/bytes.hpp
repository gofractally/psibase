#pragma once
#include <psio/from_json.hpp>
#include <psio/reflect.hpp>
#include <psio/to_json.hpp>
#include <vector>

namespace psio
{
   struct bytes
   {
      std::vector<char> data;
   };

   PSIO_REFLECT(bytes, data);

   template <typename S>
   void to_json(const bytes& obj, S& stream)
   {
      psio::to_json_hex(obj.data.data(), obj.data.size(), stream);
   }

   template <typename S>
   void from_json(bytes& obj, S& stream)
   {
      psio::from_json_hex(obj.data, stream);
   }
}  // namespace psio
