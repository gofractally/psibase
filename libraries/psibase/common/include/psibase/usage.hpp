#pragma once

// Node-local usage metering (gofractally/psibase#2270): who used how much of
// this node. Nothing in this header is consensus: identities and counters
// exist in the node's memory and in its own (subjective) storage only.
//
// This header is shared by native code, which measures, and by the local
// service that reports, so that both resolve a connection to the same
// identity.

#include <psibase/AccountNumber.hpp>
#include <psibase/SocketInfo.hpp>
#include <psio/reflect.hpp>

#include <array>
#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace psibase
{
   // What kind of party an identity is. The value is part of the stored key.
   enum class UsageKind : std::uint8_t
   {
      // The node itself and its operator's own connections:
      // `local:unix`, `local:loopback`, `local:node`, `local:unknown`.
      local = 0,
      // An unauthenticated client, by address: an IPv4 address, or the /64
      // prefix of an IPv6 address.
      ip = 1,
      // A request that carried a valid login token: the account it names.
      account = 2,
      // The owner of a peer (p2p) connection, by the address of that
      // connection.
      peer = 3,
      // Reserved for the guest + passkey tier. Not produced.
      guest = 4,
      // Aggregates, one per kind above; the id is that kind's name.
      // `expired:<kind>` holds the counts of records dropped by retention,
      // `overflow:<kind>` those of records evicted, or never given a record,
      // because the table was full. With them the rows of a kind always sum
      // to everything that was charged to it.
      expired  = 254,
      overflow = 255,
   };

   inline constexpr std::size_t maxUsageIdLength = 64;

   std::string_view         to_string(UsageKind kind);
   std::optional<UsageKind> parseUsageKind(std::string_view text);
   // True for the kinds that hold aggregates instead of one party.
   bool isAggregate(UsageKind kind);

   // An identity is a kind and an id. Its text form is `kind:id`.
   struct UsageIdentity
   {
      UsageKind   kind = UsageKind::local;
      std::string id;

      friend bool operator==(const UsageIdentity&, const UsageIdentity&) = default;
      friend auto operator<=>(const UsageIdentity&, const UsageIdentity&) = default;

      static UsageIdentity local(std::string_view which);  // unix, loopback, node, unknown
      static UsageIdentity account(AccountNumber account);
      // IPv4 exact (an IPv4-mapped IPv6 address counts as IPv4); IPv6 by /64,
      // zone dropped.
      static UsageIdentity address(const IPAddress& address);
      // The owner of a peer connection: the same address forms, kind `peer`.
      // `peer:unix` and `peer:loopback` for local transports.
      static UsageIdentity peer(const std::optional<SocketEndpoint>& endpoint);
      static UsageIdentity aggregate(UsageKind aggregateKind, UsageKind of);

      // The identity of an unauthenticated connection.
      //
      // `forwarded` is what the request's Forwarded / X-Forwarded-For headers
      // list, in order (psibase::forwardedFor). It is used only if the
      // transport peer is a trusted proxy (isTrustedUsageProxy): then the
      // identity is the right-most forwarded address that is not itself a
      // trusted proxy, "the nearest party we cannot vouch for". With no
      // such address the identity is the transport peer: `local:unix`,
      // `local:loopback`, or the proxy's own address. From any other peer
      // the headers are ignored, since the client writes them.
      static UsageIdentity resolve(const std::optional<SocketEndpoint>&        endpoint,
                                   std::span<const std::optional<IPAddress>> forwarded,
                                   std::span<const IPAddressPrefix>           trustedProxies);
   };

   // Whether the id is one this kind can have, in its canonical spelling.
   // Identity strings reach the node from outside (a query names one); every
   // identity is checked with this before it is used as a key.
   bool        isValid(const UsageIdentity& identity);
   std::string to_string(const UsageIdentity& identity);
   // Returns nothing unless the text is `kind:id` with a valid id.
   std::optional<UsageIdentity> parseUsageIdentity(std::string_view text);

   // Whether forwarding headers are believed when they arrive from this
   // transport peer: only from a unix socket, from loopback, or from an
   // address inside one of the configured proxy prefixes.
   bool isTrustedUsageProxy(const SocketEndpoint&             endpoint,
                            std::span<const IPAddressPrefix> trustedProxies);
   bool isTrustedUsageProxy(const IPAddress&                  address,
                            std::span<const IPAddressPrefix> trustedProxies);

   // The counters of one record. All are totals; times are nanoseconds of
   // wall clock.
   struct UsageCounters
   {
      // HTTP requests received.
      std::uint64_t requests = 0;
      // Request bytes (head and body), websocket payload bytes received.
      std::uint64_t bytesIn = 0;
      // Response bytes (head and body), websocket payload bytes sent.
      std::uint64_t bytesOut = 0;
      // Websocket messages received / sent.
      std::uint64_t messagesIn  = 0;
      std::uint64_t messagesOut = 0;
      // Wall clock the node spent handling requests and inbound messages
      // (not the time a reply waited for something else to happen).
      std::uint64_t requestNs = 0;
      // Trial (speculative) runs posted for this identity.
      std::uint64_t trxPushed = 0;
      // Trial runs that finished without / with an error.
      std::uint64_t trialOk     = 0;
      std::uint64_t trialFailed = 0;
      // Wall clock of trial runs, compiles excluded.
      std::uint64_t trialNs = 0;
      // Wall clock those trial runs waited for compiles they started.
      std::uint64_t compileNs = 0;
      // Signature checks run, and their wall clock.
      std::uint64_t verifyRuns = 0;
      std::uint64_t verifyNs   = 0;
      // Wall clock of run continuations and of other posted runs.
      std::uint64_t callbackNs = 0;

      friend bool operator==(const UsageCounters&, const UsageCounters&) = default;

      PSIO_REFLECT(UsageCounters,
                   requests,
                   bytesIn,
                   bytesOut,
                   messagesIn,
                   messagesOut,
                   requestNs,
                   trxPushed,
                   trialOk,
                   trialFailed,
                   trialNs,
                   compileNs,
                   verifyRuns,
                   verifyNs,
                   callbackNs)
   };

   // One name per counter, in declaration order. Native code keeps the
   // counters of a live record in an array indexed by this.
   enum class UsageField : std::uint8_t
   {
      requests,
      bytesIn,
      bytesOut,
      messagesIn,
      messagesOut,
      requestNs,
      trxPushed,
      trialOk,
      trialFailed,
      trialNs,
      compileNs,
      verifyRuns,
      verifyNs,
      callbackNs,
   };
   inline constexpr std::size_t numUsageFields = 14;

   inline constexpr std::array<std::uint64_t UsageCounters::*, numUsageFields> usageFieldMembers{
       &UsageCounters::requests,    &UsageCounters::bytesIn,    &UsageCounters::bytesOut,
       &UsageCounters::messagesIn,  &UsageCounters::messagesOut, &UsageCounters::requestNs,
       &UsageCounters::trxPushed,   &UsageCounters::trialOk,    &UsageCounters::trialFailed,
       &UsageCounters::trialNs,     &UsageCounters::compileNs,  &UsageCounters::verifyRuns,
       &UsageCounters::verifyNs,    &UsageCounters::callbackNs,
   };
   inline constexpr std::array<std::string_view, numUsageFields> usageFieldNames{
       "requests",  "bytesIn",   "bytesOut",    "messagesIn", "messagesOut",
       "requestNs", "trxPushed", "trialOk",     "trialFailed", "trialNs",
       "compileNs", "verifyRuns", "verifyNs",   "callbackNs",
   };

   UsageCounters& operator+=(UsageCounters& lhs, const UsageCounters& rhs);
   // lhs - rhs, each counter separately; lhs is never behind rhs.
   UsageCounters operator-(const UsageCounters& lhs, const UsageCounters& rhs);
   bool          isZero(const UsageCounters& counters);

   // How much a record used, as one number: what retention grows with and
   // what "top consumers" sorts by when no counter is named.
   //
   //   one unit = one request, one inbound websocket message, one pushed
   //              transaction, one millisecond of node time
   //              (request + trial + compile + verify + callback), or
   //              64 KiB transferred (in + out).
   std::uint64_t usageUnits(const UsageCounters& total);

   // How long a record is kept after it was last seen (seconds):
   //
   //   min(retentionMax, retentionBase + retentionPerUnit * usageUnits(total))
   //
   // A visitor who used little and does not come back is dropped after
   // about `retentionBase`; every unit of use buys `retentionPerUnit` more,
   // up to `retentionMax`.
   struct UsageRetention
   {
      std::uint64_t base    = 3600;           // usage-retention-base: one hour
      std::uint64_t perUnit = 60;             // usage-retention-per-unit: one minute
      std::uint64_t max     = 30 * 24 * 3600;  // usage-retention-max: thirty days

      std::uint64_t seconds(const UsageCounters& total) const;
      friend bool   operator==(const UsageRetention&, const UsageRetention&) = default;
   };
}  // namespace psibase
