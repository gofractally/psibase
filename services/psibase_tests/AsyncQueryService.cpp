#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
#include <psibase/dispatch.hpp>
#include <services/system/HttpServer.hpp>

#include <charconv>
#include <chrono>

using namespace psibase;
using namespace SystemService;

struct AsyncResponseRow
{
   std::int32_t               socket;
   HttpReply                  reply;
   std::optional<std::string> error;
};
PSIO_REFLECT(AsyncResponseRow, socket, reply, error)

using AsyncResponseTable = psibase::Table<AsyncResponseRow, &AsyncResponseRow::socket>;

struct CounterRow
{
   std::uint32_t value;
   auto          key() const { return SingletonKey{}; }
};

PSIO_REFLECT(CounterRow, value)

using CounterTable = psibase::Table<CounterRow, &CounterRow::key>;

struct AsyncQueryService : psibase::Service
{
   using Subjective              = psibase::SubjectiveTables<AsyncResponseTable, CounterTable>;
   static constexpr auto service = psibase::AccountNumber{"as-query"};
   void                  onBlock();
   auto                  serveSys(const HttpRequest&          req,
                                  std::optional<std::int32_t> socket) -> std::optional<HttpReply>;
};
PSIO_REFLECT(AsyncQueryService, method(onBlock), method(serveSys, request, socket))

void wait_until(std::chrono::steady_clock::time_point end)
{
   while (std::chrono::steady_clock::now() < end)
   {
   }
}

void wait_for(std::chrono::steady_clock::duration dur)
{
   wait_until(std::chrono::steady_clock::now() + dur);
}

void AsyncQueryService::onBlock()
{
   std::vector<AsyncResponseRow> rows;
   PSIBASE_SUBJECTIVE_TX
   {
      auto table = Subjective{}.open<AsyncResponseTable>();
      for (auto row : table.getIndex<0>())
      {
         table.remove(row);
         to<HttpServer>().claimReply(row.socket);
         rows.push_back(std::move(row));
         if (rows.back().error)
         {
            break;
         }
      }
   }
   for (const auto& row : rows)
   {
      if (row.error)
         abortMessage(*row.error);
      else
         to<HttpServer>().sendReply(row.socket, row.reply);
   }
}

std::pair<std::string_view, std::chrono::seconds> parseQuery(std::string_view target)
{
   auto pos = target.find('?');
   if (pos == std::string_view::npos)
      return {target, std::chrono::seconds(0)};
   auto     path      = target.substr(0, pos);
   auto     params    = target.substr(pos + 1);
   auto     delay_idx = params.find("delay=");
   unsigned value     = 0;
   if (delay_idx != std::string_view::npos)
   {
      std::from_chars(params.data() + delay_idx + 6, params.data() + params.size(), value);
   }
   return {path, std::chrono::seconds(value)};
}

std::optional<HttpReply> AsyncQueryService::serveSys(const HttpRequest&          request,
                                                     std::optional<std::int32_t> socket)
{
   check(getSender() == HttpServer::service, "Wrong sender");
   check(socket.has_value(), "Missing socket");
   auto reply         = HttpReply{.contentType = request.contentType, .body = request.body};
   auto [path, delay] = parseQuery(request.target);
   if (path == "/send")
   {
      wait_for(delay);
      to<HttpServer>().sendReply(*socket, reply);
   }
   else if (path == "/abort")
   {
      wait_for(delay);
      abortMessage("test abort");
   }
   else if (path == "/send_async")
   {
      auto table = Subjective{}.open<AsyncResponseTable>();
      PSIBASE_SUBJECTIVE_TX
      {
         table.put({.socket = *socket, .reply = reply});
         to<HttpServer>().deferReply(*socket);
      }
      wait_for(delay);
   }
   else if (path == "/send_and_abort_async")
   {
      auto table = Subjective{}.open<AsyncResponseTable>();
      PSIBASE_SUBJECTIVE_TX
      {
         table.put({.socket = *socket, .error = "test send and abort async"});
         to<HttpServer>().deferReply(*socket);
      }
      wait_for(delay);
   }
   else if (path == "/send_and_abort")
   {
      wait_for(delay);
      to<HttpServer>().sendReply(*socket, reply);
      abortMessage("test send and abort");
   }
   else if (path == "/send_async_and_abort")
   {
      auto table = Subjective{}.open<AsyncResponseTable>();
      PSIBASE_SUBJECTIVE_TX
      {
         table.put({.socket = *socket, .reply = reply});
         to<HttpServer>().deferReply(*socket);
      }
      wait_for(delay);
      abortMessage("test send async and abort");
   }
   else if (path == "/send_with_contention")
   {
      auto table = Subjective{}.open<CounterTable>();
      PSIBASE_SUBJECTIVE_TX
      {
         auto row = table.get(SingletonKey{}).value_or(CounterRow{0});
         ++row.value;
         table.put(row);
         wait_for(delay);
      }
      to<HttpServer>().sendReply(*socket, reply);
   }
   return {};
}

PSIBASE_DISPATCH(AsyncQueryService)
