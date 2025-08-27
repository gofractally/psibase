#pragma once

#include <algorithm>

namespace psibase::net
{
   // Automatically adjusts a timeout based on the observed network latency.
   // The timeout increases by a factor of 1.5 every time it expires,
   // but is periodically reduced if the maximum latency observed recently
   // is significantly lower.
   template <typename Clock>
   class auto_timeout
   {
     public:
      explicit auto_timeout(typename Clock::duration initial_value) : _current(initial_value) {}
      void stop() {}
      void start()
      {
         auto now    = Clock::now();
         _last_reset = now;
         _longest    = {};
         _next_check = now + _window;
      }
      void reset()
      {
         auto now    = Clock::now();
         _longest    = std::max(_longest, now - _last_reset);
         _last_reset = now;
         if (now >= _next_check)
         {
            _current    = std::min(_current, _longest * 2);
            _longest    = {};
            _next_check = now + _window;
         }
      }
      void                     increase() { _current = std::min(_current * 3 / 2, _max); }
      typename Clock::duration get() const { return _current; }

     private:
      typename Clock::duration   _current;
      typename Clock::time_point _last_reset;
      typename Clock::duration   _longest;
      typename Clock::duration   _window = std::chrono::minutes(30);
      typename Clock::duration   _max    = std::chrono::minutes(5);
      typename Clock::time_point _next_check;
   };
}  // namespace psibase::net
