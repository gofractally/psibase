#pragma once

#include <functional>
#include <random>
#include <system_error>

namespace psibase::net
{
   /**
    * This timer triggers a callback when a randomly chosen duration within
    * a range passes without the timer having been restarted.
    */
   template <typename Timer>
   class basic_random_timer
   {
     public:
      using duration   = typename Timer::duration;
      using time_point = typename Timer::time_point;
      using clock_type = typename Timer::clock_type;
      template <typename ExecutionContext>
      explicit basic_random_timer(ExecutionContext& ctx) : _timer(ctx)
      {
      }
      // Chooses a duration uniformly distributed in [lower_bound, upper_bound]
      void expires_after(duration lower_bound, duration upper_bound)
      {
         std::uniform_int_distribution<typename duration::rep> dist{lower_bound.count(),
                                                                    upper_bound.count()};
         _duration = duration{dist(_rng)};
         restart();
      }
      template <typename F>
      void async_wait(F&& f)
      {
         _callback = std::move(f);
         do_wait();
      }
      // Updates existing waiters
      void restart() { _expiration = clock_type::now() + _duration; }
      void cancel() { _timer.cancel(); }

     private:
      void do_wait()
      {
         _timer.expires_at(_expiration);
         _timer.async_wait(
             [this](const std::error_code& ec)
             {
                if (ec || clock_type::now() >= _expiration)
                {
                   _callback(ec);
                }
                else
                {
                   do_wait();
                }
             });
      }
      Timer                                       _timer;
      duration                                    _duration;
      time_point                                  _expiration;
      std::function<void(const std::error_code&)> _callback;
      std::random_device                          _rng;
   };
}  // namespace psibase::net
