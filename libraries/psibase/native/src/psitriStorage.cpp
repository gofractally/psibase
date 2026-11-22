#include <psibase/CpuAccounting.hpp>
#include <psibase/storage.hpp>
#include <psitri/engines/big.hpp>

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
#include <mutex>
#include <stdexcept>
#include <string>
#include <system_error>
#include <thread>
#include <type_traits>
#include <utility>

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

   struct State
   {
      SerializedNativeAccess                 access;  // the single writer; never taken by reads
      std::shared_ptr<Engine::database>      engine;
      std::shared_ptr<Engine::write_session> writer;
      ReaderPool                             readers;
      std::filesystem::path                  path;
      bool                                   readonly  = false;
      bool                                   temporary = false;
      ~State()
      {
         access.invoke(
             [&]
             {
                readers.close();
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

   // A storage session's own engine reader. The session's holder (one thread or
   // strand at a time) reads through it directly. `busy` only detects misuse: if
   // two threads ever read through one session object at once, the second falls
   // back to the shared pool instead of sharing an engine session.
   struct session_reader
   {
      std::shared_ptr<State>                state;  // keeps the engine open
      std::atomic<bool>                     busy{false};
      bool                                  unavailable = false;
      std::shared_ptr<Engine::read_session> session;
      ~session_reader()
      {
         if (session)
            state->access.invoke([&] { session.reset(); }, true);
      }
   };

   // Run a read on the caller's thread through the session's own reader.
   struct session_reading
   {
      template <class F>
      static auto run(read_session& owner, const shared_root& source, F&& function)
      {
         accounting::check();
         auto& state = *source->state;
         auto  body  = [&](Engine::read_session& session)
         {
            decltype(auto) result = std::forward<F>(function)(session);
            accounting::check();
            return result;
         };
         if (!owner.reader)
         {
            owner.reader        = std::make_shared<session_reader>();
            owner.reader->state = source->state;
         }
         auto& own = *owner.reader;
         if (!own.busy.exchange(true, std::memory_order_acquire))
         {
            struct Release
            {
               std::atomic<bool>& busy;
               ~Release() { busy.store(false, std::memory_order_release); }
            } release{own.busy};
            if (!own.session && !own.unavailable)
            {
               try
               {
                  own.session = state.engine->start_read_session();
               }
               catch (const std::runtime_error&)
               {
                  // The engine is out of session slots; share the pool instead.
                  own.unavailable = true;
               }
            }
            if (own.session)
               return body(*own.session);
         }
         return state.readers.use(*state.engine, body);
      }
   };
   template <class F>
   auto reading(read_session& owner, const shared_root& source, F&& function)
   {
      return session_reading::run(owner, source, std::forward<F>(function));
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
      return reading(*this, source,
                     [&](Engine::read_session& session)
                     {
                        auto c = session.create_cursor(source->tree);
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
   bool seek(read_session&             owner,
             const shared_root&        source,
             std::span<const char>     key,
             Seek                      kind,
             std::vector<char>*        outKey,
             std::vector<char>*        value,
             std::vector<shared_root>* roots)
   {
      if (!source)
         return false;
      return reading(
          owner, source,
          [&](Engine::read_session& session)
          {
             auto c     = session.create_cursor(source->tree);
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
      return seek(*this, r, k, Seek::lower, o, v, s);
   }
   bool read_session::get_less_than(const shared_root&        r,
                                    std::span<const char>     k,
                                    std::vector<char>*        o,
                                    std::vector<char>*        v,
                                    std::vector<shared_root>* s)
   {
      if (r && r->state != view->state)
         throw std::runtime_error("foreign storage root");
      return seek(*this, r, k, Seek::less, o, v, s);
   }
   bool read_session::get_max(const shared_root&        r,
                              std::span<const char>     k,
                              std::vector<char>*        o,
                              std::vector<char>*        v,
                              std::vector<shared_root>* s)
   {
      if (r && r->state != view->state)
         throw std::runtime_error("foreign storage root");
      return seek(*this, r, k, Seek::max, o, v, s);
   }
   bool read_session::is_empty(const shared_root&    r,
                               std::span<const char> lower,
                               std::span<const char> upper)
   {
      if (!r)
         return true;
      if (r->state != view->state)
         throw std::runtime_error("foreign storage root");
      return reading(*this, r,
                     [&](Engine::read_session& session)
                     {
                        auto c = session.create_cursor(r->tree);
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
      return reading(*this, a,
                     [&](Engine::read_session& session)
                     {
                        return equalCursors(session.create_cursor(a->tree),
                                            session.create_cursor(b->tree), bytes(lower),
                                            bytes(upper));
                     });
   }

   write_session::write_session(std::shared_ptr<database_view> v) : read_session(std::move(v)) {}
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
                // Defer CPU sampling across accepted atomic publication. SAL retries
                // interrupted flushes; the publication gate still requires accepted
                // root/effect work to finish before cancellation is reported.
                accounting::PublicationSignalMask samplingMask;
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
                accounting::PublicationSignalMask samplingMask;
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
      destination = state->access.invoke(
          [&]
          {
             auto edit = state->writer->start_write_transaction(native(state, destination));
             if (destination)
             {
                const auto before = native(state, destination);
                auto       c      = before.snapshot_cursor();
                for (bool found = c.lower_bound(bytes(lower));
                     found && (upper.empty() || c.key() < bytes(upper)); found = c.next())
                {
                   accounting::check();
                   edit.remove(c.key());
                }
             }
             if (source)
             {
                const auto from = native(state, source);  // validates ownership first
                auto       c    = from.snapshot_cursor();
                for (bool found = c.lower_bound(bytes(lower));
                     found && (upper.empty() || c.key() < bytes(upper)); found = c.next())
                {
                   accounting::check();
                   if (c.is_subtree())
                      edit.upsert_subtree(c.key(), from.get_subtree(c.key()));
                   else
                      edit.upsert(c.key(), *c.value<std::string>());
                }
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
