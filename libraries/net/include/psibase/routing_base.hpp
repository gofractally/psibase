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

      std::optional<std::uint64_t> connection_id;

      std::string to_string() const
      {
         return "init: version=" + std::to_string(version) +
                (connection_id ? " connection_id=" + std::to_string(*connection_id) : "");
      }
   };
   PSIO_REFLECT(InitMessage, version, id, connection_id);

   struct DuplicateConnectionMessage
   {
      static constexpr unsigned type = 7;
      std::uint64_t             connection_id;
      bool                      secure;

      std::string to_string() const
      {
         return "duplicate connection: connection_id=" + std::to_string(connection_id) +
                (secure ? " secure" : "");
      }
   };
   PSIO_REFLECT(DuplicateConnectionMessage, connection_id, secure)

   struct HostnamesMessage
   {
      static constexpr unsigned type = 8;
      std::vector<std::string>  hosts;

      std::string to_string() const
      {
         std::string result = "hostnames:";
         for (const auto& host : hosts)
         {
            result += ' ';
            result += host;
         }
         return result;
      }
   };
   PSIO_REFLECT(HostnamesMessage, hosts)

   struct HostnamesAck
   {
      static constexpr unsigned type = 9;
      std::string               to_string() const { return "hostnames ack"; }
   };
   PSIO_REFLECT(HostnamesAck)

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
             std::variant<InitMessage, DuplicateConnectionMessage, HostnamesMessage,
                          HostnamesAck>>{};
      }
      std::string message_to_string(const auto& msg)
      {
         if constexpr (requires { msg.to_string(); })
         {
            return msg.to_string();
         }
         else if constexpr (requires { msg.to_string(this); })
         {
            return msg.to_string(this);
         }
         else
         {
            return "unknown message";
         }
      }
      template <typename Msg, typename F>
      void async_send(peer_id id, const Msg& msg, F&& f)
      {
         PSIBASE_LOG(peers().logger(id), debug) << "Sending message: " << message_to_string(msg);
         if constexpr (std::is_same_v<Msg, HostnamesMessage>)
         {
            peers().start_hostname_update(id);
         }
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
         async_send(id,
                    InitMessage{.version = protocol_version, .id = nodeId, .connection_id = id});
         async_send(id, HostnamesMessage{.hosts = myhosts});
      }
      void disconnect(peer_id id) {}
      bool should_close_duplicate(NodeId id) { return nodeId <= id; }
      void set_hostnames(const std::vector<std::string>& hosts)
      {
         myhosts = hosts;
         derived().multicast(HostnamesMessage{.hosts = myhosts});
      }
      DuplicateConnectionMessage make_duplicate_message(std::uint64_t connection_id, bool secure)
      {
         return DuplicateConnectionMessage{connection_id, secure};
      }
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
      std::string message_to_string(const std::vector<char>& msg)
      {
         std::string result;
         handle_message(msg, [&](const auto& m) { result = message_to_string(m); });
         return result;
      }
      template <typename T, typename F>
      void handle_message_impl(psio::input_stream& s, F&& f)
      {
         using message_type = std::conditional_t<NeedsSignature<T>, SignedMessage<T>, T>;
         f(psio::from_frac<message_type>({s.pos, s.end}));
      }
      template <typename F, template <typename...> class L, typename... T>
      void handle_message_impl(int key, const std::vector<char>& msg, F&& f, L<T...>*)
      {
         psio::input_stream s(msg.data() + 1, msg.size() - 1);
         ((key == T::type ? handle_message_impl<T>(s, f) : (void)0), ...);
      }
      template <typename F>
      void handle_message(const std::vector<char>& msg, F&& f)
      {
         using message_type = decltype(get_message_impl());
         if (!msg.empty())
         {
            handle_message_impl(msg[0], msg, f, (message_type*)0);
         }
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
            peers().set_node_id(peer, msg.id, msg.connection_id);
         }
      }
      void recv(peer_id peer, const DuplicateConnectionMessage& msg)
      {
         PSIBASE_LOG(peers().logger(peer), debug) << "Received message: " << msg.to_string();
         peers().on_duplicate(peer, msg.connection_id, msg.secure);
      }
      void recv(peer_id peer, const HostnamesMessage& msg)
      {
         PSIBASE_LOG(peers().logger(peer), debug) << "Received message: " << msg.to_string();
         peers().set_hosts(peer, std::vector(msg.hosts));
         async_send(peer, HostnamesAck{});
      }
      void recv(peer_id peer, const HostnamesAck& msg)
      {
         PSIBASE_LOG(peers().logger(peer), debug) << "Received message: " << msg.to_string();
         peers().finish_hostname_update(peer);
      }
      template <typename T>
      void verify_signature(const SignedMessage<T>& msg)
      {
         std::vector<char> raw;
         raw.reserve(msg.data.size() + 1);
         raw.push_back(T::type);
         raw.insert(raw.end(), msg.data.data(), msg.data.data() + msg.data.size());
         Claim claim = msg.data->signer();
         if constexpr (has_block_id<T>)
         {
            chain().verify(msg.data->block_id(), {raw.data(), raw.size()}, msg.data->producer(),
                           claim, msg.signature);
         }
         else
         {
            chain().verify({raw.data(), raw.size()}, claim, msg.signature);
         }
      }
      template <typename T>
      void recv(peer_id peer, const SignedMessage<T>& msg)
      {
         PSIBASE_LOG(peers().logger(peer), debug) << "Received message: " << msg.to_string();
         try
         {
            verify_signature(msg);
         }
         catch (std::runtime_error& e)
         {
            // We might fail to validate the signature due to being ahead or
            // behind the origin of the message. This is not an error, so just
            // drop the message. TODO: When verifying a signature with an
            // associated block, we can strictly enforce the signature as long
            // as we have the correct block header state.
            PSIBASE_LOG(peers().logger(peer), debug) << "Message dropped: " << e.what();
            return;
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
      std::vector<std::string> myhosts;
      unsigned                 unacked_hostnames = 0;
      NodeId                   nodeId            = 0;
   };
}  // namespace psibase::net
