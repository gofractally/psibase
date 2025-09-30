
#include <optional>
#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <string>

using namespace psibase;

struct ParallelSubjectiveRow
{
   std::string   key;
   std::uint32_t value;
};
PSIO_REFLECT(ParallelSubjectiveRow, key, value)

using ParallelSubjectiveTable = psibase::Table<ParallelSubjectiveRow, &ParallelSubjectiveRow::key>;
PSIO_REFLECT_TYPENAME(ParallelSubjectiveTable)

struct GeRow
{
   std::uint32_t key;
};
PSIO_REFLECT(GeRow, key)

using GeTable = Table<GeRow, &GeRow::key>;
PSIO_REFLECT_TYPENAME(GeTable)

struct ParallelSubjectiveService : psibase::Service
{
   using Tables = psibase::SubjectiveTables<ParallelSubjectiveTable, GeTable>;
   static constexpr auto             service      = psibase::AccountNumber{"psubjective"};
   static constexpr auto             serviceFlags = psibase::CodeRow::isPrivileged;
   std::optional<psibase::HttpReply> serveSys(const psibase::HttpRequest& req);
};
PSIO_REFLECT(ParallelSubjectiveService, method(serveSys, req))
PSIBASE_REFLECT_TABLES(ParallelSubjectiveService, ParallelSubjectiveService::Tables)

volatile int dummy;

void spin()
{
   for (int i = 0; i < 10000; ++i)
   {
      dummy = dummy + 1;
   }
}

struct IncResponse
{
   std::uint32_t attempts = 0;
   std::uint32_t value    = 0;
};
PSIO_REFLECT(IncResponse, attempts, value)

template <typename T>
T convert_from_json(const std::vector<char>& data)
{
   return psio::convert_from_json<T>(std::string(data.data(), data.size()));
}

template <typename T>
HttpReply json_reply(const T& body)
{
   HttpReply           response{.contentType = "application/json", .headers = allowCors()};
   psio::vector_stream stream{response.body};
   psio::to_json(body, stream);
   return response;
}

std::optional<HttpReply> ParallelSubjectiveService::serveSys(const HttpRequest& req)
{
   if (req.target == "/inc")
   {
      IncResponse data;
      PSIBASE_SUBJECTIVE_TX
      {
         auto table = Tables{}.open<ParallelSubjectiveTable>();
         auto row   = table.get(std::string(""));
         if (!row)
            row.emplace();
         spin();
         data.value = ++row->value;
         table.put(*row);
         ++data.attempts;
      }
      return json_reply(data);
   }
   else if (req.target == "/ge")
   {
      GeRow row;
      PSIBASE_SUBJECTIVE_TX
      {
         auto table = Tables{}.open<GeTable>();
         auto index = table.getIndex<0>();
         auto pos   = index.begin();
         row        = (pos != index.end()) ? *pos : GeRow{};
         --row.key;
         table.put(row);
      }
      return json_reply(row);
   }
   return {};
}

PSIBASE_DISPATCH(ParallelSubjectiveService)
