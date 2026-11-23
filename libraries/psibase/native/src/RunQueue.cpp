#include <psibase/RunQueue.hpp>

#include <condition_variable>
#include <cstdint>
#include <memory>
#include <mutex>
#include <psibase/BlockContext.hpp>
#include <psibase/SystemContext.hpp>
#include <psibase/TransactionContext.hpp>
#include <psibase/saturating.hpp>
#include <thread>
#include <vector>

namespace psibase
{
   struct RunQueue::Impl
   {
      std::mutex                 mutex;
      std::condition_variable    cond;
      std::uint64_t              next = 0;
      std::vector<std::uint64_t> running;
      bool                       timerRunning = false;

      std::shared_ptr<SharedState> sharedState;
      std::optional<std::chrono::microseconds> proofTimeout;

      struct Item
      {
         enum class Kind : std::uint8_t
         {
            run,
            timer
         };
         Impl*             self;
         std::vector<char> entry;
         std::uint64_t     id;
         Kind              kind;
         Item() : self(nullptr) {}
         Item(Impl* self, std::vector<char>&& entry, std::uint64_t id)
             : self(self), entry(std::move(entry)), id(id), kind(Kind::run)
         {
         }
         Item(Impl* self, std::vector<char>&& entry, Kind kind)
             : self(self), entry(std::move(entry)), id(0), kind(kind)
         {
         }
         Item(Item&& other)
             : self(other.self), entry(std::move(other.entry)), id(other.id), kind(other.kind)
         {
            other.self = nullptr;
         }
         ~Item()
         {
            if (self)
            {
               std::lock_guard l{self->mutex};
               if (kind == Kind::run)
               {
                  std::erase(self->running, id);
               }
               else
               {
                  self->timerRunning = false;
               }
            }
         }
         explicit                 operator bool() const { return self != nullptr; }
         psio::pssz_view<RunRow> getRun() const
         {
            assert(kind == Kind::run);
            return psio::pssz_view<RunRow>(entry);
         }
         psio::pssz_view<TimerRow> getTimer() const
         {
            assert(kind == Kind::timer);
            return psio::pssz_view<TimerRow>(entry);
         }
      };
      Item pop_impl(std::unique_lock<std::mutex>&, Database& db)
      {
         auto prefix     = psio::encode(psio::key{}, runPrefix());
         auto search_key = psio::encode(psio::key{}, runKey(next));
         while (true)
         {
            auto kv = db.kvGreaterEqualRaw(RunRow::db, search_key, prefix.size());
            if (!kv)
            {
               kv = db.kvGreaterEqualRaw(RunRow::db, prefix, prefix.size());
            }
            if (!kv)
            {
               next = 0;
               return {};
            }
            std::vector<char> key(kv->key.pos, kv->key.end);
            std::vector<char> runData(kv->value.pos, kv->value.end);
            if (!psio::validate_pssz<RunRow>(runData).ok())
            {
               search_key = std::move(key);
               search_key.push_back(0);
               continue;
            }
            auto row = psio::pssz_view<RunRow>(runData);
            if (psio::encode(psio::key{}, runKey(row.id())) != key)
            {
               search_key = std::move(key);
               search_key.push_back(0);
               continue;
            }
            if (std::ranges::find(running, row.id()) != running.end())
            {
               // TODO: Don't ignore available rows in the middle
               // of the running set.
               return {};
            }
            next = row.id() + 1;
            running.push_back(row.id());
            return {this, std::move(runData), row.id()};
         }
      }

      Item popTimer(std::unique_lock<std::mutex>&,
                    Database&                              db,
                    std::chrono::steady_clock::time_point& nextExpiration)
      {
         if (timerRunning)
            return {};
         if (auto row = db.kvGetRaw(TimerRow::db, psio::encode(psio::key{}, timerKey())))
         {
            if (psio::validate_pssz<TimerRow>(std::span(row->pos, row->end)).ok())
            {
               auto view       = psio::pssz_view<TimerRow>(std::span<const char>(row->pos, row->end));
               auto expiration = saturatingCast<std::chrono::steady_clock::time_point>(
                   view.expiration().unpack());
               if (expiration < std::chrono::steady_clock::now())
               {
                  timerRunning = true;
                  return {this, std::vector(row->pos, row->end), Item::Kind::timer};
               }
               else
               {
                  nextExpiration = expiration;
                  return {};
               }
            }
         }
         return {};
      }

      Item pop(SystemContext& systemContext, const WriterPtr& writer, auto&& done)
      {
         std::unique_lock l{mutex};
         while (!done())
         {
            auto nextExpiration = std::chrono::steady_clock::time_point::max();
            {
               Database db{systemContext.sharedDatabase,
                           systemContext.sharedDatabase.emptyRevision()};
               auto     session = db.startWrite(writer);
               db.checkoutSubjective();
               if (auto result = popTimer(l, db, nextExpiration))
               {
                  return result;
               }
               if (auto result = pop_impl(l, db))
               {
                  return result;
               }
            }
            if (nextExpiration == std::chrono::steady_clock::time_point::max())
               cond.wait(l);
            else
               cond.wait_until(l, nextExpiration);
         }
         return {};
      }
   };

   RunQueue::RunQueue(std::shared_ptr<SharedState> sharedState,
                      std::optional<std::chrono::microseconds> proofTimeout)
       : impl(new Impl{.sharedState = std::move(sharedState), .proofTimeout = proofTimeout})
   {
   }

   RunQueue::~RunQueue() = default;

   void RunQueue::notify()
   {
      std::lock_guard l{impl->mutex};
      impl->cond.notify_all();
   }

   struct WasmThreadPool::Impl
   {
      std::vector<std::jthread> threads;
      RunQueue::Impl*           queue;
      std::size_t               numThreads;

      Impl(RunQueue::Impl* queue, std::size_t numThreads) : queue(queue), numThreads(numThreads) {}

      ~Impl()
      {
         {
            std::lock_guard l(queue->mutex);
            numThreads = 0;
         }
         adjustThreads();
      }
      // Starts or stops threads to match numThreads
      void adjustThreads()
      {
         if (numThreads > threads.size())
         {
            // reserve is required, because the jthread destructor will
            // deadlock if push_back throws.
            threads.reserve(numThreads);
            while (threads.size() < numThreads)
            {
               auto id = threads.size();
               threads.push_back(std::jthread([this, id] { run(id); }));
            }
         }
         else if (numThreads < threads.size())
         {
            queue->cond.notify_all();
            threads.resize(numThreads);
         }
      }
      void run(std::size_t threadIndex)
      {
         auto systemContext = queue->sharedState->getSystemContext();
         auto writer        = systemContext->sharedDatabase.createWriter();
         while (auto item = queue->pop(*systemContext, writer,
                                       [this, threadIndex] { return threadIndex >= numThreads; }))
         {
            auto         revision = systemContext->sharedDatabase.getHead();
            BlockContext bc{*systemContext, revision, writer, true};
            bc.start();
            switch (item.kind)
            {
               case RunQueue::Impl::Item::Kind::run:
                  bc.callRun(item.getRun(), queue->proofTimeout);
                  break;
               case RunQueue::Impl::Item::Kind::timer:
                  bc.callTimer(item.getTimer());
                  break;
            }
         }
      }
   };

   WasmThreadPool::WasmThreadPool(RunQueue& queue, std::size_t numThreads)
       : impl(new Impl{queue.impl.get(), numThreads})
   {
      impl->adjustThreads();
   }

   WasmThreadPool::~WasmThreadPool() = default;

   void WasmThreadPool::setNumThreads(std::size_t numThreads)
   {
      {
         std::lock_guard l(impl->queue->mutex);
         impl->numThreads = numThreads;
      }
      impl->adjustThreads();
   }
}  // namespace psibase
