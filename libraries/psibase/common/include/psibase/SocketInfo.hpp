#pragma once

#include <array>
#include <cstdint>
#include <optional>
#include <psio/adapter.hpp>
#include <psio/reflect.hpp>
#include <span>
#include <string>
#include <variant>

namespace psibase
{
   struct IPV4Address
   {
      std::array<std::uint8_t, 4> bytes;
      friend bool                 operator==(const IPV4Address&, const IPV4Address&) = default;
      PSIO_REFLECT(IPV4Address, definitionWillNotChange(), bytes)
   };
   struct IPV6Address
   {
      std::array<std::uint8_t, 16> bytes;
      std::uint32_t                zone;
      friend bool                  operator==(const IPV6Address&, const IPV6Address&) = default;
      PSIO_REFLECT(IPV6Address, definitionWillNotChange(), bytes, zone)
   };
   using IPAddress = std::variant<IPV4Address, IPV6Address>;

   std::string to_string(const IPV4Address&);
   std::string to_string(const IPV6Address&);
   std::string to_string(const IPAddress&);

   std::optional<IPV4Address> parseIPV4Address(std::string_view);
   std::optional<IPV6Address> parseIPV6Address(std::string_view);
   std::optional<IPAddress>   parseIPAddress(std::string_view);

   /// The text form of an `IPAddress`: `"127.0.0.1"`, `"::1"`. It is the
   /// JSON of the type (one string); the wire form is the variant.
   struct IPAddressText
   {
      static constexpr std::string_view schema_id = "IPAddress";

      static std::size_t packsize(const IPAddress& value) { return to_string(value).size(); }
      static void      encode(const IPAddress& value, std::string& out) { out += to_string(value); }
      static IPAddress decode(std::span<const char> text)
      {
         return parseIPAddress(std::string_view{text.data(), text.size()}).value();
      }
      static psio::codec_status validate(std::span<const char> text) noexcept
      {
         if (parseIPAddress(std::string_view{text.data(), text.size()}))
            return psio::codec_ok();
         return psio::codec_fail("IPAddress: not an IP address", 0, "IPAddress");
      }
      static psio::codec_status validate_strict(std::span<const char> text) noexcept
      {
         return validate(text);
      }
   };

   bool isLoopback(const IPV4Address&);
   bool isLoopback(const IPV6Address&);
   bool isLoopback(const IPAddress&);

   struct IPV4Endpoint
   {
      IPV4Address   address;
      std::uint16_t port;
      friend bool   operator==(const IPV4Endpoint&, const IPV4Endpoint&) = default;
      PSIO_REFLECT(IPV4Endpoint, definitionWillNotChange(), address, port)
   };
   struct IPV6Endpoint
   {
      IPV6Address   address;
      std::uint16_t port;
      friend bool   operator==(const IPV6Endpoint&, const IPV6Endpoint&) = default;
      PSIO_REFLECT(IPV6Endpoint, definitionWillNotChange(), address, port)
   };
   struct LocalEndpoint
   {
      std::string path;
      friend bool operator==(const LocalEndpoint&, const LocalEndpoint&) = default;
      PSIO_REFLECT(LocalEndpoint, definitionWillNotChange(), path)
   };

   using SocketEndpoint = std::variant<IPV4Endpoint, IPV6Endpoint, LocalEndpoint>;
   inline auto get_gql_name(SocketEndpoint*)
   {
      return "SocketEndpoint";
   }

   std::string to_string(const IPV4Endpoint&);
   std::string to_string(const IPV6Endpoint&);
   std::string to_string(const LocalEndpoint&);
   std::string to_string(const SocketEndpoint&);

   std::optional<IPV4Endpoint>   parseIPV4Endpoint(std::string_view);
   std::optional<IPV6Endpoint>   parseIPV6Endpoint(std::string_view);
   std::optional<SocketEndpoint> parseSocketEndpoint(std::string_view);

   /// The text form of a `SocketEndpoint`: `"127.0.0.1:8080"`,
   /// `"[::1]:8080"`, or the path of a local socket. It is the JSON of the
   /// type (one string); the wire form is the variant.
   struct SocketEndpointText
   {
      static constexpr std::string_view schema_id = "SocketEndpoint";

      static std::size_t packsize(const SocketEndpoint& value) { return to_string(value).size(); }
      static void encode(const SocketEndpoint& value, std::string& out) { out += to_string(value); }
      static SocketEndpoint decode(std::span<const char> text)
      {
         return parseSocketEndpoint(std::string_view{text.data(), text.size()}).value();
      }
      static psio::codec_status validate(std::span<const char> text) noexcept
      {
         if (parseSocketEndpoint(std::string_view{text.data(), text.size()}))
            return psio::codec_ok();
         return psio::codec_fail("SocketEndpoint: not a socket endpoint", 0, "SocketEndpoint");
      }
      static psio::codec_status validate_strict(std::span<const char> text) noexcept
      {
         return validate(text);
      }
   };

   bool isLoopback(const IPV4Endpoint&);
   bool isLoopback(const IPV6Endpoint&);
   bool isLoopback(const LocalEndpoint&);
   bool isLoopback(const SocketEndpoint&);

   struct IPAddressPrefix
   {
      IPAddress address;
      uint8_t   prefixLen;

      bool contains(const IPV4Address& addr) const;
      bool contains(const IPV6Address& addr) const;
      bool contains(const IPAddress& addr) const;
      bool contains(const IPV4Endpoint& endpoint) const;
      bool contains(const IPV6Endpoint& endpoint) const;
      bool contains(const LocalEndpoint& endpoint) const;
      bool contains(const SocketEndpoint& endpoint) const;

      PSIO_REFLECT(IPAddressPrefix, address, prefixLen)
   };

   std::optional<IPAddressPrefix> parseIPAddressPrefix(std::string_view s);

   struct TLSInfo
   {
      PSIO_REFLECT(TLSInfo)
      friend bool operator==(const TLSInfo&, const TLSInfo&) = default;
   };

   struct ProducerMulticastSocketInfo
   {
      PSIO_REFLECT(ProducerMulticastSocketInfo)
      friend bool operator==(const ProducerMulticastSocketInfo&,
                             const ProducerMulticastSocketInfo&) = default;
   };
   struct LogSocketInfo
   {
      PSIO_REFLECT(LogSocketInfo)
      friend bool operator==(const LogSocketInfo&, const LogSocketInfo&) = default;
   };
   struct HttpSocketInfo
   {
      std::optional<SocketEndpoint> endpoint;
      std::optional<TLSInfo>        tls;
      PSIO_REFLECT(HttpSocketInfo, endpoint, tls)
      friend bool operator==(const HttpSocketInfo&, const HttpSocketInfo&) = default;
   };
   struct WebSocketInfo
   {
      std::optional<SocketEndpoint> endpoint;
      std::optional<TLSInfo>        tls;
      PSIO_REFLECT(WebSocketInfo, endpoint, tls)
      friend bool operator==(const WebSocketInfo&, const WebSocketInfo&) = default;
   };

   struct HttpClientSocketInfo
   {
      std::optional<SocketEndpoint> endpoint;
      std::optional<TLSInfo>        tls;
      PSIO_REFLECT(HttpClientSocketInfo, endpoint, tls)
      friend bool operator==(const HttpClientSocketInfo&, const HttpClientSocketInfo&) = default;
   };

   struct P2PSocketInfo
   {
      std::optional<SocketEndpoint> endpoint;
      std::optional<TLSInfo>        tls;
      PSIO_REFLECT(P2PSocketInfo, endpoint, tls)
      friend bool operator==(const P2PSocketInfo&, const P2PSocketInfo&) = default;
   };

   using SocketInfo = std::variant<ProducerMulticastSocketInfo,
                                   LogSocketInfo,
                                   HttpSocketInfo,
                                   HttpClientSocketInfo,
                                   WebSocketInfo,
                                   P2PSocketInfo>;

   inline auto get_gql_name(SocketInfo*)
   {
      return "SocketInfo";
   }

}  // namespace psibase

PSIO_ADAPTER(psibase::IPAddress, psio::text_category, psibase::IPAddressText)
PSIO_ADAPTER(psibase::SocketEndpoint, psio::text_category, psibase::SocketEndpointText)
