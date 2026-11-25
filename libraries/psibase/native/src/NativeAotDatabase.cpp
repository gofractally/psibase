// NativeAotDatabase: compiled-module records under the cache root of the
// node's database. See NativeAotCache.hpp for what it promises; the root
// itself (writers, readers, durability) is storage::cache_root.

#include <psibase/NativeAotCache.hpp>

#include <psibase/log.hpp>

#include <cstring>
#include <map>
#include <mutex>

namespace psibase
{
   namespace
   {
      using Key = NativeArtifactStore::Key;

      std::span<const char> view(const Key& key)
      {
         return {reinterpret_cast<const char*>(key.data()), key.size()};
      }
   }  // namespace

   struct NativeAotDatabase::Impl
   {
      storage::cache_root root;

      // What is stored, for the size bound. `used` orders eviction: a record
      // read or written more recently has a larger one; a record not touched
      // since the store was made has zero.
      struct Entry
      {
         std::uint64_t size = 0;
         std::uint64_t used = 0;
      };
      std::mutex           indexMutex;
      std::map<Key, Entry> index;
      std::uint64_t        total = 0;
      std::uint64_t        clock = 0;
      std::uint64_t        maxBytes;

      Impl(storage::cache_root root, std::uint64_t maxBytes)
          : root(std::move(root)), maxBytes(maxBytes)
      {
      }
   };

   NativeAotDatabase::NativeAotDatabase(storage::cache_root root, std::uint64_t maxBytes) noexcept
   {
      try
      {
         auto state = std::make_unique<Impl>(std::move(root), maxBytes);
         if (!state->root.writable())
            return;
         // What is already stored, and how large.
         for (const auto& [name, size] : state->root.sizes())
         {
            Key key;
            if (name.size() != key.size())
               continue;
            std::memcpy(key.data(), name.data(), key.size());
            state->index[key] = {size, 0};
            state->total += size;
         }
         impl = std::move(state);
      }
      catch (const std::exception& e)
      {
         PSIBASE_LOG(loggers::generic::get(), warning)
             << "The compiled-module cache in the node's database cannot be used: " << e.what();
      }
      catch (...)
      {
      }
   }

   NativeAotDatabase::~NativeAotDatabase() = default;

   bool NativeAotDatabase::usable() const noexcept
   {
      return impl != nullptr;
   }

   std::uint64_t NativeAotDatabase::bytes() const noexcept
   {
      if (!impl)
         return 0;
      std::lock_guard lock{impl->indexMutex};
      return impl->total;
   }

   std::size_t NativeAotDatabase::entries() const noexcept
   {
      if (!impl)
         return 0;
      std::lock_guard lock{impl->indexMutex};
      return impl->index.size();
   }

   std::optional<std::vector<char>> NativeAotDatabase::read(const Key& key) noexcept
   {
      try
      {
         if (!impl)
            return std::nullopt;
         auto record = impl->root.get(view(key));
         if (!record)
            return std::nullopt;
         // Keeping the order of use must never hold up a reader.
         if (std::unique_lock lock{impl->indexMutex, std::try_to_lock})
            if (auto entry = impl->index.find(key); entry != impl->index.end())
               entry->second.used = ++impl->clock;
         return record;
      }
      catch (...)
      {
         return std::nullopt;
      }
   }

   void NativeAotDatabase::write(const Key& key, std::span<const char> record) noexcept
   {
      try
      {
         if (!impl || record.empty() || record.size() > impl->maxBytes)
            return;
         // Account for the record before it is written and make room for it,
         // so that what is stored never exceeds the bound.
         std::vector<Key> evicted;
         {
            std::lock_guard lock{impl->indexMutex};
            auto&           entry = impl->index[key];
            impl->total += record.size() - entry.size;
            entry = {record.size(), ++impl->clock};
            while (impl->total > impl->maxBytes)
            {
               auto oldest = impl->index.end();
               for (auto it = impl->index.begin(); it != impl->index.end(); ++it)
                  if (it->first != key &&
                      (oldest == impl->index.end() || it->second.used < oldest->second.used))
                     oldest = it;
               if (oldest == impl->index.end())
                  break;
               impl->total -= oldest->second.size;
               evicted.push_back(oldest->first);
               impl->index.erase(oldest);
            }
         }
         for (const auto& old : evicted)
            impl->root.erase(view(old));
         impl->root.put(view(key), record);
      }
      catch (...)
      {
         // The record may not be there; the accounting says it is, which
         // only brings eviction forward.
      }
   }

   void NativeAotDatabase::erase(const Key& key) noexcept
   {
      try
      {
         if (!impl)
            return;
         {
            std::lock_guard lock{impl->indexMutex};
            if (auto entry = impl->index.find(key); entry != impl->index.end())
            {
               impl->total -= entry->second.size;
               impl->index.erase(entry);
            }
         }
         impl->root.erase(view(key));
      }
      catch (...)
      {
      }
   }

   void NativeAotDatabase::clear() noexcept
   {
      try
      {
         if (!impl)
            return;
         {
            std::lock_guard lock{impl->indexMutex};
            impl->index.clear();
            impl->total = 0;
         }
         impl->root.clear();
      }
      catch (...)
      {
      }
   }
}  // namespace psibase
