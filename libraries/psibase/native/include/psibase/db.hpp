#pragma once

#include_next <psibase/db.hpp>

#include <psibase/blob.hpp>
#include <psibase/storage.hpp>
#include <psio/key.hpp>
#include <psio/shapes.hpp>
#include <psio/pssz.hpp>
#include <psio/pssz_view.hpp>

#include <array>
#include <filesystem>

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

   struct Revision;
   using ConstRevisionPtr = std::shared_ptr<const Revision>;

   using Writer    = storage::write_session;
   using WriterPtr = std::shared_ptr<Writer>;

   using DbPtr = storage::shared_root;

   using IndependentRevision  = std::array<DbPtr, numIndependentDatabases>;
   // Certain rows may trigger callbacks when they are written.
   //
   struct DatabaseCallbacks
   {
      std::function<void()>                      nextTransaction;
      std::function<void()>                      runQueue;
      std::function<void(std::span<const char>)> validateHostConfig;
      std::function<void()>                      hostConfig;
      std::function<void()>                      shutdown;
      // This isn't actually part of the db. It's triggered
      // by a separate host function, but there isn't a better
      // place to put it.
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
         {
            nextTransaction();
         }
         if ((flags & runQueueFlag) && runQueue)
         {
            runQueue();
         }
         if ((flags & hostConfigFlag) && hostConfig)
         {
            hostConfig();
         }
         if ((flags & shutdownFlag) && shutdown)
         {
            shutdown();
         }
         flags = 0;
      }
   };

   struct SharedDatabaseImpl;
   struct SharedDatabase
   {
      std::shared_ptr<SharedDatabaseImpl> impl;

      SharedDatabase() = default;
      SharedDatabase(const std::filesystem::path&    dir,
                     const storage::database_config& config,
                     storage::open_mode              mode = storage::open_mode::create);
      SharedDatabase(const SharedDatabase&) = default;
      SharedDatabase(SharedDatabase&&)      = default;

      SharedDatabase& operator=(const SharedDatabase&) = default;
      SharedDatabase& operator=(SharedDatabase&&)      = default;

      // Returns a fork of the database.
      // Warning: this should only be used for temporary databases as
      // the storage is shared.
      SharedDatabase clone() const;

      // The root of this database that is no part of the chain: rebuildable
      // data, kept out of every revision, fork and snapshot (storage.hpp).
      storage::cache_root cacheRoot() const;

      ConstRevisionPtr getHead();
      ConstRevisionPtr emptyRevision();
      WriterPtr        createWriter();
      void             setHead(Writer& writer, ConstRevisionPtr revision);
      ConstRevisionPtr getRevision(Writer& writer, const Checksum256& blockId);
      void             removeRevisions(Writer& writer, const Checksum256& irreversible);

      void kvPutSubjective(Writer&               writer,
                           DbId                  db,
                           std::span<const char> key,
                           std::span<const char> value);
      void kvRemoveSubjective(Writer& writer, DbId db, std::span<const char> key);
      std::optional<std::vector<char>> kvGetSubjective(Writer&               writer,
                                                       DbId                  db,
                                                       std::span<const char> key);

      // Several puts and removes of native rows published together: one
      // acquisition of the subjective write lock for the whole batch. For
      // native code that writes many rows off the request path (the usage
      // meter's periodic flush); keep a batch small, since subjective
      // commits wait while it is applied.
      struct SubjectiveWrite
      {
         std::vector<char>                key;
         std::optional<std::vector<char>> value;  // empty: remove
      };
      void kvWriteSubjective(Writer& writer, DbId db, std::span<const SubjectiveWrite> writes);
      // Every row whose key starts with `prefix`, in key order, from the
      // current published state.
      void kvScanSubjective(
          Writer&               reader,
          DbId                  db,
          std::span<const char> prefix,
          const std::function<void(std::span<const char> key, std::span<const char> value)>& f);

      IndependentRevision getSubjective();
      // The write lock of the node-local databases, for a section
      // (Database::checkoutSubjective ... commitSubjective), and, with the
      // lock held, publication of what the section built: the roots are
      // replaced and the socket changes applied (false if they cannot be
      // applied; nothing is published then).
      void lockSubjective();
      void unlockSubjective();
      bool publishSubjective(Writer&             writer,
                             IndependentRevision updated,
                             SocketChangeSet&&   socketChanges,
                             Sockets&            sockets,
                             SocketAutoCloseSet& closing);

      std::optional<bool>                isSlow() const;
      std::filesystem::path             directory() const;

      void               setCallbacks(DatabaseCallbacks*);
      DatabaseCallbacks* getCallbacks() const;
   };

   struct DatabaseImpl;
   struct Database
   {
      std::unique_ptr<DatabaseImpl> impl;

      struct KVResult
      {
         std::span<const char> key;
         std::span<const char> value;
      };

      struct Session
      {
         Database* db = {};

         Session() = default;
         Session(Database* db) : db{db} {}
         Session(const Session&) = delete;
         Session(Session&& src)
         {
            db     = src.db;
            src.db = nullptr;
         }
         ~Session()
         {
            if (db)
               db->abort(*this);
         }

         Session& operator=(const Session&) = delete;

         Session& operator=(Session&& src)
         {
            db     = src.db;
            src.db = nullptr;
            return *this;
         }

         void commit()
         {
            if (db)
               db->commit(*this);
            db = nullptr;
         }

         ConstRevisionPtr writeRevision(const Checksum256& blockId)
         {
            if (!db)
               throw std::runtime_error("Session ended; can not create revision");
            ConstRevisionPtr result;
            result = db->writeRevision(*this, blockId);
            db     = nullptr;
            return result;
         }
      };  // Session

      Database(SharedDatabase shared, ConstRevisionPtr revision);
      Database(const Database&) = delete;
      ~Database();

      void             setRevision(ConstRevisionPtr revision);
      ConstRevisionPtr getBaseRevision();
      ConstRevisionPtr getModifiedRevision();
      Session          startRead();
      Session          startWrite(WriterPtr writer);
      void             commit(Session& session);
      ConstRevisionPtr writeRevision(Session& session, const Checksum256& blockId);
      void             abort(Session&);

      ConstRevisionPtr getPrevAuthServices();
      void             setPrevAuthServices(ConstRevisionPtr revision);

      // Manage access to subjective database
      void checkoutEmptySubjective();
      // A section on the node-local databases: the way to write them. It
      // holds their write lock from here to its commit or abort. Reading
      // needs no section: outside one, a read is of what was published last.
      void checkoutSubjective();
      bool commitSubjective(Sockets& sockets, SocketAutoCloseSet& closing);
      void abortSubjective();
      // sockets options are linked to subjective checkouts. Eventually the state might
      // be exposed in a table.
      std::int32_t socketSetFlags(std::int32_t        socket,
                                  std::uint32_t       mask,
                                  std::uint32_t       value,
                                  Sockets&            sockets,
                                  SocketAutoCloseSet& closing);
      std::int32_t socketEnableP2P(std::int32_t        socket,
                                   Sockets&            sockets,
                                   SocketAutoCloseSet& closing);
      // Used to ensure that checkout and commit are run in the same action
      std::size_t saveSubjective();
      void        restoreSubjective(std::size_t depth);

      void clearTemporary();

      // TODO: kvPutRaw, kvRemoveRaw: return deltas
      // TODO: getters: pass in input buffers instead of returning KVResult

      void kvPutRaw(DbId db, std::span<const char> key, std::span<const char> value);
      void kvRemoveRaw(DbId db, std::span<const char> key);
      std::optional<std::span<const char>> kvGetRaw(DbId db, std::span<const char> key);
      /// Whether the key exists. Recorded as a read like kvGetRaw, without
      /// copying the value.
      bool kvContains(DbId db, std::span<const char> key);
      std::optional<KVResult>           kvGreaterEqualRaw(DbId               db,
                                                          std::span<const char> key,
                                                          size_t             matchKeySize);
      std::optional<KVResult> kvLessThanRaw(DbId db, std::span<const char> key, size_t matchKeySize);
      std::optional<KVResult> kvMaxRaw(DbId db, std::span<const char> key);

      template <typename K, typename V>
      auto kvPut(DbId db, const K& key, const V& value)
          -> std::enable_if_t<!psio::is_optional<V>::value, void>
      {
         kvPutRaw(db, psio::encode(psio::key{}, key), psio::to_pssz(value));
      }

      template <typename K>
      void kvRemove(DbId db, const K& key)
      {
         kvRemoveRaw(db, psio::encode(psio::key{}, key));
      }

      template <typename V, typename K>
      std::optional<V> kvGet(DbId db, const K& key)
      {
         auto s = kvGetRaw(db, psio::encode(psio::key{}, key));
         if (!s)
            return std::nullopt;
         return psio::from_pssz<V>(psio::trusted{std::span<const char>{*s}});
      }

      template <typename V, typename K>
      V kvGetOrDefault(DbId db, const K& key)
      {
         auto obj = kvGet<V>(db, key);
         if (obj)
            return std::move(*obj);
         return {};
      }

      void setCallbackFlags(DatabaseCallbacks::Flags);
   };  // Database
}  // namespace psibase
