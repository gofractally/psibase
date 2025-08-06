#include <optional>
#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/servePackAction.hpp>
#include <string>

using namespace psibase;

struct CounterRow
{
   std::string   key;
   std::uint32_t value;
};

PSIO_REFLECT(CounterRow, key, value)

using CounterTable = psibase::Table<CounterRow, &CounterRow::key>;
PSIO_REFLECT_TYPENAME(CounterTable)

struct CounterService : psibase::Service
{
   using Tables                              = psibase::ServiceTables<CounterTable>;
   static constexpr auto             service = psibase::AccountNumber{"counter"};
   std::uint32_t                     inc(std::string key, std::uint32_t id);
   std::optional<psibase::HttpReply> serveSys(const psibase::HttpRequest& req);
};
PSIO_REFLECT(CounterService, method(inc, key, id), method(serveSys, req))
PSIBASE_REFLECT_TABLES(CounterService, CounterService::Tables)

std::uint32_t CounterService::inc(std::string key, std::uint32_t id)
{
   auto table = Tables{}.open<CounterTable>();
   auto row   = table.get(std::string(key));
   if (!row)
      row.emplace();
   ++row->value;
   table.put(*row);
   return row->value;
}

std::optional<HttpReply> CounterService::serveSys(const HttpRequest& req)
{
   return servePackAction<CounterService>(req);
}

PSIBASE_DISPATCH(CounterService)
