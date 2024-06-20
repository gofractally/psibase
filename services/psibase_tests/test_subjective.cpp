#include <psibase/DefaultTestChain.hpp>
#include <services/system/HttpServer.hpp>
#include <services/system/SetCode.hpp>
#include "subjective-service.hpp"

using namespace psibase;
using namespace psio;
using namespace SystemService;

template <typename T>
struct Catch::StringMaker<std::optional<T>>
{
   static std::string convert(const std::optional<T>& value)
   {
      if (value)
      {
         return Catch::StringMaker<T>::convert(*value);
      }
      else
      {
         return "nullopt";
      }
   }
};

TEST_CASE("subjective db")
{
   DefaultTestChain t;
   t.addService(SubjectiveService::service, "subjective-service.wasm");
   t.from(SetCode::service)
       .to<SetCode>()
       .setFlags(SubjectiveService::service, SubjectiveService::serviceFlags);
   t.from(SubjectiveService::service).to<HttpServer>().registerServer(SubjectiveService::service);
   auto subjective = t.from(SubjectiveService::service).to<SubjectiveService>();

   CHECK(subjective.write("a", "b").succeeded());
   CHECK(subjective.read("a").returnVal() == std::optional{std::string("b")});

   for (int i = 0; i < 3; ++i)
   {
      subjective.abort("a", "WRONG", i);
      CHECK(subjective.read("a").returnVal() == std::optional{std::string("b")});
   }

   for (bool b : {false, true})
   {
      for (int i = 0; i < 4; ++i)
      {
         CHECK(subjective.testRFail1("a", b, i).failed(
             "subjectiveCheckout is required to access the subjective database"));
      }
   }
   for (int i = 0; i < 4; ++i)
   {
      CHECK(subjective.testRFail2(AccountNumber{"alice"}, "a", i)
                .failed("key prefix must match service"));
   }
   CHECK(subjective.testWFail1("a", "b").failed(
       "subjectiveCheckout is required to access the subjective database"));

   t.post(SubjectiveService::service, "/write", SubjectiveRow{"c", "d"});
   CHECK(t.post<std::optional<std::string>>(SubjectiveService::service, "/read", "c") ==
         std::optional{std::string("d")});
}
