#pragma once

#include <optional>
#include <psibase/check.hpp>
#include <psio/json.hpp>
#include <span>
#include <string>
#include <string_view>

namespace psibase
{
   using JWTKey = std::span<const char>;

   std::string                encodeJWT(const JWTKey&, std::string_view json);
   std::optional<std::string> decodeJWT(const JWTKey&, std::string_view token);

   template <typename T>
   std::optional<T> decodeJWT(const JWTKey& key, std::string_view token)
   {
      auto result = decodeJWT(key, token);
      // A token whose payload is not a T is not a token
      T value;
      if (result &&
          psio::decode_json_checked(psio::ijson{}, std::span<const char>{*result}, value).ok())
         return value;
      return std::nullopt;
   }

   template <typename T>
      requires psio::Reflected<T>
   std::string encodeJWT(const JWTKey& key, const T& token)
   {
      return encodeJWT(key, psio::to_ijson(token));
   }
}  // namespace psibase
