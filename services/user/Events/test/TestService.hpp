#include <cstdint>
#include <psibase/AccountNumber.hpp>
#include <psibase/Service.hpp>

struct TestService : psibase::Service<TestService>
{
   static constexpr auto service = psibase::AccountNumber{"test-service"};
   void                  send(int i, double d, std::vector<int32_t> v, std::string s);
   struct Events
   {
      struct Ui
      {
      };
      struct History
      {
         void testEvent(int32_t i, double d, std::vector<int32_t> v, std::string s) {}
      };
      struct Merkle
      {
      };
   };
};
PSIO_REFLECT(TestService, method(send, i, d, v, s))

PSIBASE_REFLECT_EVENTS(TestService);
PSIBASE_REFLECT_HISTORY_EVENTS(TestService, method(testEvent, i, d, v, s));
PSIBASE_REFLECT_UI_EVENTS(TestService);
PSIBASE_REFLECT_MERKLE_EVENTS(TestService);
