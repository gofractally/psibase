#include <catch2/catch_all.hpp>
#include <psibase/NativeAotCache.hpp>

#include <atomic>
#include <cstring>
#include <thread>
#include "TempDirectory.hpp"

namespace
{
   using Key = psibase::NativeAotCache::Key;

   Key key(std::uint32_t value)
   {
      Key result{};
      // The first byte selects the root a record is stored under.
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

   std::unique_ptr<psibase::NativeAotCache> open(
       const std::filesystem::path& directory,
       std::uint64_t                maxBytes = psibase::NativeAotDatabase::defaultMaxBytes)
   {
      return std::make_unique<psibase::NativeAotCache>(
          std::make_unique<psibase::NativeAotDatabase>(directory, maxBytes));
   }
}  // namespace

TEST_CASE("The compiled-module database keeps what it is given across a restart")
{
   TempDirectory root;
   const auto    directory = root.path / "cache" / "modules";
   {
      auto cache = open(directory);
      REQUIRE(cache->usable());
      CHECK_FALSE(cache->load(key(1)).has_value());
      cache->store(key(1), artifact(1, 1000));
      cache->store(key(2), artifact(2, 3 << 20));
      cache->store(key(1), artifact(3, 70000));  // replaced
      cache->store(key(4), {});                  // nothing to keep
      CHECK(cache->load(key(1)) == artifact(3, 70000));
      CHECK(cache->load(key(2)) == artifact(2, 3 << 20));
      CHECK_FALSE(cache->load(key(4)).has_value());
      cache->remove(key(2));
      CHECK_FALSE(cache->load(key(2)).has_value());
      cache->store(key(5), artifact(5, 12345));
   }
   {
      // The same process opens it again: every session of the first open is gone.
      auto cache = open(directory);
      REQUIRE(cache->usable());
      CHECK(cache->load(key(1)) == artifact(3, 70000));
      CHECK(cache->load(key(5)) == artifact(5, 12345));
      CHECK_FALSE(cache->load(key(2)).has_value());
      CHECK(cache->discarded() == 0);
   }
   // Deleting the database costs its contents and nothing else.
   std::filesystem::remove_all(directory);
   {
      auto cache = open(directory);
      REQUIRE(cache->usable());
      CHECK_FALSE(cache->load(key(1)).has_value());
      cache->store(key(1), artifact(1, 1000));
      CHECK(cache->load(key(1)) == artifact(1, 1000));
   }
}

TEST_CASE("The compiled-module database holds an artifact larger than one storage chunk")
{
   // psitri stores a large value as chunks of just under 32 MiB.
   TempDirectory root;
   const auto    large = artifact(9, (40u << 20) + 17);
   {
      auto cache = open(root.path / "modules");
      cache->store(key(9), large);
      CHECK(cache->load(key(9)) == large);
   }
   auto cache = open(root.path / "modules");
   CHECK(cache->load(key(9)) == large);
}

TEST_CASE("The compiled-module database returns only records it can verify")
{
   TempDirectory           root;
   const auto              directory = root.path / "modules";
   auto                    store     = std::make_unique<psibase::NativeAotDatabase>(directory);
   auto*                   raw       = store.get();
   psibase::NativeAotCache cache{std::move(store)};
   REQUIRE(cache.usable());

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
   const auto              directory = root.path / "modules";
   constexpr std::uint32_t threads = 12, own = 40, shared = 16;
   {
      auto                       cache = open(directory);
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
                   cache->store(key(mine), artifact(mine, 2000 + 997 * i));
                   // ...and one every thread compiles, to the same artifact.
                   const auto common = i % shared;
                   cache->store(key(common), artifact(common, 300000));
                   if (auto loaded = cache->load(key(mine)))
                      wrong += *loaded != artifact(mine, 2000 + 997 * i);
                   else
                      ++missing;
                   if (auto loaded = cache->load(key(common)))
                      wrong += *loaded != artifact(common, 300000);
                   else
                      ++missing;
                   // What another thread stored, if it has yet.
                   const auto other = 1000 * ((t + 1) % threads + 1) + i;
                   if (auto loaded = cache->load(key(other)))
                      wrong += *loaded != artifact(other, 2000 + 997 * i);
                }
             });
      go = true;
      for (auto& worker : workers)
         worker.join();
      CHECK(wrong == 0);
      CHECK(missing == 0);
      CHECK(cache->discarded() == 0);
   }
   // Everything every thread stored is there for the next run.
   auto          cache = open(directory);
   std::uint32_t found = 0;
   for (std::uint32_t t = 0; t < threads; ++t)
      for (std::uint32_t i = 0; i < own; ++i)
         found +=
             cache->load(key(1000 * (t + 1) + i)) == artifact(1000 * (t + 1) + i, 2000 + 997 * i);
   CHECK(found == threads * own);
   for (std::uint32_t i = 0; i < shared; ++i)
      CHECK(cache->load(key(i)) == artifact(i, 300000));
}

TEST_CASE("The compiled-module database stays within its size and evicts the least recently used")
{
   TempDirectory           root;
   const auto              directory = root.path / "modules";
   constexpr std::uint64_t limit     = 1 << 20;
   constexpr std::size_t   size      = 200000;
   {
      auto  store = std::make_unique<psibase::NativeAotDatabase>(directory, limit);
      auto* raw   = store.get();
      psibase::NativeAotCache cache{std::move(store)};
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
      // Larger than the whole database: not kept, and nothing is evicted for it.
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
   auto                    store = std::make_unique<psibase::NativeAotDatabase>(directory, limit);
   auto*                   raw   = store.get();
   psibase::NativeAotCache cache{std::move(store)};
   CHECK(raw->bytes() <= limit);
   CHECK(raw->entries() >= 4);
   cache.store(key(100), artifact(100, size));
   cache.store(key(101), artifact(101, size));
   CHECK(raw->bytes() <= limit);
   CHECK(cache.load(key(100)).has_value());
   CHECK(cache.load(key(101)).has_value());
}

TEST_CASE("A thread that used the compiled-module database may exit before or after it closes")
{
   TempDirectory root;
   const auto    directory = root.path / "modules";
   auto          cache     = open(directory);
   // Before: its sessions are released when it exits.
   std::thread([&] { cache->store(key(1), artifact(1, 4096)); }).join();
   CHECK(cache->load(key(1)) == artifact(1, 4096));
   // After: the database closes with a thread that used it still running,
   // and is opened again while it runs.
   std::atomic<int> stage{0};
   std::thread      late(
       [&]
       {
          cache->store(key(2), artifact(2, 4096));
          stage = 1;
          while (stage != 2)
             std::this_thread::yield();
          cache->store(key(3), artifact(3, 4096));
          stage = 3;
       });
   while (stage != 1)
      std::this_thread::yield();
   cache.reset();
   cache = open(directory);
   REQUIRE(cache->usable());
   stage = 2;
   while (stage != 3)
      std::this_thread::yield();
   late.join();
   CHECK(cache->load(key(2)) == artifact(2, 4096));
   CHECK(cache->load(key(3)) == artifact(3, 4096));
}
