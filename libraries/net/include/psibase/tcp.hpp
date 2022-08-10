#pragma once

#include <boost/asio/io_context.hpp>
#include <boost/asio/ip/tcp.hpp>
#include <boost/asio/connect.hpp>
#include <boost/asio/read.hpp>
#include <boost/mp11/algorithm.hpp>
#include <psio/fracpack.hpp>
#include <psibase/net_base.hpp>
#include <vector>
#include <memory>
#include <queue>
#include <iostream>

namespace psibase::net
{

   struct connection_base
   {
      using read_handler = std::function<void(const std::error_code&, std::vector<char>&&)>;
      using write_handler = std::function<void(const std::error_code&)>;
      virtual void async_write(std::vector<char>&&, write_handler) = 0;
      virtual void async_read(read_handler) = 0;
      virtual bool is_open() const = 0;
      virtual void close() = 0;
   };

   struct tcp_connection : connection_base
   {
      explicit tcp_connection(boost::asio::ip::tcp::socket&& socket) : _socket(std::move(socket)) {}
      explicit tcp_connection(boost::asio::io_context& ctx) : _socket(ctx) {}
      boost::asio::ip::tcp::socket _socket;
      bool is_open() const { return _socket.is_open(); }
      void close() { _socket.close(); }
      void async_read(read_handler f)
      {
            
         boost::asio::async_read(_socket, boost::asio::buffer(reinterpret_cast<char*>(&_msg_size), sizeof(_msg_size)),
                                 [this, f=std::move(f)](const std::error_code& ec, std::size_t size) mutable {
                                    if(!ec)
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
      template<typename F>
      void async_read_buf(F&& f)
      {
         _read_buf.resize(_msg_size);
         boost::asio::async_read(_socket, boost::asio::buffer(_read_buf),
                                 [this, f=std::forward<F>(f)](const std::error_code& ec, std::size_t sz) mutable {
                                    f(ec, std::move(_read_buf));
                                 });
      }
      void async_write(std::vector<char>&& data, write_handler f)
      {
         std::uint32_t size = data.size();
         data.insert(data.begin(), (char*)&size, (char*)&size + sizeof(size));
         _write_buf.emplace_back(std::move(data), 0, std::move(f));
         if(_write_buf.size() == 1)
         {
            async_write_loop();
         }
      }
      void async_write_loop()
      {
         if(!_write_buf.empty())
         {
            _write_buf_sequence.clear();
            for(const auto& message : _write_buf)
            {
               _write_buf_sequence.push_back(
                   boost::asio::buffer(message._data.data() + message._bytes_written,
                                       message._data.size() - message._bytes_written));
            }
            _socket.async_write_some(_write_buf_sequence, [this](const std::error_code& ec, std::size_t bytes_written){
               std::size_t remaining = bytes_written;
               for(std::size_t i = 0;; ++i)
               {
                  if(i == _write_buf.size())
                  {
                     _write_buf.clear();
                     break;
                  }
                  auto available = _write_buf[i]._data.size() - _write_buf[i]._bytes_written;
                  if(available > remaining)
                  {
                     _write_buf[i]._bytes_written += remaining;
                     _write_buf.erase(_write_buf.begin(), _write_buf.begin() + i);
                     break;
                  }
                  _write_buf[i]._callback(std::error_code{});
                  remaining -= available;
               }
               if(ec)
               {
                  for(auto& message : _write_buf)
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
         std::vector<char> _data;
         std::size_t _bytes_written = 0;
         std::function<void(const std::error_code&)> _callback;
      };
      std::vector<serialized_message> _write_buf;
      std::vector<boost::asio::const_buffer> _write_buf_sequence;
      // read buffer
      std::uint32_t _msg_size;
      std::vector<char> _read_buf;
   };

   template<typename Derived>
   struct tcp
   {
      auto& network() { return static_cast<Derived*>(this)->network(); }
      explicit tcp(boost::asio::io_context& ctx) : _ctx(ctx), _resolver(_ctx) {}
      boost::asio::ip::tcp::endpoint listen(const boost::asio::ip::tcp::endpoint& endpoint)
      {
         _acceptors.emplace_back(std::make_shared<boost::asio::ip::tcp::acceptor>(_ctx, endpoint));
         async_accept(_acceptors.back());
         return _acceptors.back()->local_endpoint();
      }
      void async_accept(std::shared_ptr<boost::asio::ip::tcp::acceptor> a)
      {
         auto p = a.get();
         p->async_accept([this, a=std::move(a)](const std::error_code& ec, boost::asio::ip::tcp::socket&& sock) mutable {
            if(!ec && a->is_open())
            {
               std::cout << "Accepted connection from: " << sock.remote_endpoint() << std::endl;
               add_connection(std::make_shared<tcp_connection>(std::move(sock)));
               async_accept(std::move(a));
            }
         });
      }
      void async_connect(const boost::asio::ip::tcp::endpoint& endpoint)
      {
         auto id = next_peer_id++;
         auto conn = std::make_shared<tcp_connection>(_ctx);
         auto& sock = conn->_socket;
         sock.async_connect(endpoint, [this,conn=std::move(conn),id,endpoint](const std::error_code& ec){
            if(ec)
            {
               std::cout << "Failed connecting" << std::endl;
               _connections.erase(id);
            }
            else
            {
               std::cout << "Connected to: " << endpoint << std::endl;
               add_connection(std::move(conn));
            }
         });
      }
      void async_connect(std::string_view host, std::string_view service)
      {
         std::cout << "Connecting to " << host << ":" << service << std::endl;
         _resolver.async_resolve(host, service, [this](const std::error_code& ec, const auto& endpoints){
            // TODO: report error
            if(!ec)
            {
               auto conn = std::make_shared<tcp_connection>(_ctx);
               auto& sock = conn->_socket;
               boost::asio::async_connect(sock, endpoints, [this, conn=std::move(conn)](const std::error_code& ec, const boost::asio::ip::tcp::endpoint& e){
                     if(ec)
                     {
                        std::cout << "Failed connecting" << std::endl;
                     }
                     else
                     {
                        std::cout << "Connected to: " << e << std::endl;
                        add_connection(std::move(conn));
                     }
                  });
            }
            else
            {
               std::cout << "resolve failed: "  << ec.message() << std::endl;
            }
         });
      }
      template<typename F>
      void async_send(peer_id id, const std::vector<char>& msg, F&& f)
      {
         auto iter = _connections.find(id);
         if(iter == _connections.end())
         {
            throw std::runtime_error("unknown peer");
         }
         iter->second->async_write(std::vector<char>(msg), std::forward<F>(f));
      }
      void add_connection(std::shared_ptr<connection_base> conn)
      {
         auto id = next_peer_id++;
         auto [iter,_] = _connections.try_emplace(id, std::move(conn));
         start_connection(id);
      }
      void start_connection(peer_id id)
      {
         auto iter = _connections.find(id);
         assert(iter != _connections.end());
         auto copy = iter->second;
         async_recv(id, std::move(copy));
         static_cast<Derived*>(this)->network().connect(id);
      }
      void async_recv(peer_id id, std::shared_ptr<connection_base>&& c)
      {
         auto p = c.get();
         p->async_read([this, c=std::move(c), id](const std::error_code& ec, std::vector<char>&& buf) mutable {
            if(ec && ec != make_error_code(boost::asio::error::operation_aborted))
            {
               disconnect(id);
            }
            else if(!ec && c->is_open())
            {
               network().recv(id, buf);
               async_recv(id, std::move(c));
            }
         });
      }
      void disconnect_all()
      {
         for(auto& [id,conn] : _connections)
         {
            static_cast<Derived*>(this)->network().disconnect(id);
            conn->close();
         }
         _connections.clear();
      }
      void disconnect(peer_id id)
      {
         auto iter = _connections.find(id);
         if(iter != _connections.end())
         {
            static_cast<Derived*>(this)->network().disconnect(id);
            iter->second->close();
            _connections.erase(iter);
         }
      }

      peer_id next_peer_id = 0;
      boost::asio::io_context& _ctx;
      boost::asio::ip::tcp::resolver _resolver;
      std::vector<std::shared_ptr<boost::asio::ip::tcp::acceptor>> _acceptors;
      std::map<peer_id, std::shared_ptr<connection_base>> _connections;
   };

}
