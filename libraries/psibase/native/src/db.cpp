#include <psibase/db.hpp>

#include <boost/filesystem/operations.hpp>
#include <mdbx.h++>

namespace psibase
{
   static std::unique_ptr<mdbx::env_managed> constructEnv(const boost::filesystem::path& dir,
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

   struct SharedDatabaseImpl
   {
      const std::unique_ptr<mdbx::env_managed> stateEnv;
      const std::unique_ptr<mdbx::env_managed> subjectiveEnv;
      const std::unique_ptr<mdbx::env_managed> writeOnlyEnv;
      const std::unique_ptr<mdbx::env_managed> blockLogEnv;
      const mdbx::map_handle                   contractMap;
      const mdbx::map_handle                   nativeConstrainedMap;
      const mdbx::map_handle                   nativeUnconstrainedMap;
      const mdbx::map_handle                   subjectiveMap;
      const mdbx::map_handle                   writeOnlyMap;
      const mdbx::map_handle                   eventMap;
      const mdbx::map_handle                   uiEventMap;
      const mdbx::map_handle                   blockLogMap;

      SharedDatabaseImpl(const boost::filesystem::path& dir)
          : stateEnv{constructEnv(dir / "state", 3)},
            subjectiveEnv{constructEnv(dir / "subjective")},
            writeOnlyEnv{constructEnv(dir / "write_only", 3)},
            blockLogEnv{constructEnv(dir / "block_log")},
            contractMap{construct_kv_map(*stateEnv, "contract")},
            nativeConstrainedMap{construct_kv_map(*stateEnv, "native_constrained")},
            nativeUnconstrainedMap{construct_kv_map(*stateEnv, "native_unconstrained")},
            subjectiveMap{construct_kv_map(*subjectiveEnv, nullptr)},
            writeOnlyMap{construct_kv_map(*writeOnlyEnv, "write_only")},
            eventMap{construct_kv_map(*writeOnlyEnv, "event")},
            uiEventMap{construct_kv_map(*writeOnlyEnv, "ui_event")},
            blockLogMap{construct_kv_map(*blockLogEnv, nullptr)}
      {
      }

      mdbx::map_handle get_map(DbId db)
      {
         if (db == DbId::contract)
            return contractMap;
         if (db == DbId::native_constrained)
            return nativeConstrainedMap;
         if (db == DbId::native_unconstrained)
            return nativeUnconstrainedMap;
         if (db == DbId::subjective)
            return subjectiveMap;
         if (db == DbId::write_only)
            return writeOnlyMap;
         if (db == DbId::event)
            return writeOnlyMap;
         if (db == DbId::ui_event)
            return writeOnlyMap;
         if (db == DbId::block_log)
            return blockLogMap;
         throw std::runtime_error("unknown DbId");
      }
   };

   SharedDatabase::SharedDatabase(const boost::filesystem::path& dir)
       : impl{std::make_shared<SharedDatabaseImpl>(dir)}
   {
   }

   struct DatabaseImpl
   {
      SharedDatabase                   shared;
      std::vector<mdbx::txn_managed>   transactions;
      std::vector<mdbx::txn_managed>   writeOnlyTransactions;
      std::optional<mdbx::txn_managed> subjectiveTransaction;
      std::optional<mdbx::txn_managed> blockLogTransaction;
      mdbx::cursor_managed             cursor;

      bool transactions_ok()
      {
         // This mismatch can occur if start_*() or commit() throw
         return transactions.size() == writeOnlyTransactions.size() &&
                transactions.empty() == !subjectiveTransaction.has_value() &&
                transactions.empty() == !blockLogTransaction.has_value();
      }

      bool transactions_available() { return transactions_ok() && !transactions.empty(); }

      mdbx::txn_managed& get_trx(DbId db)
      {
         check(transactions_available(), "no active database transactions");
         if (db == DbId::subjective)
            return *subjectiveTransaction;
         else if (db == DbId::block_log)
            return *blockLogTransaction;
         else if (db == DbId::write_only)
            return writeOnlyTransactions.back();
         else if (db == DbId::event)
            return writeOnlyTransactions.back();
         else if (db == DbId::ui_event)
            return writeOnlyTransactions.back();
         else
            return transactions.back();
      }
   };

   Database::Database(SharedDatabase shared)
       : impl{std::make_unique<DatabaseImpl>(DatabaseImpl{std::move(shared)})}
   {
   }

   Database::~Database() {}

   Database::Session Database::startRead()
   {
      check(impl->transactions_ok(), "database transactions mismatch");
      impl->transactions.push_back(impl->shared.impl->stateEnv->start_read());
      impl->writeOnlyTransactions.push_back(impl->shared.impl->writeOnlyEnv->start_read());
      if (!impl->subjectiveTransaction)
         impl->subjectiveTransaction.emplace(impl->shared.impl->subjectiveEnv->start_read());
      if (!impl->blockLogTransaction)
         impl->blockLogTransaction.emplace(impl->shared.impl->blockLogEnv->start_read());
      return {this};
   }

   Database::Session Database::startWrite()
   {
      check(impl->transactions_ok(), "database transactions mismatch");
      if (impl->transactions.empty())
      {
         impl->transactions.push_back(impl->shared.impl->stateEnv->start_write());
         impl->writeOnlyTransactions.push_back(impl->shared.impl->writeOnlyEnv->start_write());
         impl->subjectiveTransaction.emplace(impl->shared.impl->subjectiveEnv->start_write());
         impl->blockLogTransaction.emplace(impl->shared.impl->blockLogEnv->start_write());
      }
      else
      {
         impl->transactions.push_back(impl->transactions.back().start_nested());
         impl->writeOnlyTransactions.push_back(impl->writeOnlyTransactions.back().start_nested());
      }
      return {this};
   }

   // TODO: consider flushing disk after each commit when
   //       transactions.size() falls to 0.
   void Database::commit(Database::Session&)
   {
      check(impl->transactions_available(), "no active database transactions during commit");
      if (impl->transactions.size() == 1)
      {
         // Commit first to prevent consensus state from getting ahead of block
         // log. If the consensus state fails to commit, then replaying the blocks
         // can catch the consensus state back up on restart.
         impl->blockLogTransaction->commit();
         impl->blockLogTransaction.reset();
      }

      // Commit write-only before consensus state to prevent consensus from
      // getting ahead. If write-only commits, but consensus state fails to
      // commit, then replaying the block on restart will fix up the problem.
      impl->writeOnlyTransactions.back().commit();
      impl->writeOnlyTransactions.pop_back();

      // Consensus state.
      impl->transactions.back().commit();
      impl->transactions.pop_back();

      // It's no big deal if this fails to commit
      if (impl->transactions.empty())
      {
         impl->subjectiveTransaction->commit();
         impl->subjectiveTransaction.reset();
      }
   }

   void Database::abort(Database::Session&)
   {
      if (!impl->transactions_available())
         return;
      impl->transactions.pop_back();
      impl->writeOnlyTransactions.pop_back();
      if (impl->transactions.empty() && impl->subjectiveTransaction.has_value())
      {
         // The subjective database has no undo stack and survives aborts; this
         // helps subjective contracts perform subjective mitigation.
         try
         {
            impl->subjectiveTransaction->commit();
         }
         catch (...)
         {
            // Ignore failures since this may be called from ~session()
            // and it's not a major problem if subjective data fails to
            // get committed.

            // TODO: log the failure since this may indicate a disk-space issue
            //       or a larger problem
         }
         impl->subjectiveTransaction.reset();
      }
      if (impl->transactions.empty())
         impl->blockLogTransaction.reset();
   }

   void Database::kvPutRaw(DbId db, psio::input_stream key, psio::input_stream value)
   {
      impl->get_trx(db).upsert(impl->shared.impl->get_map(db), {key.pos, key.remaining()},
                               {value.pos, value.remaining()});
   }

   void Database::kvRemoveRaw(DbId db, psio::input_stream key)
   {
      impl->get_trx(db).erase(impl->shared.impl->get_map(db), {key.pos, key.remaining()});
   }

   std::optional<psio::input_stream> Database::kvGetRaw(DbId db, psio::input_stream key)
   {
      mdbx::slice k{key.pos, key.remaining()};
      mdbx::slice v;
      auto        stat = ::mdbx_get(impl->get_trx(db), impl->shared.impl->get_map(db).dbi, &k, &v);
      if (stat == MDBX_NOTFOUND)
         return std::nullopt;
      mdbx::error::success_or_throw(stat);
      return psio::input_stream{(const char*)v.data(), v.size()};
   }

   std::optional<Database::KVResult> Database::kvGreaterEqualRaw(DbId               db,
                                                                 psio::input_stream key,
                                                                 size_t             matchKeySize)
   {
      mdbx::slice k{key.pos, key.remaining()};
      impl->cursor.bind(impl->get_trx(db), impl->shared.impl->get_map(db).dbi);
      auto result = impl->cursor.lower_bound(k, false);
      if (!result)
         return std::nullopt;
      if (result.key.size() < matchKeySize || memcmp(result.key.data(), key.pos, matchKeySize))
         return std::nullopt;
      return Database::KVResult{
          psio::input_stream{(const char*)result.key.data(), result.key.size()},
          psio::input_stream{(const char*)result.value.data(), result.value.size()},
      };
   }

   std::optional<Database::KVResult> Database::kvLessThanRaw(DbId               db,
                                                             psio::input_stream key,
                                                             size_t             matchKeySize)
   {
      mdbx::slice k{key.pos, key.remaining()};
      impl->cursor.bind(impl->get_trx(db), impl->shared.impl->get_map(db).dbi);
      auto result = impl->cursor.lower_bound(k, false);
      if (!result)
         result = impl->cursor.to_last(false);
      else
         result = impl->cursor.to_previous(false);
      if (!result)
         return std::nullopt;
      if (result.key.size() < matchKeySize || memcmp(result.key.data(), key.pos, matchKeySize))
         return std::nullopt;
      return Database::KVResult{
          psio::input_stream{(const char*)result.key.data(), result.key.size()},
          psio::input_stream{(const char*)result.value.data(), result.value.size()},
      };
   }

   std::optional<Database::KVResult> Database::kvMaxRaw(DbId db, psio::input_stream key)
   {
      std::vector<unsigned char> next(reinterpret_cast<const unsigned char*>(key.pos),
                                      reinterpret_cast<const unsigned char*>(key.end));
      while (!next.empty())
      {
         if (++next.back())
            break;
         next.pop_back();
      }
      std::optional<mdbx::cursor::move_result> result;
      if (next.empty())
      {
         result = impl->cursor.to_last(false);
      }
      else
      {
         mdbx::slice k{next.data(), next.size()};
         result = impl->cursor.lower_bound(k, false);
         if (!*result)
            result = impl->cursor.to_last(false);
         else
            result = impl->cursor.to_previous(false);
      }
      if (!*result)
         return std::nullopt;
      if (result->key.size() < key.remaining() ||
          memcmp(result->key.data(), key.pos, key.remaining()))
         return std::nullopt;
      return Database::KVResult{
          psio::input_stream{(const char*)result->key.data(), result->key.size()},
          psio::input_stream{(const char*)result->value.data(), result->value.size()},
      };
   }

}  // namespace psibase
