#include "helpers.hpp"

#include <algorithm>
#include <charconv>
#include <format>

#include <psibase/base64.hpp>

using namespace psibase;

namespace xportal
{
   HttpReply textError(std::vector<HttpHeader> headers, HttpStatus status, std::string_view message)
   {
      return HttpReply{.status      = status,
                       .contentType = "text/html",
                       .body        = std::vector<char>(message.begin(), message.end()),
                       .headers     = std::move(headers)};
   }

   TimePointUSec wallNow()
   {
      return std::chrono::time_point_cast<MicroSeconds>(std::chrono::system_clock::now());
   }

   void maskSecret(std::optional<std::string>& secret)
   {
      if (secret)
         *secret = secret->substr(secret->size() - std::min<std::size_t>(secret->size(), 4));
   }

   const psio::json::any* objectField(const psio::json::any_object& object, std::string_view key)
   {
      const psio::json::any* found = nullptr;
      for (const auto& entry : object)
         if (entry.key == key)
            found = &entry.value;
      return found;
   }

   std::optional<std::string> readStringField(const psio::json::any_object& object,
                                              std::string_view              path,
                                              std::string_view              key,
                                              std::optional<std::string>&   out)
   {
      auto value = objectField(object, key);
      if (!value)
         return std::nullopt;
      auto text = value->get_if<std::string>();
      if (!text || text->empty())
         return std::format("{}.{} must be a non-empty string\n", path, key);
      out = *text;
      return std::nullopt;
   }

   std::optional<std::string> readPositive(const psio::json::any& value,
                                           std::string_view       name,
                                           uint64_t&              out)
   {
      // JSON numbers arrive as their source text, the same as strings.
      uint64_t parsed = 0;
      if (auto text = value.get_if<std::string>())
      {
         auto end    = text->data() + text->size();
         auto result = std::from_chars(text->data(), end, parsed);
         if (result.ec == std::errc{} && result.ptr == end && parsed != 0)
         {
            out = parsed;
            return std::nullopt;
         }
      }
      return std::format("{} must be a positive integer\n", name);
   }

   std::string formEncode(
       std::initializer_list<std::pair<std::string_view, std::string_view>> fields)
   {
      constexpr std::string_view hex = "0123456789ABCDEF";
      std::string                out;
      auto                       append = [&](std::string_view text)
      {
         for (unsigned char c : text)
         {
            if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
                c == '-' || c == '.' || c == '_' || c == '~')
            {
               out += c;
            }
            else
            {
               out += '%';
               out += hex[c >> 4];
               out += hex[c & 0xf];
            }
         }
      };
      for (const auto& [key, value] : fields)
      {
         if (!out.empty())
            out += '&';
         append(key);
         out += '=';
         append(value);
      }
      return out;
   }

   std::string codeChallenge(std::string_view verifier)
   {
      auto hash = sha256(verifier.data(), verifier.size());
      return toBase64Url({reinterpret_cast<const char*>(hash.data()), hash.size()});
   }

   HttpReply redirect(std::string location, std::vector<HttpHeader> headers)
   {
      headers.push_back({"Location", std::move(location)});
      return HttpReply{.status = HttpStatus::found, .headers = std::move(headers)};
   }

   HttpReply badGateway(std::string_view message)
   {
      return textError(std::vector<HttpHeader>{}, HttpStatus::badGateway, message);
   }

   bool sameBytes(std::span<const char> a, const Checksum256& b)
   {
      if (a.size() != b.size())
         return false;
      unsigned char diff = 0;
      for (std::size_t i = 0; i < b.size(); ++i)
         diff |= static_cast<unsigned char>(a[i]) ^ b[i];
      return diff == 0;
   }
}  // namespace xportal
