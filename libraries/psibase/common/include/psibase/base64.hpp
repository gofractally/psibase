#pragma once

#include <cstddef>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace psibase
{
   // base64, without whitespace
   std::optional<std::size_t> validateBase64(std::string_view s);
   std::vector<char>          fromBase64(std::string_view s);
   std::string                toBase64(std::span<const char> d);

   // base64url, no padding
   std::string toBase64Url(std::string_view s);
   std::string fromBase64Url(std::string_view s);
}  // namespace psibase
