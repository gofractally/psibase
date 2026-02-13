#pragma once

#include <psibase/log.hpp>
#include <psibase/net_base.hpp>

#include <boost/asio/dispatch.hpp>
#include <boost/asio/io_context.hpp>
#include <boost/asio/steady_timer.hpp>
#include <boost/log/attributes/constant.hpp>
#include <functional>
#include <map>
#include <memory>
#include <stdexcept>
#include <system_error>
#include <tuple>
#include <vector>

namespace psibase::net
{
   struct connection_base
   {
      enum close_code
      {
         // The connection was closed as a result of server configuration
         normal,
         // There was another connection to the same peer
         duplicate,
         // The connection was closed because the peer sent an invalid message
         error,
         // The server is shutting down
         shutdown,
         // The server is restarting
         restart
      };
      connection_base()
      {
         logger.add_attribute("Channel", boost::log::attributes::constant(std::string("p2p")));
      }
      using read_handler  = std::function<void(const std::error_code&, std::vector<char>&&)>;
      using write_handler = std::function<void(const std::error_code&)>;
      virtual void async_write(std::vector<char>&&, write_handler) = 0;
      virtual void async_read(read_handler)                        = 0;
      virtual void close(close_code)                               = 0;
      // Information for display
      virtual std::string endpoint() const { return ""; }
      //
      loggers::common_logger logger;
      bool                   closed = false;
   };

   template <typename Derived>
   struct peer_manager
   {
      auto& network() { return static_cast<Derived*>(this)->network(); }
      explicit peer_manager(boost::asio::io_context& ctx) : _ctx(ctx)
      {
         default_logger.add_attribute("Channel",
                                      boost::log::attributes::constant(std::string("p2p")));
      }
      void add_connection(std::shared_ptr<connection_base> conn)
      {
         auto id = next_peer_id++;
         conn->logger.add_attribute("PeerId", boost::log::attributes::constant(id));
         PSIBASE_LOG(conn->logger, info) << "Connected";
         auto [iter, inserted] = _connections.try_emplace(id, conn);
         assert(inserted);
         static_cast<Derived*>(this)->network().connect(id);
         async_recv(id, std::move(conn));
      }
      template <typename F>
      void async_send(peer_id id, const std::vector<char>& msg, F&& f)
      {
         auto iter = _connections.find(id);
         if (iter == _connections.end())
         {
            throw std::runtime_error("unknown peer");
         }
         iter->second->async_write(
             std::vector<char>(msg),
             [this, &ctx = _ctx, f = std::forward<F>(f)](const std::error_code& ec) mutable
             { boost::asio::dispatch(ctx, [this, f = std::move(f), ec]() mutable { f(ec); }); });
      }
      void send_message(const std::shared_ptr<connection_base>& conn, const auto& msg)
      {
         PSIBASE_LOG(conn->logger, debug)
             << "Sending message: " << network().message_to_string(msg);
         conn->async_write(network().serialize_message(msg), [](const std::error_code&) {});
      }
      void async_recv(peer_id id, std::shared_ptr<connection_base>&& c)
      {
         auto p = c.get();
         p->async_read(
             [this, &ctx = _ctx, c = std::move(c), id](const std::error_code& ec,
                                                       std::vector<char>&&    buf) mutable
             {
                if (ec)
                {
                   boost::asio::dispatch(ctx, [this, id]() mutable
                                         { disconnect(id, connection_base::close_code::normal); });
                }
                else
                {
                   boost::asio::dispatch(
                       ctx,
                       [this, c = std::move(c), id, buf = std::move(buf)]() mutable
                       {
                          if (!c->closed)
                          {
                             network().recv(id, std::move(buf));
                          }
                          async_recv(id, std::move(c));
                       });
                }
             });
      }
      void disconnect_all(bool restart)
      {
         for (auto& [id, conn] : _connections)
         {
            static_cast<Derived*>(this)->network().disconnect(id);
            if (!conn->closed)
            {
               conn->closed = true;
               conn->close(restart ? connection_base::close_code::restart
                                   : connection_base::close_code::shutdown);
            }
         }
         _connections.clear();
      }
      bool disconnect(peer_id                     id,
                      connection_base::close_code code = connection_base::close_code::error)
      {
         auto iter = _connections.find(id);
         if (iter != _connections.end())
         {
            static_cast<Derived*>(this)->network().disconnect(id);
            if (!iter->second->closed)
            {
               iter->second->closed = true;
               iter->second->close(code);
            }
            _connections.erase(iter);
            return true;
         }
         return false;
      }

      loggers::common_logger& logger(peer_id id)
      {
         auto iter = _connections.find(id);
         if (iter != _connections.end())
         {
            return iter->second->logger;
         }
         else
         {
            return default_logger;
         }
      }

      const auto& connections() const { return _connections; }

      peer_id                                             next_peer_id = 0;
      boost::asio::io_context&                            _ctx;
      std::map<peer_id, std::shared_ptr<connection_base>> _connections;

      loggers::common_logger default_logger;
   };

}  // namespace psibase::net
