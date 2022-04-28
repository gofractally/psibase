#pragma once

#include <condition_variable>
#include <mutex>
#include <set>

namespace psidb
{

   template <typename T>
   class mutex_set
   {
     public:
      struct proxy
      {
        public:
         void lock() { _self->lock(_value); }
         void unlock() { _self->unlock(_value); }

        private:
         friend class mutex_set;
         proxy(mutex_set* self, const T& value) : _self(self), _value(value) {}
         T          _value;
         mutex_set* _self;
      };
      proxy operator[](const T& value) { return proxy(this, value); }
      void  lock(const T& value)
      {
         std::unique_lock l{_mutex};
         _cond.wait(l, [&]() { return _locked.insert(value).second; });
      }
      void unlock(const T& value)
      {
         std::lock_guard l{_mutex};
         _locked.erase(value);
         _cond.notify_all();
      }

     private:
      std::set<T>             _locked;
      std::mutex              _mutex;
      std::condition_variable _cond;
   };

}  // namespace psidb
