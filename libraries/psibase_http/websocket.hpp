#pragma once

#include <boost/asio/dispatch.hpp>
#include <boost/asio/post.hpp>
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
#include <psibase/serviceEntry.hpp>
#include <psio/finally.hpp>
#include <span>
#include <string>
#include "close.hpp"
#include "server_state.hpp"

namespace psibase::http
{

   struct WebSocket;

   struct WebSocketImplBase
   {
      virtual ~WebSocketImplBase()                                          = default;
      virtual void startWrite(std::shared_ptr<WebSocket>&&)                 = 0;
      virtual void close(std::shared_ptr<WebSocket>&& self)                 = 0;
      virtual void onLock(CloseLock&& l, std::shared_ptr<WebSocket>&& self) = 0;
   };

   struct WebSocket : AutoCloseSocket, std::enable_shared_from_this<WebSocket>
   {
      explicit WebSocket(server_state& server, SocketInfo&& info);
      template <typename I>
      static void setImpl(CloseLock&                   cl,
                          std::shared_ptr<WebSocket>&& self,
                          std::unique_ptr<I>&&         impl)
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

      void onClose(const std::optional<std::string>& message) noexcept override
      {
         impl->close(shared_from_this());
      }
      void onLock(CloseLock&& l) override { impl->onLock(std::move(l), shared_from_this()); }
      void send(Writer&, std::span<const char> data) override
      {
         std::vector<char> copy(data.begin(), data.end());
         bool              first;
         {
            std::lock_guard l{mutex};
            if (state != StateType::normal)
               return;
            first = impl && outbox.empty();
            outbox.push_back(std::move(copy));
         }
         PSIBASE_LOG(logger, debug) << "Sending message: " << data.size() << " bytes";
         if (first)
         {
            impl->startWrite(shared_from_this());
         }
      }
      void handleMessage(CloseLock&& l);
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
            server.sharedState->sockets()->asyncClose(*this);
      }
      SocketInfo info() const override { return savedInfo; }
      enum class StateType : std::uint8_t
      {
         normal,
         closing,
         error,
      };
      server_state&                      server;
      WebSocketInfo                      savedInfo;
      std::mutex                         mutex;
      std::unique_ptr<WebSocketImplBase> impl;
      std::deque<std::vector<char>>      outbox;
      boost::beast::flat_buffer          input;
      psibase::loggers::common_logger    logger;
      StateType                          state = StateType::normal;
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
      void close(std::shared_ptr<WebSocket>&& self) override
      {
         PSIBASE_LOG(self->logger, debug) << "closing websocket";
         boost::asio::post(
             stream.get_executor(),
             [self = std::move(self)]() mutable
             {
                callClose(self->server, self->logger, *self);
                {
                   std::lock_guard l{self->mutex};
                   if (self->state != WebSocket::StateType::normal)
                      return;
                   self->state = WebSocket::StateType::closing;
                }
                auto ptr = static_cast<WebSocketImpl*>(self->impl.get());
                ptr->stream.async_close(
                    boost::beast::websocket::close_code::normal,
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
            std::lock_guard l{self->mutex};
            if (self->state != WebSocket::StateType::normal)
            {
               self->outbox.clear();
               return;
            }
            else
            {
               data = &self->outbox.front();
            }
         }
         stream.binary(true);
         auto buffer = boost::asio::buffer(*data);
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
                      if (ec != make_error_code(boost::asio::error::operation_aborted))
                      {
                         self->error(ec);
                      }
                      self->outbox.clear();
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
                   if (ec != make_error_code(boost::asio::error::operation_aborted))
                   {
                      self->error(ec);
                   }
                }
                else
                {
                   if (auto l = self->server.sharedState->sockets()->lockRecv(self))
                   {
                      self->handleMessage(std::move(l));
                      static_cast<WebSocketImpl*>(self->impl.get())->readLoop(std::move(self));
                   }
                }
             });
      }
      void onLock(CloseLock&& l, std::shared_ptr<WebSocket>&& self) override
      {
         boost::asio::post(
             stream.get_executor(),
             [l = std::move(l), self = std::move(self)]() mutable
             {
                self->handleMessage(std::move(l));
                static_cast<WebSocketImpl*>(self->impl.get())->readLoop(std::move(self));
             });
      }
      Stream stream;
   };

}  // namespace psibase::http
