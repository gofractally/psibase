#pragma once

#include <chrono>
#include <functional>
#include <memory>
#include <system_error>
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
      using duration                  = std::chrono::microseconds;
      using rep                       = duration::rep;
      using period                    = duration::period;
      using time_point                = std::chrono::time_point<mock_clock>;
      static constexpr bool is_steady = false;
      static time_point     now();
      static void           reset();
      static void           reset(time_point);
      static void           advance(duration);
      static void           advance();
   };

   struct mock_timer
   {
      using clock_type = mock_clock;
      using duration   = clock_type::duration;
      using time_point = clock_type::time_point;
      template <typename ExecutionContext>
      mock_timer(ExecutionContext& ctx) : _impl(std::make_shared<impl>())
      {
         _impl->bind = [&ctx](const auto& f)
         {
            return [&ctx, f, work = typename ExecutionContext::work{ctx}](const std::error_code& ec)
            { ctx.post([f, ec] { f(ec); }); };
         };
      }
      ~mock_timer();
      void expires_at(time_point);
      void expires_after(duration);
      void async_wait(std::function<void(const std::error_code&)>);
      struct impl
      {
         using callback_type = std::function<void(const std::error_code&)>;
         std::vector<callback_type>                         callbacks;
         std::function<callback_type(const callback_type&)> bind;
         time_point                                         deadline;
      };
      std::shared_ptr<impl> _impl;
      void                  cancel();
   };
}  // namespace psibase::test
