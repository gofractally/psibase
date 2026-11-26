// The node's compiled-module store: records under the cache root of the
// node's own database (NativeAotDatabase over storage::cache_root).

#include <catch2/catch_all.hpp>
#include <psibase/CpuAccounting.hpp>
#include <psibase/NativeAotCache.hpp>
#include <psibase/db.hpp>
#include <psibase/nativeTables.hpp>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <functional>
#include <mutex>
#include <set>
#include <thread>
#include "TempDirectory.hpp"

using namespace psibase;

namespace
{
   using Key = NativeAotCache::Key;

   constexpr storage::database_config config{64ull << 20, 64ull << 20, 64ull << 20, 64ull << 20};

   Key key(std::uint32_t value)
   {
      Key result{};
      result[0] = static_cast<std::uint8_t>(value * 37);
      std::memcpy(result.data() + 1, &value, sizeof(value));
      return result;
   }

   std::vector<char> artifact(std::uint32_t value, std::size_t size)
   {
      std::vector<char> result(size);
      for (std::size_t i = 0; i < size; ++i)
         result[i] = static_cast<char>(value * 131 + i * 7 + (i >> 8));
      return result;
   }

   // A node: its database, and its module cache under that database's cache root.
   struct Node
   {
      SharedDatabase     shared;
      NativeAotDatabase* store;
      NativeAotCache     cache;

      explicit Node(const std::filesystem::path& path,
                    std::uint64_t                maxBytes = NativeAotDatabase::defaultMaxBytes,
                    storage::database_config     settings = config)
          : shared(path, settings), cache(make(shared, maxBytes, store))
      {
      }
      static std::unique_ptr<NativeAotDatabase> make(SharedDatabase&     shared,
                                                     std::uint64_t       maxBytes,
                                                     NativeAotDatabase*& store)
      {
         auto result = std::make_unique<NativeAotDatabase>(shared.cacheRoot(), maxBytes);
         store       = result.get();
         return result;
      }
   };

   std::span<const char> span(std::string_view s)
   {
      return {s.data(), s.size()};
   }
   Checksum256 blockId(std::uint32_t number, unsigned fork = 0)
   {
      Checksum256 id{};
      for (unsigned i = 0; i < 4; ++i)
         id[i] = number >> (24 - 8 * i);
      id.back() = fork;
      return id;
   }
   // A block: one revision of the chain's databases, stored under its id.
   ConstRevisionPtr revision(SharedDatabase&    shared,
                             WriterPtr          writer,
                             const Checksum256& id,
                             const Checksum256& previous,
                             std::string_view   content)
   {
      Database db(shared, shared.emptyRevision());
      auto     session = db.startWrite(writer);
      db.kvPutRaw(DbId::service, span("contract"), span(content));
      StatusRow status{};
      status.head                  = BlockInfo{};
      status.head->header.previous = previous;
      db.kvPut(StatusRow::db, statusKey(), status);
      return session.writeRevision(id);
   }
   std::string content(SharedDatabase& shared, ConstRevisionPtr at)
   {
      Database db(shared, std::move(at));
      auto     session = db.startRead();
      auto     value   = db.kvGetRaw(DbId::service, span("contract"));
      return value ? std::string(value->begin(), value->end()) : "<missing>";
   }
}  // namespace

TEST_CASE("The compiled-module store keeps what it is given across a restart")
{
   TempDirectory root;
   const auto    path = root.path / "node";
   {
      Node node{path};
      REQUIRE(node.cache.usable());
      CHECK_FALSE(node.cache.load(key(1)).has_value());
      node.cache.store(key(1), artifact(1, 1000));
      node.cache.store(key(2), artifact(2, 3 << 20));
      node.cache.store(key(1), artifact(3, 70000));  // replaced
      node.cache.store(key(4), {});                  // nothing to keep
      CHECK(node.cache.load(key(1)) == artifact(3, 70000));
      CHECK(node.cache.load(key(2)) == artifact(2, 3 << 20));
      CHECK_FALSE(node.cache.load(key(4)).has_value());
      node.cache.remove(key(2));
      CHECK_FALSE(node.cache.load(key(2)).has_value());
      node.cache.store(key(5), artifact(5, 12345));
      CHECK(node.store->entries() == 2);
   }
   {
      Node node{path};
      REQUIRE(node.cache.usable());
      CHECK(node.store->entries() == 2);
      CHECK(node.store->bytes() == 70000 + 12345 + 2 * 64);
      CHECK(node.cache.load(key(1)) == artifact(3, 70000));
      CHECK(node.cache.load(key(5)) == artifact(5, 12345));
      CHECK_FALSE(node.cache.load(key(2)).has_value());
      CHECK(node.cache.discarded() == 0);
   }
}

TEST_CASE("Clearing the compiled-module store costs its contents and nothing of the chain")
{
   TempDirectory root;
   const auto    path = root.path / "node";
   {
      Node node{path};
      auto writer = node.shared.createWriter();
      node.shared.setHead(*writer, revision(node.shared, writer, blockId(1), {}, "block-1"));
      node.shared.kvPutSubjective(*writer, DbId::subjective, span("key"), span("local"));
      node.cache.store(key(1), artifact(1, 50000));
      node.cache.store(key(2), artifact(2, 50000));
      node.store->clear();
      CHECK(node.store->entries() == 0);
      CHECK(node.store->bytes() == 0);
      CHECK_FALSE(node.cache.load(key(1)).has_value());
      CHECK(content(node.shared, node.shared.getHead()) == "block-1");
      // A module is compiled again and kept again.
      node.cache.store(key(1), artifact(1, 50000));
      CHECK(node.cache.load(key(1)) == artifact(1, 50000));
   }
   Node node{path};
   auto writer = node.shared.createWriter();
   CHECK(node.cache.load(key(1)) == artifact(1, 50000));
   CHECK_FALSE(node.cache.load(key(2)).has_value());
   CHECK(content(node.shared, node.shared.getHead()) == "block-1");
   auto local = node.shared.kvGetSubjective(*writer, DbId::subjective, span("key"));
   REQUIRE(local.has_value());
   CHECK(std::string(local->begin(), local->end()) == "local");
}

TEST_CASE("The compiled-module store holds an artifact larger than one storage chunk")
{
   // The engine stores a large value as chunks of just under 32 MiB.
   TempDirectory root;
   const auto    large = artifact(9, (40u << 20) + 17);
   {
      Node node{root.path / "node"};
      node.cache.store(key(9), large);
      CHECK(node.cache.load(key(9)) == large);
   }
   Node node{root.path / "node"};
   CHECK(node.cache.load(key(9)) == large);
}

TEST_CASE("The compiled-module store returns only records it can verify")
{
   TempDirectory root;
   Node          node{root.path / "node"};
   auto&         cache = node.cache;
   auto*         raw   = node.store;

   cache.store(key(1), artifact(1, 5000));
   auto record = raw->read(key(1));
   REQUIRE(record.has_value());
   REQUIRE(record->size() == 5000 + 64);

   // Native code that is not what was stored.
   auto damaged = *record;
   damaged[2500] ^= 1;
   raw->write(key(1), damaged);
   CHECK_FALSE(cache.load(key(1)).has_value());
   CHECK(cache.discarded() == 1);
   CHECK(raw->entries() == 0);

   // Bytes with no digest at all.
   raw->write(key(2), artifact(2, 5000));
   CHECK_FALSE(cache.load(key(2)).has_value());
   CHECK(cache.discarded() == 2);

   // A good record under a key it was not stored under: another module's
   // code, or the same module compiled by another engine build, whose
   // identity is part of the key.
   raw->write(key(3), *record);
   CHECK_FALSE(cache.load(key(3)).has_value());
   CHECK(cache.discarded() == 3);
   CHECK(raw->entries() == 0);

   // The module is compiled and stored again, and then it loads.
   cache.store(key(1), artifact(1, 5000));
   CHECK(cache.load(key(1)) == artifact(1, 5000));
   CHECK(cache.discarded() == 3);
}

TEST_CASE("Threads store and load compiled modules at the same time")
{
   TempDirectory           root;
   const auto              path    = root.path / "node";
   constexpr std::uint32_t threads = 12, own = 40, shared = 16;
   {
      Node                       node{path};
      auto&                      cache = node.cache;
      std::atomic<std::uint32_t> wrong{0}, missing{0};
      std::atomic<bool>          go{false};
      std::vector<std::thread>   workers;
      for (std::uint32_t t = 0; t < threads; ++t)
         workers.emplace_back(
             [&, t]
             {
                while (!go)
                   std::this_thread::yield();
                for (std::uint32_t i = 0; i < own; ++i)
                {
                   // A module only this thread compiles...
                   const auto mine = 1000 * (t + 1) + i;
                   cache.store(key(mine), artifact(mine, 2000 + 997 * i));
                   // ...and one every thread compiles, to the same artifact.
                   const auto common = i % shared;
                   cache.store(key(common), artifact(common, 300000));
                   if (auto loaded = cache.load(key(mine)))
                      wrong += *loaded != artifact(mine, 2000 + 997 * i);
                   else
                      ++missing;
                   if (auto loaded = cache.load(key(common)))
                      wrong += *loaded != artifact(common, 300000);
                   else
                      ++missing;
                   // What another thread stored, if it has yet.
                   const auto other = 1000 * ((t + 1) % threads + 1) + i;
                   if (auto loaded = cache.load(key(other)))
                      wrong += *loaded != artifact(other, 2000 + 997 * i);
                }
             });
      go = true;
      for (auto& worker : workers)
         worker.join();
      CHECK(wrong == 0);
      CHECK(missing == 0);
      CHECK(cache.discarded() == 0);
      CHECK(node.store->entries() == threads * own + shared);
   }
   // Everything every thread stored is there for the next run.
   Node          node{path};
   std::uint32_t found = 0;
   for (std::uint32_t t = 0; t < threads; ++t)
      for (std::uint32_t i = 0; i < own; ++i)
         found += node.cache.load(key(1000 * (t + 1) + i)) ==
                  artifact(1000 * (t + 1) + i, 2000 + 997 * i);
   CHECK(found == threads * own);
   for (std::uint32_t i = 0; i < shared; ++i)
      CHECK(node.cache.load(key(i)) == artifact(i, 300000));
}

TEST_CASE("The compiled-module store stays within its size and evicts the least recently used")
{
   TempDirectory           root;
   const auto              path  = root.path / "node";
   constexpr std::uint64_t limit = 1 << 20;
   constexpr std::size_t   size  = 200000;
   {
      Node  node{path, limit};
      auto& cache = node.cache;
      auto* raw   = node.store;
      for (std::uint32_t i = 1; i <= 5; ++i)
         cache.store(key(i), artifact(i, size));
      CHECK(raw->entries() == 5);
      CHECK(raw->bytes() == 5 * (size + 64));
      // 1 is used again; 2 is now the least recently used.
      CHECK(cache.load(key(1)).has_value());
      cache.store(key(6), artifact(6, size));
      CHECK(raw->entries() == 5);
      CHECK(raw->bytes() <= limit);
      CHECK_FALSE(cache.load(key(2)).has_value());
      CHECK(cache.load(key(1)) == artifact(1, size));
      CHECK(cache.load(key(6)) == artifact(6, size));
      // Larger than the whole bound: not kept, and nothing is evicted for it.
      cache.store(key(7), artifact(7, limit + 1));
      CHECK_FALSE(cache.load(key(7)).has_value());
      CHECK(raw->entries() == 5);
      for (std::uint32_t i = 8; i < 40; ++i)
      {
         cache.store(key(i), artifact(i, size + i));
         CHECK(raw->bytes() <= limit);
      }
      CHECK(cache.load(key(39)).has_value());
   }
   // The bound holds for what a restart finds; nothing found has been used
   // yet, so all of it goes before anything stored now.
   Node node{path, limit};
   CHECK(node.store->bytes() <= limit);
   CHECK(node.store->entries() >= 4);
   node.cache.store(key(100), artifact(100, size));
   node.cache.store(key(101), artifact(101, size));
   CHECK(node.store->bytes() <= limit);
   CHECK(node.cache.load(key(100)).has_value());
   CHECK(node.cache.load(key(101)).has_value());
}

namespace
{
   // A place where a thread is stopped, and is known to be standing.
   struct Hold
   {
      std::mutex              mutex;
      std::condition_variable changed;
      unsigned                arrived  = 0;      // times a thread has come here
      unsigned                passed   = 0;      // of those, let go
      bool                    open     = false;  // nobody is stopped any more
      bool                    finished = false;  // nobody comes here any more

      // The thread to be stopped calls this; it returns when it may go on.
      void arrive()
      {
         std::unique_lock lock{mutex};
         const auto       mine = ++arrived;
         changed.notify_all();
         changed.wait(lock, [&] { return open || passed >= mine; });
      }
      // Waits until a thread stands here for the `count`th time. False if
      // none will, or none is stopped any more.
      bool awaitArrival(unsigned count)
      {
         std::unique_lock lock{mutex};
         changed.wait(lock, [&] { return open || arrived >= count || finished; });
         return !open && arrived >= count;
      }
      // Whether a thread is standing here now.
      bool holding()
      {
         std::lock_guard lock{mutex};
         return !open && arrived > passed;
      }
      void pass()
      {
         {
            std::lock_guard lock{mutex};
            ++passed;
         }
         changed.notify_all();
      }
      void release()
      {
         {
            std::lock_guard lock{mutex};
            open = true;
         }
         changed.notify_all();
      }
      void finish()
      {
         {
            std::lock_guard lock{mutex};
            finished = true;
         }
         changed.notify_all();
      }
   };

   // Turns a wait that would never end into a failure: if it is still there
   // after `limit` it runs `rescue`, which lets the held thread go. The
   // limit is no part of what is tested: what it guards takes milliseconds,
   // and it is seconds so that no load on the machine reaches it.
   class HangGuard
   {
      std::mutex              mutex;
      std::condition_variable stop;
      bool                    done = false;
      std::atomic<bool>       fired{false};
      std::thread             thread;

     public:
      HangGuard(std::chrono::seconds limit, std::function<void()> rescue)
          : thread(
                [this, limit, rescue = std::move(rescue)]
                {
                   std::unique_lock lock{mutex};
                   if (!stop.wait_for(lock, limit, [&] { return done; }))
                   {
                      fired = true;
                      rescue();
                   }
                })
      {
      }
      ~HangGuard()
      {
         {
            std::lock_guard lock{mutex};
            done = true;
         }
         stop.notify_all();
         thread.join();
      }
      bool expired() const { return fired; }
   };
   constexpr std::chrono::seconds hangLimit{20};

   // The cache root's write hook is a plain function: what it holds is here.
   std::atomic<Hold*> heldCacheWrite{nullptr};
   void               holdCacheWrite()
   {
      if (auto* hold = heldCacheWrite.load())
         hold->arrive();
   }
}  // namespace

TEST_CASE("Modules are stored while the chain publishes, and neither waits for the other")
{
   using namespace std::chrono;
   // The default (nothing is flushed) and the slow case for the chain (every
   // publication of its top root is flushed).
   for (auto sync : {storage::durability::none, storage::durability::flush})
   {
      TempDirectory root;
      auto          settings = config;
      settings.sync          = sync;
      Node node{root.path / "node", NativeAotDatabase::defaultMaxBytes, settings};

      constexpr unsigned blocks = 200, stores = 50, storers = 4;
      const auto         module = artifact(1, 1 << 20);

      struct Times
      {
         microseconds total{}, longest{};
      };
      // Each side alone, then both together.
      auto publish = [&](unsigned first, const std::atomic<bool>* until = nullptr)
      {
         Times      times;
         // Made on the thread that publishes.
         auto       writer = node.shared.createWriter();
         const auto start  = steady_clock::now();
         for (unsigned i = 0; until ? !until->load() || i < blocks : i < blocks; ++i)
         {
            const auto begin = steady_clock::now();
            node.shared.setHead(*writer, revision(node.shared, writer, blockId(first + i),
                                                  blockId(first + i - 1), "block"));
            times.longest = std::max(
                times.longest, duration_cast<microseconds>(steady_clock::now() - begin));
         }
         times.total = duration_cast<microseconds>(steady_clock::now() - start);
         return times;
      };
      std::atomic<std::uint32_t> wrong{0};
      auto                       store = [&](unsigned base)
      {
         std::atomic<std::int64_t> longest{0};
         const auto                start = steady_clock::now();
         std::vector<std::thread>  threads;
         for (unsigned t = 0; t < storers; ++t)
            threads.emplace_back(
                [&, t]
                {
                   for (unsigned i = 0; i < stores; ++i)
                   {
                      const auto id    = base + 1000 * t + i;
                      const auto begin = steady_clock::now();
                      node.cache.store(key(id), module);
                      const auto took =
                          duration_cast<microseconds>(steady_clock::now() - begin).count();
                      for (auto seen = longest.load(); took > seen;)
                         if (longest.compare_exchange_weak(seen, took))
                            break;
                      wrong += node.cache.load(key(id)) != module;
                   }
                });
         for (auto& thread : threads)
            thread.join();
         return Times{duration_cast<microseconds>(steady_clock::now() - start),
                      microseconds(longest.load())};
      };
      const auto publishAlone = publish(1);
      const auto storeAlone   = store(100000);

      // A chain write that has not been committed is held open the whole
      // time as well: an open write session of the chain is no obstacle.
      Database pending(node.shared, node.shared.getHead());
      auto     open = pending.startWrite(node.shared.createWriter());
      pending.kvPutRaw(DbId::service, span("pending"), span("uncommitted"));
      Times             publishBeside, storeBeside;
      std::atomic<bool> stored{false};
      {
         // The chain publishes for as long as modules are being stored.
         std::thread chain([&] { publishBeside = publish(100000, &stored); });
         storeBeside = store(200000);
         stored      = true;
         chain.join();
      }
      CHECK(wrong == 0);
      CHECK(node.store->entries() == 2 * storers * stores);
      CHECK(content(node.shared, node.shared.getHead()) == "block");
      CHECK(node.cache.discarded() == 0);
      // Reported, not asserted: the two share a machine, a file and an
      // allocator, so no time is a constant, and on a loaded machine the
      // scheduler alone makes one publication take longer than all the
      // stores together. That neither waits for the other is shown below,
      // without a clock.
      WARN((sync == storage::durability::none ? "sync none: " : "sync flush: ")
           << blocks << " chain publications alone " << publishAlone.total.count() << " us (longest "
           << publishAlone.longest.count() << " us); beside module stores, longest "
           << publishBeside.longest.count() << " us; " << storers * stores
           << " stores of 1 MiB on " << storers << " threads: alone " << storeAlone.total.count()
           << " us (longest " << storeAlone.longest.count() << " us), beside publication "
           << storeBeside.total.count() << " us (longest " << storeBeside.longest.count()
           << " us)");
      // With flushing on, the chain's flush also writes out the module pages
      // stored since the last one (they are in the same file): that is a
      // cost of the flush, measured above, and not a wait for a writer.

      // Neither waits for the other, whatever the scheduler does: each side
      // is stopped in the middle of its work, for as long as the other
      // needs to do all of its own. A side that needed what the stopped one
      // holds would never finish; HangGuard turns that into a failure.
      const auto part = artifact(7, 64 << 10);

      // The cache root's writer is stopped where it is about to write, with
      // a store handed to it and its caller waiting. The chain publishes.
      {
         Hold cacheWrite;
         heldCacheWrite = &cacheWrite;
         storage::cache_root::set_write_hook(holdCacheWrite);
         std::thread storer([&] { node.cache.store(key(900000), part); });
         bool        held = false, still = false, hung = false;
         {
            HangGuard guard{hangLimit, [&] { cacheWrite.release(); }};
            held = cacheWrite.awaitArrival(1);
            std::thread chain([&] { publish(1000000); });
            chain.join();
            still = cacheWrite.holding();
            hung  = guard.expired();
         }
         cacheWrite.release();
         storer.join();
         storage::cache_root::set_write_hook(nullptr);
         heldCacheWrite = nullptr;
         CHECK(held);
         // The publications were all made while the store was in the
         // writer's hands, and none of them had to be let through.
         CHECK(still);
         CHECK_FALSE(hung);
         const bool kept = node.cache.load(key(900000)) == part;
         CHECK(kept);
      }

      // The chain is stopped wherever a publication can be: storage asks
      // the request's budget before it enters the writer's gate, again once
      // it is inside, and when the work there is done, and a budget that is
      // evaluated at every check is this test's to answer. At each of those
      // places, the ones inside the gate among them, a module is stored and
      // read back while the chain stands there.
      {
         Hold          chainStep;
         unsigned      steps = 0;
         std::uint32_t lost  = 0;
         bool          hung  = false;
         auto          budget = std::make_shared<accounting::Request>(
             [&]
             {
                chainStep.arrive();
                return true;
             },
             microseconds(0));
         {
            HangGuard   guard{hangLimit, [&] { chainStep.release(); }};
            std::thread chain(
                [&]
                {
                   auto writer = node.shared.createWriter();
                   {
                      accounting::Scope scope(budget);
                      node.shared.setHead(*writer,
                                          revision(node.shared, writer, blockId(2000000),
                                                   blockId(1999999), "held"));
                   }
                   chainStep.finish();
                });
            while (chainStep.awaitArrival(steps + 1))
            {
               const auto id = 900001 + steps;
               node.cache.store(key(id), part);
               lost += node.cache.load(key(id)) != part;
               ++steps;
               chainStep.pass();
            }
            chain.join();
            hung = guard.expired();
         }
         INFO("the chain was stopped at " << steps << " places of one publication");
         CHECK_FALSE(hung);
         // Some of them are inside the gate: one before it, one in it and
         // one after its work, for each time the gate is entered.
         CHECK(steps >= 3);
         CHECK(lost == 0);
         CHECK(content(node.shared, node.shared.getHead()) == "held");
         CHECK(node.store->entries() == 2 * storers * stores + 1 + steps);
      }
   }
}

namespace
{
   std::mutex                writersMutex;
   std::set<std::thread::id> writers;
   std::atomic<unsigned>     writes{0};
}  // namespace

TEST_CASE("Every write of the compiled-module root is made by its one writer thread")
{
   TempDirectory root;
   const auto    path = root.path / "node";
   {
      std::lock_guard lock{writersMutex};
      writers.clear();
      writes = 0;
   }
   storage::cache_root::set_write_hook(
       []
       {
          std::lock_guard lock{writersMutex};
          writers.insert(std::this_thread::get_id());
          ++writes;
       });
   constexpr unsigned        threads = 10, each = 30;
   std::set<std::thread::id> callers{std::this_thread::get_id()};
   std::thread::id           writer;
   {
      Node node{path};
      CHECK(node.shared.cacheRoot().writer_thread() == std::thread::id{});  // nothing written yet
      node.cache.store(key(1), artifact(1, 1000));
      writer = node.shared.cacheRoot().writer_thread();
      CHECK(writer != std::thread::id{});
      CHECK(writer != std::this_thread::get_id());

      std::atomic<unsigned>    missing{0};
      std::vector<std::thread> workers;
      std::mutex               callersMutex;
      for (unsigned t = 0; t < threads; ++t)
         workers.emplace_back(
             [&, t]
             {
                {
                   std::lock_guard lock{callersMutex};
                   callers.insert(std::this_thread::get_id());
                }
                for (unsigned i = 0; i < each; ++i)
                {
                   const auto id = 100 * (t + 1) + i;
                   node.cache.store(key(id), artifact(id, 20000));
                   // Stored means there for the next reader, on any thread.
                   missing += node.cache.load(key(id)) != artifact(id, 20000);
                   if (i % 3 == 0)
                      node.cache.remove(key(id));
                }
             });
      for (auto& worker : workers)
         worker.join();
      CHECK(missing == 0);
      node.store->clear();
      node.cache.store(key(2), artifact(2, 1000));
      CHECK(node.shared.cacheRoot().writer_thread() == writer);
   }
   storage::cache_root::set_write_hook(nullptr);
   std::lock_guard lock{writersMutex};
   // 1 store, then per thread 30 stores and 10 removes, a clear and a store.
   CHECK(writes == 1 + threads * (each + each / 3) + 2);
   REQUIRE(writers.size() == 1);
   CHECK(*writers.begin() == writer);
   CHECK(callers.count(writer) == 0);
}

TEST_CASE("The database closes with module stores in flight and loses none that returned")
{
   TempDirectory           root;
   const auto              path    = root.path / "node";
   constexpr unsigned      threads = 8, each = 25;
   std::atomic<unsigned>   stored{0};
   {
      // Each thread has its own handles to the database and the store; the
      // database closes when the last of them lets go, on whichever thread
      // that is, while the others may still be handing over stores.
      auto                     node = std::make_shared<Node>(path);
      std::vector<std::thread> workers;
      for (unsigned t = 0; t < threads; ++t)
         workers.emplace_back(
             [node, t, &stored]() mutable
             {
                for (unsigned i = 0; i < each * (t + 1) / threads; ++i)
                {
                   node->cache.store(key(1000 * (t + 1) + i), artifact(t + i, 100000));
                   ++stored;
                }
                node.reset();
             });
      node.reset();
      for (auto& worker : workers)
         worker.join();
   }
   Node     node{path};
   unsigned found = 0;
   for (unsigned t = 0; t < threads; ++t)
      for (unsigned i = 0; i < each * (t + 1) / threads; ++i)
         found += node.cache.load(key(1000 * (t + 1) + i)) == artifact(t + i, 100000);
   CHECK(found == stored);
   CHECK(node.store->entries() == stored);
   CHECK(node.cache.discarded() == 0);
}

TEST_CASE("Reverting and pruning blocks neither loses nor restores compiled modules")
{
   TempDirectory root;
   const auto    path = root.path / "node";
   {
      Node node{path};
      auto writer = node.shared.createWriter();
      auto first  = revision(node.shared, writer, blockId(1), {}, "first");
      node.shared.setHead(*writer, first);
      node.cache.store(key(1), artifact(1, 40000));  // compiled at block 1

      auto second = revision(node.shared, writer, blockId(2), blockId(1), "second");
      auto third  = revision(node.shared, writer, blockId(3), blockId(2), "third");
      node.shared.setHead(*writer, third);
      node.cache.store(key(2), artifact(2, 40000));  // compiled at block 3
      node.cache.remove(key(1));                     // and one evicted there

      // Storing and removing modules made no revision and moved no head.
      CHECK(node.shared.getHead() == third);

      // A fork switch: the head goes back to block 1 and on to another block 2.
      node.shared.setHead(*writer, first);
      CHECK(content(node.shared, node.shared.getHead()) == "first");
      CHECK(node.cache.load(key(2)) == artifact(2, 40000));  // not lost with block 3
      CHECK_FALSE(node.cache.load(key(1)).has_value());      // not back with block 1
      auto fork = revision(node.shared, writer, blockId(2, 1), blockId(1), "fork");
      node.shared.setHead(*writer, fork);
      node.shared.removeRevisions(*writer, blockId(2, 1));
      CHECK_FALSE(node.shared.getRevision(*writer, blockId(3)));
      CHECK(node.cache.load(key(2)) == artifact(2, 40000));
      CHECK_FALSE(node.cache.load(key(1)).has_value());
      CHECK(node.store->entries() == 1);

      // A fork of the whole database (what the tester and the snapshot
      // loader work on) has its own head; it is the same store underneath.
      auto clone = node.shared.clone();
      auto cw    = clone.createWriter();
      clone.setHead(*cw, revision(clone, cw, blockId(9), blockId(2, 1), "clone"));
      CHECK(content(node.shared, node.shared.getHead()) == "fork");
      CHECK(node.cache.load(key(2)) == artifact(2, 40000));
   }
   Node node{path};
   CHECK(content(node.shared, node.shared.getHead()) == "fork");
   CHECK(node.cache.load(key(2)) == artifact(2, 40000));
   CHECK_FALSE(node.cache.load(key(1)).has_value());
}

TEST_CASE("Nothing a snapshot or a state hash reads contains a compiled module")
{
   // A snapshot, a state hash and a revision are all made from the chain's
   // databases at a revision, and the node's own state is its subjective
   // databases. Every one of them is read here, key by key.
   TempDirectory root;
   Node          node{root.path / "node"};
   auto          writer = node.shared.createWriter();
   node.shared.setHead(*writer, revision(node.shared, writer, blockId(1), {}, "first"));
   node.shared.kvPutSubjective(*writer, DbId::subjective, span("key"), span("local"));

   auto everything = [&]
   {
      std::vector<std::pair<std::vector<char>, std::vector<char>>> rows;
      Database db(node.shared, node.shared.getHead());
      auto     session = db.startRead();
      db.checkoutSubjective();
      for (std::uint32_t id = 0; id < std::uint32_t(DbId::endIndependent); ++id)
      {
         if (id >= numChainDatabases && id < std::uint32_t(DbId::beginIndependent))
            continue;
         std::vector<char> from;
         while (auto row = db.kvGreaterEqualRaw(DbId(id), from, 0))
         {
            rows.emplace_back(std::vector<char>(row->key.begin(), row->key.end()),
                              std::vector<char>(row->value.begin(), row->value.end()));
            from.assign(row->key.begin(), row->key.end());
            from.push_back(0);
         }
      }
      db.abortSubjective();
      return rows;
   };
   const auto before = everything();
   REQUIRE(before.size() >= 3);
   const auto head = node.shared.getHead();

   const auto module = artifact(7, 100000);
   node.cache.store(key(7), module);
   node.cache.store(key(8), artifact(8, 2 << 20));
   REQUIRE(node.cache.load(key(7)) == module);

   CHECK(node.shared.getHead() == head);
   const auto after = everything();
   CHECK(after == before);
   for (const auto& [name, value] : after)
   {
      CHECK(value.size() < 100000);
      CHECK(std::search(value.begin(), value.end(), module.begin(), module.begin() + 64) ==
            value.end());
   }
}
