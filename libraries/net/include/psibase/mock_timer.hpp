#pragma once

#include <chrono>
#include <deque>
#include <functional>
#include <iosfwd>
#include <memory>
#include <random>
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

   std::ostream& operator<<(std::ostream&, mock_clock::time_point);

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

   struct mock_execution_context
   {
      using clock_type = mock_clock;
      using duration   = clock_type::duration;
      using time_point = clock_type::time_point;
      ~mock_execution_context();
      template <typename ExecutionContext, typename F>
      void post_after(ExecutionContext& ctx, duration delay, F&& f)
      {
         while (!impl.empty() && impl.front()->callbacks.empty())
            impl.pop_front();
         mock_timer timer(ctx);
         timer.expires_after(delay);
         timer.async_wait(std::forward<F>(f));
         impl.push_back(std::move(timer._impl));
      }
      std::deque<std::shared_ptr<mock_timer::impl>> impl;
   };

   struct global_random
   {
      using result_type = std::mt19937::result_type;
      static constexpr auto min() { return std::mt19937::min(); }
      static constexpr auto max() { return std::mt19937::max(); }
      result_type           operator()();
      static void           seed(result_type value);
      static result_type    make_seed();
      static void           set_global_seed(result_type value);
   };
}  // namespace psibase::test

namespace psibase::net
{
   template <typename T>
   struct random_source;
   template <>
   struct random_source<psibase::test::mock_timer>
   {
      using type = psibase::test::global_random;
   };

}  // namespace psibase::net
