#pragma once

#include_next <psibase/db.hpp>

#include <psibase/blob.hpp>
#include <psio/fracpack.hpp>
#include <psio/from_bin.hpp>
#include <psio/to_key.hpp>

#include <array>
#include <filesystem>
#include <map>
#include <optional>
#include <shared_mutex>

#include <absl/container/btree_map.h>
#include <psitri/database.hpp>
#include <psitri/transaction.hpp>
#include <psitri/write_session_impl.hpp>
#include <sal/smart_ptr_impl.hpp>

namespace psibase::net
{
   struct connection_base;
}

namespace psibase
{
   struct Socket;
   struct SocketAutoCloseSet;
   struct Sockets;
   struct SocketChange;
   using SocketChangeSet = std::vector<SocketChange>;

   // ── PsiTri type aliases ──────────────────────────────────────────────

   using WriteSessionPtr  = psitri::write_session::ptr;
   using ConstRevisionPtr = sal::smart_ptr<sal::alloc_header>;

   // Legacy aliases kept for minimal-diff migration of consumer code that
   // still references Writer / WriterPtr. These expose psitri types directly.
   using Writer    = psitri::write_session;
   using WriterPtr = WriteSessionPtr;

   // ── Session database maps ───────────────────────────────────────────
   //
   // Session data is server-lifetime only — not persisted to disk, no
   // undo/rollback.  A shared_mutex gives concurrent reads with exclusive
   // writes.
   //
   // SessionOrderedKV — sorted btree_map for both session (DbId 66) and
   //   nativeSession (DbId 67).  Supports lower_bound/upper_bound for
   //   WASM Table API index operations.

   struct SessionOrderedKV
   {
      using Map = absl::btree_map<std::vector<char>, std::vector<char>>;

      mutable std::shared_mutex mutex;
      Map                       data;

      void put(std::span<const char> key, std::span<const char> value)
      {
         std::unique_lock lock(mutex);
         data[std::vector<char>(key.begin(), key.end())] =
             std::vector<char>(value.begin(), value.end());
      }

      void remove(std::span<const char> key)
      {
         std::unique_lock lock(mutex);
         data.erase(std::vector<char>(key.begin(), key.end()));
      }

      std::optional<std::vector<char>> get(std::span<const char> key) const
      {
         std::shared_lock lock(mutex);
         auto             it = data.find(std::vector<char>(key.begin(), key.end()));
         if (it == data.end())
            return std::nullopt;
         return it->second;
      }

      bool empty() const
      {
         std::shared_lock lock(mutex);
         return data.empty();
      }

      void clear()
      {
         std::unique_lock lock(mutex);
         data.clear();
      }
   };

   // ── Callbacks ────────────────────────────────────────────────────────

   // Certain rows may trigger callbacks when they are written.
   struct DatabaseCallbacks
   {
      std::function<void()>                      nextTransaction;
      std::function<void()>                      runQueue;
      std::function<void(std::span<const char>)> validateHostConfig;
      std::function<void()>                      hostConfig;
      std::function<void()>                      shutdown;
      std::function<void(std::span<const char>,
                         const std::function<void(const std::shared_ptr<Socket>&)>&)>
                                                                        socketOpen;
      std::function<void(const std::shared_ptr<net::connection_base>&)> socketP2P;

      static const unsigned nextTransactionFlag = 1;
      static const unsigned runQueueFlag        = 2;
      static const unsigned hostConfigFlag      = 4;
      static const unsigned shutdownFlag        = 8;
      using Flags                               = unsigned;
      void run(Flags& flags)
      {
         if ((flags & nextTransactionFlag) != 0 && nextTransaction)
            nextTransaction();
         if ((flags & runQueueFlag) && runQueue)
            runQueue();
         if ((flags & hostConfigFlag) && hostConfig)
            hostConfig();
         if ((flags & shutdownFlag) && shutdown)
            shutdown();
         flags = 0;
      }
   };

   // ── SharedDatabase ───────────────────────────────────────────────────

   struct SharedDatabaseImpl;
   struct SharedDatabase
   {
      std::shared_ptr<SharedDatabaseImpl> impl;

      SharedDatabase() = default;
      SharedDatabase(const std::filesystem::path& dir,
                     const psitri::runtime_config& config  = {},
                     psitri::open_mode             mode    = psitri::open_mode::create_or_open);
      SharedDatabase(const SharedDatabase&) = default;
      SharedDatabase(SharedDatabase&&)      = default;

      SharedDatabase& operator=(const SharedDatabase&) = default;
      SharedDatabase& operator=(SharedDatabase&&)      = default;

      // Returns a fork of the database.
      // Warning: this should only be used for temporary databases as
      // the storage is shared.
      SharedDatabase clone() const;

      ConstRevisionPtr getHead(Writer& writer);
      ConstRevisionPtr emptyRevision();
      WriteSessionPtr  createWriter();
      void             setHead(Writer& writer, ConstRevisionPtr revision);

      // Fork revision management (stored as subtrees in root 2)
      ConstRevisionPtr getRevision(Writer& writer, const Checksum256& blockId);
      void             writeRevision(Writer& writer,
                                     const Checksum256& blockId,
                                     ConstRevisionPtr   root);
      void             removeRevisions(Writer& writer, const Checksum256& irreversible);

      // Subjective database access (root 1 — mutex-protected, no OCC)
      void kvPutSubjective(Writer&               writer,
                           DbId                  db,
                           std::span<const char> key,
                           std::span<const char> value);
      void kvRemoveSubjective(Writer& writer, DbId db, std::span<const char> key);
      std::optional<std::vector<char>> kvGetSubjective(Writer&               writer,
                                                       DbId                  db,
                                                       std::span<const char> key);

      // Returns the in-memory session maps (defined on SharedDatabaseImpl)
      SessionOrderedKV& nativeSessionMap();
      SessionOrderedKV& sessionMap();

      bool                               isSlow() const;
      std::vector<std::span<const char>> span() const;

      void               setCallbacks(DatabaseCallbacks*);
      DatabaseCallbacks* getCallbacks() const;
   };

   // ── KVStore ──────────────────────────────────────────────────────────
   //
   // Thin routing layer that prefixes keys with DbId and dispatches to
   // the active psitri::transaction (consensus or subjective) or to
   // in-memory std::maps for ephemeral databases.

   class KVStore
   {
     public:
      struct KVResult
      {
         psio::input_stream key;
         psio::input_stream value;
      };

      // Active transactions — set by BlockContext for read/write paths
      psitri::transaction* consensus_tx  = nullptr;
      psitri::transaction* subjective_tx = nullptr;  // persistent subjective (root 1)

      // Session databases — in-memory maps, no psitri needed
      SessionOrderedKV* session_ordered_kv = nullptr;  // DbId::session (66)
      SessionOrderedKV* session_native_kv  = nullptr;  // DbId::nativeSession (67)

      // Read-only consensus cursor — used when no transaction is active
      // (e.g. RevisionAccess for read-only queries against a specific revision)
      std::optional<psitri::cursor> consensus_cursor;

      // Writer for read-only subjective access (reads current root without checkout)
      Writer* _writer = nullptr;

      // SharedDatabase pointer for per-impl subjective root fallback reads
      SharedDatabase* _shared_db = nullptr;

      // Ephemeral databases — in-memory only (temporary is per-transaction)
      using MemoryKV = std::map<std::vector<char>, std::vector<char>>;
      MemoryKV temporary;

      // ── Raw KV operations ─────────────────────────────────────────────

      void                             kvPutRaw(DbId db, psio::input_stream key, psio::input_stream value);
      void                             kvRemoveRaw(DbId db, psio::input_stream key);
      std::optional<psio::input_stream> kvGetRaw(DbId db, psio::input_stream key);
      std::optional<KVResult>          kvGreaterEqualRaw(DbId               db,
                                                         psio::input_stream key,
                                                         size_t             matchKeySize);
      std::optional<KVResult>          kvLessThanRaw(DbId db, psio::input_stream key, size_t matchKeySize);
      std::optional<KVResult>          kvMaxRaw(DbId db, psio::input_stream key);

      // ── Templated wrappers ────────────────────────────────────────────

      template <typename K, typename V>
      auto kvPut(DbId db, const K& key, const V& value)
          -> std::enable_if_t<!psio::is_std_optional<V>(), void>
      {
         kvPutRaw(db, psio::convert_to_key(key), psio::convert_to_frac(value));
      }

      template <typename K>
      void kvRemove(DbId db, const K& key)
      {
         kvRemoveRaw(db, psio::convert_to_key(key));
      }

      template <typename V, typename K>
      std::optional<V> kvGet(DbId db, const K& key)
      {
         auto s = kvGetRaw(db, psio::convert_to_key(key));
         if (!s)
            return std::nullopt;
         return psio::from_frac<V>(psio::prevalidated{s->pos, s->end});
      }

      template <typename V, typename K>
      V kvGetOrDefault(DbId db, const K& key)
      {
         auto obj = kvGet<V>(db, key);
         if (obj)
            return std::move(*obj);
         return {};
      }

      // ── prevAuthServices ──────────────────────────────────────────────

      ConstRevisionPtr getPrevAuthServices();
      void             setPrevAuthServices(ConstRevisionPtr revision);

      // ── Revision access ───────────────────────────────────────────────

      void             setBaseRevision(ConstRevisionPtr root) { _base_root = std::move(root); }
      ConstRevisionPtr getBaseRevision() const { return _base_root; }
      ConstRevisionPtr getModifiedRevision() const;

      // ── Subjective management (delegated from BlockContext) ───────────

      void checkoutSubjective(Writer& ws, SharedDatabase& shared);
      void checkoutEmptySubjective(Writer& ws);
      bool commitSubjective(Sockets& sockets, SocketAutoCloseSet& closing);
      void abortSubjective();

      std::int32_t socketSetFlags(std::int32_t        socket,
                                  std::uint32_t       mask,
                                  std::uint32_t       value,
                                  Sockets&            sockets,
                                  SocketAutoCloseSet& closing);
      std::int32_t socketEnableP2P(std::int32_t        socket,
                                   Sockets&            sockets,
                                   SocketAutoCloseSet& closing);
      std::size_t saveSubjective();
      void        restoreSubjective(std::size_t depth);

      // ── Ephemeral lifecycle ───────────────────────────────────────────

      void clearTemporary() { temporary.clear(); }

      void setCallbackFlags(DatabaseCallbacks::Flags);

     private:
      ConstRevisionPtr  _base_root;
      std::vector<char> _keyBuffer;
      std::vector<char> _valueBuffer;
      std::vector<char> _prefixedKey;

      // Subjective transaction storage (owned when checked out)
      std::optional<psitri::transaction>         _subjective_tx_storage;
      std::vector<psitri::transaction_frame_ref> _subjective_frames;  // nesting via sub-transactions
      SharedDatabase*                            _subjective_shared = nullptr;
      DatabaseCallbacks::Flags           _callbackFlags     = {};
      std::size_t                        _subjectiveLimit   = 0;

      // Prepend DbId byte to key, return view into _prefixedKey buffer
      std::string_view prefixKey(DbId db, std::span<const char> key);

      // Read cursor — returns nullopt if no data source (empty database)
      std::optional<psitri::cursor> readCursorForDb(DbId db);

      // Helpers for ephemeral database operations
      std::optional<psio::input_stream> ephemeralGet(MemoryKV& m, psio::input_stream key);
      std::optional<KVResult>           ephemeralGreaterEqual(MemoryKV& m, psio::input_stream key,
                                                              size_t matchKeySize);
      std::optional<KVResult>           ephemeralLessThan(MemoryKV& m, psio::input_stream key,
                                                          size_t matchKeySize);
      std::optional<KVResult>           ephemeralMax(MemoryKV& m, psio::input_stream key);
   };

   // ── RevisionAccess ────────────────────────────────────────────────
   //
   // Convenience RAII wrapper that pairs a KVStore with a psitri
   // transaction for temporary read/write access to a specific revision.
   // Replaces the old  Database db{shared, revision}; db.startXxx()  pattern.

   struct RevisionAccess
   {
      KVStore                          kv;
      std::optional<psitri::transaction> tx;

      // Read/write access to a revision (requires a write session)
      RevisionAccess(Writer& writer, ConstRevisionPtr revision)
          : tx(std::in_place,
               writer.allocator_session(),
               std::move(revision),
               [](sal::smart_ptr<sal::alloc_header>) {},
               []() {},
               psitri::tx_mode::batch)
      {
         kv.consensus_tx = &*tx;
      }

      // Read-only access to a revision via cursor (no writer or session needed)
      RevisionAccess(SharedDatabase&, ConstRevisionPtr revision)
      {
         if (revision)
            kv.consensus_cursor.emplace(std::move(revision));
      }

      RevisionAccess(const RevisionAccess&)            = delete;
      RevisionAccess& operator=(const RevisionAccess&) = delete;
   };

}  // namespace psibase
