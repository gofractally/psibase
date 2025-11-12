#pragma once

#include <array>
#include <cstdint>
#include <optional>
#include <psio/reflect.hpp>
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

   void to_json(const IPAddress& addr, auto& stream)
   {
      to_json(to_string(addr), stream);
   }
   void from_json(IPAddress& addr, auto& stream)
   {
      std::string s;
      from_json(s, stream);
      addr = parseIPAddress(s).value();
   }

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

   void to_json(const SocketEndpoint& endpoint, auto& stream)
   {
      to_json(to_string(endpoint), stream);
   }
   void from_json(SocketEndpoint& endpoint, auto& stream)
   {
      std::string s;
      from_json(s, stream);
      endpoint = parseSocketEndpoint(s).value();
   }

   bool isLoopback(const IPV4Endpoint&);
   bool isLoopback(const IPV6Endpoint&);
   bool isLoopback(const LocalEndpoint&);
   bool isLoopback(const SocketEndpoint&);

   struct IPAddressPrefix
   {
      IPAddress address;
      uint8_t   prefixLen;

      bool contains(const IPV4Address& addr);
      bool contains(const IPV6Address& addr);
      bool contains(const IPAddress& addr);

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
   struct HttpSocketInfo
   {
      std::optional<SocketEndpoint> endpoint;
      std::optional<TLSInfo>        tls;
      PSIO_REFLECT(HttpSocketInfo, endpoint, tls)
      friend bool operator==(const HttpSocketInfo&, const HttpSocketInfo&) = default;
   };

   struct HttpClientSocketInfo
   {
      std::optional<SocketEndpoint> endpoint;
      std::optional<TLSInfo>        tls;
      PSIO_REFLECT(HttpClientSocketInfo, endpoint, tls)
      friend bool operator==(const HttpClientSocketInfo&, const HttpClientSocketInfo&) = default;
   };

   using SocketInfo =
       std::variant<ProducerMulticastSocketInfo, HttpSocketInfo, HttpClientSocketInfo>;

   inline auto get_gql_name(SocketInfo*)
   {
      return "SocketInfo";
   }

}  // namespace psibase
