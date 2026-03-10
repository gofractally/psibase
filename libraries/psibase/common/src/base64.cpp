#include <psibase/base64.hpp>

#include <algorithm>
#include <array>
#include <cassert>
#include <psibase/check.hpp>
#include <ranges>

using namespace psibase;

namespace
{
   constexpr std::array<char, 64> base64Table(char c62, char c63)
   {
      std::array<char, 64> result = {};
      auto                 pos    = result.begin();
      pos = std::ranges::copy(std::ranges::views::iota('A', static_cast<char>('Z' + 1)), pos).out;
      pos = std::ranges::copy(std::ranges::views::iota('a', static_cast<char>('z' + 1)), pos).out;
      pos = std::ranges::copy(std::ranges::views::iota('0', static_cast<char>('9' + 1)), pos).out;
      *pos++ = c62;
      *pos++ = c63;
      if (pos != result.end())
         abortMessage("Size mismatch");
      return result;
   }

   constexpr std::array<std::int8_t, 256> invert(std::array<char, 64> tab)
   {
      std::array<std::int8_t, 256> result = {};
      for (auto& ch : result)
      {
         ch = -1;
      }
      std::int8_t i = 0;
      for (auto ch : tab)
      {
         result[static_cast<unsigned char>(ch)] = i;
         ++i;
      }
      return result;
   }

   constexpr unsigned mask(int bits)
   {
      return (unsigned(1) << bits) - 1;
   }

   // Encoding may add padding bits, decoding removes padding
   template <int SrcBits, int DstBits, bool Encode>
   auto transcode(const auto& in, auto out)
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
         return (buf & mask(bits)) == 0;
      }
   }

   constexpr auto base64tab    = base64Table('+', '/');
   constexpr auto base64invtab = invert(base64tab);

   constexpr auto base64url_tab    = base64Table('-', '_');
   constexpr auto base64url_invtab = invert(base64url_tab);

   void padBase64(std::string& s)
   {
      switch (s.size() % 4)
      {
         case 0:
            break;
         case 2:
            s += "==";
            break;
         case 3:
            s.push_back('=');
            break;
         default:
            assert(!"Wrong size");
      }
   }

   std::size_t unpadBase64(std::string_view& s)
   {
      std::size_t padding = 0;
      if (s.ends_with('='))
      {
         s.remove_suffix(1);
         ++padding;
      }
      if (s.ends_with('='))
      {
         s.remove_suffix(1);
         ++padding;
      }
      return padding;
   }
}  // namespace

std::optional<std::size_t> psibase::validateBase64(std::string_view s)
{
   if (s.size() % 4 != 0)
      return {};
   std::size_t padding = unpadBase64(s);
   for (unsigned char ch : s)
   {
      if (base64invtab[ch] == -1)
         return {};
   }
   bool okay = ::transcode<6, 8, false>(
       s | std::ranges::views::transform([](unsigned char ch) { return base64invtab[ch]; }),
       [&](unsigned ch) {});
   if (!okay)
      return {};
   return (s.size() + padding) / 4 * 3 - padding;
}

std::vector<char> psibase::fromBase64(std::string_view s)
{
   check(s.size() % 4 == 0, "Invalid base64 encoding");
   std::size_t padding = unpadBase64(s);
   for (unsigned char ch : s)
   {
      check(base64invtab[ch] != -1, "Invalid base64 encoding");
   }
   std::vector<char> result;
   result.reserve((s.size() + padding) / 4 * 3 - padding);
   bool okay = ::transcode<6, 8, false>(
       s | std::ranges::views::transform([](unsigned char ch) { return base64invtab[ch]; }),
       [&](unsigned ch) { result.push_back(ch); });
   check(okay, "Invalid base64 encoding");
   return result;
}

std::string psibase::toBase64(std::span<const char> data)
{
   std::string result;
   result.reserve((data.size() + 2) / 3 * 4);
   ::transcode<8, 6, true>(data, [&](unsigned ch) { result.push_back(base64tab[ch]); });
   padBase64(result);
   return result;
}

std::string psibase::toBase64Url(std::string_view s)
{
   std::string result;
   result.reserve((s.size() * 4 + 2) / 3);
   ::transcode<8, 6, true>(s, [&](unsigned ch) { result.push_back(base64url_tab[ch]); });
   return result;
}

std::string psibase::fromBase64Url(std::string_view s)
{
   std::string result;
   result.reserve(s.size() * 3 / 4);
   bool okay = ::transcode<6, 8, false>(
       s | std::ranges::views::transform(
               [](char ch)
               {
                  auto result = base64url_invtab[static_cast<unsigned char>(ch)];
                  check(result != -1, "Invalid base64url encoding");
                  return result;
               }),
       [&](unsigned ch) { result.push_back(static_cast<char>(ch)); });
   check(okay, "Invalid base64url encoding");
   return result;
}
