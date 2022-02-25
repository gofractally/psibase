#pragma once

#include <newchain/system_context.hpp>

namespace newchain::http
{
   struct http_config
   {
      uint32_t                  num_threads      = {};
      uint32_t                  max_request_size = {};
      std::chrono::milliseconds idle_timeout_ms  = {};
      std::string               allow_origin     = {};
      std::string               static_dir       = {};
      std::string               address          = {};
      std::string               port             = {};
      std::string               unix_path        = {};
   };

   struct server
   {
      virtual ~server() {}

      static std::shared_ptr<server> create(const std::shared_ptr<const http_config>& http_config,
                                            const std::shared_ptr<shared_state>&      shared_state);

      virtual void stop() = 0;
   };

}  // namespace newchain::http
