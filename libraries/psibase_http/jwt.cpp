#include <psibase/jwt.hpp>

#include <psio/from_json.hpp>
#include <psio/to_json.hpp>

#include <ranges>

#include <openssl/hmac.h>

namespace psibase::http
{
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
   struct token_header
   {
      std::string typ{"JWT"};
      std::string alg{"HS256"};
      friend bool operator==(const token_header&, const token_header&) = default;
   };
   PSIO_REFLECT(token_header, typ, alg);
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

      unsigned char mac[EVP_MAX_MD_SIZE];
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
   std::string encode_jwt(const token_key& key, const token_data& token)
   {
      std::string result = to_base64url(psio::convert_to_json(token_header{})) + "." +
                           to_base64url(psio::convert_to_json(token));
      unsigned char mac[EVP_MAX_MD_SIZE];
      unsigned      mac_size;
      HMAC(EVP_sha256(), key.data(), key.size(),
           reinterpret_cast<const unsigned char*>(result.data()), result.size(), mac, &mac_size);
      return result + "." + to_base64url(mac, mac_size);
   }
}  // namespace psibase::http
