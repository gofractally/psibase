#pragma once

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

   struct http_config
   {
      uint32_t                  num_threads            = {};
      uint32_t                  max_request_size       = {};
      std::chrono::milliseconds idle_timeout_ms        = {};
      std::string               allow_origin           = {};
      std::string               static_dir             = {};  // TODO: remove?
      std::string               address                = {};
      unsigned short            port                   = {};
      std::string               unix_path              = {};  // TODO: remove? rename?
      std::string               host                   = {};
      push_boot_t               push_boot_async        = {};
      push_transaction_t        push_transaction_async = {};
   };

   struct server
   {
      virtual ~server() {}

      static std::shared_ptr<server> create(const std::shared_ptr<const http_config>& http_config,
                                            const std::shared_ptr<SharedState>&       sharedState);

      virtual void stop() = 0;
   };

}  // namespace psibase::http
