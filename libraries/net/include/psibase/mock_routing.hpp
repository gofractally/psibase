#pragma once

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
      template <typename Msg, typename F>
      void async_send_block(peer_id id, const Msg& msg, F&& f)
      {
         if (_network)
         {
            auto peer = _peers.find(id);
            if (peer == _peers.end())
            {
               throw std::runtime_error("unknown peer");
            }
            std::cout << std::to_string(static_cast<Derived*>(this)->producer_name()) << "->"
                      << std::to_string(static_cast<Derived*>(peer->second.first)->producer_name())
                      << ": ";
            _network->log(msg);
            _network->ctx.post(
                [msg, peer = &*peer, id, this]()
                {
                   if (_peers.find(id) != _peers.end())
                   {
                      static_cast<Derived*>(peer->second.first)->recv(peer->second.second, msg);
                   }
                });
            _network->ctx.post([f]() { f(std::error_code()); });
         }
      }
      template <typename Msg>
      void multicast_producers(const Msg& msg)
      {
         if (_network)
         {
            _network->multicast_producers(msg);
         }
      }
      template <typename Msg>
      void broadcast(const Msg& msg)
      {
         if (_network)
         {
            _network->broadcast(msg);
         }
      }
      template <typename Msg>
      void sendto(producer_id producer, const Msg& msg)
      {
         if (_network)
         {
            _network->sendto(producer, msg);
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
      mock_network<Derived>*                               _network     = nullptr;
      peer_id                                              next_peer_id = 0;
      std::map<peer_id, std::pair<mock_routing*, peer_id>> _peers;
   };

   template <typename Node>
   struct mock_network
   {
      mock_network(boost::asio::io_context& ctx) : ctx(ctx) {}
      template <typename Msg>
      void log(const Msg& msg)
      {
         std::cout << msg.to_string() << std::endl;
      }
      template <typename Msg>
      void multicast_producers(const Msg& msg)
      {
         log(msg);
         post(
             [this, msg]()
             {
                for (auto* node : nodes)
                {
                   if (node->is_producer())
                   {
                      node->recv(msg);
                   }
                }
             });
      }
      template <typename Msg>
      void broadcast(const Msg& msg)
      {
         log(msg);
         post(
             [this, msg]()
             {
                for (auto* node : nodes)
                {
                   if (node->is_producer())
                   {
                      node->recv(msg);
                   }
                }
             });
      }
      template <typename Msg>
      void sendto(producer_id prod, const Msg& msg)
      {
         log(msg);
         post(
             [this, msg, prod]()
             {
                for (auto* node : nodes)
                {
                   if (node->is_producer() && node->producer_name() == prod)
                   {
                      node->recv(msg);
                   }
                }
             });
      }
      template <typename F>
      void post(F&& f)
      {
         ctx.post(std::forward<F>(f));
      }
      void add(Node* n)
      {
         assert(n->_network == nullptr);
         n->_network = this;
         nodes.push_back(n);
      }
      void remove(Node* n)
      {
         assert(n->_network == this);
         n->_network = nullptr;
         nodes.erase(std::find(nodes.begin(), nodes.end(), n));
      }
      boost::asio::io_context& ctx;
      std::vector<Node*>       nodes;
   };
}  // namespace psibase::net
