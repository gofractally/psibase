#include <algorithm>
#include <array>
#include <cstdint>
#include <optional>
#include <psibase/base64.hpp>
#include <psibase/check.hpp>
#include <psibase/crypto.hpp>
#include <psibase/jwt.hpp>
#include <psio/reflect.hpp>
#include <ranges>
#include <string>
#include <string_view>

namespace psibase
{
   std::string toBase64Url(unsigned char* data, std::size_t size)
   {
      return toBase64Url(std::string_view{reinterpret_cast<char*>(data), size});
   }
   struct token_header
   {
      std::string typ{"JWT"};
      std::string alg{"HS256"};
      friend bool operator==(const token_header&, const token_header&) = default;
   };
   PSIO_REFLECT(token_header, typ, alg);
   std::optional<std::string> decodeJWT(const JWTKey& key, std::string_view token)
   {
      auto end_header = token.find('.');
      if (end_header == std::string_view::npos)
         return std::nullopt;
      auto end_payload = token.find('.', end_header + 1);
      if (end_payload == std::string_view::npos)
         return std::nullopt;
      std::string_view encoded_header  = token.substr(0, end_header);
      std::string_view encoded_payload = token.substr(end_header + 1, end_payload - end_header - 1);
      std::string_view encoded_signature = token.substr(end_payload + 1, std::string::npos);
      std::string_view signing_input     = token.substr(0, end_payload);

      Checksum256 mac       = hmacSha256(key, signing_input);
      auto        signature = fromBase64Url(encoded_signature);
      if (signature.size() != mac.size() ||
          std::memcmp(signature.data(), mac.data(), mac.size()) != 0)
         return std::nullopt;

      auto header = psio::convert_from_json<token_header>(fromBase64Url(encoded_header));
      if (header != token_header{})
         return std::nullopt;

      return fromBase64Url(encoded_payload);
   }
   std::string encodeJWT(const JWTKey& key, std::string_view token)
   {
      std::string result =
          toBase64Url(psio::convert_to_json(token_header{})) + "." + toBase64Url(token);
      auto mac = hmacSha256(key, result);
      return result + "." + toBase64Url(mac.data(), mac.size());
   }
}  // namespace psibase
