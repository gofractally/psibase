#include <services/test/SubjectiveCounterService.hpp>

#include <psibase/dispatch.hpp>
#include <psibase/servePackAction.hpp>

using namespace psibase;
using namespace TestService;

std::uint32_t SubjectiveCounterService::inc(std::string key, std::uint32_t id)
{
   return to<SubjectiveCounterService>().withFlags(CallFlags::runModeRpc).incImpl(key, id);
}

void SubjectiveCounterService::checkIncRpc(std::string   key,
                                           std::uint32_t id,
                                           std::uint32_t expected)
{
   auto result = to<SubjectiveCounterService>().withFlags(CallFlags::runModeRpc).incImpl(key, id);
   check(result == expected, std::format("{} != {}", result, expected));
}

void SubjectiveCounterService::checkIncCallback(std::string   key,
                                                std::uint32_t id,
                                                std::uint32_t expected)
{
   auto result =
       to<SubjectiveCounterService>().withFlags(CallFlags::runModeCallback).incImpl(key, id);
   check(result == expected, std::format("{} != {}", result, expected));
}

std::uint32_t SubjectiveCounterService::incImpl(std::string key, std::uint32_t id)
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
      HttpReply           result{.contentType = "application/json", .headers = allowCors()};
      psio::vector_stream stream{result.body};
      psio::to_json(value, stream);
      return result;
   }
   return servePackAction<SubjectiveCounterService>(req);
}

PSIBASE_DISPATCH(SubjectiveCounterService)
