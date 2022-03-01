#include <newchain/db.hpp>

#include <mdbx.h++>

namespace newchain
{
   static std::unique_ptr<mdbx::env_managed> construct_env(const boost::filesystem::path& dir)
   {
      mdbx::env_managed::operate_parameters op;
      op.max_maps                          = 3;
      op.options.nested_write_transactions = true;
      op.options.orphan_read_transactions  = false;

      return std::make_unique<mdbx::env_managed>(
          dir.native(), mdbx::env_managed::create_parameters{mdbx::env_managed::geometry{}}, op);
   }

   static mdbx::map_handle construct_kv_map(mdbx::env_managed& env, const char* name)
   {
      mdbx::map_handle kv_map;
      auto             trx = env.start_write();
      kv_map               = trx.create_map(name);
      trx.commit();
      return kv_map;
   }

   struct shared_database_impl
   {
      const std::unique_ptr<mdbx::env_managed> main_env;
      const mdbx::map_handle                   contract_map;
      const mdbx::map_handle                   native_constrained_map;
      const mdbx::map_handle                   native_unconstrained_map;

      shared_database_impl(const boost::filesystem::path& dir)
          : main_env{construct_env(dir)},
            contract_map{construct_kv_map(*main_env, "contract")},
            native_constrained_map{construct_kv_map(*main_env, "native_constrained")},
            native_unconstrained_map{construct_kv_map(*main_env, "native_unconstrained")}
      {
      }

      mdbx::map_handle get_map(kv_map map)
      {
         if (map == kv_map::contract)
            return contract_map;
         if (map == kv_map::native_constrained)
            return native_constrained_map;
         if (map == kv_map::native_unconstrained)
            return native_unconstrained_map;
         throw std::runtime_error("unknown kv_map");
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
      impl->transactions.push_back(impl->shared.impl->main_env->start_read());
      return {this};
   }

   database::session database::start_write()
   {
      if (impl->transactions.empty())
         impl->transactions.push_back(impl->shared.impl->main_env->start_write());
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

   void database::kv_set_raw(kv_map map, eosio::input_stream key, eosio::input_stream value)
   {
      eosio::check(!impl->transactions.empty(), "no active database sessions");
      impl->transactions.back().upsert(impl->shared.impl->get_map(map), {key.pos, key.remaining()},
                                       {value.pos, value.remaining()});
   }

   std::optional<eosio::input_stream> database::kv_get_raw(kv_map map, eosio::input_stream key)
   {
      eosio::check(!impl->transactions.empty(), "no active database sessions");
      mdbx::slice k{key.pos, key.remaining()};
      mdbx::slice v;
      auto        stat =
          ::mdbx_get(impl->transactions.back(), impl->shared.impl->get_map(map).dbi, &k, &v);
      if (stat == MDBX_NOTFOUND)
         return std::nullopt;
      mdbx::error::success_or_throw(stat);
      return eosio::input_stream{(const char*)v.data(), v.size()};
   }
}  // namespace newchain
