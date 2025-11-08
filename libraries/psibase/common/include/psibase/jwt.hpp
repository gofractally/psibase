#pragma once

#include <optional>
#include <psibase/check.hpp>
#include <psio/from_json.hpp>
#include <psio/to_json.hpp>

namespace psibase
{
   using JWTKey = std::span<const char>;

   std::string encodeJWT(const JWTKey&, std::string_view json);
   void        validateJWT(const JWTKey&, std::string_view token);
   std::string decodeJWTPayloadUnsafe(std::string_view token);

   template <typename T>
   std::optional<T> decodeJWT(const JWTKey&                 key,
                              std::string_view              token,
                              std::function<bool(const T&)> validatePayload)
   {
      auto payload = psio::convert_from_json<T>(decodeJWTPayloadUnsafe(token));
      if (validatePayload(payload))
      {
         validateJWT(key, token);
         return payload;
      }
      return std::nullopt;
   }

   template <typename T>
      requires psio::Reflected<T>
   std::string encodeJWT(const JWTKey& key, const T& token)
   {
      return encodeJWT(key, psio::convert_to_json(token));
   }
}  // namespace psibase
