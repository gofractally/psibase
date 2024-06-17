
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

struct ParallelSubjectiveService : psibase::Service<ParallelSubjectiveService>
{
   using Tables                  = psibase::SubjectiveTables<ParallelSubjectiveTable>;
   static constexpr auto service = psibase::AccountNumber{"psubjective"};
   static constexpr auto serviceFlags =
       psibase::CodeRow::isSubjective | psibase::CodeRow::allowWriteSubjective;
   std::optional<psibase::HttpReply> serveSys(const psibase::HttpRequest& req);
};
PSIO_REFLECT(ParallelSubjectiveService, method(serveSys, req))

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
      HttpReply           response{.contentType = "application/json"};
      psio::vector_stream stream{response.body};
      psio::to_json(data, stream);
      return response;
   }
   return {};
}

PSIBASE_DISPATCH(ParallelSubjectiveService)
