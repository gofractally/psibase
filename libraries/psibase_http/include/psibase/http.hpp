#pragma once

#include <boost/beast/core/tcp_stream.hpp>
#include <boost/beast/websocket/stream_fwd.hpp>
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

   using get_config_result   = std::function<std::vector<char>()>;
   using get_config_callback = std::function<void(get_config_result)>;
   using get_config_t        = std::function<void(get_config_callback)>;

   struct http_status
   {
      unsigned slow : 1;
      unsigned startup : 1;
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
      get_config_t              get_config             = {};
      connect_t                 set_config             = {};
      admin_service             admin                  = {};
      services_t                services;
      std::atomic<bool>         enable_p2p;
      std::atomic<bool>         enable_transactions;
      std::atomic<http_status>  status;

      mutable std::shared_mutex mutex;
   };

   struct server
   {
      virtual ~server() {}

      static std::shared_ptr<server> create(const std::shared_ptr<const http_config>& http_config,
                                            const std::shared_ptr<SharedState>&       sharedState);

      virtual void stop() = 0;
   };

}  // namespace psibase::http
