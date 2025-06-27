#pragma once

// Implements a Bellman-Ford based routing algorithm using the feasibility
// condition from babel (RFC8966) to prevent routing loops
//
// Note that this protocol allows routing to producers only.
// Other nodes act purely as routers from the standpoint of this protocol.

#include <psibase/log.hpp>
#include <psibase/net_base.hpp>
#include <psibase/routing_base.hpp>

#include <boost/asio/steady_timer.hpp>
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

   template <typename Derived, typename Msg>
   concept has_validate_message =
       requires(Derived& d, const Msg& msg) { d.consensus().validate_message(msg); };

   using RouterId = std::uint64_t;

   struct RouteUpdateMessage
   {
      static constexpr unsigned type = 4;
      producer_id               producer;
      SequenceNumber            seqno;
      RouteMetric               metric;
      std::optional<RouterId>   router;
      std::string               to_string() const
      {
         return "route update: " + producer.str() + " seqno=" + std::to_string(seqno.value) +
                " metric=" + std::to_string(metric.value);
      }
   };
   PSIO_REFLECT(RouteUpdateMessage, producer, seqno, metric, router)

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
      std::string               to_string(auto* serializer) const
      {
         return "to " + destination.str() + ": " + serializer->message_to_string(data);
      }
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
      struct SourceKey
      {
         producer_id producer;
         RouterId    router;
         friend auto operator<=>(const SourceKey&, const SourceKey&) = default;
      };
      struct SelectedRoute
      {
         RouterId    router;
         peer_id     peer;
         friend bool operator==(const SelectedRoute&, const SelectedRoute&) = default;
      };
      struct RouteKey
      {
         producer_id producer;
         RouterId    router;
         peer_id     peer;
         friend auto operator<=>(const RouteKey& lhs, const RouteKey& rhs) = default;
         friend auto operator<=>(const RouteKey& lhs, const producer_id& rhs)
         {
            return lhs.producer <=> rhs;
         }
         SelectedRoute selected() const { return SelectedRoute{router, peer}; }
         SourceKey     sourceKey() const { return SourceKey{producer, router}; }
      };
      struct RouteData
      {
         SequenceNumber seqno;
         RouteMetric    metric;
         auto           feasibility() const { return Feasibility(seqno, metric); }
      };
      struct NeighborData
      {
         RouteMetric transmissionCost = {1};
      };
      struct CachedSeqnoRequest
      {
         SequenceNumber                        seqno;
         std::chrono::steady_clock::time_point time;
      };

      struct DeferredMessage
      {
         using MessageKey = std::tuple<peer_id, Checksum256>;
         peer_id           peer;
         Checksum256       blockid;
         std::vector<char> message;
         friend auto       operator<=>(const DeferredMessage&, const DeferredMessage&) = default;
         friend auto       operator<=>(const DeferredMessage& lhs, const peer_id& rhs)
         {
            return lhs.peer <=> rhs;
         }
         friend auto operator<=>(const DeferredMessage& lhs, const MessageKey& rhs)
         {
            return MessageKey{lhs.peer, lhs.blockid} <=> rhs;
         }
      };

      explicit shortest_path_routing(boost::asio::io_context& ctx) : base_type(ctx), seqnoTimer(ctx)
      {
         logger.add_attribute("Channel", boost::log::attributes::constant(std::string("p2p")));
         std::random_device rng;

         // We don't reuse the nodeId, because nodeId could be
         // kept across node restarts.
         // routerId is linked to seqno. If we reuse a routerId, we also
         // have to preserve seqno. We're not do that.
         routerId = std::uniform_int_distribution<RouterId>()(rng);
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
      void multicast_producers(const Checksum256& id, const Msg& msg)
      {
         for (const auto& [producer, selected] : selectedRoutes)
         {
            send_after_block(selected.peer, id,
                             RoutingEnvelope{producer, this->serialize_message(msg)});
         }
      }
      template <typename Msg>
      void multicast_producers(const Msg& msg)
      {
         for (const auto& [producer, selected] : selectedRoutes)
         {
            sendto(producer, msg);
         }
      }
      template <typename Msg>
      void sendto(producer_id producer, const Checksum256& id, const Msg& msg)
      {
         auto selected = selectedRoutes.find(producer);
         if (selected != selectedRoutes.end())
         {
            send_after_block(selected->second.peer, id,
                             RoutingEnvelope{producer, this->serialize_message(msg)});
         }
         else
         {
            PSIBASE_LOG(logger, debug)
                << "Message discarded for lack of a route to " << msg.destination.str();
         }
      }
      template <typename Msg>
      void sendto(producer_id producer, const Msg& msg)
      {
         trySend(producer, RoutingEnvelope{producer, this->serialize_message(msg)});
      }
      template <typename Msg>
      void send_after_block(peer_id peer, const Checksum256& blockid, const Msg& msg)
      {
         if (consensus().peer_has_block(peer, blockid))
         {
            async_send(peer, msg);
         }
         else
         {
            deferredMessages.insert({peer, blockid, this->serialize_message(msg)});
         }
      }
      void on_peer_block(peer_id peer, const Checksum256& blockid)
      {
         auto r = deferredMessages.equal_range(std::tuple{peer, blockid});
         for (const auto& value : std::ranges::subrange(r.first, r.second))
         {
            async_send(peer, value.message);
         }
         deferredMessages.erase(r.first, r.second);
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
         for (auto iter = selectedRoutes.begin(), end = selectedRoutes.end(); iter != end;)
         {
            auto next = iter;
            ++next;
            if (iter->second.peer == peer)
            {
               selectRoute(iter->first, peer);
            }
            iter = next;
         }
      }
      void send_routes(peer_id peer)
      {
         for (const auto& [producer, nextPeer] : selectedRoutes)
         {
            auto route = routeTable.find(RouteKey{producer, nextPeer.router, nextPeer.peer});
            if (route != routeTable.end())
            {
               async_send(peer, RouteUpdateMessage{producer, route->second.seqno, getMetric(*route),
                                                   nextPeer.router});
            }
         }
         if (auto self = consensus().producer_name(); consensus().is_producer(self))
         {
            async_send(peer, RouteUpdateMessage{self, seqno, RouteMetric{0}, routerId});
         }
      }
      void on_producer_change()
      {
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
               PSIBASE_LOG(logger, info) << "Removed route to " << iter->first.str();
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
            if (consensus().is_producer(iter->first.producer) && iter->first.producer != self)
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
            multicast(RouteUpdateMessage{self, seqno, RouteMetric{0}, routerId});
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
         auto pos = sourceTable.find(route.first.sourceKey());
         if (pos == sourceTable.end())
         {
            return true;
         }
         return route.second.feasibility() < pos->second;
      }
      void updateRoute(std::pair<const RouteKey, RouteData>& route, const RouteUpdateMessage& msg)
      {
         if (route.second.metric != msg.metric || route.second.seqno != msg.seqno)
         {
            route.second.metric = msg.metric;
            route.second.seqno  = msg.seqno;
            selectRoute(route.first.producer, route.first.peer);
         }
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
         auto [iter, updated] =
             selectedRoutes.try_emplace(route.first.producer, route.first.selected());
         if (!updated)
         {
            if (iter->second != route.first.selected())
            {
               updated      = true;
               iter->second = route.first.selected();
            }
         }
         if (updated || route.first.peer == updatedRoute)
         {
            auto metric = getMetric(route);
            PSIBASE_LOG(peers().logger(route.first.peer), info)
                << (updated ? "New" : "Updated") << " route for " << route.first.producer.str()
                << " seqno=" << route.second.seqno.value << " metric=" << metric.value;
            auto feasibility     = Feasibility{route.second.seqno, metric};
            auto [pos, inserted] = sourceTable.try_emplace(route.first.sourceKey(), feasibility);
            if (!inserted && feasibility < pos->second)
            {
               pos->second = feasibility;
            }
            multicast(RouteUpdateMessage{route.first.producer, route.second.seqno, metric,
                                         route.first.router});
         }
      }
      void selectRoute(producer_id producer, peer_id updated)
      {
         auto iter        = routeTable.lower_bound(producer);
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
         else if (auto removedPos = selectedRoutes.find(producer);
                  removedPos != selectedRoutes.end())
         {
            auto router = removedPos->second.router;
            selectedRoutes.erase(removedPos);
            PSIBASE_LOG(logger, info) << "No feasible route to " << producer.str();
            multicast(RouteUpdateMessage{producer, {}, RouteMetric::infinite, router});
            sendSeqnoRequest(producer, router);
         }
      }
      void sendSeqnoRequest(producer_id producer, RouterId router)
      {
         auto iter = sourceTable.find(SourceKey{producer, router});
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
         auto routeKey = RouteKey{msg.producer, msg.router.value_or(0), peer};
         auto iter     = routeTable.find(routeKey);
         if (iter == routeTable.end())
         {
            if (msg.metric != RouteMetric::infinite)
            {
               routeTable.try_emplace(routeKey, msg.seqno, msg.metric);
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
            auto route =
                routeTable.find(RouteKey{producer, selected->second.router, selected->second.peer});
            if (route != routeTable.end())
            {
               return {producer, route->second.seqno, getMetric(*route), selected->second.router};
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
            async_send(selected->second.peer, msg);
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
      template <typename T>
         requires has_validate_message<Derived, T>
      auto validate_message(const SignedMessage<T>& msg)
      {
         try
         {
            this->verify_signature(msg);
         }
         catch (std::runtime_error&)
         {
            return decltype(consensus().validate_message(*msg.data)){};
         }
         return consensus().validate_message(*msg.data);
      }
      template <typename T>
         requires has_validate_message<Derived, T>
      auto validate_message(const T& msg)
      {
         return consensus().validate_message(msg);
      }
      void recv(peer_id peer, RoutingEnvelope&& msg)
      {
         PSIBASE_LOG(peers().logger(peer), debug)
             << "Received message: to " << msg.destination.str() << ": "
             << this->message_to_string(msg.data);
         if (msg.destination == consensus().producer_name())
         {
            recv(peer, std::move(msg.data));
         }
         else
         {
            this->handle_message(msg.data,
                                 [&, this](const auto& deserialized)
                                 {
                                    if constexpr (requires { validate_message(deserialized); })
                                    {
                                       if (auto id = validate_message(deserialized))
                                       {
                                          auto selected = selectedRoutes.find(msg.destination);
                                          if (selected != selectedRoutes.end())
                                          {
                                             if constexpr (std::is_same_v<decltype(id), bool>)
                                             {
                                                this->async_send(selected->second.peer, msg);
                                             }
                                             else
                                             {
                                                send_after_block(selected->second.peer, *id, msg);
                                             }
                                          }
                                          else
                                          {
                                             PSIBASE_LOG(logger, debug)
                                                 << "Message discarded for lack of a route to "
                                                 << msg.destination.str();
                                          }
                                       }
                                    }
                                    else
                                    {
                                       PSIBASE_LOG(this->peers().logger(peer), warning)
                                           << "Wrong message type";
                                    }
                                 });
         }
      }
      void incrementSeqno()
      {
         auto now = std::chrono::steady_clock::now();
         if (now - lastSeqnoUpdate > minSeqnoUpdateInterval)
         {
            seqno = seqno + 1;
            multicast(RouteUpdateMessage{consensus().producer_name(), seqno, 0, routerId});
            lastSeqnoUpdate = now;
         }
         else
         {
            seqnoTimer.expires_at(lastSeqnoUpdate + minSeqnoUpdateInterval);
            seqnoTimer.async_wait(
                [this](const std::error_code& e)
                {
                   if (!e)
                   {
                      incrementSeqno();
                   }
                });
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
      RouterId                                   routerId = {};
      SequenceNumber                             seqno    = {};
      std::chrono::steady_clock::time_point      lastSeqnoUpdate;
      std::map<peer_id, NeighborData>            neighborTable;
      std::map<RouteKey, RouteData, std::less<>> routeTable;
      std::map<SourceKey, Feasibility>           sourceTable;
      std::map<producer_id, SelectedRoute>       selectedRoutes;

      std::map<producer_id, CachedSeqnoRequest> recentSeqnoRequests;
      boost::asio::steady_timer                 seqnoTimer;

      std::set<DeferredMessage, std::less<>> deferredMessages;

      loggers::common_logger logger;
   };
}  // namespace psibase::net
