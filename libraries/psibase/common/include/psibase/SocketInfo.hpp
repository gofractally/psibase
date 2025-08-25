#pragma once

#include <array>
#include <cstdint>
#include <optional>
#include <psio/reflect.hpp>
#include <string>
#include <variant>

namespace psibase
{
   struct IPV4Endpoint
   {
      std::array<std::uint8_t, 4> addr;
      std::uint16_t               port;
      friend bool                 operator==(const IPV4Endpoint&, const IPV4Endpoint&) = default;
      PSIO_REFLECT(IPV4Endpoint, definitionWillNotChange(), addr, port)
   };
   struct IPV6Endpoint
   {
      std::array<std::uint8_t, 16> addr;
      std::uint32_t                zone;
      std::uint16_t                port;
      friend bool                  operator==(const IPV6Endpoint&, const IPV6Endpoint&) = default;
      PSIO_REFLECT(IPV6Endpoint, definitionWillNotChange(), addr, zone, port)
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

   struct ProducerMulticastSocketInfo
   {
      PSIO_REFLECT(ProducerMulticastSocketInfo)
      friend bool operator==(const ProducerMulticastSocketInfo&,
                             const ProducerMulticastSocketInfo&) = default;
   };
   struct HttpSocketInfo
   {
      std::optional<SocketEndpoint> endpoint;
      PSIO_REFLECT(HttpSocketInfo, endpoint)
      friend bool operator==(const HttpSocketInfo&, const HttpSocketInfo&) = default;
   };

   using SocketInfo = std::variant<ProducerMulticastSocketInfo, HttpSocketInfo>;

   inline auto get_gql_name(SocketInfo*)
   {
      return "SocketInfo";
   }

}  // namespace psibase
