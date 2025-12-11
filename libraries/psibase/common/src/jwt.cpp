#include <algorithm>
#include <array>
#include <cstdint>
#include <optional>
#include <psibase/check.hpp>
#include <psibase/crypto.hpp>
#include <psibase/jwt.hpp>
#include <psio/reflect.hpp>
#include <ranges>
#include <string>
#include <string_view>

#include "base64.hpp"

namespace psibase
{
   namespace
   {
      constexpr auto base64url_tab    = psibase::detail::base64Table('-', '_');
      constexpr auto base64url_invtab = psibase::detail::invert(base64url_tab);
   }  // namespace
   std::string to_base64url(std::string_view s)
   {
      std::string result;
      result.reserve((s.size() * 4 + 2) / 3);
      psibase::detail::transcode<8, 6, true>(
          s, [&](unsigned ch) { result.push_back(base64url_tab[ch]); });
      return result;
   }
   std::string to_base64url(unsigned char* data, std::size_t size)
   {
      return to_base64url(std::string_view{reinterpret_cast<char*>(data), size});
   }
   std::string from_base64url(std::string_view s)
   {
      std::string result;
      result.reserve(s.size() * 3 / 4);
      bool okay = psibase::detail::transcode<6, 8, false>(
          s | std::ranges::views::transform(
                  [](char ch)
                  {
                     if (auto result = base64url_invtab[static_cast<unsigned char>(ch)];
                         result != -1)
                     {
                        return result;
                     }
                     else
                     {
                        abortMessage("Invalid base64 char");
                     }
                  }),
          [&](unsigned ch) { result.push_back(static_cast<char>(ch)); });
      psibase::check(okay, "Invalid padding");
      return result;
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
      auto        signature = from_base64url(encoded_signature);
      if (signature.size() != mac.size() ||
          std::memcmp(signature.data(), mac.data(), mac.size()) != 0)
         return std::nullopt;

      auto header = psio::convert_from_json<token_header>(from_base64url(encoded_header));
      if (header != token_header{})
         return std::nullopt;

      return from_base64url(encoded_payload);
   }
   std::string encodeJWT(const JWTKey& key, std::string_view token)
   {
      std::string result =
          to_base64url(psio::convert_to_json(token_header{})) + "." + to_base64url(token);
      auto mac = hmacSha256(key, result);
      return result + "." + to_base64url(mac.data(), mac.size());
   }
}  // namespace psibase
