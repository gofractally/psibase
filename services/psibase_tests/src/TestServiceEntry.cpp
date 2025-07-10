#include <services/test/TestServiceEntry.hpp>

using namespace psibase;
using namespace TestService;

struct payload
{
   int         number;
   std::string memo;
};
PSIO_REFLECT(payload, number, memo)

int ctors_called = 0;
int start_called = 0;
int call_called  = 0;

struct startup
{
   startup() { ++ctors_called; }
};
startup s;

extern "C" void __wasm_call_ctors();
extern "C" void start(AccountNumber this_service)
{
   __wasm_call_ctors();
   check(this_service == TestServiceEntry::service,
         std::format("{} != {}", this_service.str(), TestServiceEntry::service.str()));
   ++start_called;
   auto counter = TestServiceEntry{}.open<CallCounterTable>();
   auto row     = counter.get(CallCounterRow::start)
                  .value_or(CallCounterRow{.id = CallCounterRow::start, .count = 0});
   ++row.count;
   counter.put(row);
}

extern "C" void called(AccountNumber this_service, AccountNumber sender)
{
   auto act = getCurrentAction();
   auto pl  = psio::from_frac_strict<payload>(act.rawData);
   check(ctors_called == 1, "ctors != 1");
   check(start_called == 1, "start != 1");
   check(this_service == TestServiceEntry::service, "called: this_service = " + this_service.str());
   check(sender == TestServiceEntry::service, "called: sender = " + sender.str());
   check(act.sender == TestServiceEntry::service, "called: act.sender = " + act.sender.str());
   check(act.service == TestServiceEntry::service, "called: act.service = " + act.service.str());
   check(act.method == MethodNumber{"call"}, "called: act.method = " + act.method.str());
   check(pl.memo == "Counting down", "memo: " + pl.memo);
   {
      auto counter = TestServiceEntry{}.open<CallCounterTable>();
      auto row     = counter.get(CallCounterRow::called)
                     .value_or(CallCounterRow{.id = CallCounterRow::called, .count = 0});
      int depth = 3 - pl.number;
      check(call_called == depth,
            std::format("call_called != depth ({} != {})", call_called, depth));
      check(row.count == call_called,
            std::format("row.count != call_called ({} != {})", row.count, call_called));
      ++call_called;
      ++row.count;
      counter.put(row);
   }
   if (pl.number)
   {
      auto r = psio::from_frac<int>(call({
          .sender  = this_service,
          .service = this_service,
          .method  = act.method,
          .rawData = psio::convert_to_frac(payload{
              .number = pl.number - 1,
              .memo   = pl.memo,
          }),
      }));
      check(r == pl.number - 1, std::format("{} != {}", r, pl.number - 1));
   }
   setRetval(pl.number);
}
