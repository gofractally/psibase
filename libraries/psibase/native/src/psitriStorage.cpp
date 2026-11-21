#include <psibase/CpuAccounting.hpp>
#include <psibase/storage.hpp>
#include <psitri/engines/big.hpp>

#include <fcntl.h>
#include <unistd.h>
#include <algorithm>
#include <array>
#include <atomic>
#include <cassert>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <mutex>
#include <stdexcept>
#include <string>
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
   constexpr std::string_view countKey    = "count";

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

   // SAL's public session contract permits serialized cross-thread use:
   // psitri e4d23be, sal/allocator.hpp:158-161 and allocator_session.hpp:431-438.
   // Every native operation AND retained-handle destruction enters this same
   // gate. Work stays on its existing caller; waiting consumes no thread CPU.
   // Recursion is only for native owned-handle cleanup. Application callbacks
   // remain outside this boundary, after the higher-level publication locks.
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

   struct State
   {
      SerializedNativeAccess                 access;
      std::shared_ptr<Engine::database>      engine;
      std::shared_ptr<Engine::write_session> writer;
      std::shared_ptr<Engine::read_session>  reader;
      std::filesystem::path                  path;
      bool                                   readonly  = false;
      bool                                   temporary = false;
      ~State()
      {
         access.invoke(
             [&]
             {
                reader.reset();
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
   struct root
   {
      std::shared_ptr<State>  state;
      std::optional<Snapshot> snapshot;
      std::optional<Cursor>   readonlyCursor;
      Cursor cursor() const { return snapshot ? snapshot->snapshot_cursor() : *readonlyCursor; }
   };
   shared_root retain(const std::shared_ptr<State>& state, Snapshot snapshot)
   {
      if (!snapshot)
         return {};
      return shared_root(new root{state, std::move(snapshot), {}},
                         [state](const root* r) { state->access.invoke([&] { delete r; }, true); });
   }
   shared_root retain(const std::shared_ptr<State>& state, Cursor cursor)
   {
      return shared_root(new root{state, {}, std::move(cursor)},
                         [state](const root* r) { state->access.invoke([&] { delete r; }, true); });
   }
   Snapshot native(const std::shared_ptr<State>& state, const shared_root& r)
   {
      state->writable();
      if (!r)
         return state->writer->create_temporary_tree();
      if (r->state != state || !r->snapshot)
         throw std::runtime_error("foreign or read-only storage root");
      return *r->snapshot;
   }
   struct database_view
   {
      std::shared_ptr<State> state;
      std::mutex             mutex;
      shared_root            top;
      bool                   publish = true;
   };

   void readRootValue(const std::shared_ptr<State>& state,
                      Cursor&                       cursor,
                      std::vector<char>*            value,
                      std::vector<shared_root>*     roots)
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
            if (state->readonly)
               (*roots)[i] = retain(state, list.subtree_cursor());
            else
            {
               // Get an owned child through the public snapshot extension;
               // a cursor alone does not expose writable allocator addresses.
               // This path is supplied by the caller's owning snapshot below.
               throw std::logic_error("owned root extraction needs snapshot");
            }
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

   void readValue(const shared_root&        source,
                  Cursor&                   cursor,
                  std::vector<char>*        value,
                  std::vector<shared_root>* roots)
   {
      if (!cursor.is_subtree() || !roots || source->state->readonly)
      {
         readRootValue(source->state, cursor, value, roots);
         return;
      }
      if (value)
         value->clear();
      roots->clear();
      auto       list    = source->snapshot->get_subtree(cursor.key());
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
         (*roots)[i] = retain(source->state, list.get_subtree(bytes(indexKey(i))));
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
      auto state = view->state;
      if (source->state != state)
         throw std::runtime_error("foreign storage root");
      return state->access.invoke(
          [&]
          {
             auto c = source->cursor();
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
      return source->state->access.invoke(
          [&]
          {
             auto c     = source->cursor();
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
      return r->state->access.invoke(
          [&]
          {
             auto c = r->cursor();
             return !c.lower_bound(bytes(lower)) || (!upper.empty() && c.key() >= bytes(upper));
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
      return view->state->access.invoke(
          [&] { return equalCursors(a->cursor(), b->cursor(), bytes(lower), bytes(upper)); });
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
             auto final = edit.get_tree();
             return retain(state, std::move(final));
          });
      accounting::Publication publication;
      if (view->publish)
         state->access.invoke(
             [&]
             {
                // SAL's accepted root commit may perform fsync/msync without an EINTR
                // retry. Defer only the CPU sampling signal across this bounded atomic
                // publication; the caller's publication gate already defers timeout.
                accounting::PublicationSignalMask samplingMask;
                auto                              tx = state->writer->start_transaction(0);
                tx.primary().set_root(native(state, updated));
                tx.commit();
             });
      view->top = std::move(updated);
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
             return retain(state, edit.get_tree());
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
             return retain(state, edit.get_tree());
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
             return retain(state, edit.get_tree());
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
                auto c = destination->cursor();
                for (bool found = c.lower_bound(bytes(lower));
                     found && (upper.empty() || c.key() < bytes(upper)); found = c.next())
                {
                   accounting::check();
                   edit.remove(c.key());
                }
             }
             if (source)
             {
                native(state, source);  // validate ownership before any publication
                auto c = source->cursor();
                for (bool found = c.lower_bound(bytes(lower));
                     found && (upper.empty() || c.key() < bytes(upper)); found = c.next())
                {
                   accounting::check();
                   if (c.is_subtree())
                      edit.upsert_subtree(c.key(), source->snapshot->get_subtree(c.key()));
                   else
                      edit.upsert(c.key(), *c.value<std::string>());
                }
             }
             return retain(state, edit.get_tree());
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
      const auto written = ::write(fd, identity.data(), identity.size());
      const bool failed  = written != static_cast<ssize_t>(identity.size()) || ::fsync(fd) != 0;
      ::close(fd);
      if (failed)
         throw std::runtime_error("cannot persist database identity");
      fd = ::open(path.c_str(), O_RDONLY | O_DIRECTORY);
      if (fd < 0)
         throw std::runtime_error("cannot open database directory");
      const int result = ::fsync(fd);
      ::close(fd);
      if (result)
         throw std::runtime_error("cannot persist database directory");
   }
   database::database(std::shared_ptr<database_view> v) : view(std::move(v)) {}
   database::database(const std::filesystem::path& requested,
                      const database_config&,
                      open_mode mode)
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
         static std::atomic<unsigned> serial = 0;
         path /= std::string("psibase-temporary-") + std::to_string(::getpid()) + "-" +
                 std::to_string(serial++);
         state->temporary = true;
      }
      const bool directoryExists = std::filesystem::exists(path);
      const bool nonempty        = directoryExists && !std::filesystem::is_empty(path);
      const bool existing        = std::filesystem::exists(path / formatFile);
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
      state->path      = path;
      view             = std::make_shared<database_view>();
      view->state      = state;
      state->access.invoke(
          [&]
          {
             Engine::config cfg;
             cfg.sync_mode                = psitri::sync_mode::fsync;
             cfg.enable_read_cache        = false;
             cfg.max_pinned_cache_size_mb = 0;
             if (!fresh)
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
                 state->readonly
                     ? psitri::open_mode::read_only
                     : (fresh ? psitri::open_mode::create_only : psitri::open_mode::open_existing),
                 cfg);
             if (state->readonly)
             {
                state->reader = state->engine->start_read_session();
                view->top     = retain(state, state->reader->create_cursor(0));
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
                view->top = retain(state, state->writer->get_root(0));
             }
          });
      if (fresh)
         writeIdentityFile(path);
   }
   std::shared_ptr<database> database::clone() const
   {
      auto result     = std::make_shared<database_view>();
      result->state   = view->state;
      result->publish = false;
      {
         std::lock_guard lock(view->mutex);
         result->top = view->top;
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
