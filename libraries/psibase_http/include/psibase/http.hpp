#pragma once

#include <boost/beast/core/tcp_stream.hpp>
#include <boost/beast/websocket/stream_fwd.hpp>
#include <chrono>
#include <psibase/SystemContext.hpp>
#include <psibase/trace.hpp>

namespace psibase::http
{
   using push_boot_result   = std::optional<std::string>;
   using push_boot_callback = std::function<void(push_boot_result)>;
   using push_boot_t =
       std::function<void(std::vector<char> packed_signed_transactions, push_boot_callback)>;

   using push_transaction_result   = std::variant<TransactionTrace, std::string>;
   using push_transaction_callback = std::function<void(push_transaction_result)>;
   using push_transaction_t =
       std::function<void(std::vector<char> packed_signed_trx, push_transaction_callback)>;

   using accept_p2p_websocket_result = boost::beast::websocket::stream<boost::beast::tcp_stream>;
   using accept_p2p_websocket_t      = std::function<void(accept_p2p_websocket_result&&)>;

   struct peer_info
   {
      int         id;
      std::string endpoint;
   };
   PSIO_REFLECT(peer_info, id, endpoint);
   using get_peers_result   = std::vector<peer_info>;
   using get_peers_callback = std::function<void(get_peers_result)>;
   using get_peers_t        = std::function<void(get_peers_callback)>;

   using connect_result   = std::optional<std::string>;
   using connect_callback = std::function<void(connect_result)>;
   using connect_t        = std::function<void(std::vector<char>, connect_callback)>;

   struct http_config
   {
      uint32_t                  num_threads            = {};
      uint32_t                  max_request_size       = {};
      std::chrono::milliseconds idle_timeout_ms        = {};
      std::string               allow_origin           = {};
      std::string               address                = {};
      unsigned short            port                   = {};
      std::string               unix_path              = {};  // TODO: remove? rename?
      std::string               host                   = {};
      push_boot_t               push_boot_async        = {};
      push_transaction_t        push_transaction_async = {};
      accept_p2p_websocket_t    accept_p2p_websocket   = {};
      get_peers_t               get_peers              = {};
      connect_t                 connect                = {};
      connect_t                 disconnect             = {};
      bool                      host_perf              = false;
   };

   struct server
   {
      virtual ~server() {}

      static std::shared_ptr<server> create(const std::shared_ptr<const http_config>& http_config,
                                            const std::shared_ptr<SharedState>&       sharedState);

      virtual void stop() = 0;
   };

}  // namespace psibase::http
