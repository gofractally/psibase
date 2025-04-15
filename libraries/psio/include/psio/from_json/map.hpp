#pragma once
#include <map>
#include <psio/from_json.hpp>

namespace psio
{
   template <typename K, typename T, typename C, typename S>
   void from_json(std::map<K, T, C>& m, S& stream)
   {
      from_json_object(stream,
                       [&](std::string_view key) { from_json(m[static_cast<K>(key)], stream); });
   }
}  // namespace psio
