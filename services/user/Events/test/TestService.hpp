#include <cstdint>
#include <psibase/AccountNumber.hpp>
#include <psibase/Service.hpp>

struct TestService : psibase::Service
{
   static constexpr auto service = psibase::AccountNumber{"test-service"};
   //
   void send(int i, double d, std::vector<int32_t> v, std::string s);
   void sendOptional(std::optional<std::int32_t> opt);
   void sendOptional8(std::optional<std::uint8_t> opt);
   void sendString(const std::string& s);
   void sendAccount(psibase::AccountNumber account);
   struct Events
   {
      struct Ui
      {
      };
      struct History
      {
         void testEvent(int32_t i, double d, std::vector<int32_t> v, std::string s) {}
         void opt(std::optional<std::int32_t> opt);
         void optb(std::optional<std::uint8_t> opt);
         void str(std::string s);
         void account(psibase::AccountNumber a);
      };
      struct Merkle
      {
      };
   };
};
PSIO_REFLECT(TestService,
             method(send, i, d, v, s),
             method(sendOptional, opt),
             method(sendOptional8, opt),
             method(sendString, s),
             method(sendAccount, a))

PSIBASE_REFLECT_EVENTS(TestService);
PSIBASE_REFLECT_HISTORY_EVENTS(TestService,
                               method(testEvent, i, d, v, s),
                               method(opt, opt),
                               method(optb, opt),
                               method(str, s),
                               method(account, a));
PSIBASE_REFLECT_UI_EVENTS(TestService);
PSIBASE_REFLECT_MERKLE_EVENTS(TestService);
