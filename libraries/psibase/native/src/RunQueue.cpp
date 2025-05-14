#include <psibase/RunQueue.hpp>

#include <condition_variable>
#include <cstdint>
#include <memory>
#include <mutex>
#include <psibase/BlockContext.hpp>
#include <psibase/SystemContext.hpp>
#include <psibase/TransactionContext.hpp>
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

      std::shared_ptr<SharedState> sharedState;

      struct Item
      {
         Impl*             self;
         std::vector<char> entry;
         std::uint64_t     id;
         Item() : self(nullptr) {}
         Item(Impl* self, std::vector<char>&& entry, std::uint64_t id)
             : self(self), entry(std::move(entry)), id(id)
         {
         }
         Item(Item&& other) : self(other.self), entry(std::move(other.entry)), id(other.id)
         {
            other.self = nullptr;
         }
         ~Item()
         {
            if (self)
            {
               std::lock_guard l{self->mutex};
               std::erase(self->running, id);
            }
         }
         explicit                 operator bool() const { return self != nullptr; }
         psio::view<const RunRow> get() const
         {
            return psio::view<const RunRow>(psio::prevalidated{entry});
         }
      };
      Item pop_impl(std::unique_lock<std::mutex>&, Database& db)
      {
         auto prefix     = psio::convert_to_key(runPrefix());
         auto search_key = psio::convert_to_key(runKey(next));
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
            if (!psio::fracpack_validate<RunRow>(runData))
            {
               search_key = std::move(key);
               search_key.push_back(0);
               continue;
            }
            auto row = psio::view<const RunRow>(psio::prevalidated{runData});
            if (psio::convert_to_key(runKey(row.id())) != key)
            {
               search_key = std::move(key);
               search_key.push_back(0);
               continue;
            }
            if (std::ranges::contains(running, row.id().unpack()))
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

      Item pop(SystemContext& systemContext, const WriterPtr& writer, auto&& done)
      {
         std::unique_lock l{mutex};
         while (!done())
         {
            {
               Database db{systemContext.sharedDatabase,
                           systemContext.sharedDatabase.emptyRevision()};
               auto     session = db.startWrite(writer);
               db.checkoutSubjective();
               if (auto result = pop_impl(l, db))
               {
                  return result;
               }
            }
            cond.wait(l);
         }
         return {};
      }
   };

   RunQueue::RunQueue(std::shared_ptr<SharedState> sharedState)
       : impl(new Impl{.sharedState = std::move(sharedState)})
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
         numThreads = 0;
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
            bc.callRun(item.get());
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
