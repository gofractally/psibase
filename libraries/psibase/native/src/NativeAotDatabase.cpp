// NativeAotDatabase: compiled-module records in a psitri database of their
// own. See NativeAotCache.hpp for what it promises; this file is how.

#include <psibase/NativeAotCache.hpp>

#include <psibase/log.hpp>
#include <psitri/engines/big.hpp>

#include <algorithm>
#include <cstring>
#include <map>
#include <mutex>
#include <string_view>
#include <thread>

namespace psibase
{
   namespace
   {
      using Engine = psitri::big_engine;
      using Key    = NativeArtifactStore::Key;

      // Records are spread over this many roots by the first byte of their
      // key. psitri has one writer per root and writers on different roots
      // do not wait for each other, so two threads storing different modules
      // almost always commit side by side.
      constexpr std::uint32_t shards = 64;

      std::uint32_t shardOf(const Key& key)
      {
         return key[0] % shards;
      }
      std::string_view view(const Key& key)
      {
         return {reinterpret_cast<const char*>(key.data()), key.size()};
      }

      // One thread's sessions on one database.
      struct Sessions
      {
         std::shared_ptr<Engine::write_session> writer;
         std::shared_ptr<Engine::read_session>  reader;
      };
   }  // namespace

   struct NativeAotDatabase::Impl : std::enable_shared_from_this<NativeAotDatabase::Impl>
   {
      // Declared first, destroyed last: every session goes before it.
      std::shared_ptr<Engine::database> database;

      // The sessions of every thread that has used this database. A thread
      // finds its own without this mutex (see `mine`); the mutex is taken
      // when a thread first arrives and when it exits.
      std::mutex                                           sessionsMutex;
      std::map<std::thread::id, std::unique_ptr<Sessions>> sessions;

      // What is stored, for the size bound. `used` orders eviction: a record
      // read or written more recently has a larger one; a record not touched
      // since the database was opened has zero.
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

      explicit Impl(std::uint64_t maxBytes) : maxBytes(maxBytes) {}

      ~Impl()
      {
         // No thread is inside this object any more. psitri allows a session
         // that is not in use to be destroyed by another thread than the one
         // that created it, and requires all of them gone before the database.
         sessions.clear();
      }

      // Each thread's own sessions on the databases it has used. The
      // sessions belong to the database; a thread keeps only the way to
      // them, and gives them up when it exits if the database is still open.
      struct Mine
      {
         struct Slot
         {
            std::weak_ptr<Impl> owner;
            Sessions*           sessions;
         };
         std::vector<Slot> slots;
         ~Mine()
         {
            for (auto& slot : slots)
               if (auto owner = slot.owner.lock())
               {
                  std::lock_guard lock{owner->sessionsMutex};
                  owner->sessions.erase(std::this_thread::get_id());
               }
         }
      };

      // The calling thread's sessions: created on it, used only by it.
      Sessions& mine()
      {
         static thread_local Mine mine;
         std::erase_if(mine.slots, [](const Mine::Slot& slot) { return slot.owner.expired(); });
         for (auto& slot : mine.slots)
            if (slot.owner.lock().get() == this)
               return *slot.sessions;
         auto created    = std::make_unique<Sessions>();
         created->writer = database->start_write_session();
         created->reader = database->start_read_session();
         auto* result    = created.get();
         {
            std::lock_guard lock{sessionsMutex};
            sessions[std::this_thread::get_id()] = std::move(created);
         }
         mine.slots.push_back({weak_from_this(), result});
         return *result;
      }

      void remove(const Key& key)
      {
         auto tx = mine().writer->start_transaction(shardOf(key));
         tx.remove(view(key));
         tx.commit();
      }
   };

   NativeAotDatabase::NativeAotDatabase(const std::filesystem::path& directory,
                                        std::uint64_t                maxBytes) noexcept
   {
      try
      {
         auto state = std::make_shared<Impl>(maxBytes);
         std::filesystem::create_directories(directory.parent_path());
         Engine::config cfg;
         // A record that does not survive a crash is compiled again, and one
         // that survives in part fails its digest: nothing here is worth a
         // flush. This is the engine's cheapest policy.
         cfg.sync_mode                = psitri::sync_mode::none;
         cfg.enable_read_cache        = false;
         cfg.max_pinned_cache_size_mb = 0;
         state->database =
             Engine::database::open(directory, psitri::open_mode::create_or_open, cfg);
         // What is already stored, and how large.
         auto& reader = *state->mine().reader;
         for (std::uint32_t shard = 0; shard < shards; ++shard)
         {
            auto cursor = reader.create_cursor(shard);
            for (bool found = cursor.seek_begin(); found; found = cursor.next())
            {
               auto name = cursor.key();
               auto size = cursor.value_size();
               Key  key;
               if (name.size() != key.size() || size < 0)
                  continue;
               std::memcpy(key.data(), name.data(), key.size());
               state->index[key] = {static_cast<std::uint64_t>(size), 0};
               state->total += static_cast<std::uint64_t>(size);
            }
         }
         impl = std::move(state);
      }
      catch (const std::exception& e)
      {
         PSIBASE_LOG(loggers::generic::get(), warning)
             << "The compiled-module database " << directory.string()
             << " cannot be used: " << e.what()
             << ". It holds nothing that cannot be compiled again: stop the node and delete "
                "the directory to start a new one.";
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
         std::vector<char> record;
         bool              found;
         {
            // A cursor reads the root as committed when it was created,
            // without waiting for a writer of that root or of any other.
            auto cursor = impl->mine().reader->create_cursor(shardOf(key));
            found       = cursor.get(view(key), [&](std::string_view value)
                                     { record.assign(value.begin(), value.end()); });
         }
         if (!found)
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
            impl->remove(old);
         auto tx = impl->mine().writer->start_transaction(shardOf(key));
         tx.upsert(view(key), std::string_view{record.data(), record.size()});
         tx.commit();
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
         impl->remove(key);
      }
      catch (...)
      {
      }
   }
}  // namespace psibase
