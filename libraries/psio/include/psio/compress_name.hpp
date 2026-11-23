#pragma once
#include <psio/action_name.hpp>

// Source spellings share the new codec; no old-format decoder is retained.
namespace psio::detail
{
   inline constexpr uint64_t method_to_number(std::string_view name)
   {
      return action_names::encode(name);
   }
   inline std::string number_to_method(uint64_t value)
   {
      return action_names::decode(value);
   }
   inline constexpr bool is_hash_name(uint64_t value)
   {
      return action_names::is_hash(value);
   }
}  // namespace psio::detail
