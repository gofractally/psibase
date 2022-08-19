#pragma once

#include <boost/asio/dispatch.hpp>
#include <boost/asio/io_context.hpp>
#include <functional>
#include <map>
#include <memory>
#include <stdexcept>
#include <system_error>
#include <vector>

namespace psibase::net
{

   struct connection_base
   {
      using read_handler  = std::function<void(const std::error_code&, std::vector<char>&&)>;
      using write_handler = std::function<void(const std::error_code&)>;
      virtual void async_write(std::vector<char>&&, write_handler) = 0;
      virtual void async_read(read_handler)                        = 0;
      virtual bool is_open() const                                 = 0;
      virtual void close()                                         = 0;
      // Information for display
      virtual std::string endpoint() const { return ""; }
   };

   template <typename Derived>
   struct peer_manager
   {
      auto& network() { return static_cast<Derived*>(this)->network(); }
      explicit peer_manager(boost::asio::io_context& ctx) : _ctx(ctx) {}
      void add_connection(std::shared_ptr<connection_base> conn)
      {
         auto id               = next_peer_id++;
         auto [iter, inserted] = _connections.try_emplace(id, conn);
         assert(inserted);
         async_recv(id, std::move(conn));
         static_cast<Derived*>(this)->network().connect(id);
      }
      template <typename F>
      void async_send(peer_id id, const std::vector<char>& msg, F&& f)
      {
         auto iter = _connections.find(id);
         if (iter == _connections.end())
         {
            throw std::runtime_error("unknown peer");
         }
         iter->second->async_write(std::vector<char>(msg), std::forward<F>(f));
      }
      void async_recv(peer_id id, std::shared_ptr<connection_base>&& c)
      {
         auto p = c.get();
         p->async_read(
             [this, c = std::move(c), id](const std::error_code& ec,
                                          std::vector<char>&&    buf) mutable
             {
                if (ec && ec != make_error_code(boost::asio::error::operation_aborted))
                {
                   boost::asio::dispatch(_ctx, [this, id]() mutable { disconnect(id); });
                }
                else if (!ec && c->is_open())
                {
                   boost::asio::dispatch(_ctx, [this, id, buf = std::move(buf)]() mutable
                                         { network().recv(id, buf); });
                   async_recv(id, std::move(c));
                }
             });
      }
      void disconnect_all()
      {
         for (auto& [id, conn] : _connections)
         {
            static_cast<Derived*>(this)->network().disconnect(id);
            conn->close();
         }
         _connections.clear();
      }
      bool disconnect(peer_id id)
      {
         auto iter = _connections.find(id);
         if (iter != _connections.end())
         {
            static_cast<Derived*>(this)->network().disconnect(id);
            iter->second->close();
            _connections.erase(iter);
            return true;
         }
         return false;
      }

      const auto& connections() const { return _connections; }

      peer_id                                             next_peer_id = 0;
      boost::asio::io_context&                            _ctx;
      std::map<peer_id, std::shared_ptr<connection_base>> _connections;
   };

}  // namespace psibase::net
