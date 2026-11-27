#include <psibase/usage.hpp>

#include <algorithm>
#include <limits>

namespace psibase
{
   namespace
   {
      constexpr std::string_view localIds[] = {"unix", "loopback", "node", "unknown"};

      constexpr UsageKind baseKinds[] = {UsageKind::local, UsageKind::ip, UsageKind::account,
                                         UsageKind::peer, UsageKind::guest};

      bool isLocalId(std::string_view id)
      {
         return std::ranges::find(localIds, id) != std::end(localIds);
      }

      // IPv4-mapped IPv6 (::ffff:a.b.c.d) is the IPv4 address.
      std::optional<IPV4Address> mappedV4(const IPV6Address& addr)
      {
         for (std::size_t i = 0; i < 10; ++i)
            if (addr.bytes[i] != 0)
               return {};
         if (addr.bytes[10] != 0xff || addr.bytes[11] != 0xff)
            return {};
         return IPV4Address{{addr.bytes[12], addr.bytes[13], addr.bytes[14], addr.bytes[15]}};
      }

      std::string addressId(const IPV4Address& addr)
      {
         return to_string(addr);
      }
      std::string addressId(const IPV6Address& addr)
      {
         if (auto v4 = mappedV4(addr))
            return addressId(*v4);
         IPV6Address prefix{addr.bytes, 0};
         for (std::size_t i = 8; i < 16; ++i)
            prefix.bytes[i] = 0;
         return to_string(prefix) + "/64";
      }
      std::string addressId(const IPAddress& addr)
      {
         return std::visit([](const auto& a) { return addressId(a); }, addr);
      }

      // An address id is valid if it is what addressId produces.
      bool isAddressId(std::string_view id)
      {
         if (auto v4 = parseIPV4Address(id))
            return addressId(*v4) == id;
         if (!id.ends_with("/64"))
            return false;
         auto v6 = parseIPV6Address(id.substr(0, id.size() - 3));
         return v6 && !mappedV4(*v6) && addressId(*v6) == id;
      }

      std::optional<IPAddress> addressOf(const SocketEndpoint& endpoint)
      {
         if (auto v4 = std::get_if<IPV4Endpoint>(&endpoint))
            return IPAddress{v4->address};
         if (auto v6 = std::get_if<IPV6Endpoint>(&endpoint))
         {
            if (auto v4 = mappedV4(v6->address))
               return IPAddress{*v4};
            return IPAddress{v6->address};
         }
         return {};
      }

      IPAddress unmapped(const IPAddress& address)
      {
         if (auto v6 = std::get_if<IPV6Address>(&address))
            if (auto v4 = mappedV4(*v6))
               return *v4;
         return address;
      }

      std::uint64_t saturatingAdd(std::uint64_t a, std::uint64_t b)
      {
         return a > std::numeric_limits<std::uint64_t>::max() - b
                    ? std::numeric_limits<std::uint64_t>::max()
                    : a + b;
      }
      std::uint64_t saturatingMul(std::uint64_t a, std::uint64_t b)
      {
         if (a != 0 && b > std::numeric_limits<std::uint64_t>::max() / a)
            return std::numeric_limits<std::uint64_t>::max();
         return a * b;
      }
   }  // namespace

   std::string_view to_string(UsageKind kind)
   {
      switch (kind)
      {
         case UsageKind::local:
            return "local";
         case UsageKind::ip:
            return "ip";
         case UsageKind::account:
            return "account";
         case UsageKind::peer:
            return "peer";
         case UsageKind::guest:
            return "guest";
         case UsageKind::expired:
            return "expired";
         case UsageKind::overflow:
            return "overflow";
      }
      return {};
   }

   std::optional<UsageKind> parseUsageKind(std::string_view text)
   {
      for (auto kind : baseKinds)
         if (to_string(kind) == text)
            return kind;
      if (text == "expired")
         return UsageKind::expired;
      if (text == "overflow")
         return UsageKind::overflow;
      return {};
   }

   bool isAggregate(UsageKind kind)
   {
      return kind == UsageKind::expired || kind == UsageKind::overflow;
   }

   bool isValid(const UsageIdentity& identity)
   {
      const auto& id = identity.id;
      if (id.empty() || id.size() > maxUsageIdLength)
         return false;
      switch (identity.kind)
      {
         case UsageKind::local:
            return isLocalId(id);
         case UsageKind::ip:
            return isAddressId(id);
         case UsageKind::account:
         {
            AccountNumber account{std::string_view{id}};
            return account.value != 0 && account.str() == id;
         }
         case UsageKind::peer:
            return id == "unix" || id == "loopback" || id == "unknown" || isAddressId(id);
         case UsageKind::guest:
            // Reserved: no id is valid until the tier exists.
            return false;
         case UsageKind::expired:
         case UsageKind::overflow:
         {
            auto of = parseUsageKind(id);
            return of && !isAggregate(*of);
         }
      }
      return false;
   }

   std::string to_string(const UsageIdentity& identity)
   {
      std::string result{to_string(identity.kind)};
      result += ':';
      result += identity.id;
      return result;
   }

   std::optional<UsageIdentity> parseUsageIdentity(std::string_view text)
   {
      // The longest kind name, the separator and the longest id.
      if (text.size() > 16 + maxUsageIdLength)
         return {};
      auto pos = text.find(':');
      if (pos == std::string_view::npos)
         return {};
      auto kind = parseUsageKind(text.substr(0, pos));
      if (!kind)
         return {};
      UsageIdentity result{*kind, std::string{text.substr(pos + 1)}};
      if (!isValid(result))
         return {};
      return result;
   }

   UsageIdentity UsageIdentity::local(std::string_view which)
   {
      return {UsageKind::local, std::string{isLocalId(which) ? which : "unknown"}};
   }

   UsageIdentity UsageIdentity::account(AccountNumber account)
   {
      return {UsageKind::account, account.str()};
   }

   UsageIdentity UsageIdentity::address(const IPAddress& address)
   {
      return {UsageKind::ip, addressId(address)};
   }

   UsageIdentity UsageIdentity::peer(const std::optional<SocketEndpoint>& endpoint)
   {
      if (!endpoint)
         return {UsageKind::peer, "unknown"};
      if (std::holds_alternative<LocalEndpoint>(*endpoint))
         return {UsageKind::peer, "unix"};
      auto addr = addressOf(*endpoint);
      if (isLoopback(*addr))
         return {UsageKind::peer, "loopback"};
      return {UsageKind::peer, addressId(*addr)};
   }

   UsageIdentity UsageIdentity::aggregate(UsageKind aggregateKind, UsageKind of)
   {
      return {aggregateKind, std::string{to_string(of)}};
   }

   bool isTrustedUsageProxy(const IPAddress& address, std::span<const IPAddressPrefix> trustedProxies)
   {
      auto addr = unmapped(address);
      if (isLoopback(addr))
         return true;
      for (const auto& prefix : trustedProxies)
         if (prefix.contains(addr))
            return true;
      return false;
   }

   bool isTrustedUsageProxy(const SocketEndpoint&             endpoint,
                       std::span<const IPAddressPrefix> trustedProxies)
   {
      if (auto addr = addressOf(endpoint))
         return isTrustedUsageProxy(*addr, trustedProxies);
      // A unix socket
      return true;
   }

   UsageIdentity UsageIdentity::resolve(const std::optional<SocketEndpoint>&        endpoint,
                         std::span<const std::optional<IPAddress>> forwarded,
                         std::span<const IPAddressPrefix>           trustedProxies)
   {
      if (!endpoint)
         return local("unknown");
      auto transport = addressOf(*endpoint);
      if (isTrustedUsageProxy(*endpoint, trustedProxies))
      {
         for (auto iter = forwarded.rbegin(); iter != forwarded.rend(); ++iter)
         {
            // An entry that is not an address (obfuscated, "unknown",
            // malformed) names nobody: stop at the proxy that sent it.
            if (!*iter)
               break;
            if (!isTrustedUsageProxy(**iter, trustedProxies))
               return address(**iter);
         }
         if (!transport)
            return local("unix");
         if (isLoopback(*transport))
            return local("loopback");
      }
      return address(*transport);
   }

   UsageCounters& operator+=(UsageCounters& lhs, const UsageCounters& rhs)
   {
      for (auto member : usageFieldMembers)
         lhs.*member = saturatingAdd(lhs.*member, rhs.*member);
      return lhs;
   }

   UsageCounters operator-(const UsageCounters& lhs, const UsageCounters& rhs)
   {
      UsageCounters result;
      for (auto member : usageFieldMembers)
         result.*member = lhs.*member >= rhs.*member ? lhs.*member - rhs.*member : 0;
      return result;
   }

   bool isZero(const UsageCounters& counters)
   {
      return counters == UsageCounters{};
   }

   std::uint64_t usageUnits(const UsageCounters& total)
   {
      std::uint64_t time = 0;
      for (auto ns :
           {total.requestNs, total.trialNs, total.compileNs, total.verifyNs, total.callbackNs})
         time = saturatingAdd(time, ns);
      std::uint64_t result = saturatingAdd(total.bytesIn, total.bytesOut) / 65536;
      for (auto n : {total.requests, total.messagesIn, total.trxPushed, time / 1000000})
         result = saturatingAdd(result, n);
      return result;
   }

   std::uint64_t UsageRetention::seconds(const UsageCounters& total) const
   {
      return std::min(max, saturatingAdd(base, saturatingMul(perUnit, usageUnits(total))));
   }
}  // namespace psibase
