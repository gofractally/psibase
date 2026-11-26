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
#include <psibase/UsageMeter.hpp>
#include <psibase/WebSocket.hpp>
#include <psibase/db.hpp>
#include <psibase/peer_manager.hpp>
#include <psibase/serviceEntry.hpp>
#include <psibase/finally.hpp>
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
         // Close requested while messages were still queued: no new messages
         // are accepted, the queued ones are written, then the close starts.
         draining,
         closing,
         error,
      };
      struct QueueItem
      {
         std::vector<char>                           data;
         std::function<void(const std::error_code&)> callback;
         bool                                        binary = true;
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
         self->server.register_connection(self);
         if (hasMessages)
            ptr->writeLoop(std::shared_ptr{self});
         ptr->readLoop(std::move(self));
      }

      void onClose(const std::optional<std::string>& message) noexcept override
      {
         impl->close(shared_from_this());
      }
      void onLock(CloseLock&& l) override { impl->onLock(std::move(l), shared_from_this()); }
      void send(Writer&, std::span<const char> data, std::uint32_t flags) override
      {
         if (flags != WebSocketFlags::binary && flags != WebSocketFlags::text)
            abortMessage("Invalid websocket flags: " + std::to_string(flags));
         std::vector<char> copy(data.begin(), data.end());
         bool              first;
         {
            std::lock_guard l{mutex};
            if (state != StateType::normal)
               return;
            first = impl && outbox.empty();
            outbox.push_back({.data = std::move(copy), .binary = flags == WebSocketFlags::binary});
         }
         PSIBASE_LOG(logger, debug) << "Sending message: " << data.size() << " bytes";
         if (first)
         {
            impl->startWrite(shared_from_this());
         }
      }
      void handleMessage(CloseLock&& l, bool binary);
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
            if (ec == make_error_code(boost::beast::websocket::error::closed) ||
                ec == make_error_code(boost::asio::error::eof))
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
         // Usage metering: from here on this is a peer connection, and
         // everything it carries is charged to the peer, by the address of
         // the connection, for as long as the connection lives. That holds
         // even if the peer logged in with an account: in this phase usage
         // is tracked by peer and by account, and a peer is a peer. What the
         // connection cost before this point (the HTTP request that asked
         // for the upgrade) stays where it was charged: the account of the
         // login token, or the address. Connections this node opened get
         // their record here too; they have none until now.
         if (auto meter = server.sharedState->usage(); meter->enabled())
            setUsage(meter->find(UsageIdentity::peer(savedInfo.endpoint)));
         callback(shared_from_this());
      }
      std::shared_ptr<UsageRecord> usageRecord() const override { return usage(); }

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
            auto      data = std::vector(msg.begin(), msg.end());
            input.consume(input.size());
            callback(std::error_code{}, std::move(data));
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
               needClose = true;
            }
         }
         if (needClose)
         {
            // TODO: propagate code
            server.sharedState->sockets()->asyncClose(*this);
         }
      }

      static void close(std::shared_ptr<WebSocket>&& self, bool restart)
      {
         self->close(restart ? close_code::restart : close_code::shutdown);
      }

      void abandon() noexcept override
      {
         outbox.clear();
         readCallback = nullptr;
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
                auto ptr = static_cast<WebSocketImpl*>(self->impl.get());
                {
                   std::lock_guard l{self->mutex};
                   if (self->state != WebSocket::StateType::normal)
                      return;
                   // Messages already accepted for this socket are delivered
                   // before the close frame. Closing at once discarded them
                   // (a proxied client lost the last messages of an origin
                   // that sent and closed), and started a close while a
                   // write was in flight, which the stream does not allow.
                   if (!self->outbox.empty())
                   {
                      self->state    = WebSocket::StateType::draining;
                      ptr->closeCode = code;
                      return;
                   }
                   self->state = WebSocket::StateType::closing;
                }
                ptr->startClose(std::move(self), code);
             });
      }
      void startClose(std::shared_ptr<WebSocket>&& self, boost::beast::websocket::close_code code)
      {
         stream.async_close(
             code,
             [self = std::move(self)](const std::error_code& ec)
             {
                if (ec)
                   self->error(ec);
                else
                   self->error(make_error_code(boost::beast::websocket::error::closed));
             });
      }
      void writeLoop(std::shared_ptr<WebSocket>&& self)
      {
         const WebSocket::QueueItem* item;
         {
            std::unique_lock l{self->mutex};
            if (self->state != WebSocket::StateType::normal &&
                self->state != WebSocket::StateType::draining)
            {
               auto outbox = std::move(self->outbox);
               l.unlock();
               self->clearOutbox(std::move(outbox),
                                 make_error_code(boost::beast::websocket::error::closed));
               return;
            }
            else
            {
               item = &self->outbox.front();
            }
         }
         stream.binary(item->binary);
         auto buffer = boost::asio::buffer(item->data);
         stream.async_write(
             buffer,
             [self = std::move(self)](const std::error_code& ec,
                                      std::size_t            bytes_transferred) mutable
             {
                bool                                        last;
                bool                                        closeNow = false;
                boost::beast::websocket::close_code         closeCode{};
                std::function<void(const std::error_code&)> callback;
                {
                   std::unique_lock l{self->mutex};
                   if (ec)
                   {
                      auto outbox = std::move(self->outbox);
                      l.unlock();  // `error()` locks the mutex
                      if (ec != make_error_code(boost::asio::error::operation_aborted))
                      {
                         self->error(ec);
                      }
                      self->clearOutbox(std::move(outbox), ec);
                      return;
                   }
                   else
                   {
                      // Usage metering: payload bytes sent, per message
                      if (auto usage = self->usage())
                      {
                         usage->add(UsageField::bytesOut, bytes_transferred);
                         usage->add(UsageField::messagesOut, 1);
                      }
                      callback = std::move(self->outbox.front().callback);
                      self->outbox.pop_front();
                   }
                   last = self->outbox.empty();
                   if (last && self->state == WebSocket::StateType::draining)
                   {
                      self->state = WebSocket::StateType::closing;
                      closeNow    = true;
                      closeCode   = static_cast<WebSocketImpl*>(self->impl.get())->closeCode;
                   }
                }
                if (callback)
                {
                   callback(ec);
                }
                if (closeNow)
                {
                   static_cast<WebSocketImpl*>(self->impl.get())
                       ->startClose(std::move(self), closeCode);
                }
                else if (!last)
                {
                   static_cast<WebSocketImpl*>(self->impl.get())->writeLoop(std::move(self));
                }
             });
      }
      void readLoop(std::shared_ptr<WebSocket>&& self)
      {
         auto& input = self->input;
         assert(input.size() == 0);
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
                   // Usage metering: payload bytes received, per message
                   if (auto usage = self->usage())
                   {
                      usage->add(UsageField::bytesIn, bytes_read);
                      usage->add(UsageField::messagesIn, 1);
                   }
                   if (self->handleP2P())
                      return;
                   if (auto l = self->server.sharedState->sockets()->lockRecv(self))
                   {
                      auto derived = static_cast<WebSocketImpl*>(self->impl.get());
                      self->handleMessage(std::move(l), derived->stream.got_binary());
                      derived->readLoop(std::move(self));
                   }
                }
             });
      }
      void onLock(CloseLock&& l, std::shared_ptr<WebSocket>&& self) override
      {
         boost::asio::post(stream.get_executor(),
                           [l = std::move(l), self = std::move(self)]() mutable
                           {
                              if (self->handleP2P())
                                 return;
                              auto derived = static_cast<WebSocketImpl*>(self->impl.get());
                              self->handleMessage(std::move(l), derived->stream.got_binary());
                              derived->readLoop(std::move(self));
                           });
      }
      Stream stream;
      // The code to close with once the outbox drains. Guarded by the
      // socket's mutex; meaningful only in the draining state.
      boost::beast::websocket::close_code closeCode{};
   };

}  // namespace psibase::http
