#pragma once

#include <psibase/log.hpp>

#include <boost/asio/io_context.hpp>
#include <cassert>
#include <deque>
#include <functional>
#include <iostream>
#include <vector>

namespace psibase::net
{
   template <typename Node>
   struct mock_network;

   template <typename Derived>
   struct mock_routing
   {
      explicit mock_routing(boost::asio::io_context& ctx) : ctx(ctx)
      {
         logger.add_attribute("Channel", boost::log::attributes::constant(std::string("p2p")));
      }
      void post_recv(peer_id origin, const auto& msg)
      {
         ctx.post(
             [msg, this, origin]()
             {
                if (auto iter = _peers.find(origin); iter != _peers.end())
                {
                   PSIBASE_LOG(logger, debug)
                       << static_cast<Derived*>(iter->second.first)->producer_name().str() << "->"
                       << static_cast<Derived*>(this)->producer_name().str() << ": "
                       << msg.to_string() << std::endl;
                   static_cast<Derived*>(this)->recv(origin, msg);
                }
             });
      }
      template <typename Msg, typename F>
      void async_send_block(peer_id id, const Msg& msg, F&& f)
      {
         auto peer = _peers.find(id);
         if (peer == _peers.end())
         {
            throw std::runtime_error("unknown peer");
         }
         peer->second.first->post_recv(peer->second.second, msg);
         ctx.post([f]() { f(std::error_code()); });
      }
      template <typename Msg>
      void multicast_producers(const Msg& msg)
      {
         for (const auto& [id, peer] : _peers)
         {
            peer.first->post_recv(peer.second, msg);
         }
      }
      template <typename Msg>
      void sendto(producer_id producer, const Msg& msg)
      {
         for (const auto& [id, peer] : _peers)
         {
            if (static_cast<Derived*>(peer.first)->producer_name() == producer)
            {
               peer.first->post_recv(peer.second, msg);
            }
         }
      }
      void add_peer(mock_routing* other)
      {
         auto* p1 = add_peer_impl(other);
         auto* p2 = other->add_peer_impl(this);
         std::swap(*p1, *p2);
         static_cast<Derived*>(this)->consensus().connect(*p2);
         static_cast<Derived*>(other)->consensus().connect(*p1);
      }
      void remove_peer(mock_routing* other)
      {
         for (auto [id, data] : _peers)
         {
            if (data.first == other)
            {
               _peers.erase(id);
               other->_peers.erase(data.second);
               static_cast<Derived*>(this)->consensus().disconnect(id);
               static_cast<Derived*>(other)->consensus().disconnect(data.second);
               return;
            }
         }
         assert(!"Unknown peer");
      }
      peer_id* add_peer_impl(mock_routing* other)
      {
         peer_id id    = next_peer_id++;
         auto [pos, _] = _peers.insert({id, {other, id}});
         return &pos->second.second;
      }
      boost::asio::io_context&                             ctx;
      peer_id                                              next_peer_id = 0;
      std::map<peer_id, std::pair<mock_routing*, peer_id>> _peers;
      loggers::common_logger                               logger;
   };

}  // namespace psibase::net
