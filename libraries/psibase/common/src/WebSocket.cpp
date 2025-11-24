#define OPENSSL_SUPPRESS_DEPRECATED

#include <psibase/WebSocket.hpp>

#include <openssl/sha.h>
#include <algorithm>

#include "base64.hpp"

using namespace psibase;

namespace
{
   bool iequal(std::string_view lhs, std::string_view rhs)
   {
      return std::ranges::equal(lhs, rhs, {}, ::tolower, ::tolower);
   }

   bool headerContains(const HttpRequest& request, std::string_view name, std::string_view value)
   {
      auto values = request.getHeaderValues(name);
      return std::ranges::any_of(values, [value](std::string_view s) { return iequal(s, value); });
   }

   constexpr auto base64tab    = psibase::detail::base64Table('+', '/');
   constexpr auto base64invtab = psibase::detail::invert(base64tab);

   void pad_base64(std::string& s)
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

   std::string to_base64(std::span<const char> s)
   {
      std::string result;
      result.reserve((s.size() + 2) / 3 * 4);
      psibase::detail::transcode<8, 6, true>(s,
                                             [&](unsigned ch) { result.push_back(base64tab[ch]); });
      pad_base64(result);
      return result;
   }

   // returns the decoded size if the argument is valid base64
   std::optional<std::size_t> validate_base64(std::string_view s)
   {
      if (s.size() % 4 != 0)
         return {};
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
      for (unsigned char ch : s)
      {
         if (base64invtab[ch] == -1)
            return {};
      }
      bool okay = psibase::detail::transcode<6, 8, false>(
          s | std::ranges::views::transform([](unsigned char ch) { return base64invtab[ch]; }),
          [&](unsigned ch) {});
      if (!okay)
         return {};
      return (s.size() + padding) / 4 * 3 - padding;
   }

   std::string acceptKey(std::string_view key)
   {
      std::array<char, SHA_DIGEST_LENGTH> hash;
      std::string_view                    suffix{"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"};
      SHA_CTX                             ctx;
      SHA1_Init(&ctx);
      SHA1_Update(&ctx, (const unsigned char*)key.data(), key.size());
      SHA1_Update(&ctx, (const unsigned char*)suffix.data(), suffix.size());
      SHA1_Final((unsigned char*)hash.data(), &ctx);
      return to_base64(hash);
   }

   std::optional<std::string_view> requestKey(const HttpRequest& request)
   {
      if (request.method != "GET")
         return {};
      if (!headerContains(request, "upgrade", "websocket"))
         return {};
      if (!headerContains(request, "connection", "upgrade"))
         return {};
      auto key = request.getHeader("Sec-WebSocket-Key");
      if (!key)
         return {};
      auto decoded_key_size = validate_base64(*key);
      if (!decoded_key_size || *decoded_key_size != 16)
         return {};
      auto version = request.getHeader("Sec-WebSocket-Version");
      if (!version || *version != "13")
         return {};
      return key;
   }

   bool isTokenChar(char ch)
   {
      constexpr std::string_view separators = "()<>@,;:\\\"/[]?={} \t";
      return ch >= 0x21 && ch <= 0x7e && separators.find(ch) == std::string_view::npos;
   }

   // Returns nullopt if the field is present, but with incorrect format
   std::optional<std::vector<std::string_view>> getTokens(const HttpRequest& request,
                                                          std::string_view   name)
   {
      auto result = request.getHeaderValues(name);
      for (const auto& s : result)
      {
         for (char ch : s)
         {
            if (!isTokenChar(ch))
            {
               return {};
            }
         }
      }
      return result;
   }

   std::optional<std::vector<std::string_view>> requestSubprotocols(const HttpRequest& request)
   {
      return getTokens(request, "Sec-WebSocket-Protocol");
   }

   std::optional<std::vector<std::string_view>> requestExtensions(const HttpRequest& request)
   {
      // WRONG
      return getTokens(request, "Sec-WebSocket-Extensions");
   }
}  // namespace

bool psibase::isWebSocketHandshake(const HttpRequest& request)
{
   return requestKey(request) && requestSubprotocols(request) && requestExtensions(request);
}

bool psibase::isWebSocketHandshake(const HttpReply& reply)
{
   if (reply.status != HttpStatus::switchingProtocols)
      return false;
   auto upgrade = reply.getHeader("upgrade");
   if (!upgrade || !iequal(*upgrade, "websocket"))
      return false;
   auto connection = reply.getHeader("connection");
   if (!connection || !iequal(*connection, "upgrade"))
      return false;
   return true;
}

bool psibase::isWebSocketHandshake(const HttpRequest& request, const HttpReply& reply)
{
   auto key          = requestKey(request);
   auto subprotocols = requestSubprotocols(request);
   auto extensions   = requestExtensions(request);
   if (!key || !subprotocols || !extensions)
      return false;
   if (!isWebSocketHandshake(reply))
      return false;
   // Further validation. If this fails, assume that the
   // service is trying to create a websocket, but got it
   // wrong.
   auto accept = reply.getHeader("Sec-WebSocket-Accept");
   if (!accept || *accept != acceptKey(*key))
      return false;
   // Check that the subprotocol is valid if it exists
   if (auto replySubprotocol = reply.getHeader("Sec-WebSocket-Protocol"))
   {
      if (std::ranges::find(*subprotocols, replySubprotocol) == subprotocols->end())
         abortMessage("reply contains subprotocol that was not present in request");
   }
   for (const auto& ext : reply.getHeaderValues("Sec-WebSocket-Extensions"))
   {
      if (std::ranges::find(*extensions, ext) == extensions->end())
         abortMessage("reply contains extension " + std::string(ext) +
                      " that was not present in request");
   }
   return true;
}

std::optional<HttpReply> psibase::webSocketHandshake(const HttpRequest& request)
{
   if (auto key = requestKey(request))
   {
      psibase::HttpReply reply{
          .status = HttpStatus::switchingProtocols,
      };
      reply.headers.push_back({"Upgrade", "websocket"});
      reply.headers.push_back({"Connection", "Upgrade"});
      reply.headers.push_back({"Sec-WebSocket-Accept", acceptKey(*key)});
      return reply;
   }
   return {};
}
