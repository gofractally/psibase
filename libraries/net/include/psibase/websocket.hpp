#pragma once

#include <boost/asio/buffer.hpp>
#include <boost/asio/connect.hpp>
#include <boost/asio/io_context.hpp>
#include <boost/asio/ip/tcp.hpp>
#include <boost/beast/core.hpp>
#include <boost/beast/http.hpp>
#include <boost/beast/ssl.hpp>
#include <boost/beast/version.hpp>
#include <boost/beast/websocket.hpp>
#include <deque>
#include <memory>
#include <psibase/log.hpp>
#include <psibase/peer_manager.hpp>
#include <sstream>
#include <string>
#include <string_view>
#include <system_error>
#include <vector>

namespace psibase::net
{
   template <typename Stream>
   struct websocket_connection : connection_base,
                                 std::enable_shared_from_this<websocket_connection<Stream>>
   {
      explicit websocket_connection(boost::beast::websocket::stream<Stream>&& stream)
          : stream(std::move(stream))
      {
         logger.add_attribute("RemoteEndpoint", boost::log::attributes::constant(endpoint()));
         need_close_msg = true;
      }
      ~websocket_connection()
      {
         if (need_close_msg)
         {
            PSIBASE_LOG(logger, info) << "Connection closed";
         }
      }
      explicit websocket_connection(boost::asio::io_context& ctx, auto&&... args)
          : stream(ctx, static_cast<decltype(args)>(args)...)
      {
      }
      void async_read(read_handler f) override
      {
         boost::asio::dispatch(
             stream.get_executor(),
             [this, f = std::move(f)]() mutable
             {
                inbox.clear();
                buffer.emplace(inbox);
                stream.async_read(*buffer,
                                  [this, f = std::move(f)](const std::error_code& ec, std::size_t)
                                  {
                                     if (ec)
                                     {
                                        log_error(ec);
                                     }
                                     f(ec, std::move(inbox));
                                  });
             });
      }
      void log_error(const std::error_code& ec)
      {
         // Don't bother logging errors that we expect to see on shutdown
         if (ec != make_error_code(boost::asio::error::operation_aborted) &&
             ec != make_error_code(boost::beast::websocket::error::closed))
         {
            // It isn't an error for the remote to close the connection
            if (ec == make_error_code(boost::asio::error::eof))
            {
               PSIBASE_LOG(logger, info) << ec.message();
            }
            else
            {
               PSIBASE_LOG(logger, warning) << ec.message();
            }
         }
      }
      void async_write(std::vector<char>&& data, write_handler f) override
      {
         boost::asio::dispatch(
             stream.get_executor(),
             [self = this->shared_from_this(), data = std::move(data), f = std::move(f)]() mutable
             {
                self->outbox.emplace_back(message{std::move(data), std::move(f)});
                if (self->outbox.size() == 1)
                {
                   auto p = self.get();
                   p->async_write_loop(std::move(self));
                }
             });
      }
      void async_write_loop(std::shared_ptr<websocket_connection> self)
      {
         stream.binary(true);
         stream.async_write(boost::asio::buffer(outbox.front().data),
                            [self = std::move(self)](const std::error_code& ec, std::size_t sz)
                            {
                               if (!ec)
                               {
                                  self->outbox.front().callback(ec);
                                  self->outbox.pop_front();
                                  if (!self->outbox.empty())
                                  {
                                     auto p = self.get();
                                     p->async_write_loop(std::move(self));
                                  }
                               }
                               else
                               {
                                  self->log_error(ec);
                                  for (auto& m : self->outbox)
                                  {
                                     m.callback(ec);
                                  }
                                  self->outbox.clear();
                               }
                            });
      }
      bool        is_open() const { return !closed; }
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
      void close(close_code code)
      {
         if (!closed)
         {
            closed = true;
            boost::asio::dispatch(
                stream.get_executor(),
                [self = this->shared_from_this(), code]() mutable
                {
                   auto p = self.get();
                   p->stream.async_close(
                       translate_close_code(code),
                       [self = std::move(self)](const std::error_code& ec) mutable {});
                });
         }
      }
      std::string endpoint() const
      {
         auto               result = get_lowest_layer(stream).socket().remote_endpoint();
         std::ostringstream ss;
         ss << result;
         return ss.str();
      }
      struct message
      {
         std::vector<char>                           data;
         std::function<void(const std::error_code&)> callback;
      };
      boost::beast::websocket::stream<Stream> stream;
      std::string                             host;
      std::deque<message>                     outbox;
      std::vector<char>                       inbox;
      // Grrrr...
      std::optional<boost::asio::dynamic_vector_buffer<char, std::allocator<char>>> buffer;
      // Avoid calling close more than once
      bool closed = false;
      //
      bool need_close_msg = false;
   };

   template <typename Stream, typename F>
   void maybe_async_ssl_handshake(std::shared_ptr<websocket_connection<Stream>>&& conn, F&& f)
   {
      f(std::error_code{}, std::move(conn));
   }

   template <typename Stream, typename F>
   void maybe_async_ssl_handshake(
       std::shared_ptr<websocket_connection<boost::beast::ssl_stream<Stream>>>&& conn,
       F&&                                                                       f)
   {
      auto& ssl = conn->stream.next_layer();
      ssl.async_handshake(boost::asio::ssl::stream_base::client,
                          [conn = std::move(conn), f = std::forward<F>(f)](
                              const std::error_code& ec) { f(ec, std::move(conn)); });
   }

   template <typename Stream, typename F>
   void async_connect(std::shared_ptr<websocket_connection<Stream>>&& conn,
                      boost::asio::ip::tcp::resolver&                 resolver,
                      std::string_view                                host,
                      std::string_view                                service,
                      F&&                                             f)
   {
      conn->host = host;
      conn->logger.add_attribute("RemoteEndpoint", boost::log::attributes::constant(
                                                       conn->host + ":" + std::string(service)));
      resolver.async_resolve(
          host, service,
          [conn = std::move(conn), f = std::forward<F>(f)](const std::error_code& ec,
                                                           const auto&            endpoints) mutable
          {
             if (!ec)
             {
                auto& sock = get_lowest_layer(conn->stream);
                sock.async_connect(
                    endpoints,
                    [conn = std::move(conn), f = std::move(f)](
                        const std::error_code& ec, const boost::asio::ip::tcp::endpoint& e) mutable
                    {
                       if (ec)
                       {
                          PSIBASE_LOG(conn->logger, warning) << ec.message();
                          f(ec, std::move(conn));
                       }
                       else
                       {
                          maybe_async_ssl_handshake(
                              std::move(conn),
                              [f = std::move(f)](const std::error_code& ec, auto&& conn)
                              {
                                 if (ec)
                                 {
                                    PSIBASE_LOG(conn->logger, warning) << ec.message();
                                    f(ec, std::move(conn));
                                 }
                                 else
                                 {
                                    auto* p = conn.get();
                                    p->stream.async_handshake(
                                        p->host, "/native/p2p",
                                        [conn = std::move(conn),
                                         f    = std::move(f)](const std::error_code& ec) mutable
                                        {
                                           if (ec)
                                           {
                                              PSIBASE_LOG(conn->logger, warning) << ec.message();
                                              f(ec, std::move(conn));
                                           }
                                           else
                                           {
                                              conn->need_close_msg = true;
                                              f(ec, std::move(conn));
                                           }
                                        });
                                 }
                              });
                       }
                    });
             }
             else
             {
                PSIBASE_LOG(conn->logger, warning) << ec.message();
                f(ec, std::move(conn));
             }
          });
   }
}  // namespace psibase::net
