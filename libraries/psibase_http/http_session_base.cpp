#include "http_session_base.hpp"

#include <cassert>

namespace beast = boost::beast;
namespace bhttp = beast::http;
using std::chrono::steady_clock;

namespace psibase::http
{
   std::pair<beast::string_view, beast::string_view> parse_request_target(
       const http_session_base::request_type& request);

   void handle_request(server_state&                     server,
                       http_session_base::request_type&& req,
                       http_session_base&                send);

   http_session_base::~http_session_base() = default;
   http_session_base::http_session_base(server_state& server) : server(server)
   {
      static_assert(limit > 0, "queue limit must be positive");
      items.reserve(limit);
   }

   void http_session_base::start_socket_timer()
   {
      auto self = shared_from_this();
      auto usec = server.http_config->idle_timeout_us.load();
      if (usec < 0)
         return;
      _expiration = steady_clock::now() + std::chrono::microseconds{usec};
      _timer->expires_at(_expiration);
      _timer->async_wait(
          [this, self = std::move(self)](beast::error_code ec) mutable
          {
             if (ec || _closed)
             {
                return;
             }
             if (steady_clock::now() >= _expiration)
             {
                beast::error_code ec;
                close_impl(ec);
                if (ec)
                {
                   PSIBASE_LOG(logger, warning) << "close: " << ec.message();
                }
                else
                {
                   PSIBASE_LOG(logger, info) << "Idle connection closed";
                }
                _closed = true;
             }
          });
   }

   void http_session_base::stop_socket_timer()
   {
      _expiration = steady_clock::time_point::max();
      _timer->cancel();
   }

   void http_session_base::on_read(beast::error_code ec, std::size_t /*bytes_transferred*/)
   {
      if (_closed)
         return;

      // This means they closed the connection
      if (ec == bhttp::error::end_of_stream)
         return do_close();

      if (ec)
      {
         PSIBASE_LOG(logger, warning) << "read: " << ec.message();
         return close_on_error();
      }

      {
         const auto& req             = parser->get();
         auto [req_host, req_target] = parse_request_target(req);
         request_attrs.emplace(std::tuple{
             boost::log::add_scoped_logger_attribute(
                 logger, "RequestMethod",
                 boost::log::attributes::constant{std::string(req.method_string())}),
             boost::log::add_scoped_logger_attribute(
                 logger, "RequestTarget",
                 boost::log::attributes::constant{std::string(req_target)}),
             boost::log::add_scoped_logger_attribute(
                 logger, "RequestHost", boost::log::attributes::constant{std::string(req_host)})});
         PSIBASE_LOG(logger, debug) << "Received HTTP request";
      }

      // Send the response
      handle_request(server, parser->release(), *this);

      // The queue being empty means that we're waiting for the
      // request to be processed asynchronously, and there are
      // no pending writes.
      if (is_empty())
      {
         assert(!can_read());
         stop_socket_timer();
      }

      // If we aren't at the queue limit, try to pipeline another request
      if (can_read())
         do_read();
   }

   void http_session_base::do_close()
   {
      // Send a TCP shutdown
      if (!_closed)
      {
         shutdown_impl();
         _timer->cancel();  // cancel connection timer.
         _closed = true;
      }
      // At this point the connection is closed gracefully
   }
   void http_session_base::close_on_error()
   {
      if (!_closed)
      {
         _timer->cancel();
         beast::error_code ec;
         close_impl(ec);
         if (ec)
         {
            PSIBASE_LOG(logger, warning) << "close: " << ec.message();
         }
         _closed = true;
      }
   }

   // Called when a message finishes sending
   // Returns `true` if the caller should initiate a read
   bool http_session_base::pop_queue()
   {
      assert(!items.empty());
      const auto was_full = is_full();
      items.erase(items.begin());
      if (items.empty() && pause_read)
         stop_socket_timer();
      else
         start_socket_timer();
      if (!items.empty())
         (*items.front())();
      return was_full && !pause_read;
   }

   void http_session_base::on_write(bool              close,
                                    beast::error_code ec,
                                    std::size_t /*bytes_transferred*/)
   {
      if (_closed)
         return;

      if (ec)
      {
         PSIBASE_LOG(logger, warning) << "write: " << ec.message();
         return close_on_error();
      }

      if (close)
      {
         // This means we should close the connection, usually because
         // the response indicated the "Connection: close" semantic.
         return do_close();
      }

      // Inform the queue that a write completed
      if (pop_queue())
      {
         // Read another request
         do_read();
      }
   }

   // Called by the HTTP handler to send a response.
   void http_session_base::operator()(message_type&& msg)
   {
      // This holds a work item
      struct work_impl : work
      {
         http_session_base& self;
         message_type       msg;

         work_impl(http_session_base& self, message_type&& msg) : self(self), msg(std::move(msg)) {}

         void operator()() { self.write_response(std::move(msg)); }
      };

      {
         BOOST_LOG_SCOPED_LOGGER_TAG(logger, "ResponseStatus",
                                     static_cast<unsigned>(msg.result_int()));
         BOOST_LOG_SCOPED_LOGGER_ATTR(logger, "ResponseBytes",
                                      boost::log::attributes::constant<std::uint64_t>(
                                          msg.payload_size() ? *msg.payload_size() : 0));
         PSIBASE_LOG(logger, info) << "Handled HTTP request";
         request_attrs.reset();
      }

      // Allocate and store the work
      items.push_back(boost::make_unique<work_impl>(*this, std::move(msg)));

      // If there was no previous work, start this one
      if (items.size() == 1)
      {
         start_socket_timer();
         (*items.front())();
      }
   }

   void http_session_base::operator()(websocket_upgrade,
                                      request_type&&         msg,
                                      accept_p2p_websocket_t f)
   {
      struct work_impl : work
      {
         http_session_base&     self;
         request_type           request;
         accept_p2p_websocket_t next;

         work_impl(http_session_base& self, request_type&& msg, accept_p2p_websocket_t&& f)
             : self(self), request(std::move(msg)), next(std::move(f))
         {
         }
         void operator()() { self.accept_websocket(std::move(request), std::move(next)); }
      };

      {
         BOOST_LOG_SCOPED_LOGGER_TAG(logger, "ResponseStatus",
                                     static_cast<unsigned>(bhttp::status::switching_protocols));
         PSIBASE_LOG(logger, info) << "Handled HTTP request";
         request_attrs.reset();
      }

      // Allocate and store the work
      items.push_back(boost::make_unique<work_impl>(*this, std::move(msg), std::move(f)));

      // If there was no previous work, start this one
      if (items.size() == 1)
         (*items.front())();
   }

}  // namespace psibase::http
