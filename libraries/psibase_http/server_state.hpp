#pragma once

#include <boost/signals2/signal.hpp>
#include <memory>

namespace psibase
{
   struct SharedState;
}

namespace psibase::http
{

   struct http_config;

   struct server_state
   {
      std::shared_ptr<const http::http_config> http_config = {};
      std::shared_ptr<psibase::SharedState>    sharedState = {};

      using signal_type = boost::signals2::signal<void(bool)>;
      signal_type shutdown_connections;
      template <typename T>
      void register_connection(const std::shared_ptr<T>& ptr)
      {
         shutdown_connections.connect(
             signal_type::slot_type([weak = std::weak_ptr{ptr}](bool restart)
                                    { T::close(weak.lock(), restart); })
                 .track_foreign(std::weak_ptr{ptr}));
      }
   };

}  // namespace psibase::http
