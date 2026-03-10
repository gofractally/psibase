#define OPENSSL_SUPPRESS_DEPRECATED

#include <psibase/WebSocket.hpp>

#include <openssl/sha.h>
#include <algorithm>
#include <psibase/HttpHeaders.hpp>
#include <psibase/api.hpp>
#include <psibase/base64.hpp>

using namespace psibase;

namespace
{
   bool headerContains(const HttpRequest& request, std::string_view name, std::string_view value)
   {
      auto values = request.getHeaderValues(name);
      return std::ranges::any_of(values, [value](std::string_view s) { return iequal(s, value); });
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
      return toBase64(hash);
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
      auto decoded_key_size = validateBase64(*key);
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

   bool isWS(char ch)
   {
      std::string_view ws = " \t";
      return ws.find(ch) != std::string_view::npos;
   }

   bool parseToken(auto& iter, auto end)
   {
      if (iter == end)
         return false;
      if (!isTokenChar(*iter))
         return false;
      ++iter;
      while (iter != end && isTokenChar(*iter))
         ++iter;
      return true;
   }

   bool parseQuotedToken(auto& begin, auto end)
   {
      if (begin == end)
         return false;
      if (*begin != '"')
         return false;
      auto iter = begin;
      ++iter;
      // tokens cannot be empty
      if (iter != end && *iter == '"')
         return false;
      while (true)
      {
         if (iter == end)
            return false;
         if (*iter == '"')
         {
            ++iter;
            break;
         }
         if (*iter == '\\')
         {
            ++iter;
            if (iter == end)
               return false;
         }
         if (!isTokenChar(*iter))
            return false;
         ++iter;
      }
      begin = iter;
      return true;
   }

   void parseOWS(auto& iter, auto end)
   {
      while (iter != end && isWS(*iter))
         ++iter;
   }

   bool isToken(std::string_view value)
   {
      auto iter = value.begin();
      auto end  = value.end();
      return parseToken(iter, end) && iter == end;
   }

   bool isExtension(std::string_view value)
   {
      auto iter = value.begin();
      auto end  = value.end();
      if (!parseToken(iter, end))
         return false;
      parseOWS(iter, end);
      while (iter != end)
      {
         if (*iter++ != ';')
            return false;
         parseOWS(iter, end);
         if (!parseToken(iter, end))
            return false;
         parseOWS(iter, end);
         if (iter != end && *iter == '=')
         {
            ++iter;
            parseOWS(iter, end);
            if (!parseQuotedToken(iter, end) && !parseToken(iter, end))
               return false;
            parseOWS(iter, end);
         }
      }
      return true;
   }

   // \pre value is an extension
   std::string_view extensionName(std::string_view value)
   {
      auto iter = value.begin();
      parseToken(iter, value.end());
      return std::string_view{value.begin(), iter};
   }

   std::optional<std::vector<std::string_view>> requestSubprotocols(const HttpRequest& request)
   {
      auto result = request.getHeaderValues("Sec-WebSocket-Protocol");
      if (!std::ranges::all_of(result, isToken))
         return std::nullopt;
      return result;
   }

   std::optional<std::vector<std::string_view>> requestExtensions(const HttpRequest& request)
   {
      auto result = request.getHeaderValues("Sec-WebSocket-Extensions");
      if (!std::ranges::all_of(result, isExtension))
         return std::nullopt;
      return result;
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
   auto accept = reply.getHeader("Sec-WebSocket-Accept");
   if (!accept || *accept != acceptKey(*key))
      return false;
   // Check that the subprotocol is valid if it exists
   if (auto replySubprotocol = reply.getHeader("Sec-WebSocket-Protocol"))
   {
      if (!subprotocols ||
          std::ranges::find(*subprotocols, *replySubprotocol) == subprotocols->end())
         return false;
   }
   for (const auto& ext : reply.getHeaderValues("Sec-WebSocket-Extensions"))
   {
      // TODO: each extension requires custom validation
      if (!isExtension(ext))
         return false;
      auto name = extensionName(ext);
      if (!extensions ||
          std::ranges::find_if(*extensions, [&](std::string_view reqExt)
                               { return extensionName(reqExt) == name; }) == extensions->end())
         return false;
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

#ifdef __wasm32__

std::string psibase::randomWebSocketKey()
{
   char buf[16];
   raw::getRandom(buf, sizeof(buf));
   return toBase64(buf);
}

#endif
