#include <newchain/db.hpp>

#include <boost/filesystem/operations.hpp>
#include <mdbx.h++>

namespace newchain
{
   static std::unique_ptr<mdbx::env_managed> construct_env(const boost::filesystem::path& dir,
                                                           unsigned max_maps = 0)
   {
      mdbx::env_managed::create_parameters  cp;
      mdbx::env_managed::operate_parameters op;
      op.max_maps                          = max_maps;
      op.options.nested_write_transactions = true;
      op.options.orphan_read_transactions  = false;

      boost::filesystem::create_directories(dir);
      return std::make_unique<mdbx::env_managed>(dir.native(), cp, op);
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
      const std::unique_ptr<mdbx::env_managed> state_env;
      const std::unique_ptr<mdbx::env_managed> subjective_env;
      const mdbx::map_handle                   contract_map;
      const mdbx::map_handle                   native_constrained_map;
      const mdbx::map_handle                   native_unconstrained_map;
      const mdbx::map_handle                   subjective_map;

      shared_database_impl(const boost::filesystem::path& dir)
          : state_env{construct_env(dir / "state", 3)},
            subjective_env{construct_env(dir / "subjective")},
            contract_map{construct_kv_map(*state_env, "contract")},
            native_constrained_map{construct_kv_map(*state_env, "native_constrained")},
            native_unconstrained_map{construct_kv_map(*state_env, "native_unconstrained")},
            subjective_map{construct_kv_map(*subjective_env, nullptr)}
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
         if (map == kv_map::subjective)
            return subjective_map;
         throw std::runtime_error("unknown kv_map");
      }
   };

   shared_database::shared_database(const boost::filesystem::path& dir)
       : impl{std::make_shared<shared_database_impl>(dir)}
   {
   }

   struct database_impl
   {
      shared_database                  shared;
      std::vector<mdbx::txn_managed>   transactions;
      std::optional<mdbx::txn_managed> subjective_transaction;

      mdbx::txn_managed& get_trx(kv_map map)
      {
         eosio::check(!transactions.empty() && subjective_transaction.has_value(),
                      "no active database sessions");
         if (map == kv_map::subjective)
            return *subjective_transaction;
         else
            return transactions.back();
      }
   };

   database::database(shared_database shared)
       : impl{std::make_unique<database_impl>(database_impl{std::move(shared)})}
   {
   }

   database::~database() {}

   database::session database::start_read()
   {
      if (!impl->subjective_transaction)
         impl->subjective_transaction.emplace(impl->shared.impl->subjective_env->start_read());
      impl->transactions.push_back(impl->shared.impl->state_env->start_read());
      return {this};
   }

   database::session database::start_write()
   {
      if (!impl->subjective_transaction)
         impl->subjective_transaction.emplace(impl->shared.impl->subjective_env->start_write());
      if (impl->transactions.empty())
         impl->transactions.push_back(impl->shared.impl->state_env->start_write());
      else
         impl->transactions.push_back(impl->transactions.back().start_nested());
      return {this};
   }

   void database::commit(database::session&)
   {
      eosio::check(!impl->transactions.empty() && impl->subjective_transaction.has_value(),
                   "missing transactions during commit");
      impl->transactions.back().commit();
      impl->transactions.pop_back();
      if (impl->transactions.empty())
      {
         impl->subjective_transaction->commit();
         impl->subjective_transaction.reset();
      }
   }

   void database::abort(database::session&)
   {
      impl->transactions.pop_back();
      if (impl->transactions.empty() && impl->subjective_transaction.has_value())
      {
         // The subjective database has no undo stack and survives aborts; this
         // helps subjective contracts perform subjective mitigation.
         try
         {
            impl->subjective_transaction->commit();
         }
         catch (...)
         {
            // Ignore failures since this may be called from ~session()
            // and it's not a major problem if subjective data fails to
            // get committed.

            // TODO: log the failure since this may indicate a disk-space issue
            //       or a larger problem
         }
         impl->subjective_transaction.reset();
      }
   }

   void database::kv_set_raw(kv_map map, eosio::input_stream key, eosio::input_stream value)
   {
      impl->get_trx(map).upsert(impl->shared.impl->get_map(map), {key.pos, key.remaining()},
                                {value.pos, value.remaining()});
   }

   std::optional<eosio::input_stream> database::kv_get_raw(kv_map map, eosio::input_stream key)
   {
      mdbx::slice k{key.pos, key.remaining()};
      mdbx::slice v;
      auto stat = ::mdbx_get(impl->get_trx(map), impl->shared.impl->get_map(map).dbi, &k, &v);
      if (stat == MDBX_NOTFOUND)
         return std::nullopt;
      mdbx::error::success_or_throw(stat);
      return eosio::input_stream{(const char*)v.data(), v.size()};
   }
}  // namespace newchain
