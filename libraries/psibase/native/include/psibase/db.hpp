#pragma once

#include_next <psibase/db.hpp>

#include <psibase/blob.hpp>
#include <psibase/nativeTables.hpp>
#include <psio/fracpack.hpp>
#include <psio/from_bin.hpp>
#include <psio/to_key.hpp>

#include <boost/filesystem/path.hpp>

namespace psibase
{
   struct SharedDatabaseImpl;
   struct SharedDatabase
   {
      std::shared_ptr<SharedDatabaseImpl> impl;

      SharedDatabase() = default;
      SharedDatabase(const boost::filesystem::path& dir);
      SharedDatabase(const SharedDatabase&) = default;
      SharedDatabase(SharedDatabase&&)      = default;

      SharedDatabase& operator=(const SharedDatabase&) = default;
      SharedDatabase& operator=(SharedDatabase&&)      = default;
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
      };  // Session

      Database(SharedDatabase shared);
      Database(const Database&) = delete;
      ~Database();

      Session startRead();
      Session startWrite();
      void    commit(Session&);
      void    abort(Session&);

      void kvPutRaw(kv_map map, psio::input_stream key, psio::input_stream value);
      void kvRemoveRaw(kv_map map, psio::input_stream key);
      std::optional<psio::input_stream> kvGetRaw(kv_map map, psio::input_stream key);
      std::optional<KVResult>           kvGreaterEqualRaw(kv_map             map,
                                                          psio::input_stream key,
                                                          size_t             matchKeySize);
      std::optional<KVResult>           kvLessThanRaw(kv_map             map,
                                                      psio::input_stream key,
                                                      size_t             matchKeySize);
      std::optional<KVResult>           kvMaxRaw(kv_map map, psio::input_stream key);

      template <typename K, typename V>
      auto kvPut(kv_map map, const K& key, const V& value)
          -> std::enable_if_t<!psio::is_std_optional<V>(), void>
      {
         kvPutRaw(map, psio::convert_to_key(key), psio::convert_to_frac(value));
      }

      template <typename V, typename K>
      std::optional<V> kvGet(kv_map map, const K& key)
      {
         auto s = kvGetRaw(map, psio::convert_to_key(key));
         if (!s)
            return std::nullopt;
         return psio::convert_from_frac<V>(psio::input_stream(s->pos, s->end));
      }

      template <typename V, typename K>
      V kvGetOrDefault(kv_map map, const K& key)
      {
         auto obj = kvGet<V>(map, key);
         if (obj)
            return std::move(*obj);
         return {};
      }
   };  // Database
}  // namespace psibase
