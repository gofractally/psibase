#pragma once
#include <list>
#include <psio/to_bin.hpp>

namespace psio
{

   template <typename T, typename S>
   result<void> to_bin(const std::list<T>& obj, S& stream)
   {
      return to_bin_range(obj, stream);
   }

}  // namespace psio
