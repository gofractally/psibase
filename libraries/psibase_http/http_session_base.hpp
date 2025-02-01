#pragma once

#include <boost/asio/steady_timer.hpp>
#include <boost/beast/core/flat_buffer.hpp>
#include <boost/beast/http/message.hpp>
#include <boost/beast/http/parser.hpp>
#include <boost/beast/http/vector_body.hpp>
#include <chrono>
#include <functional>
#include <memory>
#include <optional>
#include <psibase/http.hpp>
#include <psibase/log.hpp>
#include <tuple>
#include <vector>

#include "server_state.hpp"

namespace psibase::http
{

   struct websocket_upgrade
   {
   };

   class http_session_base : public std::enable_shared_from_this<http_session_base>
   {
     public:
      using message_type = boost::beast::http::response<boost::beast::http::vector_body<char>>;
      using request_type = boost::beast::http::request<boost::beast::http::vector_body<char>>;

     protected:
      ~http_session_base();
      http_session_base(server_state& server);

      enum
      {
         // Maximum number of responses we will queue
         limit = 8
      };

      // The type-erased, saved work item
      struct work
      {
         virtual ~work()           = default;
         virtual void operator()() = 0;
      };
      // This queue is used for HTTP pipelining.
      std::vector<std::unique_ptr<work>> items;

      void start_socket_timer();
      void stop_socket_timer();

      void on_read(boost::beast::error_code ec, std::size_t bytes_transferred);

      void do_close();
      void close_on_error();

      boost::beast::flat_buffer                  buffer;
      std::unique_ptr<boost::asio::steady_timer> _timer;
      bool                                       _closed = false;
      std::chrono::steady_clock::time_point      _expiration;

      // The parser is stored in an optional container so we can
      // construct it from scratch it at the beginning of each new message.
      boost::optional<boost::beast::http::request_parser<boost::beast::http::vector_body<char>>>
          parser;

     public:
      server_state& server;

      psibase::loggers::common_logger logger;
      using scoped_attribute = decltype(boost::log::add_scoped_logger_attribute(
          logger,
          std::string(),
          boost::log::attributes::constant{std::string()}));
      std::optional<std::tuple<scoped_attribute, scoped_attribute, scoped_attribute>> request_attrs;

     public:
      bool pause_read = false;

      // Returns `true` if we have reached the queue limit
      bool is_full() const { return items.size() >= limit; }
      bool can_read() const { return !is_full() && !pause_read; }
      bool is_empty() const { return items.empty(); }

      // Called when a message finishes sending
      // Returns `true` if the caller should initiate a read
      bool pop_queue();

      void on_write(bool close, boost::beast::error_code ec, std::size_t bytes_transferred);

      // Called by the HTTP handler to send a response.
      void operator()(message_type&& msg);
      void operator()(websocket_upgrade, request_type&& msg, accept_p2p_websocket_t f);

      virtual void write_response(message_type&& msg)                                      = 0;
      virtual void accept_websocket(request_type&& request, accept_p2p_websocket_t&& next) = 0;
      virtual void do_read()                                                               = 0;
      virtual bool check_access(const authz_loopback&) const                               = 0;
      virtual bool check_access(const authz_ip&) const                                     = 0;
      virtual void post(std::function<void()>)                                             = 0;
      virtual void close_impl(boost::beast::error_code& ec)                                = 0;
      virtual void shutdown_impl()                                                         = 0;

      virtual bool is_secure() const { return false; }
   };

}  // namespace psibase::http
