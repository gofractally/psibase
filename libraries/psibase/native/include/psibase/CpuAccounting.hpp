#pragma once
#include <pthread.h>
#include <time.h>
#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cstdint>
#include <exception>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <psibase/NativeThreadClock.hpp>
#include <stdexcept>
#include <system_error>
#include <utility>
#include <vector>

namespace psibase::accounting
{
   // Cumulative per-caller logical CPU supplement. Request scopes never reset
   // it. A live owner-job sample and its completed debt are exchanged under
   // one mutex, so logical time remains monotonic across every transition.
   class Counter
   {
      struct Active
      {
         std::shared_ptr<NativeThreadClock> clock;
         Duration                           start;
      };
      std::mutex                                           mutex;
      Duration                                             completed{};
      std::optional<Active>                                active;
      std::vector<std::pair<void*, std::function<void()>>> listeners;
      void                                                 notify()
      {
         for (auto& entry : listeners)
            entry.second();
      }

     public:
      Duration sample()
      {
         std::lock_guard lock(mutex);
         return completed + (active ? active->clock->read() - active->start : Duration{});
      }
      void begin()
      {
         auto            clock = currentThreadClock();
         const auto      start = clock->read();
         std::lock_guard lock(mutex);
         if (active)
            throw std::logic_error("overlapping owner jobs for one synchronous caller");
         active = Active{std::move(clock), start};
         notify();
      }
      void end()
      {
         std::lock_guard lock(mutex);
         if (!active)
            std::terminate();
         completed += active->clock->read() - active->start;
         active.reset();
         notify();
      }
      void subscribe(void* id, std::function<void()> function)
      {
         std::lock_guard lock(mutex);
         listeners.emplace_back(id, std::move(function));
      }
      void unsubscribe(void* id)
      {
         std::lock_guard lock(mutex);
         std::erase_if(listeners, [&](auto& entry) { return entry.first == id; });
      }
   };
   inline std::shared_ptr<Counter> threadCounter()
   {
      thread_local auto counter = std::make_shared<Counter>();
      return counter;
   }
   class ActiveJob
   {
      std::shared_ptr<Counter> counter;

     public:
      explicit ActiveJob(std::shared_ptr<Counter> c) : counter(std::move(c)) { counter->begin(); }
      ~ActiveJob() { counter->end(); }
   };

   class Cancelled : public std::runtime_error
   {
     public:
      Cancelled() : std::runtime_error("execution CPU limit exceeded or request cancelled") {};
   };
   class Request
   {
      std::mutex            mutex;
      bool                  cancelled  = false;
      bool                  pending    = false;
      bool                  closed     = false;
      unsigned              publishing = 0;
      std::function<bool()> withinBudget;

     public:
      explicit Request(std::function<bool()> check) : withinBudget(std::move(check)) {}
      void cancel()
      {
         std::lock_guard lock(mutex);
         if (publishing)
            pending = true;
         else
            cancelled = true;
      }
      void close()
      {
         std::lock_guard lock(mutex);
         closed       = true;
         cancelled    = true;
         withinBudget = {};
      }
      void check()
      {
         std::lock_guard lock(mutex);
         if (closed)
            throw Cancelled();
         if (publishing)
            return;
         if (cancelled || !withinBudget || !withinBudget())
         {
            cancelled = true;
            throw Cancelled();
         }
      }
      void beginPublication()
      {
         std::lock_guard lock(mutex);
         if (closed || cancelled)
            throw Cancelled();
         if (!publishing && (!withinBudget || !withinBudget()))
         {
            cancelled = true;
            throw Cancelled();
         }
         ++publishing;
      }
      void endPublication()
      {
         std::lock_guard lock(mutex);
         if (!publishing)
            std::terminate();
         if (--publishing == 0 && pending)
         {
            cancelled = true;
            pending   = false;
         }
      }
   };
   struct Context
   {
      std::vector<std::shared_ptr<Request>> requests;
      void                                  check() const
      {
         for (auto& request : requests)
            request->check();
      }
   };
   inline std::shared_ptr<Context>& currentContext()
   {
      thread_local std::shared_ptr<Context> context;
      return context;
   }
   struct AdoptContext
   {
   };
   inline constexpr AdoptContext adoptContext{};
   class Scope
   {
      std::shared_ptr<Context> previous;

     public:
      explicit Scope(std::shared_ptr<Request> request) : previous(currentContext())
      {
         auto context = std::make_shared<Context>();
         if (previous)
            context->requests = previous->requests;
         if (request && std::find(context->requests.begin(), context->requests.end(), request) ==
                            context->requests.end())
            context->requests.push_back(std::move(request));
         context->check();
         currentContext() = std::move(context);
      }
      Scope(std::shared_ptr<Context> context, AdoptContext) : previous(currentContext())
      {
         if (context)
            context->check();
         currentContext() = std::move(context);
      }
      Scope(const Scope&) = delete;
      ~Scope() { currentContext() = std::move(previous); }
   };
   inline void check()
   {
      if (auto context = currentContext())
         context->check();
   }

   // The accepted publication region cannot safely be interrupted inside the
   // native atomic root commit/fsync. Its caller waits synchronously, completes
   // cached-root/socket/callback effects, then finish() reports any deferred
   // timeout. Expensive COW construction and OCC scans belong BEFORE this gate.
   class Publication
   {
      std::shared_ptr<Context> context;
      std::size_t              accepted = 0;

     public:
      Publication() : context(currentContext())
      {
         if (!context)
            return;
         try
         {
            for (auto& request : context->requests)
            {
               request->beginPublication();
               ++accepted;
            }
         }
         catch (...)
         {
            while (accepted)
               context->requests[--accepted]->endPublication();
            throw;
         }
      }
      Publication(const Publication&) = delete;
      ~Publication()
      {
         while (accepted)
            context->requests[--accepted]->endPublication();
      }
      void finish()
      {
         while (accepted)
            context->requests[--accepted]->endPublication();
         if (context)
            context->check();
      }
   };
}  // namespace psibase::accounting
