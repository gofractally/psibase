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
#include <psibase/peer_manager.hpp>
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
      virtual void startRead(std::shared_ptr<WebSocket>&&)                  = 0;
      virtual void close(std::shared_ptr<WebSocket>&&        self,
                         boost::beast::websocket::close_code code =
                             boost::beast::websocket::close_code::normal)   = 0;
      virtual void onLock(CloseLock&& l, std::shared_ptr<WebSocket>&& self) = 0;
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
            outbox.push_back({std::move(copy)});
         }
         PSIBASE_LOG(logger, debug) << "Sending message: " << data.size() << " bytes";
         if (first)
         {
            impl->startWrite(shared_from_this());
         }
      }
      void handleMessage(CloseLock&& l);
      bool handleP2P();
      void error(const std::error_code& ec)
      {
         StateType oldState;
         {
            std::unique_lock l{mutex};
            oldState = state;
            state    = StateType::error;
            if (readCallback)
            {
               l.unlock();
               auto readCallback  = std::move(this->readCallback);
               this->readCallback = nullptr;
               readCallback(ec, std::vector<char>());
            }
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
         channel.set("p2p");
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
            impl->startRead(shared_from_this());
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
            // TODO: propagate code
            server.sharedState->sockets()->asyncClose(*this);
         }
      }

      using ChannelAttr = boost::log::attributes::mutable_constant<std::string>;

      ChannelAttr                        channel;
      server_state&                      server;
      WebSocketInfo                      savedInfo;
      std::mutex                         mutex;
      std::unique_ptr<WebSocketImplBase> impl;
      std::deque<QueueItem>              outbox;
      boost::beast::flat_buffer          input;
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
      void startRead(std::shared_ptr<WebSocket>&& self) override
      {
         boost::asio::dispatch(
             stream.get_executor(), [self = std::move(self)]() mutable
             { static_cast<WebSocketImpl*>(self->impl.get())->readLoop(std::move(self)); });
      }
      void close(std::shared_ptr<WebSocket>&&        self,
                 boost::beast::websocket::close_code code) override
      {
         PSIBASE_LOG(self->logger, debug) << "closing websocket";
         boost::asio::post(
             stream.get_executor(),
             [self = std::move(self), code]() mutable
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
                   self->error(ec);
                }
                else
                {
                   if (self->handleP2P())
                      return;
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
                if (self->handleP2P())
                   return;
                self->handleMessage(std::move(l));
                static_cast<WebSocketImpl*>(self->impl.get())->readLoop(std::move(self));
             });
      }
      Stream stream;
   };

}  // namespace psibase::http
