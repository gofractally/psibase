#pragma once

#include <chrono>
#include <functional>
#include <memory>
#include <vector>

namespace psibase::test
{
   /**
    * This clock can be manually controlled.
    *
    * WARNING: the current time of mock_clock is global state.  It is
    * not possible to use multiple independent instances of mock_clock
    * simultaneously in the same program.
    */
   struct mock_clock
   {
      using duration = std::chrono::microseconds;
      using rep = duration::rep;
      using period = duration::period;
      using time_point = std::chrono::time_point<mock_clock>;
      static constexpr bool is_steady = false;
      static time_point now();
      static void reset();
      static void reset(time_point);
      static void advance(duration);
   };

   struct mock_timer
   {
      using clock_type = mock_clock;
      using duration = clock_type::duration;
      using time_point = clock_type::time_point;
      template<typename ExecutionContext>
      mock_timer(ExecutionContext& ctx) : _impl(std::make_shared<impl>())
      {
         _impl->post = [&ctx](const auto& f){ ctx.post(f); };
      }
      void expires_at(time_point);
      void expires_after(duration);
      void async_wait(std::function<void(const std::error_code&)>);
      struct impl {
         std::vector<std::function<void(const std::error_code&)>> callbacks;
         std::function<void(std::function<void()>)> post;
         time_point deadline;
      };
      std::shared_ptr<impl> _impl;
      void cancel();
   };
}
