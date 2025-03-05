#pragma once

#include <psibase/log.hpp>
#include <psibase/message_serializer.hpp>
#include <psibase/mock_timer.hpp>

#include <boost/asio/io_context.hpp>
#include <boost/asio/post.hpp>
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
   struct mock_routing : message_serializer<Derived>
   {
      using DeferredMessageKey = std::tuple<peer_id, Checksum256>;
      struct peer_info
      {
         mock_routing*              ptr;
         peer_id                    rid;
         test::mock_clock::duration latency;
      };
      explicit mock_routing(boost::asio::io_context& ctx) : ctx(ctx)
      {
         logger.add_attribute("Channel", boost::log::attributes::constant(std::string("p2p")));
      }
      void on_producer_change() {}
      void post_recv(peer_id origin, const auto& msg)
      {
         boost::asio::post(
             ctx,
             [msg, this, origin]()
             {
                if (auto iter = _peers.find(origin); iter != _peers.end())
                {
                   PSIBASE_LOG(logger, debug)
                       << static_cast<Derived*>(iter->second.ptr)->producer_name().str() << "->"
                       << static_cast<Derived*>(this)->producer_name().str() << ": "
                       << msg.to_string() << std::endl;
                   static_cast<Derived*>(this)->recv(origin, maybe_sign_message(msg));
                }
             });
      }
      template <typename T>
      static auto maybe_sign_message(const T& message)
      {
         if constexpr (has_recv<SignedMessage<T>, Derived>)
         {
            return SignedMessage<T>{message};
         }
         else
         {
            return message;
         }
      }
      void send(const peer_info& peer, const auto& message)
      {
         if (peer.latency == test::mock_clock::duration())
         {
            peer.ptr->post_recv(peer.rid, message);
         }
         else
         {
            defer.post_after(ctx, peer.latency,
                             [ptr = peer.ptr, origin = peer.rid, message](const std::error_code&)
                             { ptr->post_recv(origin, message); });
         }
      }
      template <typename Msg>
      void async_send(peer_id id, const Msg& msg)
      {
         auto peer = _peers.find(id);
         if (peer == _peers.end())
         {
            throw std::runtime_error("unknown peer");
         }
         send(peer->second, msg);
      }
      template <typename Msg, typename F>
      void async_send(peer_id id, const Msg& msg, F&& f)
      {
         async_send(id, msg);
         boost::asio::post(ctx, [f]() { f(std::error_code()); });
      }
      template <typename Msg>
      void multicast_producers(const Msg& msg)
      {
         multicast(msg);
      }
      template <typename Msg>
      void multicast_producers(const Checksum256& blockid, const Msg& msg)
      {
         for (const auto& [id, peer] : _peers)
         {
            send_after_block(id, blockid, msg);
         }
      }
      template <typename Msg>
      void multicast(const Msg& msg)
      {
         for (const auto& [id, peer] : _peers)
         {
            send(peer, msg);
         }
      }
      template <typename Msg>
      void send_after_block(peer_id peer, const Checksum256& blockid, const Msg& msg)
      {
         if (static_cast<Derived*>(this)->consensus().peer_has_block(peer, blockid))
         {
            async_send(peer, msg);
         }
         else
         {
            deferredMessages.try_emplace({peer, blockid},
                                         [this, peer, msg] { async_send(peer, msg); });
         }
      }
      void on_peer_block(peer_id peer, const Checksum256& blockid)
      {
         auto r = deferredMessages.equal_range({peer, blockid});
         for (const auto& [k, f] : std::ranges::subrange(r.first, r.second))
         {
            f();
         }
         deferredMessages.erase(r.first, r.second);
      }
      template <typename Msg>
      void sendto(producer_id producer, const Msg& msg)
      {
         for (const auto& [id, peer] : _peers)
         {
            if (static_cast<Derived*>(peer.ptr)->producer_name() == producer)
            {
               send(peer, msg);
            }
         }
      }
      void add_peer(mock_routing* other, test::mock_clock::duration latency = {})
      {
         auto* p1 = add_peer_impl(other, latency);
         auto* p2 = other->add_peer_impl(this, latency);
         std::swap(*p1, *p2);
         static_cast<Derived*>(this)->consensus().connect(*p2);
         static_cast<Derived*>(other)->consensus().connect(*p1);
      }
      void remove_peer(mock_routing* other)
      {
         for (auto [id, data] : _peers)
         {
            if (data.ptr == other)
            {
               _peers.erase(id);
               other->_peers.erase(data.rid);
               static_cast<Derived*>(this)->consensus().disconnect(id);
               static_cast<Derived*>(other)->consensus().disconnect(data.rid);
               return;
            }
         }
         assert(!"Unknown peer");
      }
      bool has_peer(mock_routing* other)
      {
         for (const auto& [id, data] : _peers)
         {
            if (data.ptr == other)
            {
               return true;
            }
         }
         return false;
      }
      peer_id* add_peer_impl(mock_routing* other, test::mock_clock::duration latency)
      {
         peer_id id    = next_peer_id++;
         auto [pos, _] = _peers.insert({id, {other, id, latency}});
         return &pos->second.rid;
      }
      boost::asio::io_context&     ctx;
      test::mock_execution_context defer;
      peer_id                      next_peer_id = 0;
      std::map<peer_id, peer_info> _peers;
      loggers::common_logger       logger;
      // Stores messages that should be sent to a peer after the
      // peer is known to have a particular block.
      std::map<DeferredMessageKey, std::function<void()>> deferredMessages;
   };

}  // namespace psibase::net
