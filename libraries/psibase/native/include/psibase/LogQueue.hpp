#pragma once

#include <boost/asio/any_io_executor.hpp>
#include <boost/asio/dispatch.hpp>
#include <boost/asio/post.hpp>

#include <deque>
#include <functional>
#include <mutex>
#include <span>
#include <string>

namespace psibase::loggers
{
   struct LogQueue
   {
     public:
      using Message = std::string;
      LogQueue(boost::asio::any_io_executor ctx) : ctx(ctx) {}
      ~LogQueue() { cancel(); }
      void push(Message&& message)
      {
         std::lock_guard l{mutex};
         data.push_back(std::move(message));
         if (callback)
         {
            boost::asio::post(ctx,
                              [this, callback = std::move(callback), current = &data.front()]() {
                                 callback(std::error_code(), {current->data(), current->size()});
                              });
         }
      }
      // signature: void(std::error_code, std::span<const char>);
      // The span will remain valid until the next call to async_read
      // or the queue is destroyed.
      template <typename F>
      void async_read(F&& f)
      {
         std::unique_lock l{mutex};
         assert(!data.empty());
         data.pop_front();
         if (!data.empty())
         {
            auto& current = data.front();
            l.unlock();
            boost::asio::dispatch(
                ctx,
                [this, f = std::move(f), &current]()
                {
                   f(std::error_code(), std::span<const char>{current.data(), current.size()});
                });
         }
         else
         {
            callback = std::move(f);
         }
      }
      void cancel()
      {
         if (callback)
         {
            boost::asio::post(ctx,
                              [this, callback = std::move(callback)]() {
                                 callback(make_error_code(boost::asio::error::operation_aborted),
                                          std::span<const char>());
                              });
         }
      }

     private:
      std::deque<Message>                                                data{1};
      std::mutex                                                         mutex;
      boost::asio::any_io_executor                                       ctx;
      std::function<void(const std::error_code&, std::span<const char>)> callback;
   };
}  // namespace psibase::loggers
