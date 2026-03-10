#pragma once

#include <algorithm>
#include <optional>
#include <psibase/HttpHeaders.hpp>
#include <psibase/base64.hpp>
#include <string_view>
#include <utility>
#include <vector>

namespace LocalService
{

   struct BasicCredentials
   {
      std::vector<char> value;
      std::size_t       pos;
      std::string_view  username() const { return std::string_view{value.data(), pos}; }
      std::string_view  password() const
      {
         return std::string_view{value.begin() + pos + 1, value.end()};
      }
   };

   inline std::optional<BasicCredentials> parseBasicAuth(std::string_view auth)
   {
      if (!psibase::iequal(auth.substr(0, 5), "basic"))
         return std::nullopt;

      auto pos         = 5;
      auto credentials = auth.find_first_not_of(' ', pos);
      if (credentials == pos || credentials == std::string_view::npos)
         return std::nullopt;

      auto decoded = psibase::fromBase64(auth.substr(credentials));
      auto enduser = std::ranges::find(decoded, ':');
      if (enduser == decoded.end())
         return std::nullopt;
      auto offset = static_cast<std::size_t>(enduser - decoded.begin());

      return BasicCredentials{std::move(decoded), offset};
   }

}  // namespace LocalService
