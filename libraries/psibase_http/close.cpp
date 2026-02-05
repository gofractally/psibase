#include "close.hpp"

#include <psibase/BlockContext.hpp>
#include <psibase/serviceEntry.hpp>
#include <psio/finally.hpp>

void psibase::http::callClose(const server_state&     server,
                              loggers::common_logger& logger,
                              AutoCloseSocket&        socket)
{
   auto          system = server.sharedState->getSystemContext();
   psio::finally f{[&]() { server.sharedState->addSystemContext(std::move(system)); }};
   if (socket.notifyClose)
   {
      BlockContext bc{*system, system->sharedDatabase.getHead(),
                      system->sharedDatabase.createWriter(), true};
      bc.start();

      SignedTransaction trx;
      TransactionTrace  trace;

      Action action{
          .sender  = AccountNumber(),
          .service = proxyServiceNum,
          .rawData = psio::convert_to_frac(std::tuple(socket.id)),
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
