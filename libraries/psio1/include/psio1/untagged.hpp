#pragma once

namespace psio1
{
   template <typename T>
   constexpr bool psio_is_untagged(const T*)
   {
      return false;
   }
}  // namespace psio1
