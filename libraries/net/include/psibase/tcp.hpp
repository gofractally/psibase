#pragma once

#include <boost/asio/connect.hpp>
#include <boost/asio/dispatch.hpp>
#include <boost/asio/io_context.hpp>
#include <boost/asio/ip/tcp.hpp>
#include <boost/asio/read.hpp>
#include <boost/mp11/algorithm.hpp>
#include <iostream>
#include <memory>
#include <psibase/net_base.hpp>
#include <psio/fracpack.hpp>
#include <queue>
#include <vector>

namespace psibase::net
{

   struct tcp_connection : connection_base
   {
      explicit tcp_connection(boost::asio::ip::tcp::socket&& socket) : _socket(std::move(socket)) {}
      explicit tcp_connection(boost::asio::io_context& ctx) : _socket(ctx) {}
      boost::asio::ip::tcp::socket _socket;
      bool                         is_open() const { return _socket.is_open(); }
      void                         close() { _socket.close(); }
      void                         async_read(read_handler f)
      {
         boost::asio::async_read(
             _socket, boost::asio::buffer(reinterpret_cast<char*>(&_msg_size), sizeof(_msg_size)),
             [this, f = std::move(f)](const std::error_code& ec, std::size_t size) mutable
             {
                if (!ec)
                {
                   async_read_buf(std::move(f));
                }
                else
                {
                   std::cout << "error: " << ec.message() << std::endl;
                   f(ec, std::move(_read_buf));
                }
             });
      }
      template <typename F>
      void async_read_buf(F&& f)
      {
         _read_buf.resize(_msg_size);
         boost::asio::async_read(
             _socket, boost::asio::buffer(_read_buf),
             [this, f = std::forward<F>(f)](const std::error_code& ec, std::size_t sz) mutable
             { f(ec, std::move(_read_buf)); });
      }
      void async_write(std::vector<char>&& data, write_handler f)
      {
         std::uint32_t size = data.size();
         data.insert(data.begin(), (char*)&size, (char*)&size + sizeof(size));
         _write_buf.emplace_back(std::move(data), 0, std::move(f));
         if (_write_buf.size() == 1)
         {
            async_write_loop();
         }
      }
      void async_write_loop()
      {
         if (!_write_buf.empty())
         {
            _write_buf_sequence.clear();
            for (const auto& message : _write_buf)
            {
               _write_buf_sequence.push_back(
                   boost::asio::buffer(message._data.data() + message._bytes_written,
                                       message._data.size() - message._bytes_written));
            }
            _socket.async_write_some(
                _write_buf_sequence,
                [this](const std::error_code& ec, std::size_t bytes_written)
                {
                   std::size_t remaining = bytes_written;
                   for (std::size_t i = 0;; ++i)
                   {
                      if (i == _write_buf.size())
                      {
                         _write_buf.clear();
                         break;
                      }
                      auto available = _write_buf[i]._data.size() - _write_buf[i]._bytes_written;
                      if (available > remaining)
                      {
                         _write_buf[i]._bytes_written += remaining;
                         _write_buf.erase(_write_buf.begin(), _write_buf.begin() + i);
                         break;
                      }
                      _write_buf[i]._callback(std::error_code{});
                      remaining -= available;
                   }
                   if (ec)
                   {
                      for (auto& message : _write_buf)
                      {
                         message._callback(ec);
                      }
                      _write_buf.clear();
                   }
                   else
                   {
                      async_write_loop();
                   }
                });
         }
      }
      struct serialized_message
      {
         std::vector<char>                           _data;
         std::size_t                                 _bytes_written = 0;
         std::function<void(const std::error_code&)> _callback;
      };
      std::vector<serialized_message>        _write_buf;
      std::vector<boost::asio::const_buffer> _write_buf_sequence;
      // read buffer
      std::uint32_t     _msg_size;
      std::vector<char> _read_buf;
   };

   template <typename F>
   void async_connect(std::shared_ptr<tcp_connection>&& conn,
                      boost::asio::ip::tcp::resolver&   resolver,
                      std::string_view                  host,
                      std::string_view                  service,
                      F&&                               f)
   {
      std::cout << "Connecting to " << host << ":" << service << std::endl;
      resolver.async_resolve(
          host, service,
          [conn = std::move(conn), f = std::foward<F>(f)](const std::error_code& ec,
                                                          const auto&            endpoints) mutable
          {
             // TODO: report error
             if (!ec)
             {
                auto  conn = std::make_shared<tcp_connection>(_ctx);
                auto& sock = conn->_socket;
                boost::asio::async_connect(
                    sock, endpoints,
                    [this, conn = std::move(conn), f = std::move(f)](
                        const std::error_code& ec, const boost::asio::ip::tcp::endpoint& e) mutable
                    {
                       if (ec)
                       {
                          std::cout << "Failed connecting" << std::endl;
                       }
                       else
                       {
                          std::cout << "Connected to: " << e << std::endl;
                          f(std::move(conn));
                       }
                    });
             }
             else
             {
                std::cout << "resolve failed: " << ec.message() << std::endl;
             }
          });
   }

   struct tcp_listener
   {
      explicit tcp_listener(boost::asio::io_context& ctx) : _ctx(ctx) {}
      template <typename F>
      boost::asio::ip::tcp::endpoint listen(const boost::asio::ip::tcp::endpoint& endpoint, F&& f)
      {
         _acceptors.emplace_back(std::make_shared<boost::asio::ip::tcp::acceptor>(_ctx, endpoint));
         async_accept(_acceptors.back(), std::forward<F>(f));
         return _acceptors.back()->local_endpoint();
      }
      template <typename F>
      static void async_accept(std::shared_ptr<boost::asio::ip::tcp::acceptor> a, F&& f)
      {
         auto p = a.get();
         p->async_accept(
             [a = std::move(a), f = std::forward<F>(f)](const std::error_code&         ec,
                                                        boost::asio::ip::tcp::socket&& sock) mutable
             {
                if (!ec)
                {
                   std::cout << "Accepted connection from: " << sock.remote_endpoint() << std::endl;
                   f(std::make_shared<tcp_connection>(std::move(sock)));
                }
                async_accept(std::move(a), std::move(f));
             });
      }
      boost::asio::io_context&                                     _ctx;
      std::vector<std::shared_ptr<boost::asio::ip::tcp::acceptor>> _acceptors;
   };

}  // namespace psibase::net
