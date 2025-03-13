#include <optional>
#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
#include <psibase/Table.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <psibase/servePackAction.hpp>
#include <psibase/serveSchema.hpp>
#include <string>

using namespace psibase;

struct SubjectiveCounterRow
{
   std::string   key;
   std::uint32_t value;
};

PSIO_REFLECT(SubjectiveCounterRow, key, value)

using SubjectiveCounterTable = psibase::Table<SubjectiveCounterRow, &SubjectiveCounterRow::key>;
PSIO_REFLECT_TYPENAME(SubjectiveCounterTable)

struct SubjectiveCounterService : psibase::Service
{
   using Tables                  = psibase::SubjectiveTables<SubjectiveCounterTable>;
   static constexpr auto service = psibase::AccountNumber{"counter"};
   static constexpr auto serviceFlags =
       psibase::CodeRow::isSubjective | psibase::CodeRow::allowWriteSubjective;
   std::uint32_t                     inc(std::string key, std::uint32_t id);
   std::optional<psibase::HttpReply> serveSys(const psibase::HttpRequest& req);
};
PSIO_REFLECT(SubjectiveCounterService, method(inc, key, id), method(serveSys, req))
PSIBASE_REFLECT_TABLES(SubjectiveCounterService, SubjectiveCounterService::Tables)

std::uint32_t SubjectiveCounterService::inc(std::string key, std::uint32_t id)
{
   std::uint32_t result = 0;
   PSIBASE_SUBJECTIVE_TX
   {
      auto table = Tables{}.open<SubjectiveCounterTable>();
      auto row   = table.get(key);
      if (!row)
         row = SubjectiveCounterRow{key, 0};
      ++row->value;
      table.put(*row);
      result = row->value;
   }
   return result;
}

std::optional<HttpReply> SubjectiveCounterService::serveSys(const HttpRequest& req)
{
   if (req.target == "/value")
   {
      std::uint32_t value = 0;
      PSIBASE_SUBJECTIVE_TX
      {
         auto table = Tables{}.open<SubjectiveCounterTable>();
         if (auto row = table.get(std::string("")))
            value = row->value;
      }
      HttpReply           result{.contentType = "application/json"};
      psio::vector_stream stream{result.body};
      psio::to_json(value, stream);
      return result;
   }
   if (auto result = serveSchema<SubjectiveCounterService>(req))
      return result;
   return servePackAction<SubjectiveCounterService>(req);
}

PSIBASE_DISPATCH(SubjectiveCounterService)
