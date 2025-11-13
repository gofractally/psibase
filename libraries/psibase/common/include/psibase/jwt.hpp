#pragma once

#include <optional>
#include <psibase/check.hpp>
#include <psio/from_json.hpp>
#include <psio/to_json.hpp>

namespace psibase
{
   using JWTKey = std::span<const char>;

   std::string                encodeJWT(const JWTKey&, std::string_view json);
   std::optional<std::string> decodeJWT(const JWTKey&, std::string_view token);

   template <typename T>
   std::optional<T> decodeJWT(const JWTKey& key, std::string_view token)
   {
      auto result = decodeJWT(key, token);
      if (result)
         return psio::convert_from_json<T>(*result);
      return std::nullopt;
   }

   template <typename T>
      requires psio::Reflected<T>
   std::string encodeJWT(const JWTKey& key, const T& token)
   {
      return encodeJWT(key, psio::convert_to_json(token));
   }
}  // namespace psibase
