#include <newchain/db.hpp>

#include <mdbx.h++>

namespace newchain
{
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

   struct shared_database_impl
   {
      const std::unique_ptr<mdbx::env_managed> kv;
      const mdbx::map_handle                   kv_map;

      shared_database_impl(const boost::filesystem::path& dir)
          : kv{construct_kv(dir)}, kv_map{construct_kv_map(*kv)}
      {
      }
   };

   shared_database::shared_database(const boost::filesystem::path& dir)
       : impl{std::make_shared<shared_database_impl>(dir)}
   {
   }

   struct database_impl
   {
      shared_database                shared;
      std::vector<mdbx::txn_managed> transactions;
   };

   database::database(shared_database shared)
       : impl{std::make_unique<database_impl>(database_impl{std::move(shared)})}
   {
   }

   database::~database() {}

   database::session database::start_read()
   {
      impl->transactions.push_back(impl->shared.impl->kv->start_read());
      return {this};
   }

   database::session database::start_write()
   {
      if (impl->transactions.empty())
         impl->transactions.push_back(impl->shared.impl->kv->start_write());
      else
         impl->transactions.push_back(impl->transactions.back().start_nested());
      return {this};
   }

   void database::commit(database::session&)
   {
      impl->transactions.back().commit();
      impl->transactions.pop_back();
   }

   void database::abort(database::session&) { impl->transactions.pop_back(); }

   void database::kv_set_raw(eosio::input_stream key, eosio::input_stream value)
   {
      eosio::check(!impl->transactions.empty(), "no active database sessions");
      impl->transactions.back().upsert(impl->shared.impl->kv_map, {key.pos, key.remaining()},
                                       {value.pos, value.remaining()});
   }

   std::optional<eosio::input_stream> database::kv_get_raw(eosio::input_stream key)
   {
      eosio::check(!impl->transactions.empty(), "no active database sessions");
      mdbx::slice k{key.pos, key.remaining()};
      mdbx::slice v;
      auto        stat = ::mdbx_get(impl->transactions.back(), impl->shared.impl->kv_map, &k, &v);
      if (stat == MDBX_NOTFOUND)
         return std::nullopt;
      mdbx::error::success_or_throw(stat);
      return eosio::input_stream{(const char*)v.data(), v.size()};
   }
}  // namespace newchain
