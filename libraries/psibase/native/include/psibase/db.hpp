#pragma once

#include_next <psibase/db.hpp>

#include <psibase/Socket.hpp>
#include <psibase/blob.hpp>
#include <psibase/nativeTables.hpp>
#include <psio/fracpack.hpp>
#include <psio/from_bin.hpp>
#include <psio/to_key.hpp>
#include <triedent/file_fwd.hpp>

#include <filesystem>

namespace triedent
{
   class write_session;
   class root;
   struct database_config;
}  // namespace triedent

namespace psibase
{
   struct Revision;
   using ConstRevisionPtr = std::shared_ptr<const Revision>;

   using Writer    = triedent::write_session;
   using WriterPtr = std::shared_ptr<Writer>;

   using DbPtr = std::shared_ptr<triedent::root>;

   struct DbChangeSet
   {
      struct Range
      {
         std::vector<unsigned char> lower;
         std::vector<unsigned char> upper;
         bool                       write;
      };
      std::vector<Range> ranges;
      void               onRead(std::span<const char> value);
      void               onGreaterEqual(std::span<const char> key,
                                        std::size_t           prefixLen,
                                        bool                  found,
                                        std::span<const char> result);
      void               onLessThan(std::span<const char> key,
                                    std::size_t           prefixLen,
                                    bool                  found,
                                    std::span<const char> result);
      void               onMax(std::span<const char> key, bool found, std::span<const char> result);
      void               onWrite(std::span<const char> key);
   };

   struct SharedDatabaseImpl;
   struct SharedDatabase
   {
      std::shared_ptr<SharedDatabaseImpl> impl;

      SharedDatabase() = default;
      SharedDatabase(const std::filesystem::path&     dir,
                     const triedent::database_config& config,
                     triedent::open_mode              mode = triedent::open_mode::create);
      SharedDatabase(const SharedDatabase&) = default;
      SharedDatabase(SharedDatabase&&)      = default;

      SharedDatabase& operator=(const SharedDatabase&) = default;
      SharedDatabase& operator=(SharedDatabase&&)      = default;

      ConstRevisionPtr getHead();
      ConstRevisionPtr emptyRevision();
      WriterPtr        createWriter();
      void             setHead(Writer& writer, ConstRevisionPtr revision);
      ConstRevisionPtr getRevision(Writer& writer, const Checksum256& blockId);
      void             removeRevisions(Writer& writer, const Checksum256& irreversible);

      void                             setBlockData(Writer&               writer,
                                                    const Checksum256&    blockId,
                                                    std::span<const char> key,
                                                    std::span<const char> value);
      std::optional<std::vector<char>> getBlockData(Writer&               writer,
                                                    const Checksum256&    blockId,
                                                    std::span<const char> key);

      DbPtr getSubjective();
      bool  commitSubjective(Writer&             writer,
                             DbPtr&              original,
                             DbPtr               updated,
                             DbChangeSet&&       changes,
                             SocketChangeSet&&   socketChanges,
                             Sockets&            sockets,
                             SocketAutoCloseSet& closing);

      bool                               isSlow() const;
      std::vector<std::span<const char>> span() const;
   };

   struct DatabaseImpl;
   struct Database
   {
      std::unique_ptr<DatabaseImpl> impl;

      struct KVResult
      {
         psio::input_stream key;
         psio::input_stream value;
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

      // Manage access to subjective database
      void checkoutSubjective();
      bool commitSubjective(Sockets& sockets, SocketAutoCloseSet& closing);
      void abortSubjective();
      // sockets options are linked to subjective checkouts. Eventually the state might
      // be exposed in a table.
      std::int32_t socketAutoClose(std::int32_t        socket,
                                   bool                value,
                                   Sockets&            sockets,
                                   SocketAutoCloseSet& closing);
      // Used to ensure that checkout and commit are run in the same action
      std::size_t saveSubjective();
      void        restoreSubjective(std::size_t depth);

      // TODO: kvPutRaw, kvRemoveRaw: return deltas
      // TODO: getters: pass in input buffers instead of returning KVResult

      void kvPutRaw(DbId db, psio::input_stream key, psio::input_stream value);
      void kvRemoveRaw(DbId db, psio::input_stream key);
      std::optional<psio::input_stream> kvGetRaw(DbId db, psio::input_stream key);
      std::optional<KVResult>           kvGreaterEqualRaw(DbId               db,
                                                          psio::input_stream key,
                                                          size_t             matchKeySize);
      std::optional<KVResult> kvLessThanRaw(DbId db, psio::input_stream key, size_t matchKeySize);
      std::optional<KVResult> kvMaxRaw(DbId db, psio::input_stream key);

      template <typename K, typename V>
      auto kvPut(DbId     db,
                 const K& key,
                 const V& value) -> std::enable_if_t<!psio::is_std_optional<V>(), void>
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
   };  // Database
}  // namespace psibase
