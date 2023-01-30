#include <psibase/NativeFunctions.hpp>

#include <psibase/ActionContext.hpp>

namespace psibase
{
   namespace
   {
      template <typename F>
      auto timeDb(NativeFunctions& self, F f)
      {
         auto start  = std::chrono::steady_clock::now();
         auto result = f();
         self.currentActContext->transactionContext.databaseTime +=
             std::chrono::steady_clock::now() - start;
         return result;
      }

      template <typename F>
      void timeDbVoid(NativeFunctions& self, F f)
      {
         auto start = std::chrono::steady_clock::now();
         f();
         self.currentActContext->transactionContext.databaseTime +=
             std::chrono::steady_clock::now() - start;
      }

      DbId getDbRead(NativeFunctions& self, uint32_t db)
      {
         check(self.allowDbRead,
               "database access disabled during proof verification or first auth");
         if (db == uint32_t(DbId::service))
            return (DbId)db;
         if (db == uint32_t(DbId::nativeConstrained))
            return (DbId)db;
         if (db == uint32_t(DbId::nativeUnconstrained))
            return (DbId)db;
         if (db == uint32_t(DbId::subjective))
         {
            // TODO: RPC service queries currently can read subjective data to monitor node status.
            //       However, there's a possibility this may make it easier on an active attacker.
            //       Make this capability a node configuration toggle? Allow node config to whitelist
            //       services for this?
            if ((self.code.flags & CodeRow::isSubjective) || self.allowDbReadSubjective)
               return (DbId)db;
         }
         if (db == uint32_t(DbId::writeOnly) && self.allowDbReadSubjective)
            return (DbId)db;
         if (db == uint32_t(DbId::blockLog) && self.allowDbReadSubjective)
            return (DbId)db;
         throw std::runtime_error("service may not read this db, or must use another intrinsic");
      }

      DbId getDbReadSequential(NativeFunctions& self, uint32_t db)
      {
         check(self.allowDbRead,
               "database access disabled during proof verification or first auth");
         if (self.allowDbReadSubjective || (self.code.flags & CodeRow::isSubjective))
         {
            if (db == uint32_t(DbId::historyEvent))
               return (DbId)db;
            if (db == uint32_t(DbId::uiEvent))
               return (DbId)db;
            if (db == uint32_t(DbId::merkleEvent))
               return (DbId)db;
         }
         throw std::runtime_error("service may not read this db, or must use another intrinsic");
      }

      bool keyHasServicePrefix(uint32_t db)
      {
         return db == uint32_t(DbId::service) || db == uint32_t(DbId::writeOnly) ||
                db == uint32_t(DbId::subjective);
      }

      struct Writable
      {
         DbId db;
         bool chargeable;
         bool refundable;
      };

      Writable getDbWrite(NativeFunctions& self, uint32_t db, psio::input_stream key)
      {
         check(self.allowDbRead,
               "database access disabled during proof verification or first auth");
         check(self.allowDbWrite, "database writes disabled during query");

         if (keyHasServicePrefix(db))
         {
            uint64_t prefix = self.code.codeNum.value;
            std::reverse(reinterpret_cast<char*>(&prefix), reinterpret_cast<char*>(&prefix + 1));
            check(key.remaining() >= sizeof(prefix) && !memcmp(key.pos, &prefix, sizeof(prefix)),
                  "key prefix must match service during write");
         };

         // User-written subjective services writing to subjective storage isn't really
         // viable, so it requires an additional permission bit. The oddities:
         //
         // * It has billing issues since database billing is objective
         // * Aborting or undoing a transaction doesn't roll back subjective storage;
         //   writes from speculative execution survive
         // * Forking doesn't roll back subjective storage
         // * Subjective execution doesn't happen when nodes get the produced block
         //
         // The unusual semantics exist to enable trusted subjective services to do
         // subjective attack mitigation.
         //
         // TODO: reenable after subjective database support is working as intended
         if (false && db == uint32_t(DbId::subjective) &&
             (self.code.flags & CodeRow::isSubjective) &&
             (self.code.flags & CodeRow::allowWriteSubjective))
            // Not chargeable since subjective services are skipped during replay
            return {(DbId)db, false, false};

         // Prevent poison block; subjective services skip execution during replay
         check(!(self.code.flags & CodeRow::isSubjective),
               "subjective services may only write to DbId::subjective");

         if (db == uint32_t(DbId::service))
            return {(DbId)db, true, true};
         if (db == uint32_t(DbId::writeOnly))
            return {(DbId)db, true, false};
         if (db == uint32_t(DbId::nativeConstrained) &&
             (self.code.flags & CodeRow::allowWriteNative))
            return {(DbId)db, true, true};
         if (db == uint32_t(DbId::nativeUnconstrained) &&
             (self.code.flags & CodeRow::allowWriteNative))
            return {(DbId)db, true, true};
         throw std::runtime_error("service may not write this db (" + std::to_string(db) +
                                  "), or must use another intrinsic");
      }

      // Caution: All sequential databases are currently non-refundable. If this
      //          changes, then this function needs to return Writable and the
      //          functions which call it need to adjust their logic.
      DbId getDbWriteSequential(NativeFunctions& self, uint32_t db)
      {
         check(self.allowDbRead,
               "database access disabled during proof verification or first auth");
         check(self.allowDbWrite, "writes disabled during query");

         // Prevent poison block; subjective services skip execution during replay
         check(!(self.code.flags & CodeRow::isSubjective),
               "service may not write this db, or must use another intrinsic");

         if (db == uint32_t(DbId::historyEvent))
            return (DbId)db;
         if (db == uint32_t(DbId::uiEvent))
            return (DbId)db;
         if (db == uint32_t(DbId::merkleEvent))
            return (DbId)db;
         throw std::runtime_error("service may not write this db (" + std::to_string(db) +
                                  "), or must use another intrinsic");
      }

      void verifyCodeByHashRow(psio::input_stream key, psio::input_stream value)
      {
         check(psio::fracpack_validate_strict<CodeByHashRow>({value.pos, value.end}),
               "CodeByHashRow has invalid format");
         // TODO: use a view here instead of unpacking to a rich object
         auto code =
             psio::from_frac<CodeByHashRow>(psio::prevalidated{std::span{value.pos, value.end}});
         auto codeHash = sha256(code.code.data(), code.code.size());
         check(code.codeHash == codeHash, "CodeByHashRow has incorrect codeHash");
         auto expected_key = psio::convert_to_key(code.key());
         check(key.remaining() == expected_key.size() &&
                   !memcmp(key.pos, expected_key.data(), key.remaining()),
               "CodeByHashRow has incorrect key");
      }

      void verifyConfigRow(psio::input_stream key, psio::input_stream value)
      {
         check(psio::fracpack_validate_strict<ConfigRow>({value.pos, value.end}),
               "ConfigRow has invalid format");
         auto row = psio::from_frac<ConfigRow>(psio::prevalidated{std::span{value.pos, value.end}});
         auto expected_key = psio::convert_to_key(row.key());
         check(key.remaining() == expected_key.size() &&
                   !memcmp(key.pos, expected_key.data(), key.remaining()),
               "ConfigRow has incorrect key");

         // Both of these are on the conservative side for triedent. The actual
         // max values are odd.
         check(row.maxKeySize <= 128, "maxKeySize too big for triedent");
         check(row.maxValueSize <= (15 << 20), "maxValueSize too big for triedent");
      }

      void verifyWasmConfigRow(NativeTableNum     table,
                               psio::input_stream key,
                               psio::input_stream value)
      {
         check(psio::fracpack_validate_strict<WasmConfigRow>({value.pos, value.end}),
               "WasmConfigRow has invalid format");
         auto row =
             psio::from_frac<WasmConfigRow>(psio::prevalidated{std::span{value.pos, value.end}});
         auto expected_key = psio::convert_to_key(row.key(table));
         check(key.remaining() == expected_key.size() &&
                   !memcmp(key.pos, expected_key.data(), key.remaining()),
               "WasmConfigRow has incorrect key");
      }

      void verifyWriteConstrained(psio::input_stream key, psio::input_stream value)
      {
         NativeTableNum table;
         check(key.remaining() >= sizeof(table), "Unrecognized key in nativeConstrained");
         memcpy(&table, key.pos, sizeof(table));
         std::reverse((char*)&table, (char*)(&table + 1));
         if (table == codeByHashTable)
            verifyCodeByHashRow(key, value);
         else if (table == configTable)
            verifyConfigRow(key, value);
         else if (table == transactionWasmConfigTable || table == proofWasmConfigTable)
            verifyWasmConfigRow(table, key, value);
         else
            throw std::runtime_error("Unrecognized key in nativeConstrained");
      }

      uint32_t clearResult(NativeFunctions& self)
      {
         self.result_key.clear();
         self.result_value.clear();
         return -1;
      }

      uint32_t setResult(NativeFunctions& self, std::vector<char> result)
      {
         self.result_key.clear();
         self.result_value = std::move(result);
         return self.result_value.size();
      }

      uint32_t setResult(NativeFunctions& self, const std::optional<psio::input_stream>& o)
      {
         if (!o)
            return clearResult(self);
         self.result_key.clear();
         self.result_value.assign(o->pos, o->end);
         return self.result_value.size();
      }

      uint32_t setResult(NativeFunctions& self, const std::optional<Database::KVResult>& o)
      {
         if (!o)
            return clearResult(self);
         self.result_key.assign(o->key.pos, o->key.end);
         self.result_value.assign(o->value.pos, o->value.end);
         return self.result_value.size();
      }
   }  // namespace

   uint32_t NativeFunctions::getResult(eosio::vm::span<char> dest, uint32_t offset)
   {
      if (offset < result_value.size() && dest.size())
         memcpy(dest.data(), result_value.data() + offset,
                std::min(result_value.size() - offset, dest.size()));
      return result_value.size();
   }

   uint32_t NativeFunctions::getKey(eosio::vm::span<char> dest)
   {
      if (!result_key.empty())
         memcpy(dest.data(), result_key.data(), std::min(result_key.size(), dest.size()));
      return result_key.size();
   }

   void NativeFunctions::writeConsole(eosio::vm::span<const char> str)
   {
      // TODO: limit total console size across all executions within transaction
      if (currentActContext->actionTrace.innerTraces.empty() ||
          !std::holds_alternative<ConsoleTrace>(
              currentActContext->actionTrace.innerTraces.back().inner))
         currentActContext->actionTrace.innerTraces.push_back({ConsoleTrace{}});
      auto& console =
          std::get<ConsoleTrace>(currentActContext->actionTrace.innerTraces.back().inner).console;
      console.append(str.begin(), str.end());
   }

   void NativeFunctions::abortMessage(eosio::vm::span<const char> str)
   {
      throw std::runtime_error("service '" + code.codeNum.str() +
                               "' aborted with message: " + std::string(str.data(), str.size()));
   }

   uint64_t NativeFunctions::getBillableTime()
   {
      // A more-accurate message is "only subjective services may
      // call getBillableTime", but that may mislead service developers
      // into thinking they should create a subjective service;
      // they shouldn't.
      check(code.flags & CodeRow::isSubjective,
            "unprivileged services may not call getBillableTime");
      clearResult(*this);
      return transactionContext.getBillableTime().count();
   }

   void NativeFunctions::setMaxTransactionTime(uint64_t nanoseconds)
   {
      check(code.flags & CodeRow::canSetTimeLimit,
            "setMaxTransactionTime requires canSetTimeLimit privilege");
      clearResult(*this);
      if (transactionContext.blockContext.isProducing)
         transactionContext.setWatchdog(
             std::chrono::duration_cast<std::chrono::steady_clock::duration>(
                 std::chrono::nanoseconds{nanoseconds}));
   }

   uint32_t NativeFunctions::getCurrentAction()
   {
      return setResult(*this, psio::convert_to_frac(currentActContext->action));
   }

   // TODO: flags arg. potential flags:
   //   * Prevent writes. Caution: don't accidentally allow prohibited reads.
   //   * Not needed: prevent recursion; the dispatcher can do that
   //   * Run in parallel
   //      * generalization of execVerifyProofs
   //      * needs access to proofs
   //      * no return value
   //      * require prevent writes flag
   //      * allow nodes to optionally skip during block log replay. Normal replay
   //        includes since success is part of consensus; especially if this replaces
   //        execVerifyProofs. Production absolutely must not skip.
   //      * read snapshot: 1 block behind? Immediately before trx?
   //      * kvGetTransactionUsage needs to know number of parallel executions and
   //        execution time.
   //        CAUTION: kvGetTransactionUsage is currently objective.
   //          * Create a subjective one?
   //          * Make it wait until all parallel executions complete?
   //          * Caution with waiting: vulnerability when combined with canNotTimeOut
   //      * Flag to indicate that a parallel run failure is an authorization failure.
   //        Only privileged services can set this since it impacts billing.
   //        Iffy. There's got to be another way. Some of the billing policies seem to
   //        be leaking into native.
   //      * Need to prioritize proofs over other background tasks. Rely on the above flag?
   //      * Don't allow RPC to invoke parallel. High cost, no reward for queries since it
   //        can only indicate failure.
   //      * Consensus config: number of wasm memories for a parallel execution
   //      * Node config: number of parallel executions happening at the same time
   uint32_t NativeFunctions::call(eosio::vm::span<const char> data)
   {
      // TODO: replace temporary rule
      if (++currentActContext->transactionContext.callDepth > 6)
         check(false, "call depth exceeded (temporary rule)");

      // TODO: don't unpack rawData
      check(psio::fracpack_validate_strict<Action>(data), "call: invalid data format");
      auto act = psio::from_frac<Action>(psio::prevalidated{data});
      check(act.sender == code.codeNum || (code.flags & CodeRow::allowSudo),
            "service is not authorized to call as another sender");

      currentActContext->actionTrace.innerTraces.push_back({ActionTrace{}});
      auto& inner_action_trace =
          std::get<ActionTrace>(currentActContext->actionTrace.innerTraces.back().inner);
      // TODO: avoid reserialization
      currentActContext->transactionContext.execCalledAction(code.flags, act, inner_action_trace);
      setResult(*this, inner_action_trace.rawRetval);

      --currentActContext->transactionContext.callDepth;
      return result_value.size();
   }

   void NativeFunctions::setRetval(eosio::vm::span<const char> data)
   {
      currentActContext->actionTrace.rawRetval.assign(data.begin(), data.end());
      clearResult(*this);
   }

   void NativeFunctions::kvPut(uint32_t                    db,
                               eosio::vm::span<const char> key,
                               eosio::vm::span<const char> value)
   {
      timeDbVoid(
          *this,
          [&]
          {
             check(key.size() <= transactionContext.config.maxKeySize, "key is too big");
             check(value.size() <= transactionContext.config.maxValueSize, "value is too big");
             if (db == uint32_t(DbId::nativeConstrained))
                verifyWriteConstrained({key.data(), key.size()}, {value.data(), value.size()});
             clearResult(*this);
             auto w = getDbWrite(*this, db, {key.data(), key.size()});
             if (w.chargeable)
             {
                auto& delta = transactionContext.kvResourceDeltas[KvResourceKey{code.codeNum, db}];
                delta.records += 1;
                delta.keyBytes += key.size();
                delta.valueBytes += value.size();
                if (w.refundable)
                {
                   if (auto existing = database.kvGetRaw(w.db, {key.data(), key.size()}))
                   {
                      delta.records -= 1;
                      delta.keyBytes -= key.size();
                      delta.valueBytes -= existing->remaining();
                   }
                }
             }
             database.kvPutRaw(w.db, {key.data(), key.size()}, {value.data(), value.size()});
          });
   }

   uint64_t NativeFunctions::putSequential(uint32_t db, eosio::vm::span<const char> value)
   {
      return timeDb(  //
          *this,
          [&]
          {
             check(value.size() <= transactionContext.config.maxValueSize, "value is too big");
             clearResult(*this);
             auto m = getDbWriteSequential(*this, db);

             psio::input_stream v{value.data(), value.size()};
             check(v.remaining() >= sizeof(AccountNumber::value),
                   "value prefix must match service during write");
             auto service = psio::from_bin<AccountNumber>(v);
             check(service == code.codeNum, "value prefix must match service during write");

             auto&    dbStatus = transactionContext.blockContext.databaseStatus;
             uint64_t indexNumber;
             if (db == uint32_t(DbId::historyEvent))
                indexNumber = dbStatus.nextHistoryEventNumber++;
             else if (db == uint32_t(DbId::uiEvent))
                indexNumber = dbStatus.nextUIEventNumber++;
             else if (db == uint32_t(DbId::merkleEvent))
                indexNumber = dbStatus.nextMerkleEventNumber++;
             else
                check(false, "putSequential: unsupported db");
             database.kvPut(DatabaseStatusRow::db, dbStatus.key(), dbStatus);

             database.kvPutRaw(m, psio::convert_to_key(indexNumber), {value.data(), value.size()});
             return indexNumber;
          });
   }  // putSequential()

   void NativeFunctions::kvRemove(uint32_t db, eosio::vm::span<const char> key)
   {
      timeDbVoid(*this,
                 [&]
                 {
                    clearResult(*this);
                    auto w = getDbWrite(*this, db, {key.data(), key.size()});
                    if (w.refundable)
                    {
                       if (auto existing = database.kvGetRaw(w.db, {key.data(), key.size()}))
                       {
                          auto& delta =
                              transactionContext.kvResourceDeltas[KvResourceKey{code.codeNum, db}];
                          delta.records -= 1;
                          delta.keyBytes -= key.size();
                          delta.valueBytes -= existing->remaining();
                       }
                    }
                    database.kvRemoveRaw(w.db, {key.data(), key.size()});
                 });
   }

   uint32_t NativeFunctions::kvGet(uint32_t db, eosio::vm::span<const char> key)
   {
      return timeDb(  //
          *this,
          [&] {
             return setResult(*this,
                              database.kvGetRaw(getDbRead(*this, db), {key.data(), key.size()}));
          });
   }

   uint32_t NativeFunctions::getSequential(uint32_t db, uint64_t indexNumber)
   {
      return timeDb(  //
          *this,
          [&]
          {
             auto m = getDbReadSequential(*this, db);
             return setResult(*this, database.kvGetRaw(m, psio::convert_to_key(indexNumber)));
          });
   }

   uint32_t NativeFunctions::kvGreaterEqual(uint32_t                    db,
                                            eosio::vm::span<const char> key,
                                            uint32_t                    matchKeySize)
   {
      return timeDb(  //
          *this,
          [&]
          {
             check(matchKeySize <= key.size(), "matchKeySize is larger than key");
             if (keyHasServicePrefix(db))
                check(matchKeySize >= sizeof(AccountNumber::value),
                      "matchKeySize is smaller than 8 bytes");
             return setResult(
                 *this, database.kvGreaterEqualRaw(getDbRead(*this, db), {key.data(), key.size()},
                                                   matchKeySize));
          });
   }

   uint32_t NativeFunctions::kvLessThan(uint32_t                    db,
                                        eosio::vm::span<const char> key,
                                        uint32_t                    matchKeySize)
   {
      return timeDb(  //
          *this,
          [&]
          {
             check(matchKeySize <= key.size(), "matchKeySize is larger than key");
             if (keyHasServicePrefix(db))
                check(matchKeySize >= sizeof(AccountNumber::value),
                      "matchKeySize is smaller than 8 bytes");
             return setResult(*this,
                              database.kvLessThanRaw(getDbRead(*this, db), {key.data(), key.size()},
                                                     matchKeySize));
          });
   }

   uint32_t NativeFunctions::kvMax(uint32_t db, eosio::vm::span<const char> key)
   {
      return timeDb(  //
          *this,
          [&]
          {
             if (keyHasServicePrefix(db))
                check(key.size() >= sizeof(AccountNumber::value), "key is shorter than 8 bytes");
             return setResult(*this,
                              database.kvMaxRaw(getDbRead(*this, db), {key.data(), key.size()}));
          });
   }

   // TODO: return an extensible struct instead of a vector.
   //       maybe include intrinsic usage so transact-sys can veto?
   uint32_t NativeFunctions::kvGetTransactionUsage()
   {
      auto seq  = transactionContext.kvResourceDeltas.extract_sequence();
      auto size = setResult(*this, psio::convert_to_frac(seq));
      transactionContext.kvResourceDeltas.adopt_sequence(boost::container::ordered_unique_range,
                                                         std::move(seq));
      return size;
   }
}  // namespace psibase
