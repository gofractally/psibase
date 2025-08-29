#pragma once

#include <boost/asio/connect.hpp>
#include <boost/asio/io_context.hpp>
#include <boost/asio/ip/tcp.hpp>
#include <boost/asio/read.hpp>
#include <boost/mp11/algorithm.hpp>
#include <iostream>
#include <memory>
#include <psibase/SignedMessage.hpp>
#include <psibase/log.hpp>
#include <psibase/net_base.hpp>
#include <psibase/routing_base.hpp>
#include <psio/fracpack.hpp>
#include <queue>
#include <random>
#include <vector>

namespace psibase::net
{
   struct ProducerMessage
   {
      static constexpr unsigned type = 2;
      producer_id               producer;
      std::string               to_string() const { return "producer: " + producer.str(); }
   };
   PSIO_REFLECT(ProducerMessage, producer)

   // This requires all producers to be peers
   template <typename Derived>
   struct direct_routing : routing_base<Derived>
   {
      using base_type = routing_base<Derived>;
      using base_type::async_send;
      using base_type::base_type;
      using base_type::chain;
      using base_type::consensus;
      using base_type::peers;
      using base_type::recv;

      using message_type = std::variant<ProducerMessage>;

      template <typename Msg, typename F>
      void async_send_block(peer_id id, const Msg& msg, F&& f)
      {
         async_send(id, msg, f);
      }
      // Sends a message to each peer in a list
      // each peer will receive the message only once even if it is duplicated in the input list.
      template <typename Msg>
      void async_multicast(std::vector<peer_id>&& dest, const Msg& msg)
      {
         std::sort(dest.begin(), dest.end());
         dest.erase(std::unique(dest.begin(), dest.end()), dest.end());
         auto serialized_message = this->serialize_message(msg);
         for (auto peer : dest)
         {
            PSIBASE_LOG(peers().logger(peer), debug) << "Sending message: " << msg.to_string();
            peers().async_send(peer, serialized_message, [](const std::error_code& ec) {});
         }
      }
      template <typename Msg>
      void multicast_producers(const Msg& msg)
      {
         std::vector<peer_id> producer_peers;
         for (auto [producer, peer] : producers)
         {
            producer_peers.push_back(peer);
         }
         async_multicast(std::move(producer_peers), msg);
      }
      template <typename Msg>
      void multicast(const Msg& msg)
      {
         // TODO: send to non-producers as well
         multicast_producers(msg);
      }
      template <typename Msg>
      void sendto(producer_id prod, const Msg& msg)
      {
         std::vector<peer_id> peers_for_producer;
         for (auto [iter, end] = producers.equal_range(prod); iter != end; ++iter)
         {
            peers_for_producer.push_back(iter->second);
         }
         async_multicast(std::move(peers_for_producer), msg);
      }
      bool is_reachable(producer_id prod) const { return producers.find(prod) != producers.end(); }
      struct connection;
      void connect(peer_id id)
      {
         base_type::connect(id);
         if (auto producer = static_cast<Derived*>(this)->consensus().producer_name();
             producer != AccountNumber())
         {
            async_send_block(id, ProducerMessage{producer}, [](const std::error_code&) {});
         }
         consensus().connect(id);
      }
      void disconnect(peer_id id)
      {
         consensus().disconnect(id);
         for (auto iter = producers.begin(), end = producers.end(); iter != end;)
         {
            if (iter->second == id)
            {
               iter = producers.erase(iter);
            }
            else
            {
               ++iter;
            }
         }
      }
      void recv(peer_id peer, const ProducerMessage& msg)
      {
         PSIBASE_LOG(peers().logger(peer), debug) << "Received message: " << msg.to_string();
         producers.insert({msg.producer, peer});
      }
      std::multimap<producer_id, peer_id> producers;
   };

}  // namespace psibase::net
