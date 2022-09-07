#pragma once

#include <boost/asio/connect.hpp>
#include <boost/asio/io_context.hpp>
#include <boost/asio/ip/tcp.hpp>
#include <boost/asio/read.hpp>
#include <boost/mp11/algorithm.hpp>
#include <iostream>
#include <memory>
#include <psibase/net_base.hpp>
#include <psio/fracpack.hpp>
#include <queue>
#include <vector>

namespace psibase::net
{
#ifndef PSIO_REFLECT_INLINE
#define PSIO_REFLECT_INLINE(name, ...) \
   PSIO_REFLECT(name, __VA_ARGS__)     \
   friend reflect_impl_##name get_reflect_impl(const name&) { return {}; }
#endif

   // This requires all producers to be peers
   template <typename Derived>
   struct direct_routing
   {
      auto& peers() { return static_cast<Derived*>(this)->peers(); }
      explicit direct_routing(boost::asio::io_context& ctx) {}
      static const std::uint32_t protocol_version = 0;
      struct init_message
      {
         static constexpr unsigned type    = 1;
         std::uint32_t             version = protocol_version;
         PSIO_REFLECT_INLINE(init_message, version);
      };
      struct producer_message
      {
         static constexpr unsigned type = 2;
         producer_id               producer;
         PSIO_REFLECT_INLINE(producer_message, producer)
      };
      auto get_message_impl()
      {
         return boost::mp11::mp_push_back<
             typename std::remove_cvref_t<
                 decltype(static_cast<Derived*>(this)->consensus())>::message_type,
             init_message, producer_message>{};
      }
      template <typename Msg, typename F>
      void async_send_block(peer_id id, const Msg& msg, F&& f)
      {
         peers().async_send(id, serialize_message(msg), std::forward<F>(f));
      }
      // Sends a message to each peer in a list
      // each peer will receive the message only once even if it is duplicated in the input list.
      template <typename Msg>
      void async_multicast(std::vector<peer_id>&& dest, const Msg& msg)
      {
         std::sort(dest.begin(), dest.end());
         dest.erase(std::unique(dest.begin(), dest.end()), dest.end());
         auto serialized_message = serialize_message(msg);
         for (auto peer : dest)
         {
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
      void sendto(producer_id prod, const Msg& msg)
      {
         std::vector<peer_id> peers_for_producer;
         for (auto [iter, end] = producers.equal_range(prod); iter != end; ++iter)
         {
            peers_for_producer.push_back(iter->second);
         }
         async_multicast(std::move(peers_for_producer), msg);
      }
      struct connection;
      void connect(peer_id id)
      {
         async_send_block(id, init_message{}, [](const std::error_code&) {});
         if (auto producer = static_cast<Derived*>(this)->consensus().producer_name();
             producer != AccountNumber())
         {
            async_send_block(id, producer_message{producer}, [](const std::error_code&) {});
         }
         static_cast<Derived*>(this)->consensus().connect(id);
      }
      void disconnect(peer_id id)
      {
         static_cast<Derived*>(this)->consensus().disconnect(id);
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
      template <typename Msg>
      static std::vector<char> serialize_message(const Msg& msg)
      {
         static_assert(Msg::type < 128);
         std::vector<char> result(psio::fracpack_size(msg) + 1);
         result[0] = Msg::type;
         psio::fast_buf_stream s(result.data() + 1, result.size() - 1);
         psio::fracpack(msg, s);
         return result;
      }
      template <typename T>
      void try_recv_impl(peer_id peer, psio::input_stream& s)
      {
         try
         {
            return recv(peer, psio::convert_from_frac<T>(s));
         }
         catch (std::exception& e)
         {
            std::cout << "peer " << peer << ": " << e.what() << std::endl;
            peers().disconnect(peer);
         }
         catch (...)
         {
            std::cout << "invalid message from peer " << peer << std::endl;
            peers().disconnect(peer);
         }
      }
      template <template <typename...> class L, typename... T>
      void recv_impl(peer_id peer, int key, const std::vector<char>& msg, L<T...>*)
      {
         psio::input_stream s(msg.data() + 1, msg.size() - 1);
         ((key == T::type ? try_recv_impl<T>(peer, s) : (void)0), ...);
      }
      void recv(peer_id peer, const std::vector<char>& msg)
      {
         using message_type = decltype(get_message_impl());
         static_assert(check_message_uniqueness((message_type*)nullptr));
         recv_impl(peer, msg[0], msg, (message_type*)0);
      }
      void recv(peer_id peer, const init_message& msg)
      {
         if (msg.version != protocol_version)
         {
            peers().disconnect(peer);
         }
      }
      void recv(peer_id peer, const producer_message& msg)
      {
         producers.insert({msg.producer, peer});
      }
      void recv(peer_id peer, const auto& msg)
      {
         //std::cout << "recv " << msg.to_string() << std::endl;
         static_cast<Derived*>(this)->consensus().recv(peer, msg);
      }
      std::multimap<producer_id, peer_id> producers;
   };

}  // namespace psibase::net
