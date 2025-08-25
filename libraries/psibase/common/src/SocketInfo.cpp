#include <psibase/SocketInfo.hpp>

#include <algorithm>
#include <charconv>
#include <format>

using namespace psibase;

bool psibase::isLoopback(const IPV4Endpoint& addr)
{
   return addr.addr[0] == 127;
}

bool psibase::isLoopback(const IPV6Endpoint& addr)
{
   constexpr std::uint8_t loopbackAddr[16] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1};
   return std::ranges::equal(addr.addr, loopbackAddr);
}

bool psibase::isLoopback(const LocalEndpoint&)
{
   return true;
}

bool psibase::isLoopback(const SocketEndpoint& addr)
{
   return std::visit([](const auto& addr) { return isLoopback(addr); }, addr);
}

std::string psibase::to_string(const IPV4Endpoint& endpoint)
{
   std::string result;
   result += std::to_string(endpoint.addr[0]);
   result += '.';
   result += std::to_string(endpoint.addr[1]);
   result += '.';
   result += std::to_string(endpoint.addr[2]);
   result += '.';
   result += std::to_string(endpoint.addr[3]);
   result.push_back(':');
   result += std::to_string(endpoint.port);
   return result;
}

std::string psibase::to_string(const IPV6Endpoint& endpoint)
{
   std::string result;
   result += '[';
   // IPV4 mapped addresses
   constexpr std::uint8_t mappedIPV4Prefix[12] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff};
   if (std::ranges::equal(std::span{endpoint.addr}.subspan(0, 12), mappedIPV4Prefix))
   {
      result += "::ffff:";
      result += std::to_string(endpoint.addr[12]);
      result += '.';
      result += std::to_string(endpoint.addr[13]);
      result += '.';
      result += std::to_string(endpoint.addr[14]);
      result += '.';
      result += std::to_string(endpoint.addr[15]);
   }
   else
   {
      // Find the longest group of zeroes
      std::size_t bestRun = 0;
      std::size_t bestLen = 0;
      for (std::size_t i = 0; i < 16;)
      {
         if (endpoint.addr[i] == 0 && endpoint.addr[i + 1] == 0)
         {
            int runStart = i;
            do
            {
               i += 2;
            } while (i < 16 && endpoint.addr[i] == 0 && endpoint.addr[i + 1] == 0);
            if (i - runStart > bestLen)
            {
               bestRun = runStart;
               bestLen = i - runStart;
            }
         }
         else
         {
            i += 2;
         }
      }
      // 8 groups of 4 hex digits
      bool first = true;
      for (std::size_t i = 0; i < 16;)
      {
         if (bestLen > 2 && i == bestRun)
         {
            result += "::";
            i += bestLen;
            first = true;
         }
         else
         {
            // lowercase is recommended
            constexpr const char* hex = "0123456789abcdef";
            if (first)
               first = false;
            else
               result += ':';
            if (endpoint.addr[i] & 0xF0)
               result += hex[endpoint.addr[i] >> 4];
            if (endpoint.addr[i])
               result += hex[endpoint.addr[i] & 0x0F];
            if (endpoint.addr[i] || endpoint.addr[i + 1] & 0xF0)
               result += hex[endpoint.addr[i + 1] >> 4];
            result += hex[endpoint.addr[i + 1] & 0x0F];
            i += 2;
         }
      }
   }
   if (endpoint.zone != 0)
   {
      result += '%';
      result += std::to_string(endpoint.zone);
   }
   result += "]:";
   result += std::to_string(endpoint.port);

   return result;
}

std::string psibase::to_string(const LocalEndpoint& endpoint)
{
   if (endpoint.path.empty() && endpoint.path.contains('/'))
      return endpoint.path;
   else
      // make sure that the path cannot be interpreted as an IP address
      return "./" + endpoint.path;
}

std::string psibase::to_string(const SocketEndpoint& endpoint)
{
   return std::visit([](const auto& endpoint) { return to_string(endpoint); }, endpoint);
}

namespace
{
   bool parseIPV4Address(const char*& iter, const char* end, std::span<std::uint8_t, 4> result)
   {
      bool first = true;
      for (auto& v : result)
      {
         if (first)
            first = false;
         else if (iter == end || *iter++ != '.')
            return false;

         auto res = std::from_chars(iter, end, v);
         if (res.ec != std::errc{})
            return false;
         iter = res.ptr;
      }
      return true;
   }
}  // namespace

std::optional<IPV4Endpoint> psibase::parseIPV4Endpoint(std::string_view s)
{
   IPV4Endpoint result;
   const char*  iter = s.data();
   const char*  end  = s.data() + s.size();
   if (!parseIPV4Address(iter, end, result.addr))
      return {};
   if (iter == end || *iter++ != ':')
      return {};
   auto res = std::from_chars(iter, end, result.port);
   if (res.ptr != end || res.ec != std::errc{})
      return {};
   return result;
}

std::optional<IPV6Endpoint> psibase::parseIPV6Endpoint(std::string_view s)
{
   IPV6Endpoint result;
   result.zone      = 0;
   const char* iter = s.data();
   const char* end  = s.data() + s.size();
   if (iter == end || *iter++ != '[')
      return {};
   std::size_t elidedPos = 16;
   std::size_t i         = 0;
   while (iter != end)
   {
      if (i != 0)
      {
         if (*iter == ']' || *iter == '%')
            break;
         else if (*iter++ != ':')
            return {};
      }
      // Handle '::'. If this isn't at the beginning, we've already
      // consumed one ':'.
      if (iter != end && *iter == ':')
      {
         if (elidedPos < 16)
            return {};
         elidedPos = i;
         ++iter;
         if (i == 0)
         {
            if (iter == end || *iter++ != ':')
               return {};
         }
         if (iter != end && (*iter == ']' || *iter == '%'))
            break;
      }
      if (i >= 16)
         return {};
      std::uint16_t v;
      auto          res = std::from_chars(iter, end, v, 16);
      if (res.ec != std::errc{})
         return {};
      // Handle mapped IPV4 addresses. The previous from_chars
      // produces a nonsense result since it's parsing a decimal
      // number as hex, but in this case, we only care about the
      // end ptr, which is correct.
      if (res.ptr != end && *res.ptr == '.')
      {
         if (i > 12 || i < 12 && elidedPos >= 16)
            return {};
         if (!parseIPV4Address(iter, end, std::span<std::uint8_t, 4>{&result.addr[i], 4}))
            return {};
         i += 4;

         if (iter == end || (*iter != ']' && *iter != '%'))
            return {};
         break;
      }
      iter             = res.ptr;
      result.addr[i++] = v >> 8;
      result.addr[i++] = v & 0xFF;
   }

   // Check that we actually filled the whole address
   if (elidedPos > i)
      return {};
   // move digits after :: to the end
   auto elidedEnd = std::copy_backward(result.addr.begin() + elidedPos, result.addr.begin() + i,
                                       result.addr.begin() + 16);
   std::fill(result.addr.begin() + elidedPos, elidedEnd, 0);

   // zone id
   if (iter != end && *iter == '%')
   {
      ++iter;
      auto res = std::from_chars(iter, end, result.zone);
      if (res.ec != std::errc{})
         return {};
      iter = res.ptr;
   }
   if (iter == end || *iter++ != ']')
      return {};
   if (iter == end || *iter++ != ':')
      return {};
   auto res = std::from_chars(iter, end, result.port);
   if (res.ptr != end || res.ec != std::errc{})
      return {};
   return result;
}

std::optional<SocketEndpoint> psibase::parseSocketEndpoint(std::string_view s)
{
   if (auto result = psibase::parseIPV4Endpoint(s))
      return std::move(*result);
   else if (auto result = psibase::parseIPV6Endpoint(s))
      return std::move(*result);
   else
      return LocalEndpoint{std::string(s)};
}
