#pragma once

#include <string_view>

namespace psibase
{
   bool               versionMatch(std::string_view pattern, std::string_view version);
   std::weak_ordering versionCompare(std::string_view lhs, std::string_view rhs);
}  // namespace psibase
