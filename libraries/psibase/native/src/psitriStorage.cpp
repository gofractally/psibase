#include <psibase/CpuAccounting.hpp>
#include <psibase/storage.hpp>
#include <psitri/engines/big.hpp>
#include <psitri/transactions.hpp>

#include <fcntl.h>
#include <unistd.h>
#include <algorithm>
#include <array>
#include <atomic>
#include <cassert>
#include <cerrno>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <map>
#include <mutex>
#include <stdexcept>
#include <string>
#include <system_error>
#include <thread>
#include <type_traits>
#include <utility>
#include <vector>

namespace psibase::storage
{
   using Engine   = psitri::big_engine;
   using Snapshot = psitri::snapshot_for<Engine>;
   using Cursor   = Engine::cursor;
   static_assert(psitri::engine<Engine>);
   static_assert(psitri::range_engine<Engine>);
   // Public owned/detached subtree extensions required by the adapter. No raw
   // allocator address or engine-private root constructor is used.
   static_assert(requires(Engine::write_session& ws, Snapshot tree, std::string_view k) {
      ws.create_temporary_tree();
      ws.start_write_transaction(tree).get_tree();
      ws.start_write_transaction(tree).upsert_subtree(k, tree);
      ws.start_transaction(0).primary().set_root(tree);
   });

   constexpr std::string_view identity    = "psibase.psitri.big.manifest.v1\n";
   constexpr std::string_view identityKey = "\xffpsibase-storage-format";
   constexpr std::string_view formatFile  = "psibase-storage-format";
   // Present from before the engine creates its first file until the identity
   // sidecar is durable. While it exists without a valid sidecar, everything in
   // the directory is this adapter's own unfinished initialization.
   constexpr std::string_view initFile = "psibase-storage-initializing";
   constexpr std::string_view countKey    = "count";
   // Engine root 0 is the flushed manifest (the "top root"). Root 1 is node-local
   // state that is published without flushing.
   constexpr std::uint32_t localRootIndex = 1;
   // Root 2 is rebuildable data (cache_root): nothing under roots 0 and 1
   // refers to it.
   constexpr std::uint32_t cacheRootIndex = 2;

   std::string_view bytes(std::span<const char> data)
   {
      return {data.data(), data.size()};
   }
   std::array<char, 4> indexKey(std::uint32_t index)
   {
      return {char(index >> 24), char(index >> 16), char(index >> 8), char(index)};
   }
   std::string_view bytes(const std::array<char, 4>& key)
   {
      return {key.data(), key.size()};
   }
   std::string prefixEnd(std::string_view prefix)
   {
      std::string result(prefix);
      while (!result.empty() && static_cast<unsigned char>(result.back()) == 255)
         result.pop_back();
      if (!result.empty())
         result.back() = char(static_cast<unsigned char>(result.back()) + 1);
      return result;
   }

   // The engine has one writer. SAL's session contract permits serialized
   // cross-thread use of it, so every MUTATING native operation enters this
   // gate and runs on its caller. Reads and root lifetimes do not: they use
   // per-thread reader sessions and thread-safe shared references (see
   // ReaderPool and root). Application callbacks stay outside this boundary,
   // after the higher-level publication locks.
   class SerializedNativeAccess
   {
      std::recursive_mutex mutex;
#ifndef NDEBUG
      std::thread::id activeThread{};
      unsigned        depth = 0;
#endif
     public:
      template <class F>
      auto invoke(F&& function, bool cleanup = false) -> std::invoke_result_t<F>
      {
         auto context =
             cleanup ? std::shared_ptr<accounting::Context>{} : accounting::currentContext();
         if (context)
            context->check();
         std::unique_lock lock(mutex);
#ifndef NDEBUG
         // Also covers recursive native cleanup; a second OS thread can never
         // be active inside this database's engine/session/handle graph.
         assert(!depth || activeThread == std::this_thread::get_id());
         activeThread = std::this_thread::get_id();
         ++depth;
         struct Exit
         {
            SerializedNativeAccess* access;
            ~Exit()
            {
               assert(access->depth);
               if (!--access->depth)
                  access->activeThread = {};
            }
         } exit{this};
#endif
         // Recheck after a potentially long mutex wait. A cancelled caller
         // never starts mutable native work or a new publication afterward.
         accounting::Scope request(context, accounting::adoptContext);
         if constexpr (std::is_void_v<std::invoke_result_t<F>>)
         {
            std::forward<F>(function)();
            accounting::check();
         }
         else
         {
            decltype(auto) result = std::forward<F>(function)();
            accounting::check();
            return result;
         }
      }
   };

   // Reader sessions, one in use per thread at a time. Reads never enter the
   // writer's gate: each borrows an engine read session, opens its own cursor on
   // the (immutable) shared tree, and returns the session. Borrowing is a single
   // uncontended atomic exchange; the pool bounds how many engine sessions exist.
   class ReaderPool
   {
      static constexpr unsigned size = 32;
      struct Slot
      {
         std::atomic<bool>                     busy{false};
         std::shared_ptr<Engine::read_session> session;
      };
      std::array<Slot, size> slots;

     public:
      template <class F>
      auto use(Engine::database& engine, F&& function)
      {
         const unsigned start =
             static_cast<unsigned>(std::hash<std::thread::id>{}(std::this_thread::get_id()));
         for (;;)
         {
            for (unsigned i = 0; i < size; ++i)
            {
               auto& slot = slots[(start + i) % size];
               if (slot.busy.exchange(true, std::memory_order_acquire))
                  continue;
               struct Return
               {
                  Slot& slot;
                  ~Return() { slot.busy.store(false, std::memory_order_release); }
               } giveBack{slot};
               if (!slot.session)
                  slot.session = engine.start_read_session();
               return std::forward<F>(function)(*slot.session);
            }
            std::this_thread::yield();
         }
      }
      void close()
      {
         for (auto& slot : slots)
            slot.session.reset();
      }
   };

   inline std::atomic<std::uint64_t> nextStateId{1};
   struct State;
   // storage.hpp names the state without defining it.
   struct database_state
   {
   };
   struct State : database_state
   {
      SerializedNativeAccess                 access;  // the single writer; never taken by reads
      std::shared_ptr<Engine::database>      engine;
      std::shared_ptr<Engine::write_session> writer;
      ReaderPool                             readers;
      // One engine reader per thread that has read this database.
      std::mutex                                                           threadReadersMutex;
      std::map<std::thread::id, std::shared_ptr<Engine::read_session>>     threadReaders;
      // The cache root's own writer (see cache_root). Guarded by cacheMutex,
      // never by `access`; made by the first write.
      std::mutex                             cacheMutex;
      std::shared_ptr<Engine::write_session> cacheWriter;
      const std::uint64_t id = nextStateId.fetch_add(1, std::memory_order_relaxed);
      std::filesystem::path                  path;
      bool                                   readonly  = false;
      bool                                   temporary = false;
      ~State()
      {
         access.invoke(
             [&]
             {
                readers.close();
                threadReaders.clear();
                cacheWriter.reset();
                writer.reset();
                engine.reset();
             },
             true);
         if (temporary)
         {
            std::error_code ignored;
            std::filesystem::remove_all(path, ignored);
         }
      }
      void writable() const
      {
         if (readonly)
            throw std::runtime_error("database is read-only");
      }
   };
   // A root is an immutable tree plus a reference that keeps it alive. The
   // reference is thread-safe: copying and dropping need neither a session nor
   // the writer's gate, and the last drop is finished by the engine's release
   // thread. `tree` is declared after `state` so it is dropped while the engine
   // is still open.
   struct root
   {
      std::shared_ptr<State> state;
      Engine::shared_tree    tree;
   };
   shared_root retain(const std::shared_ptr<State>& state, Engine::shared_tree tree)
   {
      if (!tree)
         return {};
      return std::make_shared<const root>(state, std::move(tree));
   }
   // Writer side, inside the gate: continue from a root. The shared reference
   // makes every edit copy-on-write, so concurrent readers never see a change.
   Snapshot native(const std::shared_ptr<State>& state, const shared_root& r)
   {
      state->writable();
      if (!r)
         return state->writer->create_temporary_tree();
      if (r->state != state)
         throw std::runtime_error("foreign storage root");
      return state->writer->adopt(r->tree);
   }
   shared_root publishable(const std::shared_ptr<State>& state, Snapshot tree)
   {
      return retain(state, state->writer->share(std::move(tree)));
   }
   struct database_view
   {
      std::shared_ptr<State> state;
      std::mutex             mutex;
      shared_root            top;
      shared_root            local;
      bool                   publish = true;
   };

   // An engine reader may be used by one thread at a time, so each thread takes
   // one per database the first time it reads and keeps it. Requests come and go
   // (psibase makes a storage session per request); the thread's reader stays.
   // A strand that moves between threads simply uses whichever thread it is on.
   // The shared pool is only the fallback when the engine has no session slot left.
   Engine::read_session* threadReader(State& state)
   {
      struct Cached
      {
         const State*          state;
         std::uint64_t         id;
         Engine::read_session* session;
      };
      thread_local std::vector<Cached> cache;
      for (const auto& entry : cache)
         if (entry.state == &state && entry.id == state.id)
            return entry.session;
      Engine::read_session* session = nullptr;
      {
         std::lock_guard lock(state.threadReadersMutex);
         auto&           slot = state.threadReaders[std::this_thread::get_id()];
         if (!slot)
         {
            try
            {
               slot = state.engine->start_read_session();
            }
            catch (const std::runtime_error&)
            {
               state.threadReaders.erase(std::this_thread::get_id());
               return nullptr;
            }
         }
         session = slot.get();
      }
      // A few entries at most: one per database this thread reads. Entries for
      // closed databases can never match again (ids are never reused).
      if (cache.size() >= 8)
         cache.erase(cache.begin());
      cache.push_back({&state, state.id, session});
      return session;
   }

   // Run a read on the caller's thread through that thread's reader.
   template <class F>
   auto reading(State& state, F&& function)
   {
      accounting::check();
      auto  body  = [&](Engine::read_session& session)
      {
         decltype(auto) result = std::forward<F>(function)(session);
         accounting::check();
         return result;
      };
      if (auto* session = threadReader(state))
         return body(*session);
      return state.readers.use(*state.engine, body);
   }
   template <class F>
   auto reading(const shared_root& source, F&& function)
   {
      return reading(*source->state, std::forward<F>(function));
   }

   void readValue(const shared_root&        source,
                  Cursor&                   cursor,
                  std::vector<char>*        value,
                  std::vector<shared_root>* roots)
   {
      if (value)
         value->clear();
      if (roots)
         roots->clear();
      if (cursor.is_subtree())
      {
         if (!roots)
            return;
         auto       list    = cursor.subtree_cursor();
         const auto encoded = list.get<std::string>(countKey);
         if (!encoded || encoded->size() != 4)
            throw std::runtime_error("invalid root-list header");
         std::uint32_t count = 0;
         for (unsigned i = 0; i < 4; ++i)
            count = (count << 8) | static_cast<unsigned char>((*encoded)[i]);
         if (count > 4096)
            throw std::runtime_error("invalid root-list length");
         roots->resize(count);
         for (std::uint32_t i = 0; i < count; ++i)
         {
            accounting::check();
            const auto key = indexKey(i);
            if (!list.lower_bound(bytes(key)) || list.key() != bytes(key))
               continue;
            if (!list.is_subtree())
               throw std::runtime_error("invalid owned root-list entry");
            (*roots)[i] = retain(source->state, list.subtree_shared());
         }
      }
      else if (value)
      {
         const auto v = cursor.value<std::string>();
         if (!v)
            throw std::runtime_error("invalid byte value");
         value->assign(v->begin(), v->end());
      }
   }

   read_session::read_session(std::shared_ptr<database_view> v) : view(std::move(v)) {}
   read_session::~read_session() = default;
   bool read_session::get(const shared_root&        source,
                          std::span<const char>     key,
                          std::vector<char>*        value,
                          std::vector<shared_root>* roots)
   {
      if (!source)
         return false;
      if (source->state != view->state)
         throw std::runtime_error("foreign storage root");
      return reading(source,
                     [&](Engine::read_session& session)
                     {
                        auto c = session.borrow_cursor(source->tree);
                        if (!c.lower_bound(bytes(key)) || c.key() != bytes(key))
                           return false;
                        readValue(source, c, value, roots);
                        return true;
                     });
   }
   std::optional<std::vector<char>> read_session::get(const shared_root&    source,
                                                      std::span<const char> key)
   {
      std::vector<char> result;
      if (!get(source, key, &result, nullptr))
         return {};
      return result;
   }

   enum class Seek
   {
      lower,
      less,
      max
   };
   bool seek(const shared_root&        source,
             std::span<const char>     key,
             Seek                      kind,
             std::vector<char>*        outKey,
             std::vector<char>*        value,
             std::vector<shared_root>* roots)
   {
      if (!source)
         return false;
      return reading(
          source,
          [&](Engine::read_session& session)
          {
             auto c     = session.borrow_cursor(source->tree);
             bool found = false;
             if (kind == Seek::lower)
                found = c.lower_bound(bytes(key));
             else if (kind == Seek::less)
                found = c.lower_bound(bytes(key)) ? c.prev() : c.seek_last();
             else
             {
                const auto end = prefixEnd(bytes(key));
                found =
                    end.empty() ? c.seek_last() : (c.lower_bound(end) ? c.prev() : c.seek_last());
                found = found && c.key().starts_with(bytes(key));
             }
             if (!found)
                return false;
             // Copy after seeking: old callers commonly alias input key/outKey.
             if (outKey)
                outKey->assign(c.key().begin(), c.key().end());
             readValue(source, c, value, roots);
             return true;
          });
   }
   bool read_session::get_greater_equal(const shared_root&        r,
                                        std::span<const char>     k,
                                        std::vector<char>*        o,
                                        std::vector<char>*        v,
                                        std::vector<shared_root>* s)
   {
      if (r && r->state != view->state)
         throw std::runtime_error("foreign storage root");
      return seek(r, k, Seek::lower, o, v, s);
   }
   bool read_session::get_less_than(const shared_root&        r,
                                    std::span<const char>     k,
                                    std::vector<char>*        o,
                                    std::vector<char>*        v,
                                    std::vector<shared_root>* s)
   {
      if (r && r->state != view->state)
         throw std::runtime_error("foreign storage root");
      return seek(r, k, Seek::less, o, v, s);
   }
   bool read_session::get_max(const shared_root&        r,
                              std::span<const char>     k,
                              std::vector<char>*        o,
                              std::vector<char>*        v,
                              std::vector<shared_root>* s)
   {
      if (r && r->state != view->state)
         throw std::runtime_error("foreign storage root");
      return seek(r, k, Seek::max, o, v, s);
   }
   bool read_session::is_empty(const shared_root&    r,
                               std::span<const char> lower,
                               std::span<const char> upper)
   {
      if (!r)
         return true;
      if (r->state != view->state)
         throw std::runtime_error("foreign storage root");
      return reading(r,
                     [&](Engine::read_session& session)
                     {
                        auto c = session.borrow_cursor(r->tree);
                        return !c.lower_bound(bytes(lower)) ||
                               (!upper.empty() && c.key() >= bytes(upper));
                     });
   }

   bool equalCursors(Cursor a, Cursor b, std::string_view lower, std::string_view upper)
   {
      bool av = a.lower_bound(lower), bv = b.lower_bound(lower);
      while (true)
      {
         accounting::check();
         av = av && (upper.empty() || a.key() < upper);
         bv = bv && (upper.empty() || b.key() < upper);
         if (av != bv)
            return false;
         if (!av)
            return true;
         if (a.key() != b.key() || a.is_subtree() != b.is_subtree())
            return false;
         if (a.is_subtree())
         {
            if (!equalCursors(a.subtree_cursor(), b.subtree_cursor(), {}, {}))
               return false;
         }
         else if (a.value<std::string>() != b.value<std::string>())
            return false;
         av = a.next();
         bv = b.next();
      }
   }
   bool read_session::is_equal_weak(const shared_root&    a,
                                    const shared_root&    b,
                                    std::span<const char> lower,
                                    std::span<const char> upper)
   {
      if (a == b)
         return true;
      if (!a)
         return is_empty(b, lower, upper);
      if (!b)
         return is_empty(a, lower, upper);
      if (a->state != b->state || a->state != view->state)
         throw std::runtime_error("foreign storage roots");
      return reading(a,
                     [&](Engine::read_session& session)
                     {
                        return equalCursors(session.borrow_cursor(a->tree),
                                            session.borrow_cursor(b->tree), bytes(lower),
                                            bytes(upper));
                     });
   }

   // ---- changes kept aside -------------------------------------------------
   struct delta::impl
   {
      psitri::pooled_delta_store store;
   };
   delta::delta()                            = default;
   delta::delta(delta&&) noexcept            = default;
   delta& delta::operator=(delta&&) noexcept = default;
   delta::~delta()                           = default;
   void delta::put(std::span<const char> key, std::span<const char> value)
   {
      if (!self)
         self = std::make_unique<impl>();
      self->store->put(storage::bytes(key), storage::bytes(value));
   }
   void delta::erase(std::span<const char> key)
   {
      if (!self)
         self = std::make_unique<impl>();
      self->store->erase(storage::bytes(key));
   }
   bool delta::empty() const noexcept
   {
      return !self || self->store->empty();
   }
   std::uint64_t delta::bytes() const noexcept
   {
      return self ? self->store->bytes() : 0;
   }
   delta::mark delta::save()
   {
      if (!self)
         return {};
      const auto m = self->store->save();
      return {m.root, m.size};
   }
   void delta::restore(const mark& m)
   {
      if (self)
         self->store->restore({m.root, m.size});
   }
   void delta::clear() noexcept
   {
      if (self)
         self->store->clear();
   }

   namespace
   {
      // Stands in for the tree of a null root: nothing in it.
      struct EmptyCursor
      {
         bool             seek_begin() { return false; }
         bool             lower_bound(std::string_view) { return false; }
         bool             upper_bound(std::string_view) { return false; }
         bool             seek_last() { return false; }
         bool             next() { return false; }
         bool             prev() { return false; }
         bool             is_end() const { return true; }
         bool             is_rend() const { return true; }
         bool             is_subtree() { return false; }
         std::string_view key() const { return {}; }
         template <class T = std::string>
         std::optional<T> value()
         {
            return {};
         }
         template <class F>
         bool get_value(F&&)
         {
            return false;
         }
         template <class F>
         bool get(std::string_view, F&&)
         {
            return false;
         }
         template <class T = std::string>
         std::optional<T> get(std::string_view)
         {
            return {};
         }
      };
      static_assert(adb::mergeable_cursor<EmptyCursor>);

      template <class Base>
      bool seekMerged(psitri::merged_cursor<Base> c,
                      std::span<const char>       key,
                      Seek                        kind,
                      std::vector<char>*          outKey,
                      std::vector<char>*          value)
      {
         bool found = false;
         if (kind == Seek::lower)
            found = c.lower_bound(bytes(key));
         else if (kind == Seek::less)
            found = c.lower_bound(bytes(key)) ? c.prev() : c.seek_last();
         else
         {
            const auto end = prefixEnd(bytes(key));
            found = end.empty() ? c.seek_last() : (c.lower_bound(end) ? c.prev() : c.seek_last());
            found = found && c.key().starts_with(bytes(key));
         }
         if (!found)
            return false;
         if (c.is_subtree())
            throw std::runtime_error("root-list read through pending changes");
         // Copy after seeking: callers commonly alias the input key and outKey.
         if (outKey)
            outKey->assign(c.key().begin(), c.key().end());
         if (value)
         {
            value->clear();
            c.get_value([&](std::string_view v) { value->assign(v.begin(), v.end()); });
         }
         return true;
      }
   }  // namespace

   bool read_session::get(const shared_root&     source,
                          const delta&           changes,
                          std::span<const char>  key,
                          std::vector<char>*     value)
   {
      if (changes.self)
         if (const auto* entry = changes.self->store->find(bytes(key)))
         {
            // Answered without touching the store; still a storage call the
            // caller's budget has to be able to stop.
            accounting::check();
            if (entry->removed)
               return false;
            if (value)
            {
               const auto v = entry->value();
               value->assign(v.begin(), v.end());
            }
            return true;
         }
      return get(source, key, value, nullptr);
   }
   static bool seek(database_view&         view,
                    const shared_root&     source,
                    const delta&           changes,
                    psitri::delta_store*   store,
                    std::span<const char>  key,
                    Seek                   kind,
                    std::vector<char>*     outKey,
                    std::vector<char>*     value)
   {
      if (source && source->state != view.state)
         throw std::runtime_error("foreign storage root");
      if (!store || store->empty())
         return seek(source, key, kind, outKey, value, nullptr);
      if (!source)
      {
         accounting::check();
         return seekMerged(psitri::merged_cursor<EmptyCursor>(store->freeze(), EmptyCursor{}), key,
                           kind, outKey, value);
      }
      return reading(source,
                     [&](Engine::read_session& session)
                     {
                        return seekMerged(
                            psitri::merged_cursor<Cursor>(store->freeze(),
                                                          session.borrow_cursor(source->tree)),
                            key, kind, outKey, value);
                     });
   }
   bool read_session::get_greater_equal(const shared_root&    r,
                                        const delta&          d,
                                        std::span<const char> k,
                                        std::vector<char>*    o,
                                        std::vector<char>*    v)
   {
      return seek(*view, r, d, d.self ? &*d.self->store : nullptr, k, Seek::lower, o, v);
   }
   bool read_session::get_less_than(const shared_root&    r,
                                    const delta&          d,
                                    std::span<const char> k,
                                    std::vector<char>*    o,
                                    std::vector<char>*    v)
   {
      return seek(*view, r, d, d.self ? &*d.self->store : nullptr, k, Seek::less, o, v);
   }
   bool read_session::get_max(const shared_root&    r,
                              const delta&          d,
                              std::span<const char> k,
                              std::vector<char>*    o,
                              std::vector<char>*    v)
   {
      return seek(*view, r, d, d.self ? &*d.self->store : nullptr, k, Seek::max, o, v);
   }

   write_session::write_session(std::shared_ptr<database_view> v) : read_session(std::move(v)) {}
   void write_session::require_writable() const
   {
      view->state->writable();
   }
   void write_session::apply(shared_root& source, delta& changes, const delta::mark* at)
   {
      if (!changes.self)
         return;
      auto& store   = *changes.self->store;
      auto  pending = at ? store.at({at->root, at->size}) : store.freeze();
      if (pending.begin() == pending.end())
         return;
      auto state = view->state;
      state->writable();
      if (source && source->state != state)
         throw std::runtime_error("foreign storage root");
      // One edit for all of it: each node on the way to a changed key is
      // copied once, however many of the keys below it changed, and the
      // writer's gate is entered once.
      source = state->access.invoke(
          [&]
          {
             auto edit = state->writer->start_write_transaction(native(state, source));
             for (auto it = pending.begin(), end = pending.end(); it != end; ++it)
             {
                accounting::check();
                if (it.value().removed)
                   edit.remove(it.key());
                else
                   edit.upsert(it.key(), it.value().value());
             }
             return publishable(state, edit.get_tree());
          });
   }
   shared_root write_session::get_top_root()
   {
      std::lock_guard lock(view->mutex);
      return view->top;
   }
   void write_session::set_top_root(shared_root source)
   {
      auto state = view->state;
      state->writable();
      // Keep publication and the logical view's cached manifest in the same
      // order even when independent callers publish through one physical DB.
      std::lock_guard viewLock(view->mutex);
      auto            updated = state->access.invoke(
          [&]
          {
             auto edit = state->writer->start_write_transaction(native(state, source));
             edit.upsert(identityKey, identity);
             return publishable(state, edit.get_tree());
          });
      accounting::Publication publication;
      if (view->publish)
         state->access.invoke(
             [&]
             {
                // SAL retries interrupted flushes; the publication gate still requires
                // accepted root/effect work to finish before cancellation is reported.
                auto                              tx = state->writer->start_transaction(0);
                tx.primary().set_root(native(state, updated));
                tx.commit();
             });
      view->top = std::move(updated);
      publication.finish();
   }
   shared_root write_session::get_local_root()
   {
      std::lock_guard lock(view->mutex);
      return view->local;
   }
   void write_session::set_local_root(shared_root source)
   {
      auto state = view->state;
      state->writable();
      std::lock_guard         viewLock(view->mutex);
      accounting::Publication publication;
      if (view->publish)
         state->access.invoke(
             [&]
             {
                // Published, never flushed: it becomes durable with the next
                // flushed publication of the top root.
                state->writer->set_root(localRootIndex, native(state, source));
             });
      else if (source && source->state != state)
         throw std::runtime_error("foreign storage root");
      view->local = std::move(source);
      publication.finish();
   }
   void write_session::upsert(shared_root&          source,
                              std::span<const char> key,
                              std::span<const char> value)
   {
      auto state = view->state;
      state->writable();
      source = state->access.invoke(
          [&]
          {
             auto edit = state->writer->start_write_transaction(native(state, source));
             edit.upsert(bytes(key), bytes(value));
             return publishable(state, edit.get_tree());
          });
   }
   void write_session::upsert(shared_root&                 source,
                              std::span<const char>        key,
                              std::span<const shared_root> roots)
   {
      if (roots.size() > 4096)
         throw std::runtime_error("root-list too large");
      auto state = view->state;
      state->writable();
      source = state->access.invoke(
          [&]
          {
             auto list =
                 state->writer->start_write_transaction(state->writer->create_temporary_tree());
             list.upsert(countKey, bytes(indexKey(roots.size())));
             for (std::uint32_t i = 0; i < roots.size(); ++i)
             {
                accounting::check();
                if (roots[i])
                   list.upsert_subtree(bytes(indexKey(i)), native(state, roots[i]));
             }
             auto edit = state->writer->start_write_transaction(native(state, source));
             edit.upsert_subtree(bytes(key), list.get_tree());
             return publishable(state, edit.get_tree());
          });
   }
   void write_session::remove(shared_root& source, std::span<const char> key)
   {
      auto state = view->state;
      state->writable();
      if (!source)
         return;
      source = state->access.invoke(
          [&]
          {
             auto edit = state->writer->start_write_transaction(native(state, source));
             edit.remove(bytes(key));
             return publishable(state, edit.get_tree());
          });
   }
   void write_session::splice(shared_root&          destination,
                              const shared_root&    source,
                              std::span<const char> lower,
                              std::span<const char> upper)
   {
      auto state = view->state;
      state->writable();
      if ((destination && destination->state != state) || (source && source->state != state))
         throw std::runtime_error("foreign storage root");
      // Both roots are immutable snapshots, so what differs between them in
      // the range can be found by this thread's reader, without the writer
      // gate. Only the differing keys are then applied under it. Replacing
      // the range wholesale, every key removed and every key written again
      // under the gate, made each subjective commit hold the engine's one
      // writer for as long as its ranges were large, and every other writer,
      // the block producer included, waited behind it.
      struct Change
      {
         std::string                key;
         std::optional<std::string> value;  // absent and not a subtree: remove
         bool                       subtree = false;
      };
      std::vector<Change> changes;
      if (const shared_root& either = destination ? destination : source)
      {
         reading(either,
                 [&](Engine::read_session& session)
                 {
                    std::optional<Cursor> before, after;
                    bool                  hasBefore = false, hasAfter = false;
                    if (destination)
                    {
                       before.emplace(session.borrow_cursor(destination->tree));
                       hasBefore = before->lower_bound(bytes(lower));
                    }
                    if (source)
                    {
                       after.emplace(session.borrow_cursor(source->tree));
                       hasAfter = after->lower_bound(bytes(lower));
                    }
                    auto inRange = [&](Cursor& c)
                    { return upper.empty() || c.key() < bytes(upper); };
                    auto take = [&](Cursor& c)
                    {
                       if (c.is_subtree())
                          changes.push_back({std::string(c.key()), {}, true});
                       else
                          changes.push_back({std::string(c.key()), *c.value<std::string>()});
                    };
                    while (true)
                    {
                       accounting::check();
                       hasBefore = hasBefore && inRange(*before);
                       hasAfter  = hasAfter && inRange(*after);
                       if (!hasBefore && !hasAfter)
                          break;
                       if (hasBefore && (!hasAfter || before->key() < after->key()))
                       {
                          changes.push_back({std::string(before->key()), {}, false});
                          hasBefore = before->next();
                       }
                       else if (hasAfter && (!hasBefore || after->key() < before->key()))
                       {
                          take(*after);
                          hasAfter = after->next();
                       }
                       else
                       {
                          bool same = before->is_subtree() == after->is_subtree();
                          if (same && after->is_subtree())
                             same = equalCursors(before->subtree_cursor(), after->subtree_cursor(),
                                                 {}, {});
                          else if (same)
                             same = before->value<std::string>() == after->value<std::string>();
                          if (!same)
                             take(*after);
                          hasBefore = before->next();
                          hasAfter  = after->next();
                       }
                    }
                    return 0;
                 });
      }
      if (changes.empty())
         return;
      destination = state->access.invoke(
          [&]
          {
             auto edit = state->writer->start_write_transaction(native(state, destination));
             for (const auto& change : changes)
             {
                accounting::check();
                if (change.subtree)
                   edit.upsert_subtree(change.key, native(state, source).get_subtree(change.key));
                else if (change.value)
                   edit.upsert(change.key, *change.value);
                else
                   edit.remove(change.key);
             }
             return publishable(state, edit.get_tree());
          });
   }

   std::string readIdentityFile(const std::filesystem::path& path)
   {
      std::ifstream file(path / formatFile, std::ios::binary);
      if (!file)
         throw std::runtime_error("psitri database identity missing");
      return {std::istreambuf_iterator<char>(file), {}};
   }
   void writeIdentityFile(const std::filesystem::path& path)
   {
      const auto filename = path / formatFile;
      int        fd       = ::open(filename.c_str(), O_WRONLY | O_CREAT | O_EXCL, 0644);
      if (fd < 0)
         throw std::runtime_error("cannot create database identity");
      std::size_t offset = 0;
      while (offset < identity.size())
      {
         const auto written = ::write(fd, identity.data() + offset, identity.size() - offset);
         if (written < 0 && errno == EINTR)
            continue;
         if (written <= 0)
            break;
         offset += written;
      }
      auto sync = [](int descriptor)
      {
         int result;
         do
         {
            result = ::fsync(descriptor);
         } while (result < 0 && errno == EINTR);
         return result;
      };
      const bool failed = offset != identity.size() || sync(fd) != 0;
      ::close(fd);
      if (failed)
         throw std::runtime_error("cannot persist database identity");
      fd = ::open(path.c_str(), O_RDONLY | O_DIRECTORY);
      if (fd < 0)
         throw std::runtime_error("cannot open database directory");
      const int result = sync(fd);
      ::close(fd);
      if (result)
         throw std::runtime_error("cannot persist database directory");
   }
   void syncDirectory(const std::filesystem::path& path)
   {
      const int fd = ::open(path.c_str(), O_RDONLY | O_DIRECTORY);
      if (fd < 0)
         throw std::runtime_error("cannot open database directory");
      int result;
      do
      {
         result = ::fsync(fd);
      } while (result < 0 && errno == EINTR);
      ::close(fd);
      if (result)
         throw std::runtime_error("cannot persist database directory");
   }
   void writeInitializingFile(const std::filesystem::path& path)
   {
      const auto filename = path / initFile;
      const int  fd       = ::open(filename.c_str(), O_WRONLY | O_CREAT | O_EXCL, 0644);
      if (fd < 0)
         throw std::runtime_error("cannot begin database initialization");
      int result;
      do
      {
         result = ::fsync(fd);
      } while (result < 0 && errno == EINTR);
      ::close(fd);
      if (result)
         throw std::runtime_error("cannot begin database initialization");
      syncDirectory(path);
   }
   void removeContents(const std::filesystem::path& path)
   {
      std::error_code ignored;
      for (const auto& entry : std::filesystem::directory_iterator(path, ignored))
         std::filesystem::remove_all(entry.path(), ignored);
   }
   database::database(std::shared_ptr<database_view> v) : view(std::move(v)) {}
   database::database(const std::filesystem::path& requested,
                      const database_config&       config,
                      open_mode                    mode)
   {
      // The maintained engine retains these benchmark environment overrides.
      // Reject them before its cached environment is initialized or any store
      // is opened; the node's reported explicit cache policy must be true.
      for (const char* name :
           {"HEART_PAGE_BYTES", "HEART_PINNED_MB", "HEART_READ_CACHE", "HEART_READ_CACHE_SEC"})
         if (std::getenv(name))
            throw std::runtime_error(
                std::string("Unsupported psitri engine environment override ") + name +
                "; psibase uses explicit storage configuration");
      auto state      = std::make_shared<State>();
      state->readonly = mode == open_mode::read_only;
      auto path       = std::filesystem::absolute(mode == open_mode::temporary && requested.empty()
                                                      ? std::filesystem::temp_directory_path()
                                                      : requested)
                            .lexically_normal();
      if (mode == open_mode::temporary)
      {
         std::filesystem::create_directories(path);
         auto pattern = (path / "psibase-temporary-XXXXXX").string();
         if (!::mkdtemp(pattern.data()))
            throw std::system_error(errno, std::generic_category(),
                                    "create temporary psibase database directory");
         // mkdtemp owns a new, empty, private directory. Install cleanup before
         // opening the engine; never adopt or remove a pre-existing store.
         try
         {
            state->path = pattern;
         }
         catch (...)
         {
            ::rmdir(pattern.c_str());
            throw;
         }
         state->temporary = true;
         path             = state->path;
      }
      bool directoryExists = std::filesystem::exists(path);
      if (std::filesystem::exists(path / initFile))
      {
         const bool complete = std::filesystem::exists(path / formatFile) &&
                               readIdentityFile(path) == identity;
         if (complete)
         {
            // Only removing the marker was left to do.
            if (!state->readonly)
               std::filesystem::remove(path / initFile);
         }
         else if (mode == open_mode::read_only || mode == open_mode::read_write)
            throw std::runtime_error(
                "database does not exist: its initialization was interrupted");
         else
            // An earlier initialization of this directory stopped before the
            // identity was durable. Nothing was ever published from it.
            removeContents(path);
      }
      const bool nonempty = directoryExists && !std::filesystem::is_empty(path);
      const bool existing = std::filesystem::exists(path / formatFile);
      if (existing && readIdentityFile(path) != identity)
         throw std::runtime_error("unsupported psibase storage format");
      if (nonempty && !existing)
         throw std::runtime_error("unidentified database directory; use a fresh psitri database");
      if ((mode == open_mode::read_only || mode == open_mode::read_write) && !existing)
         throw std::runtime_error("database does not exist");
      if (mode == open_mode::create_new && nonempty)
         throw std::runtime_error("database already exists");
      if (mode == open_mode::trunc && existing)
         std::filesystem::remove_all(path);
      const bool fresh = !existing || mode == open_mode::trunc;
      // A store whose last writer never closed it (killed, crashed, fail-stopped) is
      // recovered by the engine on the next read-write open. Recovery writes, so a
      // read-only open cannot do it and must not read through what was left behind.
      const bool unclean = !fresh && !Engine::database::closed_cleanly(path);
      if (unclean && state->readonly)
         throw std::runtime_error(
             "database was not shut down cleanly; open it read-write once to recover it");
      state->path = path;
      view        = std::make_shared<database_view>();
      view->state = state;
      const bool createdDirectory = fresh && !std::filesystem::exists(path);
      try
      {
         if (fresh && !state->temporary)
         {
            std::filesystem::create_directories(path);
            writeInitializingFile(path);
         }
         state->access.invoke(
             [&]
             {
                Engine::config cfg;
                // A temporary store is deleted when it closes; nothing in it can
                // outlive the process, so it never pays for a flush.
                cfg.sync_mode = state->temporary || config.sync == durability::none
                                    ? psitri::sync_mode::none
                                    : config.sync == durability::full ? psitri::sync_mode::full
                                                                      : psitri::sync_mode::fsync;
                // A flushed commit is only as good as the proof that all of it
                // reached the disk: checksum what each durable commit covers so a
                // power-loss rebuild can tell a complete flush from a partial one.
                cfg.checksum_on_commit = cfg.sync_mode != psitri::sync_mode::none;
                cfg.enable_read_cache        = false;
                cfg.max_pinned_cache_size_mb = 0;
                if (!fresh && !unclean)
                {
                   // Validate the native manifest in genuine read-only mode before
                   // acquiring a writable engine/session. Never repair another store.
                   auto check  = Engine::database::open(path, psitri::open_mode::read_only, cfg);
                   auto reader = check->start_read_session();
                   if (reader->create_cursor(0).get<std::string>(identityKey) != identity)
                      throw std::runtime_error("psibase manifest identity mismatch");
                }
                state->engine = Engine::database::open(
                    path,
                    state->readonly ? psitri::open_mode::read_only
                                    : (fresh ? psitri::open_mode::create_only
                                             : psitri::open_mode::open_existing),
                    cfg);
                if (state->readonly)
                {
                   auto reader = state->engine->start_read_session();
                   view->top   = retain(state, reader->get_root(0));
                   view->local = retain(state, reader->get_root(localRootIndex));
                }
                else
                {
                   state->writer = state->engine->start_write_session();
                   if (fresh)
                   {
                      auto tx = state->writer->start_transaction(0);
                      tx.upsert(identityKey, identity);
                      tx.commit();
                   }
                   view->top   = publishable(state, state->writer->get_root(0));
                   view->local = publishable(state, state->writer->get_root(localRootIndex));
                   // The sidecar identified this store as ours; after recovery the
                   // manifest must still agree before anything is published to it.
                   if (unclean &&
                       state->writer->get_root(0).get<std::string>(identityKey) != identity)
                      throw std::runtime_error("psibase manifest identity mismatch");
                }
             });
         if (fresh)
         {
            writeIdentityFile(path);
            if (!state->temporary)
               std::filesystem::remove(path / initFile);
         }
      }
      catch (...)
      {
         if (fresh && !state->temporary)
         {
            // Close the engine, then take back everything this constructor created,
            // so the same path can be initialized again. An existing store is never
            // touched: `fresh` means the directory was absent or empty.
            const auto owner = std::move(state);
            view.reset();
            owner->access.invoke(
                [&]
                {
                   owner->readers.close();
                   owner->threadReaders.clear();
                   owner->writer.reset();
                   owner->engine.reset();
                },
                true);
            removeContents(path);
            if (createdDirectory)
            {
               std::error_code ignored;
               std::filesystem::remove(path, ignored);
            }
         }
         throw;
      }
   }
   std::shared_ptr<database> database::clone() const
   {
      auto result     = std::make_shared<database_view>();
      result->state   = view->state;
      result->publish = false;
      {
         std::lock_guard lock(view->mutex);
         result->top   = view->top;
         result->local = view->local;
      }
      return std::shared_ptr<database>(new database(std::move(result)));
   }
   cache_root database::get_cache_root() const
   {
      return cache_root(view->state);
   }

   namespace
   {
      State& cacheState(const std::shared_ptr<database_state>& state)
      {
         return static_cast<State&>(*state);
      }
      // A read of the cache root on the caller's thread. Unlike `reading`, it
      // is not charged to, or cancelled with, the request that happens to
      // need a module: the module is the node's, not the request's.
      template <class F>
      auto readingCache(State& state, F&& function)
      {
         if (auto* session = threadReader(state))
            return function(*session);
         return state.readers.use(*state.engine, function);
      }
      // One change to the cache root: continue from what is published, edit
      // copy-on-write, publish without a flush. Readers see the root before
      // or after, never between.
      template <class F>
      void editCache(State& state, F&& change)
      {
         if (state.readonly)
            return;
         std::lock_guard lock(state.cacheMutex);
         if (!state.cacheWriter)
            state.cacheWriter = state.engine->start_write_session();
         auto& writer = *state.cacheWriter;
         writer.set_root(cacheRootIndex, change(writer));
      }
   }  // namespace

   cache_root::cache_root(std::shared_ptr<database_state> state) : state(std::move(state)) {}

   bool cache_root::writable() const noexcept
   {
      return !cacheState(state).readonly;
   }

   std::optional<std::vector<char>> cache_root::get(std::span<const char> key)
   {
      std::optional<std::vector<char>> result;
      readingCache(cacheState(state),
                   [&](Engine::read_session& session)
                   {
                      auto cursor = session.create_cursor(cacheRootIndex);
                      cursor.get(bytes(key), [&](std::string_view value)
                                 { result.emplace(value.begin(), value.end()); });
                      return 0;
                   });
      return result;
   }

   void cache_root::put(std::span<const char> key, std::span<const char> value)
   {
      editCache(cacheState(state),
                [&](Engine::write_session& writer)
                {
                   auto edit = writer.start_write_transaction(writer.get_root(cacheRootIndex));
                   edit.upsert(bytes(key), bytes(value));
                   return edit.get_tree();
                });
   }

   void cache_root::erase(std::span<const char> key)
   {
      editCache(cacheState(state),
                [&](Engine::write_session& writer)
                {
                   auto edit = writer.start_write_transaction(writer.get_root(cacheRootIndex));
                   edit.remove(bytes(key));
                   return edit.get_tree();
                });
   }

   void cache_root::clear()
   {
      editCache(cacheState(state),
                [&](Engine::write_session& writer) { return writer.create_temporary_tree(); });
   }

   std::vector<std::pair<std::vector<char>, std::uint64_t>> cache_root::sizes()
   {
      std::vector<std::pair<std::vector<char>, std::uint64_t>> result;
      readingCache(cacheState(state),
                   [&](Engine::read_session& session)
                   {
                      auto cursor = session.create_cursor(cacheRootIndex);
                      for (bool found = cursor.seek_begin(); found; found = cursor.next())
                      {
                         auto key  = cursor.key();
                         auto size = cursor.value_size();
                         if (size >= 0)
                            result.emplace_back(std::vector<char>(key.begin(), key.end()),
                                                static_cast<std::uint64_t>(size));
                      }
                      return 0;
                   });
      return result;
   }

   std::shared_ptr<write_session> database::start_write_session()
   {
      // A compatibility proxy is also used for reads by existing psibase
      // callers. Read-only State has no native Engine::write_session; every
      // mutating proxy method rejects the operation before touching storage.
      return std::shared_ptr<write_session>(new write_session(view));
   }
   std::shared_ptr<read_session> database::start_read_session()
   {
      return std::shared_ptr<read_session>(new read_session(view));
   }
   std::optional<bool> database::is_slow() const
   {
      return std::nullopt;
   }
   std::filesystem::path database::directory() const
   {
      return view->state->path;
   }
   bool database::read_only() const
   {
      return view->state->readonly;
   }
   bool database::owns(const write_session& writer) const
   {
      return writer.view == view;
   }
}  // namespace psibase::storage
