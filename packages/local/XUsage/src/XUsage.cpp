#include <services/local/XUsage.hpp>

#include <algorithm>
#include <charconv>
#include <chrono>
#include <psibase/dispatch.hpp>
#include <services/local/XAdmin.hpp>
#include <services/local/XHttp.hpp>
#include <services/local/XSignup.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/RTransact.hpp>

using namespace psibase;
using namespace LocalService;
using namespace SystemService;

namespace
{
   using Temporary = TemporaryTables<UsageRequestTable>;

   constexpr auto        supervisor = AccountNumber{"supervisor"};
   constexpr std::size_t maxPage    = 200;

   std::int64_t wallSeconds()
   {
      return std::chrono::duration_cast<std::chrono::seconds>(
                 std::chrono::system_clock::now().time_since_epoch())
          .count();
   }

   // One read and one write of one row. Must be called in a subjective transaction.
   void add(UsageTable&        table,
            const std::string& identity,
            UsageKind          kind,
            std::uint64_t      requests,
            std::uint64_t      elapsedUs,
            std::uint64_t      requestBytes,
            std::uint64_t      responseBytes,
            std::int64_t       now)
   {
      auto row = table.get(std::tuple{identity, kind})
                     .value_or(UsageRow{.identity = identity, .kind = kind, .first_seen = now});
      row.requests += requests;
      row.elapsed_us += elapsedUs;
      row.request_bytes += requestBytes;
      row.response_bytes += responseBytes;
      row.last_seen = now;
      table.put(row);
   }

   // -------------------------------------------------------------- http

   // What a caller is shown of a row
   struct Totals
   {
      std::string   identity;
      UsageKind     kind;
      std::uint64_t requests       = 0;
      std::uint64_t elapsed_us     = 0;
      std::uint64_t request_bytes  = 0;
      std::uint64_t response_bytes = 0;
      std::int64_t  first_seen     = 0;
      std::int64_t  last_seen      = 0;
      PSIO_REFLECT(Totals,
                   attr(identity, utf8),
                   kind,
                   requests,
                   elapsed_us,
                   request_bytes,
                   response_bytes,
                   first_seen,
                   last_seen)
   };

   Totals totals(const UsageRow& row)
   {
      return Totals{row.identity,      row.kind,           row.requests,   row.elapsed_us,
                    row.request_bytes, row.response_bytes, row.first_seen, row.last_seen};
   }

   // What an administrator is shown of a row: also where a guest's totals went
   struct AdminTotals
   {
      std::string                  identity;
      UsageKind                    kind;
      std::uint64_t                requests       = 0;
      std::uint64_t                elapsed_us     = 0;
      std::uint64_t                request_bytes  = 0;
      std::uint64_t                response_bytes = 0;
      std::int64_t                 first_seen     = 0;
      std::int64_t                 last_seen      = 0;
      std::optional<AccountNumber> carried_to;
      PSIO_REFLECT(AdminTotals,
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

   struct Page
   {
      std::vector<AdminTotals> rows;
      bool                more = false;
      PSIO_REFLECT(Page, rows, more)
   };

   struct ErrorBody
   {
      std::string error;
      PSIO_REFLECT(ErrorBody, attr(error, utf8))
   };

   template <typename T>
   HttpReply json(const T& value, std::vector<HttpHeader> headers, HttpStatus status = HttpStatus::ok)
   {
      headers.push_back({"Cache-Control", "no-store"});
      HttpReply reply{.status = status, .contentType = "application/json", .headers = std::move(headers)};
      psio::to_ijson(value, reply.body);
      return reply;
   }

   // A page of any app of this node may read its own totals, with the
   // browser's credentials; nobody else's page may read the reply.
   std::vector<HttpHeader> meCors(const HttpRequest& req)
   {
      auto headers = allowCorsSubdomains(req);
      if (std::ranges::any_of(headers, [](const auto& h)
                              { return h.name == "Access-Control-Allow-Origin" && h.value != "*"; }))
         headers.push_back({"Access-Control-Allow-Credentials", "true"});
      if (auto requested = req.getHeader("access-control-request-headers"))
         for (auto& h : headers)
            if (h.name == "Access-Control-Allow-Headers")
               h.value = std::string{*requested};
      headers.push_back({"Vary", "Origin"});
      return headers;
   }

   HttpReply serveMe(const HttpRequest& req)
   {
      auto headers = meCors(req);
      auto session = to<RTransact>().getSession(req);
      // The same order as for counting
      std::string identity;
      UsageKind   kind = UsageKind::node;
      if (session.user)
      {
         identity = session.user->str();
         kind     = UsageKind::account;
      }
      else if (!session.guest.empty())
      {
         identity = session.guest;
         kind     = UsageKind::guest;
      }
      else if (!session.visitor.empty())
      {
         identity = session.visitor;
         kind     = UsageKind::visitor;
      }
      else
         return json(ErrorBody{"no session"}, std::move(headers), HttpStatus::unauthorized);

      // Only ever the caller's own row: the key comes from the session alone.
      std::optional<UsageRow> row;
      PSIBASE_SUBJECTIVE_TX
      {
         row = XUsage{}.open<UsageTable>().get(std::tuple{identity, kind});
      }
      return json(totals(row.value_or(UsageRow{.identity = identity, .kind = kind})),
                  std::move(headers));
   }

   struct AllQuery
   {
      std::string after;
      std::string limit;
      PSIO_REFLECT(AllQuery, attr(after, utf8), attr(limit, utf8))
   };

   HttpReply serveAll(const HttpRequest& req)
   {
      auto        query = req.query<AllQuery>();
      std::size_t limit = maxPage;
      if (!query.limit.empty())
      {
         std::size_t requested = 0;
         auto [end, ec] = std::from_chars(query.limit.data(),
                                          query.limit.data() + query.limit.size(), requested);
         if (ec != std::errc{} || end != query.limit.data() + query.limit.size() || requested == 0)
            return json(ErrorBody{"limit must be a number from 1 to 200"},
                        allowCors(req, XAdmin::service), HttpStatus::badRequest);
         limit = std::min(requested, maxPage);
      }
      Page        page;
      PSIBASE_SUBJECTIVE_TX
      {
         page       = Page{};
         auto index = XUsage{}.open<UsageTable>().getIndex<0>();
         // Every row of an identity is after (identity, the largest kind).
         auto it = query.after.empty()
                       ? index.begin()
                       : index.upper_bound(std::tuple{query.after, UsageKind::node});
         for (auto end = index.end(); it != end; ++it)
         {
            auto row = *it;
            // The rows of one identity (one per kind) stay on one page, so
            // that `after` = the last identity never skips any.
            if (page.rows.size() >= limit && row.identity != page.rows.back().identity)
            {
               page.more = true;
               break;
            }
            page.rows.push_back(AdminTotals{row.identity, row.kind, row.requests, row.elapsed_us,
                                            row.request_bytes, row.response_bytes,
                                            row.first_seen, row.last_seen, row.carried_to});
         }
      }
      return json(page, allowCors(req, XAdmin::service));
   }
}  // namespace

void XUsage::identify(std::int32_t socket, UsageKind kind, std::string identity)
{
   check(getSender() == HttpServer::service, "Wrong sender");
   Temporary{getReceiver(), KvMode::readWrite}.open<UsageRequestTable>().put(
       UsageRequestRow{.socket = socket, .identity = std::move(identity), .kind = kind});
}

void XUsage::reply(std::int32_t socket, std::uint64_t responseBytes)
{
   check(getSender() == XHttp::service, "Wrong sender");
   auto current = Temporary{getReceiver(), KvMode::readWrite}.open<UsageRequestTable>();
   if (auto row = current.get(socket))
   {
      // The request is still being handled: `request` writes it all at once.
      row->replied        = true;
      row->response_bytes = responseBytes;
      current.put(*row);
      return;
   }
   // A deferred reply: the request itself was counted when its handler returned.
   PSIBASE_SUBJECTIVE_TX
   {
      auto deferred = open<UsageDeferredTable>();
      if (auto row = deferred.get(socket))
      {
         deferred.remove(*row);
         auto table = open<UsageTable>();
         add(table, row->identity, row->kind, 0, 0, 0, responseBytes, wallSeconds());
      }
   }
}

void XUsage::request(std::int32_t socket, std::uint64_t elapsedUs, std::uint64_t requestBytes)
{
   check(getSender() == XHttp::service, "Wrong sender");
   auto current = Temporary{getReceiver(), KvMode::readWrite}.open<UsageRequestTable>();
   // A request the chain's HTTP service did not identify is nobody's.
   auto row = current.get(socket).value_or(
       UsageRequestRow{.socket = socket, .identity = nodeIdentity, .kind = UsageKind::node});
   current.erase(socket);
   PSIBASE_SUBJECTIVE_TX
   {
      auto table = open<UsageTable>();
      add(table, row.identity, row.kind, 1, elapsedUs, requestBytes, row.response_bytes,
          wallSeconds());
      auto deferred = open<UsageDeferredTable>();
      if (!row.replied)
         // The reply comes later, on this socket. Until then the socket is
         // not reused, so this also replaces whatever an earlier request
         // on a socket of the same number left behind unanswered.
         deferred.put(UsageDeferredRow{socket, row.identity, row.kind});
      else
         deferred.erase(socket);
   }
}

void XUsage::carryOver(std::string guest, psibase::AccountNumber account)
{
   check(getSender() == XSignup::service, "Wrong sender");
   PSIBASE_SUBJECTIVE_TX
   {
      auto table = open<UsageTable>();
      auto from  = table.get(std::tuple{guest, UsageKind::guest});
      if (from && !from->carried_to)
      {
         auto to = table.get(std::tuple{account.str(), UsageKind::account})
                       .value_or(UsageRow{.identity   = account.str(),
                                          .kind       = UsageKind::account,
                                          .first_seen = from->first_seen});
         to.requests += from->requests;
         to.elapsed_us += from->elapsed_us;
         to.request_bytes += from->request_bytes;
         to.response_bytes += from->response_bytes;
         to.first_seen = std::min(to.first_seen, from->first_seen);
         to.last_seen  = std::max(to.last_seen, from->last_seen);
         table.put(to);
         // Noted on the guest's row, so that it is not added a second time.
         from->carried_to = account;
         table.put(*from);
      }
   }
}

auto XUsage::serveSys(HttpRequest request, std::optional<std::int32_t> socket)
    -> std::optional<HttpReply>
{
   check(getSender() == XHttp::service, "Wrong sender");
   auto target = request.path();

   if (target == "/all")
   {
      if (auto denied = to<XAdmin>().checkAuth(request, socket))
         return denied;
      if (request.method != "GET")
         return HttpReply::methodNotAllowed(request);
      return serveAll(request);
   }
   if (target == "/me")
   {
      if (request.method == "OPTIONS")
         return HttpReply{.headers = meCors(request)};
      if (request.method != "GET")
         return HttpReply::methodNotAllowed(request);
      return serveMe(request);
   }
   return std::nullopt;
}

PSIBASE_DISPATCH(XUsage)
