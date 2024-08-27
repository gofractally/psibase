#pragma once

#include <boost/beast/core/flat_buffer.hpp>
#include <boost/beast/websocket/rfc6455.hpp>
#include <memory>
#include <psibase/log.hpp>

namespace psibase::http
{

   // Reads log records from the queue and writes them to a websocket
   template <typename StreamType>
   class websocket_log_session
   {
     public:
      explicit websocket_log_session(StreamType&& stream);
      static void write(std::shared_ptr<websocket_log_session>&& self);
      static void read(std::shared_ptr<websocket_log_session>&& self);
      static void run(std::shared_ptr<websocket_log_session>&& self);

      static void close(std::shared_ptr<websocket_log_session>&& self,
                        boost::beast::websocket::close_reason    reason);

      static void close(std::shared_ptr<websocket_log_session>&& self, bool restart);

     private:
      bool                        closed = false;
      psibase::loggers::LogReader reader;
      StreamType                  stream;
      boost::beast::flat_buffer   buffer;
   };
}  // namespace psibase::http
