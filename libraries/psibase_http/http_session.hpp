#pragma once

#include "http_session_base.hpp"
#include "server_state.hpp"

#include <boost/asio/post.hpp>
#include <boost/asio/socket_base.hpp>
#include <boost/beast/core.hpp>
#include <boost/beast/http.hpp>

namespace psibase::http
{

   // Handles an HTTP server connection
   template <typename SessionType>
   class http_session : public http_session_base
   {
     public:
      std::shared_ptr<SessionType> shared_from_this()
      {
         return std::static_pointer_cast<SessionType>(http_session_base::shared_from_this());
      }

      virtual void post(std::function<void()> f) override
      {
         boost::asio::post(derived_session().stream.get_executor(), std::move(f));
      }

      void write_response(message_type&& msg) override
      {
         boost::beast::http::async_write(
             derived_session().stream, msg,
             boost::beast::bind_front_handler(
                 &http_session::on_write, derived_session().shared_from_this(), msg.need_eof()));
      }
      void accept_websocket(request_type&& request, accept_p2p_websocket_t&& next) override
      {
         using ws_type = boost::beast::websocket::stream<decltype(derived_session().stream)>;
         struct op
         {
            request_type           request;
            ws_type                stream;
            accept_p2p_websocket_t next;
         };

         auto ptr = std::make_shared<op>(
             op{std::move(request),
                boost::beast::websocket::stream<decltype(move_stream())>{std::move(move_stream())},
                std::move(next)});

         auto p = ptr.get();
         // Capture only the stream, not self, because after returning, there is
         // no longer anything keeping the session alive
         p->stream.async_accept(p->request, std::function<void(const std::error_code&)>(
                                                [ptr = std::move(ptr)](const std::error_code& ec)
                                                {
                                                   if (!ec)
                                                   {
                                                      ptr->next(std::move(ptr->stream));
                                                   }
                                                }));
      }

      http_session(server_state& server) : http_session_base(server)
      {
         logger.add_attribute("Channel", boost::log::attributes::constant(std::string("http")));
      }

      ~http_session() { PSIBASE_LOG(logger, debug) << "Connection closed"; }

      // Start the session
      void run()
      {
         PSIBASE_LOG(logger, debug) << "Accepted connection";
         _timer.reset(new boost::asio::steady_timer(derived_session().stream.get_executor()));
         start_socket_timer();
         do_read();
      }

      SessionType& derived_session() { return static_cast<SessionType&>(*this); }

      auto move_stream()
      {
         auto result = std::move(derived_session().stream);
         _closed     = true;
         _timer->cancel();
         return result;
      }

      void do_read() override
      {
         // Construct a new parser for each message
         parser.emplace();

         // Apply a reasonable limit to the allowed size
         // of the body in bytes to prevent abuse.
         parser->body_limit(server.http_config->max_request_size);
         // Read a request using the parser-oriented interface
         boost::beast::http::async_read(
             derived_session().stream, buffer, *parser,
             boost::beast::bind_front_handler(&http_session::on_read,
                                              derived_session().shared_from_this()));
      }

     protected:
      template <typename Dummy = void>
      void common_shutdown_impl()
      {
         boost::beast::error_code ec;
         derived_session().stream.socket().shutdown(boost::asio::socket_base::shutdown_both, ec);
         if (ec)
         {
            PSIBASE_LOG(logger, warning) << "shutdown: " << ec.message();
         }
         derived_session().stream.socket().close(ec);
         if (ec)
         {
            PSIBASE_LOG(logger, warning) << "close: " << ec.message();
         }
      }
   };  // http_session

}  // namespace psibase::http
