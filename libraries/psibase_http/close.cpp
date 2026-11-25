#include "close.hpp"

#include <psibase/BlockContext.hpp>
#include <psibase/UsageMeter.hpp>
#include <psibase/serviceEntry.hpp>
#include <psibase/finally.hpp>

void psibase::http::callClose(const server_state&     server,
                              loggers::common_logger& logger,
                              AutoCloseSocket&        socket)
{
   auto          system = server.sharedState->getSystemContext();
   psibase::finally f{[&]() { server.sharedState->addSystemContext(std::move(system)); }};
   if (socket.notifyClose)
   {
      // Usage metering: the wall clock of the close handler
      auto             usageRecord = socket.usage();
      auto             usageStart  = std::chrono::steady_clock::now();
      psibase::finally chargeUsage{
          [&]
          {
             if (usageRecord)
                usageRecord->add(UsageField::requestNs,
                                 std::chrono::steady_clock::now() - usageStart);
          }};
      BlockContext bc{*system, system->sharedDatabase.getHead(),
                      system->sharedDatabase.createWriter(), true};
      bc.start();

      SignedTransaction trx;
      TransactionTrace  trace;

      Action action{
          .sender  = AccountNumber(),
          .service = proxyServiceNum,
          .rawData = psio::to_pssz(std::tuple(socket.id)),
      };

      try
      {
         auto& atrace = bc.execAsyncExport("close", std::move(action), trace);
         BOOST_LOG_SCOPED_LOGGER_TAG(logger, "Trace", std::move(trace));
         PSIBASE_LOG(logger, debug) << proxyServiceNum.str() << "::close succeeded";
      }
      catch (std::exception& e)
      {
         BOOST_LOG_SCOPED_LOGGER_TAG(logger, "Trace", std::move(trace));
         PSIBASE_LOG(logger, warning) << proxyServiceNum.str() << "::close failed: " << e.what();
      }

      socket.remove(*bc.writer);
   }
   else
   {
      socket.remove(*system->sharedDatabase.createWriter());
   }
}
