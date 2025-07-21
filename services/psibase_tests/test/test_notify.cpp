#include <catch2/catch_all.hpp>
#include <services/system/Transact.hpp>
#include <services/test/NotifyService.hpp>
#include <services/user/Nop.hpp>

#include <psibase/DefaultTestChain.hpp>

using namespace psibase;
using namespace SystemService;
using namespace TestService;
using namespace UserService;

// All callbacks are executed
// If a callback fails, it does not apply changes to the database
// If a callback fails, the remaining callbacks will still be run

TEST_CASE("notify onBlock")
{
   DefaultTestChain      t;
   static constexpr auto notify2 = AccountNumber{"notify2"};
   t.addService(NotifyService::service, "NotifyService.wasm");
   t.addService(notify2, "NotifyService.wasm");
   t.setAutoBlockStart(false);
   t.startBlock();
   for (auto service : {NotifyService::service, notify2})
   {
      t.from(Transact::service)
          .to<Transact>()
          .addCallback(CallbackType::onBlock, false,
                       Action{.service = service,
                              .method  = MethodNumber{"onBlock"},
                              .rawData = psio::to_frac(std::tuple())});
   }
   t.finishBlock();
   auto table1 = NotifyService{}.open<BlockCountTable>();
   auto fail   = NotifyService{}.open<FailTable>();
   auto table2 = NotifyService::WriteOnly{notify2}.open<BlockCountTable>();
   {
      auto row = table1.get({});
      REQUIRE(row.has_value());
      CHECK(row->count == 1);
   }
   {
      auto row = table2.get({});
      REQUIRE(row.has_value());
      CHECK(row->count == 1);
   }
   fail.put({});
   t.startBlock();
   t.finishBlock();
   {
      auto row = table1.get({});
      REQUIRE(row.has_value());
      CHECK(row->count == 1);
   }
   {
      auto row = table2.get({});
      REQUIRE(row.has_value());
      CHECK(row->count == 2);
   }
   fail.remove({});
   t.startBlock();
   t.finishBlock();
   {
      auto row = table1.get({});
      REQUIRE(row.has_value());
      CHECK(row->count == 2);
   }
   {
      auto row = table2.get({});
      REQUIRE(row.has_value());
      CHECK(row->count == 3);
   }
}

TEST_CASE("notify onTransaction")
{
   DefaultTestChain      t;
   static constexpr auto notify2 = AccountNumber{"notify2"};
   t.addService(NotifyService::service, "NotifyService.wasm");
   t.addService(notify2, "NotifyService.wasm");
   for (auto service : {NotifyService::service, notify2})
   {
      t.from(Transact::service)
          .to<Transact>()
          .addCallback(CallbackType::onTransaction, false,
                       Action{.service = service, .method = MethodNumber{"onTrx"}});
   }
   auto table1 = NotifyService{}.open<TransactionCountTable>();
   auto fail   = NotifyService{}.open<FailTable>();
   auto table2 = NotifyService::WriteOnly{notify2}.open<TransactionCountTable>();
   {
      auto row = table1.get({});
      REQUIRE(row.has_value());
      CHECK(row->count == 2);
   }
   {
      auto row = table2.get({});
      REQUIRE(row.has_value());
      CHECK(row->count == 1);
   }
   fail.put({});
   REQUIRE(t.from(Nop::service).to<Nop>().nop().succeeded());
   {
      auto row = table1.get({});
      REQUIRE(row.has_value());
      CHECK(row->count == 2);
   }
   {
      auto row = table2.get({});
      REQUIRE(row.has_value());
      CHECK(row->count == 2);
   }
   fail.remove({});
   REQUIRE(t.from(Nop::service).to<Nop>().nop().succeeded());
   {
      auto row = table1.get({});
      REQUIRE(row.has_value());
      CHECK(row->count == 3);
   }
   {
      auto row = table2.get({});
      REQUIRE(row.has_value());
      CHECK(row->count == 3);
   }
}
