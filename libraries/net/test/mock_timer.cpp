#include <psibase/mock_timer.hpp>

#include <boost/asio/error.hpp>

#include <algorithm>
#include <mutex>

namespace psibase::test
{
   namespace
   {
      static constexpr auto timer_queue_compare = [](const auto& lhs, const auto& rhs)
      { return lhs->deadline > rhs->deadline; };
      mock_clock::time_point                         mock_current_time;
      std::vector<std::shared_ptr<mock_timer::impl>> timer_queue;
      std::mutex                                     queue_mutex;
      void                                           process_queue(mock_clock::time_point new_now)
      {
         while (!timer_queue.empty() && timer_queue.front()->deadline <= new_now)
         {
            mock_timer::impl* head = timer_queue.front().get();
            {
               for (const auto& f : head->callbacks)
               {
                  head->post([f]() { f(std::error_code{}); });
               }
               head->callbacks.clear();
            }
            std::pop_heap(timer_queue.begin(), timer_queue.end(), timer_queue_compare);
            timer_queue.pop_back();
         }
      }
      void cancel_timer(const std::shared_ptr<mock_timer::impl>& impl)
      {
         auto pos = std::find(timer_queue.begin(), timer_queue.end(), impl);
         if (pos != timer_queue.end())
         {
            swap(*pos, timer_queue.back());
            timer_queue.pop_back();
            for (const auto& f : impl->callbacks)
            {
               impl->post([f]() { f(make_error_code(boost::asio::error::operation_aborted)); });
            }
            impl->callbacks.clear();
            std::make_heap(timer_queue.begin(), timer_queue.end(), timer_queue_compare);
         }
      }
   }  // namespace

   mock_clock::time_point mock_clock::now()
   {
      std::lock_guard l{queue_mutex};
      return mock_current_time;
   }

   void mock_clock::reset(time_point new_now)
   {
      std::lock_guard l{queue_mutex};
      mock_current_time = new_now;
      process_queue(new_now);
   }
   void mock_clock::advance(mock_clock::duration diff)
   {
      std::lock_guard l{queue_mutex};
      mock_current_time += diff;
      process_queue(mock_current_time);
   }
   void mock_timer::expires_at(time_point expiration)
   {
      std::lock_guard l{queue_mutex};
      cancel_timer(_impl);
      _impl->deadline = expiration;
   }
   void mock_timer::expires_after(duration d)
   {
      std::lock_guard l{queue_mutex};
      cancel_timer(_impl);
      _impl->deadline = mock_current_time + d;
   }
   void mock_timer::async_wait(std::function<void(const std::error_code&)> callback)
   {
      std::lock_guard l{queue_mutex};
      _impl->callbacks.push_back(std::move(callback));
      if (_impl->callbacks.size() == 1)
      {
         timer_queue.push_back(_impl);
         std::push_heap(timer_queue.begin(), timer_queue.end(), timer_queue_compare);
      }
   }
   void mock_timer::cancel()
   {
      std::lock_guard l{queue_mutex};
      cancel_timer(_impl);
   }
}  // namespace psibase::test
