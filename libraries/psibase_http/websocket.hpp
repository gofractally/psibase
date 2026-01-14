#pragma once

#include <boost/asio/dispatch.hpp>
#include <boost/beast/core/flat_buffer.hpp>
#include <boost/beast/websocket/error.hpp>
#include <boost/beast/websocket/rfc6455.hpp>
#include <deque>
#include <memory>
#include <mutex>
#include <optional>
#include <psibase/BlockContext.hpp>
#include <psibase/Socket.hpp>
#include <psibase/SystemContext.hpp>
#include <psibase/db.hpp>
#include <psibase/peer_manager.hpp>
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
      virtual void close(
          std::shared_ptr<WebSocket>&&        self,
          boost::beast::websocket::close_code code   = boost::beast::websocket::close_code::normal,
          bool                                report = false)                                 = 0;
      virtual void readLoop(std::shared_ptr<WebSocket>&& self) = 0;
   };

   struct WebSocket : AutoCloseSocket, net::connection_base, std::enable_shared_from_this<WebSocket>
   {
      enum class P2PState : std::uint8_t
      {
         off,
         reading,
         messageReady,
         running,
      };

      enum class StateType : std::uint8_t
      {
         normal,
         closing,
         error,
      };
      struct QueueItem
      {
         std::vector<char>                           data;
         std::function<void(const std::error_code&)> callback;
      };

      explicit WebSocket(server_state& server, SocketInfo&& info);
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

      void autoClose(const std::optional<std::string>& message) noexcept override
      {
         bool needClose = false;
         {
            std::lock_guard l{mutex};
            if (state == StateType::normal)
            {
               state     = StateType::closing;
               needClose = true;
            }
         }
         if (needClose)
            impl->close(shared_from_this());
      }
      void send(Writer&, std::span<const char> data) override
      {
         std::vector<char> copy(data.begin(), data.end());
         bool              first;
         {
            std::lock_guard l{mutex};
            if (state != StateType::normal)
               return;
            first = impl && outbox.empty();
            outbox.push_back({std::move(copy)});
         }
         PSIBASE_LOG(logger, debug) << "Sending message: " << data.size() << " bytes";
         if (first)
         {
            impl->startWrite(shared_from_this());
         }
      }
      void handleMessage(std::span<const char> data)
      {
         auto system = server.sharedState->getSystemContext();

         psio::finally f{[&]() { server.sharedState->addSystemContext(std::move(system)); }};
         BlockContext  bc{*system, system->sharedDatabase.getHead(),
                         system->sharedDatabase.createWriter(), true};
         bc.start();

         SignedTransaction trx;
         TransactionTrace  trace;

         Action action{
             .sender  = AccountNumber(),
             .service = proxyServiceNum,
             .rawData = psio::convert_to_frac(std::tuple(this->Socket::id, data)),
         };

         try
         {
            auto& atrace = bc.execAsyncExport("recv", std::move(action), trace);
            BOOST_LOG_SCOPED_LOGGER_TAG(logger, "Trace", std::move(trace));
            PSIBASE_LOG(logger, debug) << proxyServiceNum.str() << "::recv succeeded";
         }
         catch (std::exception& e)
         {
            BOOST_LOG_SCOPED_LOGGER_TAG(logger, "Trace", std::move(trace));
            PSIBASE_LOG(logger, warning) << proxyServiceNum.str() << "::recv failed: " << e.what();
         }
      }
      void handleClose()
      {
         auto system = server.sharedState->getSystemContext();

         psio::finally f{[&]() { server.sharedState->addSystemContext(std::move(system)); }};
         BlockContext  bc{*system, system->sharedDatabase.getHead(),
                         system->sharedDatabase.createWriter(), true};
         bc.start();

         SignedTransaction trx;
         TransactionTrace  trace;

         Action action{
             .sender  = AccountNumber(),
             .service = proxyServiceNum,
             .rawData = psio::convert_to_frac(std::tuple(this->Socket::id)),
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
      }
      void error(const std::error_code& ec)
      {
         StateType oldState;
         {
            std::lock_guard l{mutex};
            oldState = state;
            state    = StateType::error;
         }
         if (oldState != StateType::error)
         {
            if (ec == make_error_code(boost::beast::websocket::error::closed))
            {
               PSIBASE_LOG(logger, info) << ec.message();
            }
            else
            {
               PSIBASE_LOG(logger, warning) << ec.message();
            }
         }
         if (oldState == StateType::normal)
            handleClose();
      }
      void clearOutbox(std::deque<QueueItem>&& outbox, const std::error_code& ec)
      {
         for (auto& item : outbox)
         {
            if (item.callback)
               item.callback(ec);
         }
      }
      SocketInfo info() const override { return savedInfo; }

      bool supportsP2P() const override { return true; }

      void enableP2P(
          std::function<void(const std::shared_ptr<net::connection_base>&)> callback) override
      {
         {
            std::lock_guard l{mutex};
            if (p2pState != P2PState::off)
            {
               return;
            }
            p2pState = P2PState::reading;
         }
         callback(shared_from_this());
      }

      void async_write(std::vector<char>&&                         data,
                       std::function<void(const std::error_code&)> callback) override
      {
         bool        first;
         std::size_t size;
         {
            std::lock_guard l{mutex};
            first = impl && outbox.empty();
            size  = data.size();
            outbox.push_back({std::move(data), std::move(callback)});
         }
         if (first)
         {
            impl->startWrite(shared_from_this());
         }
      }

      void async_read(
          std::function<void(const std::error_code&, std::vector<char>&&)> callback) override
      {
         bool messageReady = false;
         {
            std::lock_guard l{mutex};
            assert(p2pState != P2PState::off);
            if (p2pState == P2PState::messageReady)
            {
               messageReady = true;
               p2pState     = P2PState::running;
            }
            else if (p2pState == P2PState::reading)
            {
               readCallback = std::move(callback);
               return;
            }
         }
         if (messageReady)
         {
            auto      inbuffer = input.cdata();
            std::span msg{static_cast<const char*>(inbuffer.data()), inbuffer.size()};
            callback(std::error_code{}, std::vector(msg.begin(), msg.end()));
         }
         else
         {
            readCallback = std::move(callback);
            impl->readLoop(shared_from_this());
         }
      }

      using close_code = net::connection_base::close_code;
      static auto translate_close_code(close_code code)
      {
         namespace websocket = boost::beast::websocket;
         switch (code)
         {
            case close_code::normal:
               return websocket::close_code::normal;
            case close_code::duplicate:
               return websocket::close_code::policy_error;
            case close_code::error:
               return websocket::close_code::policy_error;
            case close_code::shutdown:
               return websocket::close_code::going_away;
            case close_code::restart:
               return websocket::close_code::service_restart;
         }
         __builtin_unreachable();
      }

      void close(close_code code) override
      {
         bool needClose = false;
         {
            std::lock_guard l{mutex};
            if (state == StateType::normal)
            {
               state     = StateType::closing;
               needClose = true;
            }
         }
         if (needClose)
         {
            impl->close(shared_from_this(), translate_close_code(code), true);
         }
      }

      server_state&                      server;
      WebSocketInfo                      savedInfo;
      std::mutex                         mutex;
      std::unique_ptr<WebSocketImplBase> impl;
      std::deque<QueueItem>              outbox;
      boost::beast::flat_buffer          input;
      psibase::loggers::common_logger    logger;
      StateType                          state    = StateType::normal;
      P2PState                           p2pState = P2PState::off;
      //
      std::function<void(const std::error_code&, std::vector<char>&&)> readCallback;
   };

   template <typename Stream>
   struct WebSocketImpl final : WebSocketImplBase
   {
      explicit WebSocketImpl(Stream&& stream) : stream(std::move(stream)) {}
      ~WebSocketImpl() {}
      void startWrite(std::shared_ptr<WebSocket>&& self) override
      {
         boost::asio::dispatch(
             stream.get_executor(), [self = std::move(self)]() mutable
             { static_cast<WebSocketImpl*>(self->impl.get())->writeLoop(std::move(self)); });
      }
      void close(std::shared_ptr<WebSocket>&&        self,
                 boost::beast::websocket::close_code code,
                 bool                                report) override
      {
         PSIBASE_LOG(self->logger, debug) << "closing websocket";
         boost::asio::dispatch(
             stream.get_executor(),
             [self = std::move(self), code, report]() mutable
             {
                {
                   std::lock_guard l{self->mutex};
                   if (self->state != WebSocket::StateType::closing)
                      return;
                }
                if (report)
                   self->handleClose();
                auto ptr = static_cast<WebSocketImpl*>(self->impl.get());
                ptr->stream.async_close(
                    code,
                    [self = std::move(self)](const std::error_code& ec)
                    {
                       if (ec)
                          self->error(ec);
                       else
                          self->error(make_error_code(boost::beast::websocket::error::closed));
                    });
             });
      }
      void writeLoop(std::shared_ptr<WebSocket>&& self)
      {
         const std::vector<char>* data;
         {
            std::unique_lock l{self->mutex};
            if (self->state != WebSocket::StateType::normal)
            {
               auto outbox = std::move(self->outbox);
               l.unlock();
               self->clearOutbox(std::move(outbox),
                                 make_error_code(boost::beast::websocket::error::closed));
               return;
            }
            else
            {
               data = &self->outbox.front().data;
            }
         }
         stream.binary(true);
         auto buffer = boost::asio::buffer(*data);
         stream.async_write(
             buffer,
             [self = std::move(self)](const std::error_code& ec,
                                      std::size_t            bytes_transferred) mutable
             {
                bool                                        last;
                std::function<void(const std::error_code&)> callback;
                {
                   std::unique_lock l{self->mutex};
                   if (ec)
                   {
                      if (ec != make_error_code(boost::asio::error::operation_aborted))
                      {
                         // FIXME: recursive lock
                         self->error(ec);
                      }
                      auto outbox = std::move(self->outbox);
                      l.unlock();
                      self->clearOutbox(std::move(outbox), ec);
                      return;
                   }
                   else
                   {
                      callback = std::move(self->outbox.front().callback);
                      self->outbox.pop_front();
                   }
                   last = self->outbox.empty();
                }
                if (callback)
                {
                   callback(ec);
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
                   if (ec != make_error_code(boost::asio::error::operation_aborted))
                   {
                      self->error(ec);
                   }
                }
                else
                {
                   auto inbuffer = self->input.cdata();
                   auto msg = std::span{static_cast<const char*>(inbuffer.data()), inbuffer.size()};
                   if (!msg.empty() && static_cast<unsigned char>(msg[0]) < 64)
                   {
                      std::unique_lock l{self->mutex};
                      using P2PState = WebSocket::P2PState;
                      if (self->readCallback)
                      {
                         l.unlock();
                         auto readCallback  = std::move(self->readCallback);
                         self->readCallback = nullptr;
                         self->p2pState     = P2PState::running;
                         readCallback(std::error_code{}, std::vector(msg.begin(), msg.end()));
                         self->input.consume(self->input.size());
                         return;
                      }
                      else if (self->p2pState == P2PState::reading)
                      {
                         self->p2pState == P2PState::messageReady;
                         return;
                      }
                   }
                   self->handleMessage(msg);
                   self->input.consume(self->input.size());

                   static_cast<WebSocketImpl*>(self->impl.get())->readLoop(std::move(self));
                }
             });
      }
      Stream stream;
   };

}  // namespace psibase::http
