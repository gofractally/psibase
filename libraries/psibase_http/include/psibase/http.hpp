#pragma once

#include <psibase/system_context.hpp>
#include <psibase/trace.hpp>

namespace psibase::http
{
   using push_transaction_result   = std::variant<transaction_trace, std::string>;
   using push_transaction_callback = std::function<void(push_transaction_result)>;
   using push_transaction_t =
       std::function<void(std::vector<char> packed_signed_trx, push_transaction_callback)>;

   struct http_config
   {
      uint32_t                  num_threads            = {};
      uint32_t                  max_request_size       = {};
      std::chrono::milliseconds idle_timeout_ms        = {};
      std::string               allow_origin           = {};
      std::string               static_dir             = {};
      std::string               address                = {};
      unsigned short            port                   = {};
      std::string               unix_path              = {};
      std::string               host                   = {};
      push_transaction_t        push_transaction_async = {};
   };

   struct server
   {
      virtual ~server() {}

      static std::shared_ptr<server> create(const std::shared_ptr<const http_config>& http_config,
                                            const std::shared_ptr<shared_state>&      shared_state);

      virtual void stop() = 0;
   };

}  // namespace psibase::http
