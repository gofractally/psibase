#include <psibase/pem.hpp>

#include <psibase/base64.hpp>

namespace
{
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

   // One DER element with a definite length: its tag and its content.
   struct DerElement
   {
      unsigned char                  tag;
      std::span<const unsigned char> content;
   };

   // Reads the element at the front of `in` and removes it from `in`.
   bool readDer(std::span<const unsigned char>& in, DerElement& out) noexcept
   {
      if (in.size() < 2)
         return false;
      out.tag = in[0];
      // A multi-byte tag number does not occur in a SubjectPublicKeyInfo
      if ((out.tag & 0x1f) == 0x1f)
         return false;
      std::size_t pos    = 1;
      std::size_t length = in[pos++];
      if (length & 0x80)
      {
         std::size_t count = length & 0x7f;
         // 0x80 is the indefinite form, which DER does not have
         if (count == 0 || count > sizeof(std::size_t) || in.size() - pos < count)
            return false;
         length = 0;
         for (std::size_t i = 0; i < count; ++i)
            length = (length << 8) | in[pos++];
      }
      if (in.size() - pos < length)
         return false;
      out.content = in.subspan(pos, length);
      in          = in.subspan(pos + length);
      return true;
   }
}  // namespace

std::string psibase::pemEncode(std::span<const unsigned char> der, std::string_view label)
{
   std::string body = toBase64({reinterpret_cast<const char*>(der.data()), der.size()});
   std::string result;
   result += "-----BEGIN ";
   result += label;
   result += "-----\n";
   for (std::size_t pos = 0; pos < body.size(); pos += 64)
   {
      result += std::string_view{body}.substr(pos, 64);
      result += '\n';
   }
   result += "-----END ";
   result += label;
   result += "-----\n";
   return result;
}

std::optional<std::vector<unsigned char>> psibase::pemDecode(std::string_view text,
                                                             std::string_view label)
{
   text     = trim(text);
   auto eat = [&](std::string_view prefix)
   {
      if (!text.starts_with(prefix))
         return false;
      text.remove_prefix(prefix.size());
      return true;
   };
   if (!eat("-----BEGIN ") || !eat(label) || !eat("-----"))
      return {};
   auto end = text.find('-');
   if (end == std::string_view::npos)
      return {};
   std::string body;
   for (char ch : text.substr(0, end))
      if (!isSpace(ch))
         body.push_back(ch);
   text.remove_prefix(end);
   if (!eat("-----END ") || !eat(label) || !eat("-----") || !text.empty())
      return {};
   if (!validateBase64(body))
      return {};
   auto bytes = fromBase64(body);
   return std::vector<unsigned char>(bytes.begin(), bytes.end());
}

bool psibase::hasSubjectPublicKeyInfoShape(std::span<const unsigned char> der) noexcept
{
   constexpr unsigned char sequence  = 0x30;
   constexpr unsigned char oid       = 0x06;
   constexpr unsigned char bitString = 0x03;

   DerElement outer;
   if (!readDer(der, outer) || outer.tag != sequence || !der.empty())
      return false;
   auto       members = outer.content;
   DerElement algorithm, key;
   if (!readDer(members, algorithm) || algorithm.tag != sequence)
      return false;
   if (!readDer(members, key) || key.tag != bitString || !members.empty())
      return false;
   auto       algorithmMembers = algorithm.content;
   DerElement algorithmId;
   if (!readDer(algorithmMembers, algorithmId) || algorithmId.tag != oid ||
       algorithmId.content.empty())
      return false;
   // The first byte of a BIT STRING counts the unused bits of its last byte
   return !key.content.empty() && key.content[0] <= 7;
}
