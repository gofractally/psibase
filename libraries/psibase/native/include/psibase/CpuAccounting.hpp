#pragma once
#include <atomic>
#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cstdint>
#include <exception>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <system_error>
#include <utility>
#include <vector>

namespace psibase::accounting
{
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
      // Storage checks the request around every operation, so a check is one
      // atomic load: `settled` is true while nothing is cancelled, closed or
      // publishing. The executing thread does not read a clock to enforce its
      // own budget. Whoever owns the budget (the watchdog thread, which sleeps
      // until the budget could have run out) cancels the request, and that
      // takes effect at the very next check.
      //
      // A request given an interval also evaluates the budget itself, no more
      // often than that; zero evaluates it at every check. This is for
      // requests nothing else watches.
      std::optional<std::chrono::microseconds> evaluationInterval;
      std::atomic<bool>                          settled{true};
      std::atomic<std::chrono::steady_clock::rep> evaluateAfter{0};

     public:
      explicit Request(std::function<bool()>                    check,
                       std::optional<std::chrono::microseconds> interval = std::nullopt)
          : withinBudget(std::move(check)), evaluationInterval(interval)
      {
      }
      void cancel()
      {
         std::lock_guard lock(mutex);
         settled.store(false, std::memory_order_release);
         if (publishing)
            pending = true;
         else
            cancelled = true;
      }
      void close()
      {
         std::lock_guard lock(mutex);
         settled.store(false, std::memory_order_release);
         closed       = true;
         cancelled    = true;
         withinBudget = {};
      }
      void check()
      {
         std::chrono::steady_clock::rep now = 0;
         if (settled.load(std::memory_order_acquire))
         {
            if (!evaluationInterval)
               return;
            now = std::chrono::steady_clock::now().time_since_epoch().count();
            if (now < evaluateAfter.load(std::memory_order_relaxed))
               return;
         }
         std::lock_guard lock(mutex);
         if (closed)
            throw Cancelled();
         if (publishing)
            return;
         if (cancelled || !withinBudget || (evaluationInterval && !withinBudget()))
         {
            settled.store(false, std::memory_order_release);
            cancelled = true;
            throw Cancelled();
         }
         if (evaluationInterval)
            evaluateAfter.store(
                now + std::chrono::duration_cast<std::chrono::steady_clock::duration>(
                          *evaluationInterval)
                          .count(),
                std::memory_order_relaxed);
      }
      void beginPublication()
      {
         std::lock_guard lock(mutex);
         if (closed || cancelled)
            throw Cancelled();
         if (!publishing && (!withinBudget || !withinBudget()))
         {
            settled.store(false, std::memory_order_release);
            cancelled = true;
            throw Cancelled();
         }
         settled.store(false, std::memory_order_release);
         ++publishing;
      }
      void endPublication()
      {
         std::lock_guard lock(mutex);
         if (!publishing)
            std::terminate();
         if (--publishing == 0)
         {
            if (pending)
            {
               cancelled = true;
               pending   = false;
            }
            else
               settled.store(true, std::memory_order_release);
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
