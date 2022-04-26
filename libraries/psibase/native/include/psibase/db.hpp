#pragma once

#include_next <psibase/db.hpp>

#include <eosio/types.hpp>
#include <psibase/blob.hpp>
#include <psibase/native_tables.hpp>
#include <psio/fracpack.hpp>
#include <psio/from_bin.hpp>
#include <psio/to_key.hpp>

#include <boost/filesystem/path.hpp>

namespace psibase
{
   struct shared_database_impl;
   struct shared_database
   {
      std::shared_ptr<shared_database_impl> impl;

      shared_database() = default;
      shared_database(const boost::filesystem::path& dir);
      shared_database(const shared_database&) = default;
      shared_database(shared_database&&)      = default;

      shared_database& operator=(const shared_database&) = default;
      shared_database& operator=(shared_database&&)      = default;
   };

   struct database_impl;
   struct database
   {
      std::unique_ptr<database_impl> impl;

      struct kv_result
      {
         psio::input_stream key;
         psio::input_stream value;
      };

      struct session
      {
         database* db = {};

         session() = default;
         session(database* db) : db{db} {}
         session(const session&) = delete;
         session(session&& src)
         {
            db     = src.db;
            src.db = nullptr;
         }
         ~session()
         {
            if (db)
               db->abort(*this);
         }

         session& operator=(const session&) = delete;

         session& operator=(session&& src)
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
      };  // session

      database(shared_database shared);
      database(const database&) = delete;
      ~database();

      session start_read();
      session start_write();
      void    commit(session&);
      void    abort(session&);

      void kv_put_raw(kv_map map, psio::input_stream key, psio::input_stream value);
      void kv_remove_raw(kv_map map, psio::input_stream key);
      std::optional<psio::input_stream> kv_get_raw(kv_map map, psio::input_stream key);
      std::optional<kv_result>          kv_greater_equal_raw(kv_map             map,
                                                             psio::input_stream key,
                                                             size_t             match_key_size);
      std::optional<kv_result>          kv_less_than_raw(kv_map             map,
                                                         psio::input_stream key,
                                                         size_t             match_key_size);
      std::optional<kv_result>          kv_max_raw(kv_map map, psio::input_stream key);

      template <typename K, typename V>
      auto kv_put(kv_map map, const K& key, const V& value)
          -> std::enable_if_t<!eosio::is_std_optional<V>(), void>
      {
         kv_put_raw(map, psio::convert_to_key(key), psio::convert_to_frac(value));
      }

      template <typename V, typename K>
      std::optional<V> kv_get(kv_map map, const K& key)
      {
         auto s = kv_get_raw(map, psio::convert_to_key(key));
         if (!s)
            return std::nullopt;
         return psio::convert_from_frac<V>(psio::input_stream(s->pos, s->end));
      }

      template <typename V, typename K>
      V kv_get_or_default(kv_map map, const K& key)
      {
         auto obj = kv_get<V>(map, key);
         if (obj)
            return std::move(*obj);
         return {};
      }
   };  // database
}  // namespace psibase
