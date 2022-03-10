#pragma once
#include <psio/to_bin.hpp>
#include <deque>

namespace psio
{

   template <typename T, typename S>
   result<void> to_bin(const std::deque<T>& obj, S& stream)
   {
      return to_bin_range(obj, stream);
   }

}  // namespace psio
