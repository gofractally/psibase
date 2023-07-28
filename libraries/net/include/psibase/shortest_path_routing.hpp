#pragma once

// Implements a Bellman-Ford based routing algorithm using the feasibility
// condition from babel (RFC8966) to prevent routing loops
//
// Note that this protocol allows routing to producers only.
// Other nodes act purely as routers from the standpoint of this protocol.

#include <psibase/log.hpp>
#include <psibase/net_base.hpp>
#include <psibase/routing_base.hpp>

#include <chrono>
#include <cstdint>
#include <map>
#include <random>

namespace psibase::net
{
   struct SequenceNumber
   {
      std::uint16_t value;
      // Not even a partial ordering, because it is cyclic
      friend bool operator<(const SequenceNumber& lhs, const SequenceNumber& rhs)
      {
         return lhs.value != rhs.value && ((rhs.value - lhs.value) & 0x8000) == 0;
      }
      friend bool operator>=(const SequenceNumber& lhs, const SequenceNumber& rhs)
      {
         return !(lhs < rhs);
      }
      friend bool    operator==(const SequenceNumber& lhs, const SequenceNumber& rhs) = default;
      SequenceNumber operator+(std::uint16_t i) const
      {
         return SequenceNumber{static_cast<std::uint16_t>(value + i)};
      }
   };
   PSIO_REFLECT(SequenceNumber, definitionWillNotChange(), value)

   struct RouteMetric
   {
      static const RouteMetric infinite;
      std::uint16_t            value;
      friend RouteMetric       operator+(const RouteMetric& lhs, const RouteMetric& rhs)
      {
         auto result =
             static_cast<std::uint32_t>(lhs.value) + static_cast<std::uint32_t>(rhs.value);
         if (result > infinite.value)
         {
            return infinite;
         }
         else
         {
            return {static_cast<std::uint16_t>(result)};
         }
      }
      friend auto operator<=>(const RouteMetric&, const RouteMetric&) = default;
   };
   PSIO_REFLECT(RouteMetric, definitionWillNotChange(), value)

   inline const RouteMetric RouteMetric::infinite = {0xffffu};

   struct Feasibility
   {
      SequenceNumber seqno;
      RouteMetric    metric;
      friend bool    operator<(const Feasibility& lhs, const Feasibility& rhs)
      {
         return rhs.seqno < lhs.seqno || (lhs.seqno == rhs.seqno && lhs.metric < rhs.metric);
      }
   };

   struct RouteUpdateMessage
   {
      static constexpr unsigned type = 4;
      producer_id               producer;
      SequenceNumber            seqno;
      RouteMetric               metric;
      std::string               to_string() const
      {
         return "route update: " + producer.str() + " seqno=" + std::to_string(seqno.value) +
                " metric=" + std::to_string(metric.value);
      }
   };
   PSIO_REFLECT(RouteUpdateMessage, producer, seqno, metric)

   struct RouteSeqnoRequest
   {
      static constexpr unsigned type = 5;
      producer_id               producer;
      SequenceNumber            seqno;
      std::uint16_t             ttl = 64;
      std::string               to_string() const
      {
         return "seqno request: " + producer.str() + " seqno=" + std::to_string(seqno.value) +
                " ttl=" + std::to_string(ttl);
      }
   };
   PSIO_REFLECT(RouteSeqnoRequest, producer, seqno, ttl)

   struct RequestRoutesMessage
   {
      static constexpr unsigned type = 6;
      std::string               to_string() const { return "request routes"; }
   };
   PSIO_REFLECT(RequestRoutesMessage)

   struct RoutingEnvelope
   {
      static constexpr unsigned type = 3;
      producer_id               destination;
      std::vector<char>         data;
      std::string               to_string() const { return "wrapped message"; }
   };
   PSIO_REFLECT(RoutingEnvelope, destination, data)

   template <typename Derived>
   struct shortest_path_routing : routing_base<Derived>
   {
      using base_type = routing_base<Derived>;
      using base_type::async_send;
      using base_type::chain;
      using base_type::consensus;
      using base_type::peers;
      using base_type::recv;

      static constexpr peer_id min_peer               = std::numeric_limits<peer_id>::min();
      static constexpr auto    minSeqnoUpdateInterval = std::chrono::seconds(1);
      static constexpr auto    seqnoCacheMaxAge       = std::chrono::seconds(30);
      struct RouteKey
      {
         producer_id producer;
         peer_id     peer;
         friend auto operator<=>(const RouteKey& lhs, const RouteKey& rhs) = default;
         friend auto operator<=>(const RouteKey& lhs, const producer_id& rhs)
         {
            return lhs.producer <=> rhs;
         }
      };
      struct RouteData
      {
         SequenceNumber seqno;
         RouteMetric    metric;
         auto           feasibility() const { return Feasibility(seqno, metric); }
      };
      struct NeighborData
      {
         RouteMetric transmissionCost = 1;
      };
      struct CachedSeqnoRequest
      {
         SequenceNumber                        seqno;
         std::chrono::steady_clock::time_point time;
      };

      explicit shortest_path_routing(boost::asio::io_context& ctx) : base_type(ctx)
      {
         logger.add_attribute("Channel", boost::log::attributes::constant(std::string("p2p")));
      }

      template <typename Msg>
      void multicast(const Msg& msg)
      {
         for (const auto& [peer, _] : neighborTable)
         {
            async_send(peer, msg);
         }
      }
      template <typename Msg>
      void multicast_producers(const Msg& msg)
      {
         for (const auto& [producer, peer] : selectedRoutes)
         {
            sendto(producer, msg);
         }
      }
      template <typename Msg>
      void sendto(producer_id producer, const Msg& msg)
      {
         trySend(producer, RoutingEnvelope{producer, this->serialize_message(msg)});
      }
      void connect(peer_id peer)
      {
         base_type::connect(peer);
         neighborTable.try_emplace(peer, NeighborData{RouteMetric{1}});
         send_routes(peer);
         consensus().connect(peer);
      }
      void disconnect(peer_id peer)
      {
         consensus().disconnect(peer);
         auto iter = routeTable.begin();
         auto end  = routeTable.end();
         while (iter != end)
         {
            if (iter->first.peer == peer)
            {
               iter = routeTable.erase(iter);
            }
            else
            {
               ++iter;
            }
         }
         neighborTable.erase(peer);
         for (auto [producer, selected] : selectedRoutes)
         {
            if (selected == peer)
            {
               selectRoute(producer, peer);
            }
         }
      }
      void send_routes(peer_id peer)
      {
         for (const auto& [producer, nextPeer] : selectedRoutes)
         {
            auto route = routeTable.find(RouteKey{producer, nextPeer});
            if (route != routeTable.end())
            {
               async_send(peer,
                          RouteUpdateMessage{producer, route->second.seqno, getMetric(*route)});
            }
         }
         if (auto self = consensus().producer_name(); consensus().is_producer(self))
         {
            async_send(peer, RouteUpdateMessage{self, seqno, RouteMetric{0}});
         }
      }
      void on_producer_change()
      {
         PSIBASE_LOG(logger, debug) << "Cleaning up routes to inactive producers";
         // purge out-dated routes
         auto self = consensus().producer_name();
         for (auto iter = selectedRoutes.begin(), end = selectedRoutes.end(); iter != end;)
         {
            if (consensus().is_producer(iter->first) && iter->first != self)
            {
               ++iter;
            }
            else
            {
               iter = selectedRoutes.erase(iter);
            }
         }
         for (auto iter = routeTable.begin(), end = routeTable.end(); iter != end;)
         {
            auto next = routeTable.upper_bound(iter->first.producer);
            if (!consensus().is_producer(iter->first.producer) || iter->first.producer == self)
            {
               routeTable.erase(iter, next);
            }
            iter = next;
         }
         for (auto iter = sourceTable.begin(), end = sourceTable.end(); iter != end;)
         {
            if (consensus().is_producer(iter->first) && iter->first != self)
            {
               ++iter;
            }
            else
            {
               iter = sourceTable.erase(iter);
            }
         }
         // If we became a producer, we need to establish a new route
         if (consensus().is_producer(self))
         {
            multicast(RouteUpdateMessage{self, seqno, RouteMetric{0}});
         }
         // Sync our routing table with all peers
         multicast(RequestRoutesMessage{});
      }
      bool isFeasible(std::pair<const RouteKey, RouteData>& route)
      {
         if (route.second.metric == RouteMetric::infinite)
         {
            return true;
         }
         auto pos = sourceTable.find(route.first.producer);
         if (pos == sourceTable.end())
         {
            return true;
         }
         return route.second.feasibility() < pos->second;
      }
      void updateRoute(std::pair<const RouteKey, RouteData>& route, const RouteUpdateMessage& msg)
      {
         route.second.metric = msg.metric;
         route.second.seqno  = msg.seqno;
         selectRoute(route.first.producer, route.first.peer);
      }
      bool isSelected(const RouteKey& key)
      {
         auto iter = selectedRoutes.find(key.producer);
         return iter != selectedRoutes.end() && iter->second == key.peer;
      }
      RouteMetric getMetric(const std::pair<const RouteKey, RouteData>& route) const
      {
         auto iter = neighborTable.find(route.first.peer);
         if (iter == neighborTable.end())
         {
            return RouteMetric::infinite;
         }
         return route.second.metric + iter->second.transmissionCost;
      }
      void selectRoute(std::pair<const RouteKey, RouteData>& route, peer_id updatedRoute)
      {
         auto [iter, updated] = selectedRoutes.try_emplace(route.first.producer, route.first.peer);
         if (!updated)
         {
            if (iter->second != route.first.peer)
            {
               updated      = true;
               iter->second = route.first.peer;
            }
         }
         if (updated || route.first.peer == updatedRoute)
         {
            auto metric = getMetric(route);
            PSIBASE_LOG(peers().logger(route.first.peer), debug)
                << (updated ? "New" : "Updated") << " route for " << route.first.producer.str()
                << " seqno=" << route.second.seqno.value << " metric=" << metric.value;
            auto feasibility     = Feasibility{route.second.seqno, metric};
            auto [pos, inserted] = sourceTable.try_emplace(route.first.producer, feasibility);
            if (!inserted && feasibility < pos->second)
            {
               pos->second = feasibility;
            }
            multicast(RouteUpdateMessage{route.first.producer, route.second.seqno, metric});
         }
      }
      void selectRoute(producer_id producer, peer_id updated)
      {
         auto iter        = routeTable.lower_bound(RouteKey{producer, min_peer});
         auto end         = routeTable.end();
         auto best_metric = RouteMetric::infinite;
         auto best_iter   = end;
         while (iter != end && iter->first.producer == producer)
         {
            if (isFeasible(*iter))
            {
               auto metric = getMetric(*iter);
               if (metric < best_metric)
               {
                  best_metric = metric;
                  best_iter   = iter;
               }
            }
            ++iter;
         }
         if (best_iter != end)
         {
            selectRoute(*best_iter, updated);
         }
         else if (selectedRoutes.erase(producer) != 0)
         {
            sendSeqnoRequest(producer);
            multicast(RouteUpdateMessage{producer, {}, RouteMetric::infinite});
         }
      }
      void sendSeqnoRequest(producer_id producer)
      {
         auto iter = sourceTable.find(producer);
         if (iter != sourceTable.end())
         {
            multicast(RouteSeqnoRequest{producer, iter->second.seqno + 1});
         }
      }
      void recv(peer_id peer, const RouteUpdateMessage& msg)
      {
         PSIBASE_LOG(peers().logger(peer), debug) << "Received message: " << msg.to_string();
         if (msg.producer == consensus().producer_name())
         {
            return;
         }
         if (!consensus().is_producer(msg.producer))
         {
            PSIBASE_LOG(peers().logger(peer), debug)
                << "Ignoring route because " << msg.producer.str() << " is not an active producer";
            return;
         }
         auto iter = routeTable.find(RouteKey{msg.producer, peer});
         if (iter == routeTable.end())
         {
            if (msg.metric != RouteMetric::infinite)
            {
               routeTable.try_emplace(RouteKey{msg.producer, peer}, seqno, msg.metric);
               selectRoute(msg.producer, peer);
            }
         }
         else
         {
            updateRoute(*iter, msg);
         }
      }
      void recv(peer_id peer, const RequestRoutesMessage& msg)
      {
         PSIBASE_LOG(peers().logger(peer), debug) << "Received message: " << msg.to_string();
         send_routes(peer);
      }
      RouteUpdateMessage makeUpdate(producer_id producer)
      {
         auto selected = selectedRoutes.find(producer);
         if (selected != selectedRoutes.end())
         {
            auto route = routeTable.find(RouteKey{producer, selected->second});
            if (route != routeTable.end())
            {
               return {producer, route->second.seqno, getMetric(*route)};
            }
         }
         return {producer, {}, RouteMetric::infinite};
      }
      template <typename T>
      bool trySend(producer_id prod, const T& msg)
      {
         auto selected = selectedRoutes.find(prod);
         if (selected != selectedRoutes.end())
         {
            async_send(selected->second, msg);
            return true;
         }
         else
         {
            return false;
         }
      }

      using message_type = std::
          variant<RouteUpdateMessage, RouteSeqnoRequest, RequestRoutesMessage, RoutingEnvelope>;

      void recv(peer_id peer, const RouteSeqnoRequest& msg)
      {
         PSIBASE_LOG(peers().logger(peer), debug) << "Received message: " << msg.to_string();
         if (auto response = makeUpdate(msg.producer);
             response.metric != RouteMetric::infinite && response.seqno >= msg.seqno)
         {
            async_send(peer, response);
         }
         else if (msg.producer == consensus().producer_name())
         {
            incrementSeqno();
         }
         else if (msg.ttl >= 2)
         {
            forwardSeqnoRequest(msg);
         }
      }
      void recv(peer_id peer, RoutingEnvelope&& msg)
      {
         PSIBASE_LOG(peers().logger(peer), debug) << "Received message: " << msg.to_string();
         if (msg.destination == consensus().producer_name())
         {
            recv(peer, std::move(msg.data));
         }
         else
         {
            trySend(msg.destination, msg);
         }
      }
      void incrementSeqno()
      {
         auto now = std::chrono::steady_clock::now();
         if (now - lastSeqnoUpdate > minSeqnoUpdateInterval)
         {
            seqno = seqno + 1;
            multicast(RouteUpdateMessage{consensus().producer_name(), seqno, 0});
            lastSeqnoUpdate = now;
         }
      }
      bool cacheSeqnoRequest(const RouteSeqnoRequest& msg)
      {
         auto now              = std::chrono::steady_clock::now();
         auto [iter, inserted] = recentSeqnoRequests.try_emplace(msg.producer, msg.seqno, now);
         if (inserted)
         {
            return true;
         }
         if (now - iter->second.time <= seqnoCacheMaxAge && iter->second.seqno == msg.seqno)
         {
            return false;
         }
         else
         {
            iter->second.seqno = msg.seqno;
            iter->second.time  = now;
            return true;
         }
      }
      void forwardSeqnoRequest(RouteSeqnoRequest msg)
      {
         --msg.ttl;
         if (!cacheSeqnoRequest(msg))
            return;
         if (!trySend(msg.producer, msg))
         {
            auto    bestMetric = RouteMetric::infinite;
            peer_id bestRoute;
            for (const auto& route : getRoutes(msg.producer))
            {
               auto metric = getMetric(route);
               if (metric < bestMetric)
               {
                  bestMetric = metric;
                  bestRoute  = route.first.peer;
               }
            }
            if (bestMetric != RouteMetric::infinite)
            {
               async_send(bestRoute, msg);
            }
         }
      }
      auto getRoutes(producer_id producer)
      {
         auto [begin, end] = routeTable.equal_range(producer);
         return std::ranges::subrange(begin, end);
      }
      SequenceNumber                             seqno;
      std::chrono::steady_clock::time_point      lastSeqnoUpdate;
      std::map<peer_id, NeighborData>            neighborTable;
      std::map<RouteKey, RouteData, std::less<>> routeTable;
      std::map<producer_id, Feasibility>         sourceTable;
      std::map<producer_id, peer_id>             selectedRoutes;

      std::map<producer_id, CachedSeqnoRequest> recentSeqnoRequests;

      loggers::common_logger logger;
   };
}  // namespace psibase::net
