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
      virtual bool is_open() const                                 = 0;
      virtual void close(close_code)                               = 0;
      // Information for display
      virtual std::string endpoint() const { return ""; }
      //
      loggers::common_logger   logger;
      std::vector<std::string> urls;
      std::optional<NodeId>    id;
      // This is used to manage closing duplicate connections
      // - A peer is identified by host:id
      // - A secure connection will be kept over an insecure connection
      // - If both connections are secure or both are insecure, we pick
      //   which one to close based on node id. It's arbitrary as long
      //   as both nodes agree about which connection should be closed.
      // - Making an outgoing connection verifies the hostname of the
      //   the peer well enough for deduplication. An insecure connection
      //   trusts DNS. A secure connection trusts the certificate chain.
      //   A connection made to a local socket trusts the hostname reported
      //   by the peer.
      // - A node will only close its own outgoing connections. This allows
      //   us to ensure that the URL of the peer is copied to the connection
      //   that remains before the other connection is closed.
      //
      // A node sends a connection id over incoming connections.
      // A node sends its hostnames over all connections.
      //
      // After a node recieves the hostname over an incoming connection,
      // it sends duplicate connection messages with the ids of all outgoing
      // connections that have the same hostname.
      //
      // When a node recieves a duplicate connection message over an outgoing
      // connection, it checks that the host:id matches the host:id of the other
      // connection, and may close the connection.
      //
      // If A and B are both honest, then they are both aware of the set of
      // duplicate connections. They may have additional connections with
      // dishonest nodes that appear as (unverified) duplicates.
      //
      // If either A or B is dishonest, then we don't care if the connection
      // between them gets dropped. They can always just disconnect.
      bool outgoing = false;
      // secure and local are only meaningful for outgoing connections,
      // because incoming connections may be coming through a reverse proxy.
      bool                         secure            = false;
      bool                         local             = false;
      std::uint8_t                 pending_hostnames = 0;
      std::vector<std::string>     hosts;
      std::optional<std::uint64_t> connection_id;

      bool host_intersects(const connection_base& other) const
      {
         for (const auto& host : hosts)
         {
            if (std::ranges::find(other.hosts, host) != other.hosts.end())
            {
               return true;
            }
         }
         return false;
      }
   };

   struct peer_key
   {
      std::string host;
      NodeId      id;
      friend auto operator<=>(const peer_key&, const peer_key&) = default;
   };

   struct connection_manager : std::enable_shared_from_this<connection_manager>
   {
      static constexpr std::chrono::seconds timeout_base{30};
      static constexpr std::chrono::seconds timeout_delta{30};
      static constexpr std::chrono::seconds max_timeout{300};
      struct url_info
      {
         template <typename F>
         explicit url_info(F&& f)
             : connected(0),
               current_timeout(timeout_base),
               retry_time(std::chrono::steady_clock::now()),
               connect(std::forward<F>(f))
         {
         }
         std::size_t                           connected;
         std::chrono::seconds                  current_timeout;
         std::chrono::steady_clock::time_point retry_time;
         using connect_callback = std::function<void(const std::error_code&)>;
         std::function<void(const std::string&, connect_callback)> connect;
      };
      struct host_id_info
      {
         std::vector<std::shared_ptr<connection_base>> outgoing;
         std::vector<std::shared_ptr<connection_base>> incoming;
         bool empty() const { return outgoing.empty() && incoming.empty(); }
      };
      std::vector<std::string> peers;
      std::size_t              idx    = 0;
      std::size_t              count  = 0;
      std::size_t              target = 0;
      // This stores both active and potential connections. If a peer is
      // removed from the peer list, it will remain in this map until it
      // is disconnected.
      std::map<std::string, url_info> info;
      // connection reports identity, which is used to de-duplicate
      std::map<peer_key, host_id_info> nodes;
      boost::asio::steady_timer        _timer;
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
      void do_connect(const std::string& url, url_info& peer, auto now)
      {
         peer.connect(url,
                      [this, url](const std::error_code& ec)
                      {
                         if (ec)
                         {
                            release_url(url);
                            maybe_connect_some();
                         }
                      });
         peer.retry_time = now + peer.current_timeout;
         ++peer.connected;
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
      std::span<const std::shared_ptr<connection_base>> incoming(const std::string& host,
                                                                 const NodeId&      id)
      {
         if (auto pos = nodes.find(peer_key{host, id}); pos != nodes.end())
         {
            return pos->second.incoming;
         }
         return {};
      }
      std::span<const std::shared_ptr<connection_base>> outgoing(const std::string& host,
                                                                 const NodeId&      id)
      {
         if (auto pos = nodes.find(peer_key{host, id}); pos != nodes.end())
         {
            return pos->second.outgoing;
         }
         return {};
      }
      void init_hosts(const std::shared_ptr<connection_base>& conn)
      {
         auto tmp = std::move(conn->hosts);
         set_hosts(conn, std::move(tmp));
      }
      void clear_hosts(const std::shared_ptr<connection_base>& conn)
      {
         if (conn->id)
         {
            for (const auto& host : conn->hosts)
            {
               peer_key key{.host = host, .id = *conn->id};
               auto     pos = nodes.find(key);
               if (pos != nodes.end())
               {
                  auto& group = conn->outgoing ? pos->second.outgoing : pos->second.incoming;
                  std::erase(group, conn);
                  if (pos->second.empty())
                     nodes.erase(pos);
               }
            }
         }
         conn->hosts.clear();
      }
      void set_hosts(const std::shared_ptr<connection_base>& conn, std::vector<std::string>&& hosts)
      {
         clear_hosts(conn);
         if (conn->id)
         {
            PSIBASE_LOG(conn->logger, info) << std::format("Hosts: {}", hosts);
            for (const auto& host : hosts)
            {
               peer_key key{.host = host, .id = *conn->id};
               auto&    group = conn->outgoing ? nodes[key].outgoing : nodes[key].incoming;
               group.push_back(conn);
            }
         }
         conn->hosts = std::move(hosts);
      }
      void add_urls(const std::shared_ptr<connection_base>& conn,
                    const std::vector<std::string>&         urls)
      {
         for (const auto& url : urls)
         {
            if (std::ranges::find(conn->urls, url) == conn->urls.end())
            {
               auto pos = info.find(url);
               if (pos != info.end())
               {
                  conn->urls.push_back(url);
                  ++pos->second.connected;
               }
               else
               {
                  PSIBASE_LOG(conn->logger, warning)
                      << "Connection should only copy an existing URL";
               }
            }
         }
      }
      void release_url(const std::string& url)
      {
         if (auto iter = info.find(url); iter != info.end())
         {
            if (--iter->second.connected == 0)
            {
               if (iter->second.retry_time <= std::chrono::steady_clock::now())
               {
                  iter->second.current_timeout = timeout_base;
               }
               --count;
            }
         }
      }
      void disconnect(const std::shared_ptr<connection_base>& conn)
      {
         clear_hosts(conn);
         for (const std::string& url : conn->urls)
         {
            release_url(url);
         }
         maybe_connect_some();
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

      void on_duplicate(peer_id peer, std::uint64_t connection_id, bool secure)
      {
         auto other_peer = static_cast<peer_id>(connection_id);
         if (auto pos = _connections.find(peer); pos != _connections.end())
         {
            auto& conn = pos->second;
            if (conn->outgoing)
            {
               if (auto other_pos = _connections.find(other_peer); other_pos != _connections.end())
               {
                  auto& other_conn = other_pos->second;

                  PSIBASE_LOG(conn->logger, info) << std::format("id: {}", *conn->id);
                  if (conn->id && conn->id == other_conn->id && conn->host_intersects(*other_conn))
                  {
                     autoconnector->add_urls(other_conn, conn->urls);
                     if (conn->secure == secure)
                     {
                        if (network().should_close_duplicate(*conn->id))
                        {
                           PSIBASE_LOG(conn->logger, info) << "Duplicate peer";
                           disconnect(peer, connection_base::close_code::duplicate);
                        }
                     }
                     else if (secure && !conn->secure)
                     {
                        PSIBASE_LOG(conn->logger, info) << "Duplicate peer";
                        disconnect(peer, connection_base::close_code::duplicate);
                     }
                  }
               }
            }
         }
      }

      void process_hosts(const std::shared_ptr<connection_base>& conn)
      {
         if (conn->pending_hostnames == 0 && conn->id)
         {
            if (conn->outgoing)
            {
               // TODO: find other outgoing connections with the same set of hosts
               if (conn->connection_id)
               {
                  for (const auto& host : conn->hosts)
                  {
                     for (const auto& duplicate : autoconnector->incoming(host, *conn->id))
                     {
                        send_message(duplicate, network().make_duplicate_message(
                                                    *conn->connection_id, conn->secure));
                     }
                  }
               }
            }
            else
            {
               for (const auto& host : conn->hosts)
               {
                  // For each outgoing connection with this host
                  for (auto& duplicate : autoconnector->outgoing(host, *conn->id))
                  {
                     if (duplicate->outgoing && duplicate->connection_id)
                     {
                        send_message(conn, network().make_duplicate_message(
                                               *duplicate->connection_id, duplicate->secure));
                     }
                  }
               }
            }
         }
      }

      void set_hosts(peer_id peer, std::vector<std::string>&& hosts)
      {
         if (auto pos = _connections.find(peer); pos != _connections.end())
         {
            const auto& conn = pos->second;
            if (!conn->outgoing || conn->local)
            {
               autoconnector->set_hosts(conn, std::move(hosts));
               process_hosts(conn);
            }
         }
      }

      void set_node_id(peer_id                             peer,
                       const NodeId&                       id,
                       const std::optional<std::uint64_t>& connection_id)
      {
         if (auto pos = _connections.find(peer); pos != _connections.end())
         {
            const auto& conn = pos->second;
            conn->id         = id;
            if (conn->outgoing && connection_id)
            {
               conn->connection_id = connection_id;
            }
            autoconnector->init_hosts(conn);
            process_hosts(conn);
         }
      }

      void start_hostname_update(peer_id peer)
      {
         if (auto pos = _connections.find(peer); pos != _connections.end())
         {
            const auto& conn = pos->second;
            if (++conn->pending_hostnames == 0)
               throw std::runtime_error("Too many pending hostname updates");
         }
      }

      void finish_hostname_update(peer_id peer)
      {
         if (auto pos = _connections.find(peer); pos != _connections.end())
         {
            const auto& conn = pos->second;
            if (conn->pending_hostnames == 0)
               throw std::runtime_error("No pending hostname updates");
            --conn->pending_hostnames;
            process_hosts(conn);
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
