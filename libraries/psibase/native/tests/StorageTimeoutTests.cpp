#include <psibase/TransactionContext.hpp>
#include <psibase/serviceEntry.hpp>

#include <cstring>
#include <iostream>
#include <stdexcept>
#include "storage/timeout-service.hpp"

using namespace psibase;
using namespace std::chrono_literals;

namespace
{
   void require(bool condition, const char* message)
   {
      if (!condition)
         throw std::runtime_error(message);
   }
   struct Fixture
   {
      SharedDatabase    database{{},
                                 {1 << 26, 1 << 26, 1 << 26, 1 << 26},
                                 psibase::storage::open_mode::temporary};
      SystemContext     system{database,
                               WasmCache{4},
                               {},
                               std::make_shared<WatchdogManager>(),
                               std::make_shared<Sockets>(database)};
      BlockContext      block{system, database.getHead(), database.createWriter(), true};
      AccountNumber     service{"db-timeout"};
      SignedTransaction signedTransaction;
      TransactionTrace  trace;

      Fixture()
      {
         ExecutionContext::registerHostFunctions();
         CodeRow row{.codeNum = service, .flags = CodeRow::isPrivileged};
         block.db.kvPut(row.db, row.key(), row);
         setCode(block.db, service, 0, 0,
                 std::span<const char>(reinterpret_cast<const char*>(timeoutService),
                                    sizeof(timeoutService)));
         // The guest traverses real populated storage rather than timing a
         // mocked host import or an empty tree.
         for (std::uint32_t key = 0; key < 1024; ++key)
         {
            const std::string value(128, char(key));
            block.db.kvPutRaw(DbId::service, {reinterpret_cast<const char*>(&key), sizeof(key)},
                              {value.data(), value.size()});
         }
         Transaction trx;
         trx.claims.push_back({.service = service});
         signedTransaction = {psio::shared_pssz<Transaction>{trx}, {{'p'}}};
      }
      Action action() const { return {.service = service}; }
      void   fresh()
      {
         TransactionContext next{block, signedTransaction, trace, DbMode::transaction()};
         ActionTrace        result;
         next.execExport("value", action(), result);
         require(result.rawRetval == std::vector<char>({42, 0, 0, 0}),
                 "fresh transaction failed after timeout");
      }
   };
   template <class F>
   void timeout(F&& f)
   {
      try
      {
         f();
      }
      catch (const TimeoutException& e)
      {
         require(std::string_view(e.what()) == "transaction timed out", "timeout text changed");
         return;
      }
      throw std::runtime_error("execution did not report TimeoutException");
   }
}  // namespace

int main()
{
   try
   {
      Fixture  fixture;
      unsigned boundaries = 0;
      for (unsigned entry = 0; entry < 8; ++entry)
      {
         TransactionContext transaction{fixture.block, fixture.signedTransaction, fixture.trace,
                                        DbMode::transaction()};
         // Entering a scope checks the budget, so exhaust it only once inside:
         // the first storage call made by the entry point is what must fail.
         bool               exhausted = false;
         auto               request =
             std::make_shared<accounting::Request>([&] { return !exhausted; },
                                                   std::chrono::microseconds{0});
         accounting::Scope  outer(request);
         exhausted = true;
         ActionTrace        result;
         timeout(
             [&]
             {
                switch (entry)
                {
                   case 0:
                      transaction.execTransaction();
                      break;
                   case 1:
                      transaction.execVerifyProof(0);
                      break;
                   case 2:
                      transaction.execVerifyProof({}, {.service = fixture.service}, {'p'});
                      break;
                   case 3:
                      transaction.execNonTrxAction(0, fixture.action(), result);
                      break;
                   case 4:
                      transaction.execCalledAction(0, fixture.action(), result);
                      break;
                   case 5:
                      transaction.execCalledAction(0, fixture.action(), result, CallFlags::none);
                      break;
                   case 6:
                      transaction.execServe(fixture.action(), result);
                      break;
                   case 7:
                      transaction.execExport("value", fixture.action(), result);
                      break;
                }
             });
         ++boundaries;
      }
      fixture.fresh();
      {
         TransactionContext transaction{fixture.block, fixture.signedTransaction, fixture.trace,
                                        DbMode::transaction()};
         // Deterministically win the race with the asynchronous watchdog:
         // reject a synchronous accounting check inside the DB-heavy guest.
         unsigned checks  = 0;
         // Evaluated at every check, so the count is exact.
         auto     request = std::make_shared<accounting::Request>(
             [&] { return ++checks < 500; }, std::chrono::microseconds{0});
         accounting::Scope outer(request);
         ActionTrace       result;
         timeout([&] { transaction.execExport("heavy", fixture.action(), result); });
         require(checks == 500, "synchronous storage cancellation was not exercised");
         require(result.rawRetval == std::vector<char>({42, 0, 0, 0}),
                 "synchronous cancellation occurred before the guest started");
         require(result.error == "transaction timed out", "storage timeout trace differs");
      }
      fixture.fresh();
      for (const char* function : {"heavy", "spin"})
      {
         {
            TransactionContext transaction{fixture.block, fixture.signedTransaction, fixture.trace,
                                           DbMode::transaction()};
            transaction.setWatchdog(5ms);
            ActionTrace result;
            timeout([&] { transaction.execExport(function, fixture.action(), result); });
            require(result.error == "transaction timed out", "VM timeout trace differs");
         }
         fixture.fresh();
      }
      std::cout << "{\"passed\":true,\"execution_boundaries\":" << boundaries
                << ",\"synchronous_db_cancellations\":1,\"real_budget_guests\":2,"
                   "\"fresh_transactions\":4}\n";
   }
   catch (const std::exception& error)
   {
      std::cerr << error.what() << '\n';
      return 1;
   }
}
