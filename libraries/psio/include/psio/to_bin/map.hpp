#pragma once
#include <psio/to_bin.hpp>
#include <map>

namespace psio
{

   template <typename K, typename V, typename S>
   result<void> to_bin(const std::map<K, V>& obj, S& stream)
   {
      return to_bin_range(obj, stream);
   }

}  // namespace psio
