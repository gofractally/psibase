#include <psibase/wif.hpp>

#include <psibase/check.hpp>
#include <psibase/crypto.hpp>

#include <algorithm>
#include <cstring>

namespace
{
   using psibase::WifError;

   constexpr std::string_view alphabet =
       "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

   // version, secret, flag, check
   constexpr std::size_t maxBytes = 1 + 32 + 1 + 4;
   // No string of 37 or 38 bytes is longer than this in base58
   constexpr std::size_t maxText = 52;

   // The order of the secp256k1 group, big-endian
   constexpr unsigned char order[32] = {0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
                                        0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xfe,
                                        0xba, 0xae, 0xdc, 0xe6, 0xaf, 0x48, 0xa0, 0x3b,
                                        0xbf, 0xd2, 0x5e, 0x8c, 0xd0, 0x36, 0x41, 0x41};

   int digit(char ch)
   {
      auto pos = alphabet.find(ch);
      return pos == std::string_view::npos ? -1 : static_cast<int>(pos);
   }

   bool isSpace(char ch)
   {
      return ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n';
   }

   std::string_view trim(std::string_view s)
   {
      while (!s.empty() && isSpace(s.front()))
         s.remove_prefix(1);
      while (!s.empty() && isSpace(s.back()))
         s.remove_suffix(1);
      return s;
   }

   // Overwrites key material that is no longer needed
   void wipe(void* data, std::size_t size)
   {
      volatile unsigned char* p = static_cast<unsigned char*>(data);
      while (size--)
         *p++ = 0;
   }

   // 0 < secret < order
   bool validSecret(std::span<const unsigned char, 32> secret)
   {
      unsigned char any = 0;
      for (auto b : secret)
         any |= b;
      return any != 0 && std::memcmp(secret.data(), order, 32) < 0;
   }

   std::array<unsigned char, 4> checkBytes(std::span<const unsigned char> payload)
   {
      auto once  = psibase::sha256(payload.data(), payload.size());
      auto twice = psibase::sha256(once.data(), once.size());
      return {twice[0], twice[1], twice[2], twice[3]};
   }

   std::optional<psibase::WifKey> fail(WifError* out, WifError error)
   {
      if (out)
         *out = error;
      return {};
   }
}  // namespace

std::string_view psibase::wifErrorName(WifError error)
{
   switch (error)
   {
      case WifError::badCharacter:
         return "bad-character";
      case WifError::badLength:
         return "bad-length";
      case WifError::badChecksum:
         return "bad-checksum";
      case WifError::badVersion:
         return "bad-version";
      case WifError::badFlag:
         return "bad-flag";
      case WifError::badSecret:
         return "bad-secret";
   }
   return "";
}

std::string_view psibase::wifErrorMessage(WifError error)
{
   switch (error)
   {
      case WifError::badCharacter:
         return "private key (WIF): contains a character that is not base58";
      case WifError::badLength:
         return "private key (WIF): wrong length";
      case WifError::badChecksum:
         return "private key (WIF): check digits do not match";
      case WifError::badVersion:
         return "private key (WIF): not a Bitcoin mainnet or testnet private key";
      case WifError::badFlag:
         return "private key (WIF): malformed compression flag";
      case WifError::badSecret:
         return "private key (WIF): not a valid secp256k1 key";
   }
   return "";
}

std::string psibase::wifEncode(std::span<const unsigned char, 32> secret,
                               bool                               compressed,
                               WifNetwork                         network)
{
   check(validSecret(secret), wifErrorMessage(WifError::badSecret));
   unsigned char bytes[maxBytes];
   std::size_t   size = 0;
   bytes[size++]      = static_cast<unsigned char>(network);
   std::memcpy(bytes + size, secret.data(), 32);
   size += 32;
   if (compressed)
      bytes[size++] = 0x01;
   auto sum = checkBytes({bytes, size});
   std::memcpy(bytes + size, sum.data(), 4);
   size += 4;

   // Repeated division by 58; digits come out least significant first
   char        digits[maxText];
   std::size_t count = 0;
   for (std::size_t start = 0; start < size;)
   {
      unsigned remainder = 0;
      for (std::size_t i = start; i < size; ++i)
      {
         unsigned value = remainder * 256 + bytes[i];
         bytes[i]       = static_cast<unsigned char>(value / 58);
         remainder      = value % 58;
      }
      digits[count++] = alphabet[remainder];
      while (start < size && bytes[start] == 0)
         ++start;
   }
   // The version byte is never zero, so there are no leading zeros to write
   std::string result(digits, count);
   std::reverse(result.begin(), result.end());
   wipe(bytes, sizeof(bytes));
   wipe(digits, sizeof(digits));
   return result;
}

std::optional<psibase::WifKey> psibase::wifDecode(std::string_view text, WifError* error) noexcept
{
   text = trim(text);
   for (char ch : text)
      if (digit(ch) < 0)
         return fail(error, WifError::badCharacter);
   if (text.empty() || text.size() > maxText)
      return fail(error, WifError::badLength);

   // The number, big-endian, right-aligned in `number`
   unsigned char number[maxBytes + 1] = {};
   for (char ch : text)
   {
      unsigned carry = static_cast<unsigned>(digit(ch));
      for (std::size_t i = sizeof(number); i-- > 0;)
      {
         carry += number[i] * 58u;
         number[i] = static_cast<unsigned char>(carry);
         carry >>= 8;
      }
      // 52 base58 digits are below 2^305 and number holds 312 bits
   }
   // The bytes are the number without its leading zeros, preceded by one
   // zero byte for each leading '1' of the text
   std::size_t first = 0;
   while (first < sizeof(number) && number[first] == 0)
      ++first;
   std::size_t zeros = 0;
   while (zeros < text.size() && text[zeros] == '1')
      ++zeros;
   std::size_t size = zeros + (sizeof(number) - first);

   std::optional<WifKey> result;
   WifError              reason = WifError::badLength;
   if (size == maxBytes || size == maxBytes - 1)
   {
      // zeros <= first here, because size fits in number
      const unsigned char* bytes   = number + sizeof(number) - size;
      std::size_t          payload = size - 4;
      auto                 sum     = checkBytes({bytes, payload});
      if (std::memcmp(sum.data(), bytes + payload, 4) != 0)
         reason = WifError::badChecksum;
      else if (bytes[0] != 0x80 && bytes[0] != 0xef)
         reason = WifError::badVersion;
      else if (payload == 34 && bytes[33] != 0x01)
         reason = WifError::badFlag;
      else if (!validSecret(std::span<const unsigned char, 32>{bytes + 1, 32}))
         reason = WifError::badSecret;
      else
      {
         result.emplace();
         std::memcpy(result->secret.data(), bytes + 1, 32);
         result->compressed = payload == 34;
         result->network    = static_cast<WifNetwork>(bytes[0]);
      }
   }
   wipe(number, sizeof(number));
   if (!result)
      return fail(error, reason);
   return result;
}

bool psibase::looksLikeWif(std::string_view text) noexcept
{
   text = trim(text);
   if (text.size() != 51 && text.size() != 52)
      return false;
   if (std::string_view{"5KL9c"}.find(text[0]) == std::string_view::npos)
      return false;
   for (char ch : text)
      if (digit(ch) < 0)
         return false;
   return true;
}
