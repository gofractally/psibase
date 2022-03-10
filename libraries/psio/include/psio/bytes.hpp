#pragma once
#include <psio/reflect.hpp>
#include <vector>

namespace psio
{

   struct bytes
   {
      std::vector<char> data;
   };

   PSIO_REFLECT(bytes, data);

}  // namespace psio
