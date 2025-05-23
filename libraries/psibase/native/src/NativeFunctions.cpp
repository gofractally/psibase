#include <psibase/NativeFunctions.hpp>

#include <psibase/ActionContext.hpp>
#include <psibase/Socket.hpp>
#include <psibase/saturating.hpp>

#include <random>

namespace psibase
{
   namespace
   {
      inline constexpr uint16_t wasi_errno_inval = 28;

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

      bool isSubjectiveContext(NativeFunctions& self)
      {
         return (self.code.flags & CodeRow::isSubjective) || self.dbMode.isSubjective;
      }

      DbId getDbRead(NativeFunctions& self, uint32_t db, psio::input_stream key)
      {
         if (db == uint32_t(DbId::service) || db == uint32_t(DbId::native))
         {
            check(self.dbMode.isSubjective || self.dbMode.isSync,
                  "database access disabled during proof verification");
            return (DbId)db;
         }
         if (db == uint32_t(DbId::subjective) || db == uint32_t(DbId::temporary))
         {
            uint64_t prefix = self.code.codeNum.value;
            std::reverse(reinterpret_cast<char*>(&prefix), reinterpret_cast<char*>(&prefix + 1));
            check(key.remaining() >= sizeof(prefix) && !memcmp(key.pos, &prefix, sizeof(prefix)),
                  "key prefix must match service for accessing the subjective database");
            check(isSubjectiveContext(self),
                  "subjective databases cannot be read in a deterministic context");
            return (DbId)db;
         }
         if (db == uint32_t(DbId::writeOnly) || db == uint32_t(DbId::blockLog))
         {
            check(isSubjectiveContext(self),
                  "subjective databases cannot be read in a deterministic context");
            return (DbId)db;
         }
         if (db == uint32_t(DbId::nativeSubjective))
         {
            check(isSubjectiveContext(self),
                  "subjective databases cannot be read in a deterministic context");
            check(self.code.flags & CodeRow::allowNativeSubjective, "service may not read this db");
            return (DbId)db;
         }
         throw std::runtime_error("service may not read this db, or must use another intrinsic");
      }

      DbId getDbReadSequential(NativeFunctions& self, uint32_t db)
      {
         if (db == uint32_t(DbId::historyEvent) || db == uint32_t(DbId::uiEvent) ||
             db == uint32_t(DbId::merkleEvent))
         {
            check(isSubjectiveContext(self),
                  "subjective databases cannot be read in a deterministic context");
            return (DbId)db;
         }
         throw std::runtime_error("service may not read this db, or must use another intrinsic");
      }

      bool keyHasServicePrefix(uint32_t db)
      {
         return db == uint32_t(DbId::service) || db == uint32_t(DbId::writeOnly) ||
                db == uint32_t(DbId::subjective) || db == uint32_t(DbId::temporary);
      }

      struct Writable
      {
         DbId db;
         bool chargeable;
         bool refundable;
      };

      Writable getDbWrite(NativeFunctions& self, uint32_t db, psio::input_stream key)
      {
         if (keyHasServicePrefix(db))
         {
            uint64_t prefix = self.code.codeNum.value;
            std::reverse(reinterpret_cast<char*>(&prefix), reinterpret_cast<char*>(&prefix + 1));
            check(key.remaining() >= sizeof(prefix) && !memcmp(key.pos, &prefix, sizeof(prefix)),
                  "key prefix must match service during write");
         };

         if (db == uint32_t(DbId::subjective) || db == uint32_t(DbId::temporary))
         {
            check(isSubjectiveContext(self),
                  "subjective databases cannot be written in a deterministic context");
            check((self.code.flags & CodeRow::allowWriteSubjective),
                  "service may not write this db");
            return {(DbId)db, false, false};
         }

         if (db == uint32_t(DbId::nativeSubjective))
         {
            check(isSubjectiveContext(self),
                  "subjective databases cannot be written in a deterministic context");
            check((self.code.flags & CodeRow::allowNativeSubjective),
                  "service may not write this db");
            return {(DbId)db, false, false};
         }

         if (db == uint32_t(DbId::writeOnly))
         {
            check(self.dbMode.isSync, "writeOnly database cannot be written in an async context");
            check(self.transactionContext.dbMode.isSubjective ||
                      !(self.code.flags & CodeRow::isSubjective) ||
                      (self.code.flags & CodeRow::forceReplay),
                  "subjective services may only write to DbId::subjective");
            return {(DbId)db, !(self.code.flags & CodeRow::isSubjective), false};
         }

         if (db == uint32_t(DbId::service) || db == uint32_t(DbId::native))
         {
            check(!isSubjectiveContext(self), "database cannot be written in subjective context");
            check(self.dbMode.isSync, "database cannot be written in async context");

            if (db == uint32_t(DbId::native))
               check(self.code.flags & CodeRow::allowWriteNative,
                     "service may not write this database");

            return {(DbId)db, true, true};
         }
         throw std::runtime_error("service may not write this db (" + std::to_string(db) +
                                  "), or must use another intrinsic");
      }

      // Caution: All sequential databases are currently non-refundable. If this
      //          changes, then this function needs to return Writable and the
      //          functions which call it need to adjust their logic.
      DbId getDbWriteSequential(NativeFunctions& self, uint32_t db)
      {
         check(!isSubjectiveContext(self),
               "sequential database cannot be written in subjective context");
         check(self.dbMode.isSync, "sequential database cannot be written in async context");

         if (db == uint32_t(DbId::historyEvent))
            return (DbId)db;
         if (db == uint32_t(DbId::uiEvent))
            return (DbId)db;
         if (db == uint32_t(DbId::merkleEvent))
            return (DbId)db;
         throw std::runtime_error("service may not write this db (" + std::to_string(db) +
                                  "), or must use another intrinsic");
      }

      void verifyStatusRow(psio::input_stream                key,
                           psio::input_stream                value,
                           std::optional<psio::input_stream> oldValue)
      {
         check(psio::fracpack_validate_strict<StatusRow>({value.pos, value.end}),
               "StatusRow has invalid format");
         // TODO: Verify that only nextConsensus has changed
         auto expectedKey = psio::convert_to_key(statusKey());
         check(key.remaining() == expectedKey.size() &&
                   !std::memcmp(key.pos, expectedKey.data(), key.remaining()),
               "StatusRow has incorrect key");
      }

      void verifyCodeRow(TransactionContext&               ctx,
                         psio::input_stream                key,
                         psio::input_stream                value,
                         std::optional<psio::input_stream> oldValue)
      {
         check(psio::fracpack_validate_strict<CodeRow>(value), "CodeRow has invalid format");
         auto code      = psio::view<const CodeRow>(psio::prevalidated{value});
         bool oldIsAuth = false;
         if (oldValue)
         {
            auto oldCode = psio::view<const CodeRow>(psio::prevalidated{*oldValue});
            if (oldCode.flags() & CodeRow::isAuthService)
            {
               oldIsAuth = true;
            }
            //ctx.incCode(oldCode.codeHash(), oldCode.vmType(), oldCode.vmVersion(), -1);
         }
         bool isAuth = code.flags() & CodeRow::isAuthService;
         if (oldIsAuth || isAuth)
         {
            ctx.blockContext.modifiedAuthAccounts[code.codeNum()] = isAuth;
         }
         //ctx.incCode(code.codeHash(), code.vmType(), code.vmVersion(), 1);
         auto expected_key = psio::convert_to_key(codeKey(code.codeNum()));
         check(key.remaining() == expected_key.size() &&
                   !std::memcmp(key.pos, expected_key.data(), key.remaining()),
               "CodeRow has incorrect key");
      }

      void verifyRemoveCodeRow(TransactionContext& ctx,
                               psio::input_stream  key,
                               psio::input_stream  value)
      {
         auto code = psio::view<const CodeRow>(psio::prevalidated{value});
         if (code.flags() & CodeRow::isAuthService)
         {
            ctx.blockContext.modifiedAuthAccounts[code.codeNum()] = false;
         }
         //ctx.incCode(code.codeHash(), code.vmType(), code.vmVersion(), -1);
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

      void verifyNotifyTableRow(psio::input_stream key, psio::input_stream value)
      {
         // The notifyTable is only processed subjectively
      }

      void verifySubjectiveNotifyTableRow(Database&          db,
                                          psio::input_stream key,
                                          psio::input_stream value)
      {
         // The notifyTable is only processed subjectively
         if (psio::fracpack_validate<NotifyRow>({value.pos, value.end}))
         {
            auto row =
                psio::view<const NotifyRow>(psio::prevalidated{std::span{value.pos, value.end}});
            if (row.type() == NotifyType::nextTransaction)
            {
               db.setCallbackFlags(DatabaseCallbacks::nextTransactionFlag);
            }
         }
      }

      void verifySubjectiveRunTableRow(Database&          db,
                                       psio::input_stream key,
                                       psio::input_stream value)
      {
         // The runTable is only processed subjectively
         if (psio::fracpack_validate<RunRow>({value.pos, value.end}))
         {
            auto row =
                psio::view<const NotifyRow>(psio::prevalidated{std::span{value.pos, value.end}});
            db.setCallbackFlags(DatabaseCallbacks::runQueueFlag);
         }
      }

      void verifyScheduledSnapshotRow(psio::input_stream key, psio::input_stream value)
      {
         check(psio::fracpack_validate_strict<ScheduledSnapshotRow>({value.pos, value.end}),
               "ScheduledSnapshotRow has invalid format");
         auto row = psio::from_frac<ScheduledSnapshotRow>(
             psio::prevalidated{std::span{value.pos, value.end}});
         auto expected_key = psio::convert_to_key(row.key());
         check(key.remaining() == expected_key.size() &&
                   !memcmp(key.pos, expected_key.data(), key.remaining()),
               "ScheduledSnapshotRow has incorrect key");
      }

      void verifyWriteConstrained(TransactionContext&               context,
                                  psio::input_stream                key,
                                  psio::input_stream                value,
                                  std::optional<psio::input_stream> existing)
      {
         NativeTableNum table;
         check(key.remaining() >= sizeof(table), "Unrecognized key in nativeConstrained");
         memcpy(&table, key.pos, sizeof(table));
         std::reverse((char*)&table, (char*)(&table + 1));
         if (table == statusTable)
            verifyStatusRow(key, value, existing);
         else if (table == codeTable)
            verifyCodeRow(context, key, value, existing);
         else if (table == codeByHashTable)
            verifyCodeByHashRow(key, value);
         else if (table == configTable)
            verifyConfigRow(key, value);
         else if (table == transactionWasmConfigTable || table == proofWasmConfigTable)
            verifyWasmConfigRow(table, key, value);
         else if (table == notifyTable)
            verifyNotifyTableRow(key, value);
         else if (table == scheduledSnapshotTable)
            verifyScheduledSnapshotRow(key, value);
         else
            throw std::runtime_error("Unrecognized key in nativeConstrained");
      }

      void verifyWriteSubjective(Database& db, psio::input_stream key, psio::input_stream value)
      {
         NativeTableNum table;
         check(key.remaining() >= sizeof(table), "Unrecognized key in nativeSubjective");
         memcpy(&table, key.pos, sizeof(table));
         std::reverse((char*)&table, (char*)(&table + 1));
         if (table == notifyTable)
            verifySubjectiveNotifyTableRow(db, key, value);
         else if (table == runTable)
            verifySubjectiveRunTableRow(db, key, value);
         else
            throw std::runtime_error("Unrecognized key in nativeSubjective");
      }

      void verifyRemoveConstrained(TransactionContext& context,
                                   psio::input_stream  key,
                                   psio::input_stream  value)
      {
         NativeTableNum table;
         check(key.remaining() >= sizeof(table), "Unrecognized key in nativeConstrained");
         memcpy(&table, key.pos, sizeof(table));
         std::reverse((char*)&table, (char*)(&table + 1));
         if (table == codeTable)
            verifyRemoveCodeRow(context, key, value);
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

      KvResourceDelta& getDelta(KvResourceMap& deltas, const KvResourceKey& key)
      {
         auto pos = std::ranges::lower_bound(deltas, key, {}, &KvResourcePair::first);
         if (pos == deltas.end())
         {
            pos = deltas.insert(pos, KvResourcePair{key, {}});
         }
         return pos->second;
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

   int32_t NativeFunctions::clockTimeGet(uint32_t id, eosio::vm::argument_proxy<uint64_t*> time)
   {
      check(isSubjectiveContext(*this), "clockGetTime cannot be called in a deterministic context");
      clearResult(*this);
      std::chrono::nanoseconds result;
      if (id == 0)
      {  // CLOCK_REALTIME
         result = std::chrono::system_clock::now().time_since_epoch();
      }
      else if (id == 1)
      {  // CLOCK_MONOTONIC
         result = std::chrono::steady_clock::now().time_since_epoch();
      }
      else if (id == 2 || id == 3)
      {  // CLOCK_PROCESS_CPUTIME_ID or CLOCK_THREAD_CPUTIME_ID
         result = transactionContext.getBillableTime();
      }
      else
      {
         return wasi_errno_inval;
      }
      *time = result.count();
      return 0;
   }

   void NativeFunctions::getRandom(eosio::vm::span<char> dest)
   {
      check(isSubjectiveContext(*this), "getRandom cannot be called in a deterministic context");
      std::random_device rng;
      std::ranges::generate(dest, [&] { return rng(); });
   }

   void NativeFunctions::setMaxTransactionTime(uint64_t nanoseconds)
   {
      check(code.flags & CodeRow::canSetTimeLimit,
            "setMaxTransactionTime requires canSetTimeLimit privilege");
      clearResult(*this);
      // Ensure no overflow by capping the value. The exact value is not visible to
      // wasm and does not affect consensus and there's no way a transaction can
      // run for 300 years.
      if (transactionContext.blockContext.isProducing)
         transactionContext.setWatchdog(saturatingCast<CpuClock::duration>(
             std::chrono::duration<std::uint64_t, std::nano>(nanoseconds)));
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
      auto saved          = currentActContext->transactionContext.remainingStack;
      auto remainingStack = currentExecContext->remainingStack();
      check(remainingStack >= VMOptions::stack_usage_for_call, "stack overflow");
      remainingStack -= VMOptions::stack_usage_for_call;
      currentActContext->transactionContext.remainingStack = remainingStack;

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

      currentActContext->transactionContext.remainingStack = saved;
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
             clearResult(*this);
             auto w = getDbWrite(*this, db, {key.data(), key.size()});
             if (w.chargeable)
             {
                auto& delta =
                    getDelta(transactionContext.kvResourceDeltas, KvResourceKey{code.codeNum, db});
                delta.records += 1;
                delta.keyBytes += key.size();
                delta.valueBytes += value.size();
                if (w.refundable)
                {
                   auto existing = database.kvGetRaw(w.db, {key.data(), key.size()});
                   if (existing)
                   {
                      delta.records -= 1;
                      delta.keyBytes -= key.size();
                      delta.valueBytes -= existing->remaining();
                   }
                   // nativeConstrained is both refundable and chargeable
                   if (db == uint32_t(DbId::native))
                   {
                      verifyWriteConstrained(transactionContext, {key.data(), key.size()},
                                             {value.data(), value.size()}, existing);
                   }
                }
             }
             else if (db == uint32_t(DbId::nativeSubjective))
             {
                verifyWriteSubjective(database, {key.data(), key.size()},
                                      {value.data(), value.size()});
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

             std::span<const char>     v{value.data(), value.size()};
             std::tuple<AccountNumber> service;
             if (!psio::from_frac(service, v) || std::get<0>(service) != code.codeNum)
             {
                check(false,
                      "value of putSequential must have service account as its first member");
             }

             auto dbStatus =
                 database.kvGet<DatabaseStatusRow>(DatabaseStatusRow::db, databaseStatusKey());
             check(!!dbStatus, "databaseStatus not set");

             uint64_t indexNumber;
             if (db == uint32_t(DbId::historyEvent))
                indexNumber = dbStatus->nextHistoryEventNumber++;
             else if (db == uint32_t(DbId::uiEvent))
                indexNumber = dbStatus->nextUIEventNumber++;
             else if (db == uint32_t(DbId::merkleEvent))
                indexNumber = dbStatus->nextMerkleEventNumber++;
             else
                check(false, "putSequential: unsupported db");
             database.kvPut(DatabaseStatusRow::db, dbStatus->key(), *dbStatus);

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
                          auto& delta = getDelta(transactionContext.kvResourceDeltas,
                                                 KvResourceKey{code.codeNum, db});
                          delta.records -= 1;
                          delta.keyBytes -= key.size();
                          delta.valueBytes -= existing->remaining();
                          if (db == uint32_t(DbId::native))
                          {
                             verifyRemoveConstrained(transactionContext, {key.data(), key.size()},
                                                     *existing);
                          }
                       }
                    }
                    database.kvRemoveRaw(w.db, {key.data(), key.size()});
                 });
   }

   uint32_t NativeFunctions::kvGet(uint32_t db, eosio::vm::span<const char> key)
   {
      return timeDb(  //
          *this,
          [&]
          {
             return setResult(*this,
                              database.kvGetRaw(getDbRead(*this, db, {key.data(), key.size()}),
                                                {key.data(), key.size()}));
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
                 *this, database.kvGreaterEqualRaw(getDbRead(*this, db, {key.data(), key.size()}),
                                                   {key.data(), key.size()}, matchKeySize));
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
                              database.kvLessThanRaw(getDbRead(*this, db, {key.data(), key.size()}),
                                                     {key.data(), key.size()}, matchKeySize));
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
                              database.kvMaxRaw(getDbRead(*this, db, {key.data(), key.size()}),
                                                {key.data(), key.size()}));
          });
   }

   // TODO: return an extensible struct instead of a vector.
   //       maybe include intrinsic usage so transact can veto?
   uint32_t NativeFunctions::kvGetTransactionUsage()
   {
      auto size = setResult(*this, psio::convert_to_frac(transactionContext.kvResourceDeltas));
      return size;
   }

   void NativeFunctions::checkoutSubjective()
   {
      database.checkoutSubjective();
   }
   bool NativeFunctions::commitSubjective()
   {
      return database.commitSubjective(*transactionContext.blockContext.systemContext.sockets,
                                       transactionContext.ownedSockets);
   }
   void NativeFunctions::abortSubjective()
   {
      database.abortSubjective();
   }

   int32_t NativeFunctions::socketSend(int32_t fd, eosio::vm::span<const char> msg)
   {
      check(isSubjectiveContext(*this), "Sockets are only available during subjective execution");
      check(code.flags & CodeRow::allowSocket, "Service is not allowed to write to socket");
      check(!dbMode.isReadOnly, "Sockets disabled during proof verification or first auth");
      return transactionContext.blockContext.systemContext.sockets->send(
          *transactionContext.blockContext.writer, fd, msg);
   }

   int32_t NativeFunctions::socketAutoClose(int32_t fd, bool value)
   {
      check(isSubjectiveContext(*this), "Sockets are only available during subjective execution");
      check(code.flags & CodeRow::allowSocket, "Service is not allowed to write to socket");
      check(!dbMode.isReadOnly, "Sockets disabled during proof verification or first auth");
      return database.socketAutoClose(fd, value,
                                      *transactionContext.blockContext.systemContext.sockets,
                                      transactionContext.ownedSockets);
   }

}  // namespace psibase
