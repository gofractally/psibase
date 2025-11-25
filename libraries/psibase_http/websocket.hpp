#pragma once

#include <boost/asio/dispatch.hpp>
#include <boost/beast/core/flat_buffer.hpp>
#include <deque>
#include <memory>
#include <mutex>
#include <optional>
#include <psibase/BlockContext.hpp>
#include <psibase/Socket.hpp>
#include <psibase/SystemContext.hpp>
#include <psibase/db.hpp>
#include <psibase/serviceEntry.hpp>
#include <psio/finally.hpp>
#include <span>
#include <string>
#include "server_state.hpp"

namespace psibase::http
{

   struct WebSocket;

   struct WebSocketImplBase
   {
      virtual ~WebSocketImplBase()                          = default;
      virtual void startWrite(std::shared_ptr<WebSocket>&&) = 0;
   };

   struct WebSocket : AutoCloseSocket, std::enable_shared_from_this<WebSocket>
   {
      explicit WebSocket(server_state& state) : state(state) {}
      template <typename I>
      static void setImpl(std::shared_ptr<WebSocket>&& self, std::unique_ptr<I>&& impl)
      {
         I*   ptr = impl.get();
         bool hasMessages;
         {
            std::lock_guard l{self->mutex};
            assert(!self->impl);
            self->impl  = std::move(impl);
            hasMessages = !self->outbox.empty();
         }
         if (hasMessages)
            ptr->writeLoop(std::shared_ptr{self});
         ptr->readLoop(std::move(self));
      }

      void autoClose(const std::optional<std::string>& message) noexcept override {}
      void send(Writer&, std::span<const char> data) override
      {
         std::vector<char> copy(data.begin(), data.end());
         bool              first;
         {
            std::lock_guard l{mutex};
            first = impl && outbox.empty();
            outbox.push_back(std::move(copy));
         }
         if (first)
         {
            impl->startWrite(shared_from_this());
         }
      }
      void handleMessage(std::span<const char> data)
      {
         auto system = state.sharedState->getSystemContext();

         psio::finally f{[&]() { state.sharedState->addSystemContext(std::move(system)); }};
         BlockContext  bc{*system, system->sharedDatabase.getHead(),
                         system->sharedDatabase.createWriter(), true};
         bc.start();

         SignedTransaction trx;
         TransactionTrace  trace;

         Action action{
             .sender  = AccountNumber(),
             .service = proxyServiceNum,
             .rawData = psio::convert_to_frac(std::tuple(this->id, data)),
         };

         try
         {
            auto& atrace = bc.execAsyncExport("recv", std::move(action), trace);
            BOOST_LOG_SCOPED_LOGGER_TAG(bc.trxLogger, "Trace", std::move(trace));
            PSIBASE_LOG(bc.trxLogger, debug) << action.service.str() << "::recv succeeded";
         }
         catch (std::exception& e)
         {
            BOOST_LOG_SCOPED_LOGGER_TAG(bc.trxLogger, "Trace", std::move(trace));
            PSIBASE_LOG(bc.trxLogger, warning)
                << action.service.str() << "::recv failed: " << e.what();
         }
      }
      SocketInfo                         info() const override { return WebSocketInfo{}; }
      server_state&                      state;
      std::mutex                         mutex;
      std::unique_ptr<WebSocketImplBase> impl;
      std::deque<std::vector<char>>      outbox;
      boost::beast::flat_buffer          input;
   };

   template <typename Stream>
   struct WebSocketImpl : WebSocketImplBase
   {
      explicit WebSocketImpl(Stream&& stream) : stream(std::move(stream)) {}
      ~WebSocketImpl() {}
      void startWrite(std::shared_ptr<WebSocket>&& self) override
      {
         boost::asio::dispatch(
             stream.get_executor(), [self = std::move(self)]() mutable
             { static_cast<WebSocketImpl*>(self->impl.get())->writeLoop(std::move(self)); });
      }
      void writeLoop(std::shared_ptr<WebSocket>&& self)
      {
         stream.binary(true);
         auto buffer = boost::asio::buffer(self->outbox.front());
         stream.async_write(
             buffer,
             [self = std::move(self)](const std::error_code& ec,
                                      std::size_t            bytes_transferred) mutable
             {
                bool last;
                {
                   std::lock_guard l{self->mutex};
                   if (ec)
                   {
                      self->outbox.clear();
                      // TODO: close socket
                   }
                   else
                   {
                      self->outbox.pop_front();
                   }
                   last = self->outbox.empty();
                }
                if (!last)
                {
                   static_cast<WebSocketImpl*>(self->impl.get())->writeLoop(std::move(self));
                }
             });
      }
      void readLoop(std::shared_ptr<WebSocket>&& self)
      {
         auto& input = self->input;
         stream.async_read(
             input,
             [self = std::move(self)](const std::error_code& ec, std::size_t bytes_read) mutable
             {
                if (ec)
                {
                   // TODO: close socket
                }
                else
                {
                   auto inbuffer = self->input.cdata();
                   self->handleMessage(
                       std::span{static_cast<const char*>(inbuffer.data()), inbuffer.size()});
                   self->input.consume(self->input.size());

                   static_cast<WebSocketImpl*>(self->impl.get())->readLoop(std::move(self));
                }
             });
      }
      Stream stream;
   };

}  // namespace psibase::http
