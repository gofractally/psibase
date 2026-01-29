#include "websocket.hpp"

#include <psibase/TransactionContext.hpp>

using namespace psibase;
using namespace psibase::http;

namespace
{
   WebSocketInfo toWebSocketInfo(auto&& info)
   {
      abortMessage("Socket cannot be upgraded to a websocket");
   }
   WebSocketInfo toWebSocketInfo(HttpClientSocketInfo&& info)
   {
      return WebSocketInfo{std::move(info.endpoint), std::move(info.tls)};
   }
   WebSocketInfo toWebSocketInfo(HttpSocketInfo&& info)
   {
      return WebSocketInfo{std::move(info.endpoint), std::move(info.tls)};
   }
   WebSocketInfo toWebSocketInfo(SocketInfo&& info)
   {
      return std::visit([](auto&& info) { return toWebSocketInfo(std::move(info)); },
                        std::move(info));
   }
}  // namespace

WebSocket::WebSocket(server_state& server, SocketInfo&& info)
    : server(server), savedInfo(toWebSocketInfo(std::move(info)))
{
   logger.add_attribute("Channel", boost::log::attributes::constant(std::string("http")));
   if (savedInfo.endpoint)
   {
      logger.add_attribute("RemoteEndpoint", boost::log::attributes::constant<std::string>(
                                                 to_string(*savedInfo.endpoint)));
   }
}

void WebSocket::handleMessage(CloseLock&& l)
{
   auto inbuffer    = input.cdata();
   auto data        = std::span{static_cast<const char*>(inbuffer.data()), inbuffer.size()};
   auto clearBuffer = psio::finally{[this] { input.consume(input.size()); }};

   auto system = server.sharedState->getSystemContext();

   psio::finally f{[&]() { server.sharedState->addSystemContext(std::move(system)); }};
   BlockContext bc{*system, system->sharedDatabase.getHead(), system->sharedDatabase.createWriter(),
                   true};
   bc.start();

   SignedTransaction trx;
   TransactionTrace  trace;

   TransactionContext tc{bc, trx, trace, DbMode::rpc()};

   system->sockets->setOwner(std::move(l), &tc.ownedSockets);

   Action action{
       .sender  = AccountNumber(),
       .service = proxyServiceNum,
       .rawData = psio::convert_to_frac(std::tuple(this->id, data)),
   };

   try
   {
      auto& atrace = trace.actionTraces.emplace_back();
      tc.execExport("recv", std::move(action), atrace);
      BOOST_LOG_SCOPED_LOGGER_TAG(logger, "Trace", std::move(trace));
      PSIBASE_LOG(logger, debug) << proxyServiceNum.str() << "::recv succeeded";
   }
   catch (std::exception& e)
   {
      BOOST_LOG_SCOPED_LOGGER_TAG(logger, "Trace", std::move(trace));
      PSIBASE_LOG(logger, warning) << proxyServiceNum.str() << "::recv failed: " << e.what();
   }
}
