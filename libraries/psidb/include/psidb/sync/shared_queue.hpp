#pragma once

#include <condition_variable>
#include <mutex>
#include <queue>

namespace psidb
{
   template <typename T>
   class shared_queue
   {
     public:
      bool pop(T& result)
      {
         std::unique_lock l{_mutex};
         while (_queue.empty())
         {
            if (_stopping)
            {
               return false;
            }
            _cond.wait(l);
         }
         result = std::move(_queue.front());
         _queue.pop();
         return true;
      }
      void push(const T& t)
      {
         std::lock_guard l{_mutex};
         _queue.push(t);
         _cond.notify_one();
      }
      void push(T&& t)
      {
         std::lock_guard l{_mutex};
         _queue.push(std::move(t));
         _cond.notify_one();
      }
      void interrupt()
      {
         std::lock_guard l{_mutex};
         _stopping = true;
         _cond.notify_all();
      }

     private:
      std::queue<T>           _queue;
      std::mutex              _mutex;
      std::condition_variable _cond;
      bool                    _stopping = false;
   };
}  // namespace psidb
