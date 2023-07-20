#pragma once

#include <boost/mp11/algorithm.hpp>
#include <cstdint>
#include <psibase/SignedMessage.hpp>
#include <psibase/log.hpp>
#include <psibase/message_serializer.hpp>
#include <psibase/net_base.hpp>
#include <psio/fracpack.hpp>
#include <psio/reflect.hpp>
#include <random>
#include <string>
#include <type_traits>
#include <variant>
#include <vector>

namespace psibase::net
{
   // message type 0 is reserved to ensure that message signatures
   // are disjoint from block signatures.
   // message types 1-31 are used for routing messages
   // message types 32-63 are used for consensus messages
   struct InitMessage
   {
      static constexpr unsigned type = 1;
      std::uint32_t             version;
      NodeId                    id;
      std::string to_string() const { return "init: version=" + std::to_string(version); }
   };
   PSIO_REFLECT(InitMessage, version, id);

   template <typename T>
   concept has_block_id = requires(T& t) { t.block_id; };

   template <typename Derived>
   struct routing_base : message_serializer<Derived>
   {
      auto& peers() { return static_cast<Derived*>(this)->peers(); }
      auto& consensus() { return static_cast<Derived*>(this)->consensus(); }
      auto& chain() { return static_cast<Derived*>(this)->chain(); }
      auto& derived() { return static_cast<Derived*>(this)->network(); }
      explicit routing_base(boost::asio::io_context& ctx)
      {
         std::random_device rng;
         nodeId = std::uniform_int_distribution<NodeId>()(rng);
      }
      static const std::uint32_t protocol_version = 0;
      // This is used solely for type deduction
      auto get_message_impl()
      {
         return boost::mp11::mp_append<
             typename std::remove_cvref_t<
                 decltype(static_cast<Derived*>(this)->consensus())>::message_type,
             typename std::remove_cvref_t<
                 decltype(static_cast<Derived*>(this)->network())>::message_type,
             std::variant<InitMessage>>{};
      }
      template <typename Msg, typename F>
      void async_send(peer_id id, const Msg& msg, F&& f)
      {
         PSIBASE_LOG(peers().logger(id), debug) << "Sending message: " << msg.to_string();
         peers().async_send(id, this->serialize_message(msg), std::forward<F>(f));
      }
      template <typename Msg>
      void async_send(peer_id id, const Msg& msg)
      {
         return async_send(id, msg, [](const std::error_code&) {});
      }
      struct connection;
      void connect(peer_id id)
      {
         async_send(id, InitMessage{.version = protocol_version, .id = nodeId});
      }
      void disconnect(peer_id id) {}
      template <template <typename...> class L, typename... T>
      static constexpr bool check_message_uniqueness(L<T...>*)
      {
         std::uint8_t ids[] = {T::type...};
         for (std::size_t i = 0; i < sizeof(ids) - 1; ++i)
         {
            for (std::size_t j = i + 1; j < sizeof(ids); ++j)
            {
               if (ids[i] == ids[j])
               {
                  return false;
               }
            }
         }
         return true;
      }
      template <typename T>
      void try_recv_impl(peer_id peer, psio::input_stream& s)
      {
         try
         {
            using message_type = std::conditional_t<NeedsSignature<T>, SignedMessage<T>, T>;
            return derived().recv(peer, psio::from_frac<message_type>({s.pos, s.end}));
         }
         catch (std::exception& e)
         {
            PSIBASE_LOG(peers().logger(peer), warning) << e.what();
            peers().disconnect(peer);
         }
      }
      template <template <typename...> class L, typename... T>
      void recv_impl(peer_id peer, int key, std::vector<char>&& msg, L<T...>*)
      {
         psio::input_stream s(msg.data() + 1, msg.size() - 1);
         ((key == T::type ? try_recv_impl<T>(peer, s) : (void)0), ...);
      }
      void recv(peer_id peer, std::vector<char>&& msg)
      {
         using message_type = decltype(get_message_impl());
         static_assert(check_message_uniqueness((message_type*)nullptr));
         if (msg.empty())
         {
            PSIBASE_LOG(peers().logger(peer), warning) << "Invalid message";
            peers().disconnect(peer);
            return;
         }
         recv_impl(peer, msg[0], std::move(msg), (message_type*)0);
      }
      void recv(peer_id peer, const InitMessage& msg)
      {
         PSIBASE_LOG(peers().logger(peer), debug) << "Received message: " << msg.to_string();
         if (msg.version != protocol_version)
         {
            peers().disconnect(peer);
            return;
         }
         if (msg.id)
         {
            peers().set_node_id(peer, msg.id);
         }
      }
      template <typename T>
      void recv(peer_id peer, const SignedMessage<T>& msg)
      {
         std::vector<char> raw;
         raw.reserve(msg.data.size() + 1);
         raw.push_back(T::type);
         raw.insert(raw.end(), msg.data.data(), msg.data.data() + msg.data.size());
         Claim claim = msg.data->signer();
         PSIBASE_LOG(peers().logger(peer), debug) << "Received message: " << msg.to_string();
         if constexpr (has_block_id<T>)
         {
            chain().verify(msg.data->block_id(), {raw.data(), raw.size()}, claim, msg.signature);
         }
         else
         {
            chain().verify({raw.data(), raw.size()}, claim, msg.signature);
         }
         if constexpr (has_recv<SignedMessage<T>, Derived>)
         {
            consensus().recv(peer, msg);
         }
         else
         {
            consensus().recv(peer, msg.data.unpack());
         }
      }
      void recv(peer_id peer, const auto& msg)
      {
         PSIBASE_LOG(peers().logger(peer), debug) << "Received message: " << msg.to_string();
         consensus().recv(peer, msg);
      }
      NodeId nodeId = 0;
   };
}  // namespace psibase::net
