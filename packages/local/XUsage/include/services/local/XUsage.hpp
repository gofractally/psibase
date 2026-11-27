#pragma once

#include <cstdint>
#include <optional>
#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
#include <string>
#include <vector>

namespace LocalService
{
   /// Who a request is counted for
   enum class UsageKind : std::uint8_t
   {
      /// The account of the session
      account,
      /// A guest session (a passkey with no account)
      guest,
      /// The billing identity of the visitor cookie
      visitor,
      /// Nobody: a local request that bypassed the identity gate, or a path
      /// that needs no session. One row, with the identity `node`.
      node,
   };
   PSIO_REFLECT_ENUM(UsageKind, account, guest, visitor, node)

   /// The totals of one identity. Nothing else is kept: no addresses, no
   /// URLs, no bodies, no row per request.
   struct UsageRow
   {
      std::string identity;
      UsageKind   kind = UsageKind::node;
      /// Requests that reached the chain's HTTP service
      std::uint64_t requests = 0;
      /// Microseconds spent handling them synchronously. A reply that is
      /// sent later (a deferred reply) is not timed beyond that.
      std::uint64_t elapsed_us = 0;
      /// Bytes of request bodies
      std::uint64_t request_bytes = 0;
      /// Bytes of response bodies
      std::uint64_t response_bytes = 0;
      /// Seconds since the epoch, by this node's clock
      std::int64_t first_seen = 0;
      std::int64_t last_seen  = 0;
      /// For a guest: the account its totals were added to when it became
      /// one. They are added once; what the guest uses afterwards stays here.
      std::optional<psibase::AccountNumber> carried_to;

      using Key = psibase::CompositeKey<&UsageRow::identity, &UsageRow::kind>;
      PSIO_REFLECT(UsageRow,
                   attr(identity, utf8),
                   kind,
                   requests,
                   elapsed_us,
                   request_bytes,
                   response_bytes,
                   first_seen,
                   last_seen,
                   carried_to)
   };
   using UsageTable = psibase::Table<UsageRow, UsageRow::Key{}>;
   PSIO_REFLECT_TYPENAME(UsageTable)

   /// The request being handled on a socket, while it is being handled
   struct UsageRequestRow
   {
      std::int32_t  socket;
      std::string   identity;
      UsageKind     kind = UsageKind::node;
      bool          replied        = false;
      std::uint64_t response_bytes = 0;
      PSIO_REFLECT(UsageRequestRow, socket, attr(identity, utf8), kind, replied, response_bytes)
   };
   using UsageRequestTable = psibase::Table<UsageRequestRow, &UsageRequestRow::socket>;
   PSIO_REFLECT_TYPENAME(UsageRequestTable)

   /// A socket whose reply was deferred, and who it is counted for
   struct UsageDeferredRow
   {
      std::int32_t socket;
      std::string  identity;
      UsageKind    kind = UsageKind::node;
      PSIO_REFLECT(UsageDeferredRow, socket, attr(identity, utf8), kind)
   };
   using UsageDeferredTable = psibase::Table<UsageDeferredRow, &UsageDeferredRow::socket>;
   PSIO_REFLECT_TYPENAME(UsageDeferredTable)

   /// Counts what each identity uses of this node. Logging only: nothing is
   /// limited and nothing is billed.
   ///
   /// What is counted: every request that x-http passes to the chain's HTTP
   /// service. For each, against one identity: one request, the time its
   /// synchronous handling took, the bytes of its body, and the bytes of the
   /// body of its reply.
   ///
   /// What is not counted: requests to this node's own services (the `x-`
   /// hosts, this one included), requests refused before they reach the
   /// chain's HTTP service (an unknown host, a plain-HTTP request that is
   /// redirected, a node that has no chain), the time a deferred reply
   /// takes after the request's handler has returned, headers, and
   /// websocket traffic after the handshake.
   ///
   /// The identity of a request is, in this order: the account of its
   /// session, else its guest id, else the billing identity of its visitor
   /// cookie, else `node`.
   ///
   /// How it is fed. x-http marks a request it passes on (a header only it
   /// can set) when this service is installed. The chain's HTTP service,
   /// once it has the session, calls `identify`. x-http reports the reply
   /// it sends with `reply`, and when the handler has returned it calls
   /// `request` with the time and size. That last call writes the totals:
   /// one row read and written per request, unless the reply was deferred,
   /// which costs a second write when it is sent.
   ///
   /// HTTP interface (host `x-usage.`):
   /// - `GET /me`: the totals of the caller's own identity (session cookie
   ///   or bearer token):
   ///   `{"identity","kind","requests","elapsed_us","request_bytes",
   ///   "response_bytes","first_seen","last_seen"}`. 401 with no session.
   ///   Readable with credentials from any app of this node.
   /// - `GET /all?after=<identity>&limit=<n>`: node administrators only.
   ///   `{"rows":[...],"more":bool}`, ordered by identity; `limit` is at
   ///   most 200. A row is as for `/me`, with `carried_to`: for a guest, the
   ///   account its totals were added to, or null. To continue, pass the
   ///   last row's identity as `after`.
   struct XUsage : psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber{"x-usage"};
      using Subjective              = psibase::SubjectiveTables<UsageTable>;
      using Session                 = psibase::SessionTables<UsageDeferredTable>;

      /// The identity `node`
      static constexpr auto nodeIdentity = "node";

      /// By the chain's HTTP service: who the request on `socket` is for
      void identify(std::int32_t socket, UsageKind kind, std::string identity);

      /// By x-http: a reply of `responseBytes` body bytes is being sent on `socket`
      void reply(std::int32_t socket, std::uint64_t responseBytes);

      /// By x-http, when the chain's HTTP service has returned from handling
      /// the request on `socket`: it took `elapsedUs` microseconds and its
      /// body was `requestBytes` long
      void request(std::int32_t socket, std::uint64_t elapsedUs, std::uint64_t requestBytes);

      /// By x-signup, when a guest has become an account: the guest's totals
      /// so far are added to the account's, once.
      void carryOver(std::string guest, psibase::AccountNumber account);

      auto serveSys(psibase::HttpRequest        request,
                    std::optional<std::int32_t> socket) -> std::optional<psibase::HttpReply>;
   };
   PSIO_REFLECT(XUsage,
                method(identify, socket, kind, identity),
                method(reply, socket, responseBytes),
                method(request, socket, elapsedUs, requestBytes),
                method(carryOver, guest, account),
                method(serveSys, request, socket))
   PSIBASE_REFLECT_TABLES(XUsage, XUsage::Subjective, XUsage::Session)
}  // namespace LocalService
