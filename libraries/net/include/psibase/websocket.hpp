#pragma once

#include <boost/asio/buffer.hpp>
#include <boost/asio/io_context.hpp>
#include <boost/asio/ip/tcp.hpp>
#include <boost/asio/connect.hpp>
#include <boost/beast/core.hpp>
#include <boost/beast/http.hpp>
#include <boost/beast/websocket.hpp>
#include <boost/beast/version.hpp>
#include <psibase/tcp.hpp>
#include <system_error>
#include <deque>
#include <vector>
#include <string>
#include <string_view>

namespace psibase::net
{
   struct websocket_connection : connection_base
   {
      explicit websocket_connection(boost::beast::websocket::stream<boost::beast::tcp_stream>&& stream) : stream(std::move(stream)) {}
      explicit websocket_connection(boost::asio::io_context& ctx) : stream(ctx) {}
      void async_read(read_handler f) override
      {
         inbox.clear();
         buffer.emplace(inbox);
         stream.async_read(*buffer, [this,f=std::move(f)](const std::error_code& ec, std::size_t){
            f(ec, std::move(inbox));
         });
      }
      void async_write(std::vector<char>&& data, write_handler f) override
      {
         outbox.emplace_back(std::move(data), std::move(f));
         if(outbox.size() == 1)
         {
            async_write_loop();
         }
      }
      void async_write_loop()
      {
         stream.binary(true);
         stream.async_write(boost::asio::buffer(outbox.front().data), [this](const std::error_code& ec, std::size_t sz){
            if(!ec)
            {
               outbox.front().callback(ec);
               outbox.pop_front();
               if(!outbox.empty())
               {
                  async_write_loop();
               }
            }
            else
            {
               for(auto& m : outbox)
               {
                  m.callback(ec);
               }
               outbox.clear();
            }
         });
      }
      bool is_open() const { return stream.is_open(); }
      void close()
      {
         if(stream.is_open())
         {
            stream.close(boost::beast::websocket::close_code::none);
         }
      }
      struct message
      {
         std::vector<char> data;
         std::function<void(const std::error_code&)> callback;
      };
      boost::beast::websocket::stream<boost::beast::tcp_stream> stream;
      std::string host;
      std::deque<message> outbox;
      std::vector<char> inbox;
      // Grrrr...
      std::optional<boost::asio::dynamic_vector_buffer<char, std::allocator<char>>> buffer;
   };

   template<typename F>
   void async_connect(std::shared_ptr<websocket_connection>&& conn, boost::asio::ip::tcp::resolver& resolver, std::string_view host, std::string_view service, F&& f)
   {
      conn->host = host;
      resolver.async_resolve(host, service, [conn=std::move(conn), f=std::forward<F>(f)](const std::error_code& ec, const auto& endpoints) mutable {
            if(!ec)
            {
               auto& sock = get_lowest_layer(conn->stream);
               sock.async_connect(endpoints, [conn=std::move(conn), f=std::forward<F>(f)](const std::error_code& ec, const boost::asio::ip::tcp::endpoint& e) mutable{
                     if(ec)
                     {
                        std::cout << "Failed connecting" << std::endl;
                     }
                     else
                     {
                        std::cout << "Connected to: " << e << std::endl;
                        auto* p = conn.get();
                        p->stream.async_handshake(p->host, "/native/p2p", [conn=std::move(conn), f=std::forward<F>(f)](const std::error_code& ec) mutable{
                           if(ec)
                           {
                              std::cout << "Websocket handshake failed" << std::endl;
                           }
                           else
                           {
                              f(std::move(conn));
                           }
                        });
                     }
                  });
            }
            else
            {
               std::cout << "resolve failed: "  << ec.message() << std::endl;
            }
      });
   }
}
