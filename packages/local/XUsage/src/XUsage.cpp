#include <services/local/XUsage.hpp>

#include <psibase/HttpHeaders.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <services/local/XAdmin.hpp>
#include <services/local/XDb.hpp>
#include <services/local/XHttp.hpp>
#include <services/system/RTransact.hpp>

#include <algorithm>
#include <charconv>
#include <chrono>

using namespace psibase;
using namespace LocalService;
using namespace SystemService;

namespace
{
   constexpr UsageKind baseKinds[] = {UsageKind::local, UsageKind::ip, UsageKind::account,
                                      UsageKind::peer};
   constexpr std::size_t defaultLimit = 20;
   constexpr std::size_t maxLimit     = 1000;

   // What a record looks like in a reply
   struct UsageRecord
   {
      std::string   identity;
      std::string   kind;
      std::string   id;
      std::uint64_t firstSeen = 0;
      std::uint64_t lastSeen  = 0;
      // 0 for an aggregate, which is never dropped
      std::uint64_t keepUntil = 0;
      // psibase::usageUnits(total)
      std::uint64_t units = 0;
      UsageCounters total;
      // Use in the current usage window and the one before it
      UsageCounters recent;
      // The stored quota that applies (not enforced)
      std::optional<UsageCounters> quota;
      PSIO_REFLECT(UsageRecord,
                   identity,
                   kind,
                   id,
                   firstSeen,
                   lastSeen,
                   keepUntil,
                   units,
                   total,
                   recent,
                   quota)
   };

   struct KindTotal
   {
      std::string kind;
      // Identities with a record of their own
      std::uint64_t records = 0;
      // Everything charged to the kind, and the recent part of it
      UsageCounters total;
      UsageCounters recent;
      // The parts of `total` that no longer have a record of their own:
      // dropped by retention, and evicted because the kind was full
      UsageCounters expired;
      UsageCounters overflow;
      PSIO_REFLECT(KindTotal, kind, records, total, recent, expired, overflow)
   };

   struct Settings
   {
      bool                     enabled = false;
      std::uint64_t            maxRecords = 0;
      std::uint64_t            windowSeconds = 0;
      std::uint64_t            flushSeconds = 0;
      std::uint64_t            retentionBase = 0;
      std::uint64_t            retentionPerUnit = 0;
      std::uint64_t            retentionMax = 0;
      std::vector<std::string> trustedProxies;
      PSIO_REFLECT(Settings,
                   enabled,
                   maxRecords,
                   windowSeconds,
                   flushSeconds,
                   retentionBase,
                   retentionPerUnit,
                   retentionMax,
                   trustedProxies)
   };

   struct Report
   {
      // Seconds since the Unix epoch. Rows are at most flushSeconds old.
      std::uint64_t            now = 0;
      Settings                 settings;
      std::vector<KindTotal>   totals;
      UsageCounters            total;
      std::string              order;
      bool                     recent = false;
      std::vector<UsageRecord> top;
      PSIO_REFLECT(Report, now, settings, totals, total, order, recent, top)
   };

   struct Me
   {
      std::uint64_t now     = 0;
      bool          enabled = false;
      std::string   identity;
      // Absent if nothing is recorded (yet): rows are written every
      // flushSeconds.
      std::optional<UsageRecord> usage;
      PSIO_REFLECT(Me, now, enabled, identity, usage)
   };

   struct Quota
   {
      // `kind:id`, or `kind:*` for the default of a kind
      std::string   identity;
      UsageCounters perWindow;
      PSIO_REFLECT(Quota, identity, perWindow)
   };

   struct ReportQuery
   {
      std::string kind;
      std::string order;
      std::string recent;
      std::string limit;
      PSIO_REFLECT(ReportQuery, kind, order, recent, limit)
   };

   struct IdentityQuery
   {
      std::string id;
      PSIO_REFLECT(IdentityQuery, id)
   };

   std::uint64_t now()
   {
      return static_cast<std::uint64_t>(std::chrono::duration_cast<std::chrono::seconds>(
                                            std::chrono::system_clock::now().time_since_epoch())
                                            .count());
   }

   HttpReply json(const HttpRequest& request, std::string body, bool admin)
   {
      HttpReply reply{.contentType = "application/json", .body{body.begin(), body.end()}};
      if (admin)
      {
         // The admin UI is served from x-admin
         reply.headers = allowCors(request, XAdmin::service);
         reply.headers.push_back({"Access-Control-Allow-Credentials", "true"});
      }
      return reply;
   }

   HttpReply error(HttpStatus status, std::string_view msg)
   {
      return HttpReply{
          .status = status, .contentType = "text/plain", .body{msg.begin(), msg.end()}};
   }

   bool chainIsBooted()
   {
      auto mode   = KvMode::read;
      auto prefix = std::span<const char>();
      auto native = Native::Tables{to<XDb>().open(DbId::native, prefix, mode), mode};
      auto row    = native.open<StatusTable>().get({});
      return row && row->head;
   }

   std::optional<UsageConfigRow> readConfig()
   {
      std::optional<UsageConfigRow> result;
      auto table = Native::sessionDirect(KvMode::read).open<UsageConfigTable>();
      PSIBASE_SUBJECTIVE_TX
      {
         result = table.get({});
      }
      return result;
   }

   Settings toSettings(const std::optional<UsageConfigRow>& config)
   {
      Settings result;
      if (config)
      {
         result.enabled          = true;
         result.maxRecords       = config->maxRecords;
         result.windowSeconds    = config->windowSeconds;
         result.flushSeconds     = config->flushSeconds;
         result.retentionBase    = config->retentionBase;
         result.retentionPerUnit = config->retentionPerUnit;
         result.retentionMax     = config->retentionMax;
         result.trustedProxies   = config->trustedProxies;
      }
      return result;
   }

   // What a row used in the current window and the one before it. A row is
   // rewritten only when its identity is seen, so its window can be old.
   UsageCounters recentUse(const UsageRow& row, std::uint64_t currentWindow)
   {
      UsageCounters result;
      if (row.window == currentWindow)
      {
         result = row.current;
         result += row.previous;
      }
      else if (row.window + 1 == currentWindow)
         result = row.current;
      return result;
   }

   std::optional<UsageCounters> quotaFor(const UsageIdentity& identity)
   {
      auto                         table = XUsage{}.open<UsageQuotaTable>();
      std::optional<UsageQuotaRow> row;
      auto                         kind = static_cast<std::uint8_t>(identity.kind);
      PSIBASE_SUBJECTIVE_TX
      {
         row = table.get(std::tuple(kind, identity.id));
         if (!row)
            row = table.get(std::tuple(kind, std::string()));
      }
      if (row)
         return row->perWindow;
      return {};
   }

   UsageRecord toRecord(const UsageRow& row, std::uint64_t currentWindow, bool withQuota)
   {
      auto        identity = row.identity();
      UsageRecord result;
      result.identity  = to_string(identity);
      result.kind      = std::string{to_string(identity.kind)};
      result.id        = identity.id;
      result.firstSeen = row.firstSeen;
      result.lastSeen  = row.lastSeen;
      result.keepUntil = row.keepUntil;
      result.units     = usageUnits(row.total);
      result.total     = row.total;
      result.recent    = recentUse(row, currentWindow);
      if (withQuota && !isAggregate(identity.kind))
         result.quota = quotaFor(identity);
      return result;
   }

   std::vector<UsageRow> readRows()
   {
      std::vector<UsageRow> result;
      auto table = Native::subjectiveDirect(KvMode::read).open<UsageTable>();
      PSIBASE_SUBJECTIVE_TX
      {
         result.clear();
         for (auto row : table.getIndex<0>())
            result.push_back(std::move(row));
      }
      return result;
   }

   std::optional<UsageRow> readRow(const UsageIdentity& identity)
   {
      std::optional<UsageRow> result;
      auto table = Native::subjectiveDirect(KvMode::read).open<UsageTable>();
      PSIBASE_SUBJECTIVE_TX
      {
         result = table.get(std::tuple(static_cast<std::uint8_t>(identity.kind), identity.id));
      }
      return result;
   }

   // Who is asking: the account named by a valid login token, otherwise
   // the client's address, resolved exactly as native code resolves it for
   // metering (psibase::UsageIdentity::resolve with the node's trusted
   // proxies).
   UsageIdentity callerIdentity(const HttpRequest&                   request,
                                std::optional<std::int32_t>          socket,
                                const std::optional<UsageConfigRow>& config)
   {
      HttpRequest credentials{.host        = request.host,
                              .method      = request.method,
                              .target      = request.target,
                              .contentType = request.contentType,
                              .headers     = request.headers};
      if (chainIsBooted())
      {
         if (auto user = to<RTransact>().getUser(credentials))
            return UsageIdentity::account(*user);
      }
      std::optional<SocketEndpoint> endpoint;
      if (socket)
      {
         std::optional<SocketRow> row;
         auto table = Native::sessionDirect(KvMode::read).open<SocketTable>();
         PSIBASE_SUBJECTIVE_TX
         {
            row = table.get(*socket);
         }
         if (row)
         {
            if (auto info = std::get_if<HttpSocketInfo>(&row->info))
               endpoint = info->endpoint;
         }
      }
      std::vector<IPAddressPrefix> proxies;
      if (config)
      {
         for (const auto& text : config->trustedProxies)
            if (auto prefix = parseIPAddressPrefix(text))
               proxies.push_back(std::move(*prefix));
      }
      std::vector<std::optional<IPAddress>> forwarded;
      if (endpoint && isTrustedUsageProxy(*endpoint, proxies))
         forwarded = forwardedFor(credentials);
      return UsageIdentity::resolve(endpoint, forwarded, proxies);
   }

   std::optional<std::size_t> fieldIndex(std::string_view name)
   {
      for (std::size_t i = 0; i < numUsageFields; ++i)
         if (usageFieldNames[i] == name)
            return i;
      return {};
   }

   HttpReply serveMe(const HttpRequest& request, std::optional<std::int32_t> socket)
   {
      auto config   = readConfig();
      auto identity = callerIdentity(request, socket, config);
      Me   result;
      result.now      = now();
      result.enabled  = config.has_value();
      result.identity = to_string(identity);
      if (config)
      {
         if (auto row = readRow(identity))
            result.usage = toRecord(
                *row, result.now / std::max<std::uint64_t>(config->windowSeconds, 1), true);
      }
      return json(request, psio::to_ijson(result), false);
   }

   HttpReply serveReport(const HttpRequest& request)
   {
      auto query  = request.query<ReportQuery>();
      auto config = readConfig();
      Report result;
      result.now      = now();
      result.settings = toSettings(config);
      result.order    = query.order.empty() ? "units" : query.order;
      result.recent   = query.recent == "1" || query.recent == "true";

      std::optional<std::size_t> field;
      if (result.order != "units")
      {
         field = fieldIndex(result.order);
         if (!field)
            return error(HttpStatus::badRequest, "order: not a counter");
      }
      std::optional<UsageKind> kind;
      if (!query.kind.empty())
      {
         kind = parseUsageKind(query.kind);
         if (!kind || isAggregate(*kind))
            return error(HttpStatus::badRequest, "kind: not a kind of identity");
      }
      std::size_t limit = defaultLimit;
      if (!query.limit.empty())
      {
         auto res = std::from_chars(query.limit.data(), query.limit.data() + query.limit.size(),
                                    limit);
         if (res.ec != std::errc{} || res.ptr != query.limit.data() + query.limit.size())
            return error(HttpStatus::badRequest, "limit: not a number");
         limit = std::min(limit, maxLimit);
      }

      auto window = result.now / std::max<std::uint64_t>(result.settings.windowSeconds, 1);
      for (auto k : baseKinds)
         result.totals.push_back({std::string{to_string(k)}});
      auto totalOf = [&](UsageKind k) -> KindTotal&
      {
         for (std::size_t i = 0; i < std::size(baseKinds); ++i)
            if (baseKinds[i] == k)
               return result.totals[i];
         return result.totals[0];
      };

      auto rows = readRows();
      struct Candidate
      {
         std::uint64_t   value;
         const UsageRow* row;
      };
      std::vector<Candidate> candidates;
      for (const auto& row : rows)
      {
         auto identity = row.identity();
         if (!isValid(identity))
            continue;
         auto recent = recentUse(row, window);
         if (isAggregate(identity.kind))
         {
            auto& item = totalOf(*parseUsageKind(identity.id));
            item.total += row.total;
            item.recent += recent;
            (identity.kind == UsageKind::expired ? item.expired : item.overflow) += row.total;
         }
         else
         {
            auto& item = totalOf(identity.kind);
            item.records += 1;
            item.total += row.total;
            item.recent += recent;
            if (!kind || *kind == identity.kind)
            {
               const auto& counters = result.recent ? recent : row.total;
               candidates.push_back(
                   {field ? counters.*usageFieldMembers[*field] : usageUnits(counters), &row});
            }
         }
         result.total += row.total;
      }
      limit = std::min(limit, candidates.size());
      std::partial_sort(candidates.begin(), candidates.begin() + limit, candidates.end(),
                        [](const Candidate& a, const Candidate& b)
                        {
                           if (a.value != b.value)
                              return a.value > b.value;
                           return a.row->identity() < b.row->identity();
                        });
      for (std::size_t i = 0; i < limit; ++i)
         result.top.push_back(toRecord(*candidates[i].row, window, true));
      return json(request, psio::to_ijson(result), true);
   }

   HttpReply serveIdentity(const HttpRequest& request)
   {
      auto query    = request.query<IdentityQuery>();
      auto identity = parseUsageIdentity(query.id);
      if (!identity)
         return error(HttpStatus::badRequest, "id: not an identity (kind:id)");
      auto config = readConfig();
      auto row    = readRow(*identity);
      if (!row)
         return error(HttpStatus::notFound, "No usage is recorded for this identity");
      auto window =
          now() / std::max<std::uint64_t>(config ? config->windowSeconds : 0, 1);
      return json(request, psio::to_ijson(toRecord(*row, window, true)), true);
   }

   // `kind:id` or `kind:*`
   std::optional<UsageQuotaRow> parseQuotaTarget(std::string_view text)
   {
      if (text.size() > 16 + maxUsageIdLength)
         return {};
      auto pos = text.find(':');
      if (pos == std::string_view::npos)
         return {};
      auto kind = parseUsageKind(text.substr(0, pos));
      if (!kind || isAggregate(*kind))
         return {};
      UsageQuotaRow row{.kind = static_cast<std::uint8_t>(*kind)};
      if (text.substr(pos + 1) != "*")
      {
         auto identity = parseUsageIdentity(text);
         if (!identity)
            return {};
         row.id = identity->id;
      }
      return row;
   }

   HttpReply serveQuotas(const HttpRequest& request)
   {
      std::vector<Quota> result;
      auto               table = XUsage{}.open<UsageQuotaTable>();
      PSIBASE_SUBJECTIVE_TX
      {
         result.clear();
         for (auto row : table.getIndex<0>())
         {
            std::string identity{to_string(static_cast<UsageKind>(row.kind))};
            identity += ':';
            identity += row.id.empty() ? std::string("*") : row.id;
            result.push_back({std::move(identity), row.perWindow});
         }
      }
      return json(request, psio::to_ijson(result), true);
   }

   // Stores a quota. All limits zero: removes it.
   HttpReply setQuota(const HttpRequest& request)
   {
      if (request.contentType != "application/json")
         return error(HttpStatus::unsupportedMediaType, "Content-Type must be application/json");
      auto body = psio::from_ijson<Quota>(request.body);
      auto row  = parseQuotaTarget(body.identity);
      if (!row)
         return error(HttpStatus::badRequest,
                      "identity: expected kind:id, or kind:* for the default of a kind");
      row->perWindow = body.perWindow;
      auto table     = XUsage{}.open<UsageQuotaTable>();
      PSIBASE_SUBJECTIVE_TX
      {
         if (isZero(row->perWindow))
            table.erase(std::tuple(row->kind, row->id));
         else
            table.put(*row);
      }
      return json(request, "{}", true);
   }
}  // namespace

auto XUsage::serveSys(const HttpRequest& request, std::optional<std::int32_t> socket)
    -> std::optional<HttpReply>
{
   check(getSender() == XHttp::service, "Wrong sender");

   auto target = request.path();

   if (target == "/me")
   {
      if (request.method != "GET")
         return HttpReply::methodNotAllowed(request);
      return serveMe(request, socket);
   }

   if (target != "/report" && target != "/identity" && target != "/quotas" && target != "/quota")
      return {};

   if (request.method == "OPTIONS")
   {
      HttpReply result{.headers = allowCors(request, XAdmin::service)};
      result.headers.push_back({"Access-Control-Allow-Credentials", "true"});
      for (auto& h : result.headers)
      {
         if (h.matches("Access-Control-Allow-Headers"))
            h.value = "Content-Type, Authorization";
      }
      result.headers.push_back({"Allow", "GET, POST, OPTIONS"});
      return result;
   }

   // Everything below shows other identities' usage: the operator only.
   if (auto reply = to<XAdmin>().checkAuth(request, socket))
      return reply;

   if (target == "/quota")
   {
      if (request.method != "POST")
         return HttpReply::methodNotAllowed(request);
      return setQuota(request);
   }
   if (request.method != "GET")
      return HttpReply::methodNotAllowed(request);
   if (target == "/report")
      return serveReport(request);
   if (target == "/identity")
      return serveIdentity(request);
   return serveQuotas(request);
}

PSIBASE_DISPATCH(XUsage)
