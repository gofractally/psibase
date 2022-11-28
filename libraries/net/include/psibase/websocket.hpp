#pragma once

#include <boost/asio/buffer.hpp>
#include <boost/asio/connect.hpp>
#include <boost/asio/io_context.hpp>
#include <boost/asio/ip/tcp.hpp>
#include <boost/beast/core.hpp>
#include <boost/beast/http.hpp>
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
   struct websocket_connection : connection_base, std::enable_shared_from_this<websocket_connection>
   {
      explicit websocket_connection(
          boost::beast::websocket::stream<boost::beast::tcp_stream>&& stream)
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
      explicit websocket_connection(boost::asio::io_context& ctx) : stream(ctx) {}
      void async_read(read_handler f) override
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
             [self = shared_from_this(), data = std::move(data), f = std::move(f)]() mutable
             {
                self->outbox.emplace_back(
                    psibase::net::websocket_connection::message{std::move(data), std::move(f)});
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
      bool is_open() const { return !closed; }
      void close()
      {
         if (!closed)
         {
            closed = true;
            boost::asio::dispatch(
                stream.get_executor(),
                [self = shared_from_this()]() mutable
                {
                   auto p = self.get();
                   p->stream.async_close(
                       boost::beast::websocket::close_code::none,
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
      boost::beast::websocket::stream<boost::beast::tcp_stream> stream;
      std::string                                               host;
      std::deque<message>                                       outbox;
      std::vector<char>                                         inbox;
      // Grrrr...
      std::optional<boost::asio::dynamic_vector_buffer<char, std::allocator<char>>> buffer;
      // Avoid calling close more than once
      bool closed = false;
      //
      bool need_close_msg = false;
   };

   template <typename F>
   void async_connect(std::shared_ptr<websocket_connection>&& conn,
                      boost::asio::ip::tcp::resolver&         resolver,
                      std::string_view                        host,
                      std::string_view                        service,
                      F&&                                     f)
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
                       }
                       else
                       {
                          auto* p = conn.get();
                          p->stream.async_handshake(p->host, "/native/p2p",
                                                    [conn = std::move(conn), f = std::move(f)](
                                                        const std::error_code& ec) mutable
                                                    {
                                                       if (ec)
                                                       {
                                                          PSIBASE_LOG(conn->logger, warning)
                                                              << ec.message();
                                                       }
                                                       else
                                                       {
                                                          conn->need_close_msg = true;
                                                          f(std::move(conn));
                                                       }
                                                    });
                       }
                    });
             }
             else
             {
                PSIBASE_LOG(conn->logger, warning) << ec.message();
             }
          });
   }
}  // namespace psibase::net
