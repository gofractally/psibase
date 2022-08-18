#pragma once

#include_next <psibase/db.hpp>

#include <psibase/blob.hpp>
#include <psibase/nativeTables.hpp>
#include <psio/fracpack.hpp>
#include <psio/from_bin.hpp>
#include <psio/to_key.hpp>

#include <boost/filesystem/path.hpp>

namespace triedent
{
   class write_session;
}

namespace psibase
{
   struct Revision;
   using ConstRevisionPtr = std::shared_ptr<const Revision>;

   using Writer    = triedent::write_session;
   using WriterPtr = std::shared_ptr<Writer>;

   struct SharedDatabaseImpl;
   struct SharedDatabase
   {
      std::shared_ptr<SharedDatabaseImpl> impl;

      SharedDatabase() = default;
      SharedDatabase(const boost::filesystem::path& dir,
                     bool                           allowSlow,
                     uint64_t                       max_objects    = 1'000'000'000ul,
                     uint64_t                       hot_addr_bits  = 32,
                     uint64_t                       warm_addr_bits = 32,
                     uint64_t                       cool_addr_bits = 32,
                     uint64_t                       cold_addr_bits = 38);
      SharedDatabase(const SharedDatabase&) = default;
      SharedDatabase(SharedDatabase&&)      = default;

      SharedDatabase& operator=(const SharedDatabase&) = default;
      SharedDatabase& operator=(SharedDatabase&&)      = default;

      ConstRevisionPtr getHead();
      WriterPtr        createWriter();
      void             setHead(Writer& writer, ConstRevisionPtr revision);
      ConstRevisionPtr getRevision(Writer& writer, const Checksum256& blockId);
      void             removeRevisions(Writer& writer, const Checksum256& irreversible);
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
      auto kvPut(DbId db, const K& key, const V& value)
          -> std::enable_if_t<!psio::is_std_optional<V>(), void>
      {
         kvPutRaw(db, psio::convert_to_key(key), psio::convert_to_frac(value));
      }

      template <typename V, typename K>
      std::optional<V> kvGet(DbId db, const K& key)
      {
         auto s = kvGetRaw(db, psio::convert_to_key(key));
         if (!s)
            return std::nullopt;
         return psio::convert_from_frac<V>(psio::input_stream(s->pos, s->end));
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
