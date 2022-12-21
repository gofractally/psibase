#pragma once

#include <boost/asio/local/stream_protocol.hpp>
#include <boost/asio/ssl/context.hpp>
#include <boost/beast/core/tcp_stream.hpp>
#ifdef PSIBASE_ENABLE_SSL
#include <boost/beast/ssl.hpp>
#endif
#include <boost/beast/websocket/stream_fwd.hpp>
#include <boost/type_erasure/any.hpp>
#include <boost/type_erasure/callable.hpp>
#include <chrono>
#include <filesystem>
#include <psibase/SystemContext.hpp>
#include <psibase/trace.hpp>
#include <shared_mutex>

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

   using shutdown_t = std::function<void(std::vector<char>)>;

   using accept_p2p_websocket1 = boost::beast::websocket::stream<boost::beast::tcp_stream>;
#ifdef PSIBASE_ENABLE_SSL
   using accept_p2p_websocket2 =
       boost::beast::websocket::stream<boost::beast::ssl_stream<boost::beast::tcp_stream>>;
#endif
   using accept_p2p_websocket3 = boost::beast::websocket::stream<
       boost::beast::basic_stream<boost::asio::local::stream_protocol>>;

   using accept_p2p_websocket_t = boost::type_erasure::any<
       boost::mpl::vector<boost::type_erasure::relaxed,
                          boost::type_erasure::copy_constructible<>,
                          boost::type_erasure::callable<void(accept_p2p_websocket1&&)>,
#ifdef PSIBASE_ENABLE_SSL
                          boost::type_erasure::callable<void(accept_p2p_websocket2&&)>,
#endif
                          boost::type_erasure::callable<void(accept_p2p_websocket3&&)>>>;

   struct peer_info
   {
      int                        id;
      std::string                endpoint;
      std::optional<std::string> url;
   };
   PSIO_REFLECT(peer_info, id, endpoint, url);
   using get_peers_result   = std::vector<peer_info>;
   using get_peers_callback = std::function<void(get_peers_result)>;
   using get_peers_t        = std::function<void(get_peers_callback)>;

   using connect_result   = std::optional<std::string>;
   using connect_callback = std::function<void(connect_result)>;
   using connect_t        = std::function<void(std::vector<char>, connect_callback)>;

   using get_config_result   = std::function<std::vector<char>()>;
   using get_config_callback = std::function<void(get_config_result)>;
   using get_config_t        = std::function<void(get_config_callback)>;

   using generic_json_result   = std::variant<std::string, std::function<std::vector<char>()>>;
   using generic_json_callback = std::function<void(generic_json_result)>;
   using generic_json_t        = std::function<void(std::vector<char>, generic_json_callback)>;

   struct http_status
   {
      unsigned slow : 1;
      unsigned startup : 1;
      unsigned shutdown : 1;
   };
   template <typename S>
   void to_json(http_status obj, S& stream)
   {
      stream.write('[');
      bool first       = true;
      auto maybe_comma = [&]()
      {
         if (first)
         {
            first = false;
         }
         else
         {
            stream.write(',');
         }
      };
      if (obj.slow)
      {
         maybe_comma();
         to_json("slow", stream);
      }
      if (obj.startup)
      {
         maybe_comma();
         to_json("startup", stream);
      }
      if (obj.shutdown)
      {
         maybe_comma();
         to_json("shutdown", stream);
      }
      stream.write(']');
   }

   struct native_content
   {
      std::filesystem::path path;
      std::string           content_type;
   };
   using services_t =
       std::map<std::string, std::map<std::string, native_content, std::less<>>, std::less<>>;

   // Identifies which services are allowed to access the native API
   struct admin_none
   {
      std::string str() const { return ""; }
   };
   struct admin_any
   {
      std::string str() const { return "*"; }
   };
   struct admin_any_native
   {
      std::string str() const { return "static:*"; }
   };
   using admin_service = std::variant<admin_none, admin_any, admin_any_native, AccountNumber>;

   inline admin_service admin_service_from_string(std::string_view s)
   {
      if (s == "")
      {
         return admin_none{};
      }
      else if (s == "*")
      {
         return admin_any{};
      }
      else if (s == "static:*")
      {
         return admin_any_native{};
      }
      else
      {
         return AccountNumber{s};
      }
   }

   void from_json(admin_service& obj, auto& stream)
   {
      if (stream.get_null_pred())
      {
         obj = admin_none{};
      }
      else
      {
         obj = admin_service_from_string(stream.get_string());
      }
   }

   void to_json(const admin_service& obj, auto& stream)
   {
      if (std::holds_alternative<admin_none>(obj))
      {
         stream.write("null", 4);
      }
      else
      {
         std::visit([&](const auto& value) { to_json(value.str(), stream); }, obj);
      }
   }

#ifdef PSIBASE_ENABLE_SSL
   using tls_context_ptr = std::shared_ptr<boost::asio::ssl::context>;
#endif

   struct http_config
   {
      uint32_t                  num_threads      = {};
      uint32_t                  max_request_size = {};
      std::chrono::milliseconds idle_timeout_ms  = {};
      std::string               allow_origin     = {};
      std::string               address          = {};
      unsigned short            port             = {};
      unsigned short            https_port       = {};
      std::string               unix_path        = {};  // TODO: remove? rename?
      std::string               host             = {};
#ifdef PSIBASE_ENABLE_SSL
      tls_context_ptr tls_context = {};
#endif
      push_boot_t              push_boot_async        = {};
      push_transaction_t       push_transaction_async = {};
      accept_p2p_websocket_t   accept_p2p_websocket   = {};
      shutdown_t               shutdown               = {};
      get_peers_t              get_peers              = {};
      connect_t                connect                = {};
      connect_t                disconnect             = {};
      get_config_t             get_config             = {};
      connect_t                set_config             = {};
      get_config_t             get_keys               = {};
      generic_json_t           new_key                = {};
      admin_service            admin                  = {};
      services_t               services;
      std::atomic<bool>        enable_p2p;
      std::atomic<bool>        enable_transactions;
      std::atomic<http_status> status;

      mutable std::shared_mutex mutex;
   };

   struct server_impl;
   class server_service : public boost::asio::execution_context::service
   {
     public:
      using key_type = server_service;
      explicit server_service(boost::asio::execution_context& ctx);
      server_service(boost::asio::execution_context&           ctx,
                     const std::shared_ptr<const http_config>& http_config,
                     const std::shared_ptr<SharedState>&       sharedState);
      void async_close(bool restart, std::function<void()>);

     private:
      void                         shutdown() noexcept override;
      std::shared_ptr<server_impl> impl;
   };

}  // namespace psibase::http
