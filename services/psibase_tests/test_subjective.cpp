#include <psibase/DefaultTestChain.hpp>
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
   auto subjective = t.from(SubjectiveService::service).to<SubjectiveService>();

   CHECK(subjective.write("a", "b").succeeded());
   CHECK(subjective.read("a").returnVal() == std::optional{std::string("b")});
}
