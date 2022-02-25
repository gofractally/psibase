#pragma once

#include <newchain/blob.hpp>
#include <newchain/native_tables.hpp>

#include <boost/filesystem/path.hpp>
#include <eosio/from_bin.hpp>
#include <eosio/to_key.hpp>
#include <eosio/types.hpp>
#include <mdbx.h++>

namespace newchain
{
   struct database
   {
      const std::unique_ptr<mdbx::env_managed> kv;
      const mdbx::map_handle                   kv_map;

      database(const boost::filesystem::path& dir)
          : kv{construct_kv(dir)}, kv_map{construct_kv_map(*kv)}
      {
      }

      static std::unique_ptr<mdbx::env_managed> construct_kv(const boost::filesystem::path& dir)
      {
         mdbx::env_managed::operate_parameters op;
         op.options.nested_write_transactions = true;
         op.options.orphan_read_transactions  = false;

         return std::make_unique<mdbx::env_managed>(
             dir.native(), mdbx::env_managed::create_parameters{mdbx::env_managed::geometry{}}, op);
      }

      static mdbx::map_handle construct_kv_map(mdbx::env_managed& kv)
      {
         mdbx::map_handle kv_map;
         auto             trx = kv.start_write();
         kv_map               = trx.create_map(nullptr);
         trx.commit();
         return kv_map;
      }

      void set_kv_raw(mdbx::txn& kv_trx, eosio::input_stream key, eosio::input_stream value)
      {
         kv_trx.upsert(kv_map, {key.pos, key.remaining()}, {value.pos, value.remaining()});
      }

      template <typename K, typename V>
      auto set_kv(mdbx::txn& kv_trx, const K& key, const V& value)
          -> std::enable_if_t<!eosio::is_std_optional<V>(), void>
      {
         set_kv_raw(kv_trx, eosio::convert_to_key(key), eosio::convert_to_bin(value));
      }

      template <typename V, typename K>
      std::optional<V> get_kv(mdbx::txn& kv_trx, const K& key)
      {
         auto        kk = eosio::convert_to_key(key);
         mdbx::slice k{kk.data(), kk.size()};
         mdbx::slice v;
         auto        stat = ::mdbx_get(kv_trx, kv_map, &k, &v);
         if (stat == MDBX_NOTFOUND)
            return std::nullopt;
         mdbx::error::success_or_throw(stat);
         eosio::input_stream s{(const char*)v.data(), v.size()};
         return eosio::from_bin<V>(s);
      }

      template <typename V, typename K>
      V get_kv_or_default(mdbx::txn& kv_trx, const K& key)
      {
         auto obj = get_kv<V>(kv_trx, key);
         if (obj)
            return std::move(*obj);
         return {};
      }
   };  // database

}  // namespace newchain
