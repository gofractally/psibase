#include <optional>
#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
#include <psibase/dispatch.hpp>
#include <services/local/XHttp.hpp>
#include <services/local/XTimer.hpp>

struct DelayRow
{
   std::uint64_t id;
   std::int32_t  socket;
   PSIO_REFLECT(DelayRow, id, socket)
};
using DelayTable = psibase::Table<DelayRow, &DelayRow::id>;
PSIO_REFLECT_TYPENAME(DelayTable)

/// provides a single endpoint /wait?seconds=<int> for testing x-timer
struct XDelay : psibase::Service
{
   static constexpr auto service = psibase::AccountNumber{"x-delay"};
   using Session                 = psibase::SessionTables<DelayTable>;
   std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest        request,
                                              std::optional<std::int32_t> socket);
   void                              ready(std::uint64_t id);
};
PSIO_REFLECT(XDelay, method(serveSys, request, socket), method(ready, id))
PSIBASE_REFLECT_TABLES(XDelay, XDelay::Session)

using namespace psibase;
using namespace LocalService;

struct WaitArgs
{
   std::string seconds;
};
PSIO_REFLECT(WaitArgs, seconds)

std::optional<psibase::HttpReply> XDelay::serveSys(psibase::HttpRequest        request,
                                                   std::optional<std::int32_t> socket)
{
   auto target = request.path();
   if (target == "/wait")
   {
      auto args       = request.query<WaitArgs>();
      auto expiration = std::chrono::time_point_cast<MicroSeconds>(
          std::chrono::steady_clock::now() + psio::convert_from_json<Seconds>(args.seconds));
      auto table = open<DelayTable>();
      PSIBASE_SUBJECTIVE_TX
      {
         auto id = to<XTimer>().runAt(expiration, psibase::MethodNumber{"ready"});
         table.put({id, *socket});
         to<XHttp>().autoClose(*socket, false);
      }
   }
   return {};
}

void XDelay::ready(std::uint64_t id)
{
   auto         table = open<DelayTable>();
   std::int32_t socket;
   PSIBASE_SUBJECTIVE_TX
   {
      auto row = table.get(id).value();
      table.remove(row);
      to<XHttp>().autoClose(row.socket, true);
      socket = row.socket;
   }
   to<XHttp>().sendReply(socket, HttpReply{});
}

PSIBASE_DISPATCH(XDelay)
