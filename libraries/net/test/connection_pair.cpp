#include "connection_pair.hpp"

#include <boost/asio/post.hpp>
#include <deque>

namespace
{
   using psibase::net::connection_base;
   struct connection : connection_base
   {
      explicit connection(boost::asio::io_context& ctx) : ctx(ctx) {}
      virtual void async_write(std::vector<char>&& data, write_handler handler)
      {
         if (!is_open())
         {
            boost::asio::post(ctx, [handler = std::move(handler)]
                              { handler(make_error_code(boost::asio::error::eof)); });
            return;
         }
         if (peer->pending_read)
         {
            boost::asio::post(
                ctx, [handler = std::move(*peer->pending_read), data = std::move(data)]() mutable
                { handler(std::error_code(), std::move(data)); });
            peer->pending_read.reset();
         }
         else
         {
            peer->queue.push_back(std::move(data));
         }
         boost::asio::post(ctx, [handler = std::move(handler)] { handler(std::error_code()); });
      }
      virtual void async_read(read_handler handler)
      {
         if (!queue.empty())
         {
            auto data = std::move(queue.front());
            queue.pop_front();
            boost::asio::post(ctx, [handler = std::move(handler), data = std::move(data)]() mutable
                              { handler(std::error_code(), std::move(data)); });
         }
         else
         {
            if (!is_open())
            {
               boost::asio::post(ctx, [handler = std::move(handler)]
                                 { handler(make_error_code(boost::asio::error::eof), {}); });
               return;
            }
            pending_read = std::move(handler);
         }
      }
      virtual bool is_open() const { return peer != nullptr; }
      virtual void close(close_code)
      {
         if (peer)
         {
            peer->close_impl();
            close_impl();
         }
      }
      void close_impl()
      {
         if (pending_read)
         {
            boost::asio::post(ctx, [handler = std::move(*pending_read)]
                              { handler(make_error_code(boost::asio::error::eof), {}); });
            pending_read.reset();
         }
         peer = nullptr;
      }
      boost::asio::io_context&      ctx;
      connection*                   peer;
      std::optional<read_handler>   pending_read;
      std::deque<std::vector<char>> queue;
   };
   struct connection_pair
   {
      explicit connection_pair(boost::asio::io_context& ctx)
          : conns{connection{ctx}, connection{ctx}}
      {
         conns[0].peer = &conns[1];
         conns[1].peer = &conns[0];
      }
      connection conns[2];
   };
}  // namespace

namespace psibase::net
{
   std::pair<std::shared_ptr<connection_base>, std::shared_ptr<connection_base>>
   make_connection_pair(boost::asio::io_context& ctx)
   {
      auto                             result = std::make_shared<connection_pair>(ctx);
      std::shared_ptr<connection_base> res0{result, &result->conns[0]};
      std::shared_ptr<connection_base> res1{std::move(result), &result->conns[1]};
      return {std::move(res0), std::move(res1)};
   }
}  // namespace psibase::net
