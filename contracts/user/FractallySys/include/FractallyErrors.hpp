#pragma once

#include <string_view>

namespace UserContract
{
   namespace Errors
   {
      constexpr std::string_view insufficientPerm    = "Insufficient permission";
      constexpr std::string_view teamAlreadyExists    = "Team already exists";
      constexpr std::string_view fractalAlreadyExists = "Fractal already exists";
   }  // namespace Errors
}  // namespace UserContract