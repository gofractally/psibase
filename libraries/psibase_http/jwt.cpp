/*
 * File: jwt.cpp
 *
 * Provides functions for encoding and decoding JSON Web Tokens (JWT).
 * This includes base64 URL encoding and decoding methods, and methods
 * to create and verify JWTs using HMAC signatures.
 */

#include <psibase/jwt.hpp>

#include <psio/from_json.hpp>
#include <psio/to_json.hpp>

#include <ranges>

#include <openssl/hmac.h>

namespace psibase::http
{
   // Anonymous namespace to contain internal details of the JWT implementation.
   // This includes base64 URL encoding/decoding tables and a transcode template function.
   namespace
   {
      constexpr std::array<char, 64> make_base64url_tab()
      {
         std::array<char, 64> result = {};
         auto                 pos    = result.begin();
         pos    = std::ranges::copy(std::ranges::views::iota('A', static_cast<char>('Z' + 1)), pos).out;
         pos    = std::ranges::copy(std::ranges::views::iota('a', static_cast<char>('z' + 1)), pos).out;
         pos    = std::ranges::copy(std::ranges::views::iota('0', static_cast<char>('9' + 1)), pos).out;
         *pos++ = '-';
         *pos++ = '_';
         if (pos != result.end())
            throw std::runtime_error("Size mismatch");
         return result;
      }
      constexpr auto                         base64url_tab = make_base64url_tab();
      constexpr std::array<std::int8_t, 256> make_base64url_invtab()
      {
         std::array<std::int8_t, 256> result = {};
         for (auto& ch : result)
         {
            ch = -1;
         }
         std::int8_t i = 0;
         for (auto ch : base64url_tab)
         {
            result[static_cast<unsigned char>(ch)] = i;
            ++i;
         }
         return result;
      }
      constexpr auto     base64url_invtab = make_base64url_invtab();
      constexpr unsigned mask(int bits)
      {
         return (unsigned(1) << bits) - 1;
      }
      // Encoding may add padding bits, decoding removes padding
      template <int SrcBits, int DstBits, bool Encode>
      void transcode(const auto& in, auto out)
      {
         unsigned buf  = 0;
         int      bits = 0;
         for (unsigned char ch : in)
         {
            buf = (buf << SrcBits) | ch;
            bits += SrcBits;
            while (bits >= DstBits)
            {
               bits -= DstBits;
               out((buf >> bits) & mask(DstBits));
            }
         }
         if constexpr (Encode)
         {
            if (bits != 0)
            {
               out((buf << (DstBits - bits)) & mask(DstBits));
            }
         }
         else
         {
            psibase::check((buf & mask(bits)) == 0, "Invalid padding");
         }
      }
   }  // namespace
      /**
    * Convert a string to its base64 URL encoded representation.
    *
    * @param s The input string to encode.
    * @return A base64 URL encoded string.
    */
   std::string to_base64url(std::string_view s)
   {
      std::string result;
      result.reserve((s.size() * 4 + 2) / 3);
      transcode<8, 6, true>(s, [&](unsigned ch) { result.push_back(base64url_tab[ch]); });
      return result;
   }
   std::string to_base64url(unsigned char* data, std::size_t size)
   {
      return to_base64url(std::string_view{reinterpret_cast<char*>(data), size});
   }
   std::string from_base64url(std::string_view s)
   /**
    * Convert a base64 URL encoded string to its original representation.
    *
    * @param s The base64 URL encoded string to decode.
    * @return The original string that was encoded.
    * @throws std::runtime_error If the input is not a valid base64 URL encoded string.
    */
   {
      std::string result;
      result.reserve(s.size() * 3 / 4);
      transcode<6, 8, false>(
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
                        throw std::runtime_error("Invalid base64 char");
                     }
                  }),
          [&](unsigned ch) { result.push_back(static_cast<char>(ch)); });
      return result;
   }
   /**
    * Structure representing the header of a JWT token.
    *
    * The 'typ' member represents the type of the token, which is always 'JWT'.
    * The 'alg' member represents the signing algorithm used, which defaults to 'HS256' (HMAC using SHA-256).
    */
   struct token_header
   {
      std::string typ{"JWT"};
      std::string alg{"HS256"};
      friend bool operator==(const token_header&, const token_header&) = default;
   };
   PSIO_REFLECT(token_header, typ, alg);
   /**
    * Decode a JWT token and verify its signature with the provided key.
    *
    * @param key The key used for HMAC signature verification.
    * @param token The JWT token to decode and verify.
    * @return The decoded token payload as a token_data structure.
    * @throws std::runtime_error If the token is invalid or the signature does not match.
    */
   token_data decode_jwt(const token_key& key, std::string_view token)
   {
      auto end_header = token.find('.');
      psibase::check(end_header != std::string_view::npos, "Invalid JWT");
      auto end_payload = token.find('.', end_header + 1);
      psibase::check(end_payload != std::string_view::npos, "Invalid JWT");
      std::string_view encoded_header  = token.substr(0, end_header);
      std::string_view encoded_payload = token.substr(end_header + 1, end_payload - end_header - 1);
      std::string_view encoded_signature = token.substr(end_payload + 1, std::string::npos);
      std::string_view signing_input     = token.substr(0, end_payload);

      // MAC storage for HMAC calculation
      unsigned char mac[EVP_MAX_MD_SIZE];
      // The size of the calculated MAC
      unsigned      mac_size;
      HMAC(EVP_sha256(), key.data(), key.size(),
           reinterpret_cast<const unsigned char*>(signing_input.data()), signing_input.size(), mac,
           &mac_size);
      auto signature = from_base64url(encoded_signature);
      psibase::check(
          signature.size() == mac_size && std::memcmp(mac, signature.data(), mac_size) == 0,
          "Bad signature");

      auto header = psio::convert_from_json<token_header>(from_base64url(encoded_header));
      psibase::check(header == token_header{}, "Wrong header");

      return psio::convert_from_json<token_data>(from_base64url(encoded_payload));
   }
   /**
    * Encode a JWT token and sign it with the provided key.
    *
    * @param key The key used for HMAC signature generation.
    * @param token The token payload to encode.
    * @return The JWT token as a string, including the base64 URL encoded header, payload, and signature.
    */
   std::string encode_jwt(const token_key& key, const token_data& token)
   {
      std::string result = to_base64url(psio::convert_to_json(token_header{})) + "." +
                           to_base64url(psio::convert_to_json(token));
      // MAC storage for HMAC calculation
      unsigned char mac[EVP_MAX_MD_SIZE];
      // The size of the calculated MAC
      unsigned      mac_size;

      // Calculating HMAC signature and appending it to the encoded header and payload to form the complete JWT
      HMAC(EVP_sha256(), key.data(), key.size(),
           reinterpret_cast<const unsigned char*>(result.data()), result.size(), mac, &mac_size);
      return result + "." + to_base64url(mac, mac_size);
   }
}  // namespace psibase::http
