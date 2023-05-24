#pragma once

#include <psibase/log.hpp>

#include <boost/asio/dispatch.hpp>
#include <boost/asio/io_context.hpp>
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
      virtual bool is_open() const                                 = 0;
      virtual void close(close_code)                               = 0;
      // Information for display
      virtual std::string endpoint() const { return ""; }
      //
      loggers::common_logger     logger;
      std::optional<std::string> url;
      std::optional<NodeId>      id;
   };

   struct connection_manager : std::enable_shared_from_this<connection_manager>
   {
      static constexpr std::chrono::seconds timeout_base{30};
      static constexpr std::chrono::seconds timeout_delta{30};
      static constexpr std::chrono::seconds max_timeout{300};
      struct peer_info
      {
         template <typename F>
         explicit peer_info(F&& f)
             : connected(false),
               current_timeout(timeout_base),
               retry_time(std::chrono::steady_clock::now()),
               connect(std::forward<F>(f))
         {
         }
         bool                                  connected;
         std::chrono::seconds                  current_timeout;
         std::chrono::steady_clock::time_point retry_time;
         using connect_callback = std::function<void(const std::error_code&)>;
         std::function<void(const std::string&, connect_callback)> connect;
      };
      std::vector<std::string> peers;
      std::size_t              idx    = 0;
      std::size_t              count  = 0;
      std::size_t              target = 0;
      // This stores both active and potential connections. If a peer is
      // removed from the peer list, it will remain in this map until it
      // is disconnected.
      std::map<std::string, peer_info> info;
      // connection reports identity, which is used to de-duplicate
      std::map<NodeId, std::shared_ptr<connection_base>> nodes;
      boost::asio::steady_timer                          _timer;
      template <typename ExecutionContext>
      explicit connection_manager(ExecutionContext& ctx) : _timer(ctx)
      {
      }
      void maybe_connect_some()
      {
         if (count >= target || peers.empty())
         {
            _timer.cancel();
            return;
         }
         // find url that is not connected AND did not recently fail
         std::size_t original_idx = idx;
         auto        now          = std::chrono::steady_clock::now();
         auto        min_time     = std::chrono::steady_clock::time_point::max();
         do
         {
            const auto& url = peers[idx];
            auto        pos = info.find(url);
            // Every URL in peers must also be in info
            assert(pos != info.end());
            if (!pos->second.connected && now >= pos->second.retry_time)
            {
               do_connect(url, pos->second, now);
            }
            else if (!pos->second.connected && now < pos->second.retry_time)
            {
               min_time = std::min(min_time, pos->second.retry_time);
            }
            idx = (idx + 1) % peers.size();
         } while (count < target && idx != original_idx);
         // Retry when the earliest retry time is reached
         if (count < target && min_time != std::chrono::steady_clock::time_point::max())
         {
            _timer.expires_at(min_time);
            _timer.async_wait(
                [this](const std::error_code& ec)
                {
                   if (!ec)
                   {
                      maybe_connect_some();
                   }
                });
         }
         else
         {
            _timer.cancel();
         }
      }
      void do_connect(const std::string& url, peer_info& peer, auto now)
      {
         // possible connection lifecycles:
         // - postconnect -> disconnect: no URL
         // - postconnect -> duplicate -> disconnect: okay, receives ownership of URL
         // - postconnect(duplicate) -> disconnect: no URL
         // - disconnect: no URL
         // - connect(ok) -> postconnect -> disconnect: okay
         // - connect(ok) -> postconnect(duplicate) -> disconnect: okay, transfers ownership of URL
         // - connect(ok) -> disconnect: okay
         // - connect(error): okay
         //
         // required invariants:
         // - If connect is successful, then disconnect will be called on connection close
         // - A connection owns its url iff either it has no known NodeId or its
         //   NodeId is associated with itself in the nodes map.
         peer.connect(url,
                      [this, url](const std::error_code& ec)
                      {
                         if (ec)
                         {
                            disconnect(url);
                         }
                      });
         peer.retry_time = now + peer.current_timeout;
         peer.connected  = true;
         ++count;
         peer.current_timeout += timeout_delta;
         if (peer.current_timeout > max_timeout)
         {
            peer.current_timeout = max_timeout;
         }
      }
      void connect(const std::string& url, auto&& f)
      {
         auto [iter, inserted] = info.try_emplace(url, f);
         if (!iter->second.connected)
         {
            do_connect(url, iter->second, std::chrono::steady_clock::now());
         }
      }
      bool postconnect(const NodeId& id, const std::shared_ptr<connection_base>& conn)
      {
         auto [iter, inserted] = nodes.try_emplace(id, conn);
         conn->id              = id;
         if (!inserted && conn->url && !iter->second->url)
         {
            // TODO: how should we handle nodes that are reachable through
            // multiple configured URLs?
            iter->second->url = conn->url;
         }
         return inserted;
      }
      void disconnect(const std::string& url)
      {
         if (auto iter = info.find(url); iter != info.end())
         {
            if (iter->second.connected)
            {
               iter->second.connected = false;
               if (iter->second.retry_time <= std::chrono::steady_clock::now())
               {
                  iter->second.current_timeout = timeout_base;
               }
               --count;
            }
         }
         maybe_connect_some();
      }
      void disconnect(const std::shared_ptr<connection_base>& conn)
      {
         bool is_primary = true;
         if (conn->id)
         {
            auto pos = nodes.find(*conn->id);
            if (pos != nodes.end() && pos->second == conn)
            {
               nodes.erase(pos);
            }
            else
            {
               is_primary = false;
            }
         }
         if (conn->url && is_primary)
         {
            disconnect(*conn->url);
         }
      }
      template <typename F>
      void set(std::vector<std::string>&& peers, std::size_t target, F&& connect)
      {
         for (const std::string& peer : peers)
         {
            auto [pos, inserted] = info.try_emplace(peer, connect);
            if (inserted)
            {
               pos->second.connect = connect;
            }
         }
         if (idx >= peers.size())
         {
            idx = 0;
         }
         this->target = target;
         this->peers  = std::move(peers);
         maybe_connect_some();
      }
      auto get() const { return std::tie(peers, target); }
   };

   template <typename Derived>
   struct peer_manager
   {
      auto& network() { return static_cast<Derived*>(this)->network(); }
      explicit peer_manager(boost::asio::io_context& ctx)
          : _ctx(ctx), autoconnector(std::make_shared<connection_manager>(ctx))
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
                          if (c->is_open())
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
            conn->close(restart ? connection_base::close_code::restart
                                : connection_base::close_code::shutdown);
            autoconnector->disconnect(conn);
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
            iter->second->close(code);
            autoconnector->disconnect(iter->second);
            _connections.erase(iter);
            return true;
         }
         return false;
      }

      void set_node_id(peer_id peer, const NodeId& id)
      {
         if (auto pos = _connections.find(peer); pos != _connections.end())
         {
            if (!autoconnector->postconnect(id, pos->second))
            {
               PSIBASE_LOG(pos->second->logger, info) << "Duplicate peer";
               disconnect(peer, connection_base::close_code::duplicate);
            }
         }
      }

      template <typename F>
      void connect(const std::string& url, F&& connect)
      {
         autoconnector->connect(url, std::forward<F>(connect));
      }
      template <typename F>
      void autoconnect(std::vector<std::string>&& peers, std::size_t target, F&& connect)
      {
         autoconnector->set(std::move(peers), target, std::forward<F>(connect));
      }

      auto autoconnect() const { return autoconnector->get(); }

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
      std::shared_ptr<connection_manager>                 autoconnector;

      loggers::common_logger default_logger;
   };

}  // namespace psibase::net
