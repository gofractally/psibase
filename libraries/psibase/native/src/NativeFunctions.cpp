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
         if (db == uint32_t(DbId::contract))
            return (DbId)db;
         if (db == uint32_t(DbId::nativeConstrained))
            return (DbId)db;
         if (db == uint32_t(DbId::nativeUnconstrained))
            return (DbId)db;
         if (db == uint32_t(DbId::subjective))
         {
            // TODO: RPC contract queries currently can read subjective data to monitor node status.
            //       However, there's a possibility this may make it easier on an active attacker.
            //       Make this capability a node configuration toggle? Allow node config to whitelist
            //       contracts for this?
            if ((self.contractAccount.flags & AccountRow::isSubjective) ||
                self.transactionContext.blockContext.isReadOnly)
               return (DbId)db;
         }
         if (db == uint32_t(DbId::writeOnly) && self.transactionContext.blockContext.isReadOnly)
            return (DbId)db;
         if (db == uint32_t(DbId::blockLog) && self.transactionContext.blockContext.isReadOnly)
            return (DbId)db;
         throw std::runtime_error("contract may not read this db, or must use another intrinsic");
      }

      DbId getDbReadSequential(NativeFunctions& self, uint32_t db)
      {
         if (self.transactionContext.blockContext.isReadOnly ||
             (self.contractAccount.flags & AccountRow::isSubjective))
         {
            if (db == uint32_t(DbId::historyEvent))
               return (DbId)db;
            if (db == uint32_t(DbId::uiEvent))
               return (DbId)db;
         }
         throw std::runtime_error("contract may not read this db, or must use another intrinsic");
      }

      bool keyHasContractPrefix(uint32_t db)
      {
         return db == uint32_t(DbId::contract) || db == uint32_t(DbId::writeOnly) ||
                db == uint32_t(DbId::subjective);
      }

      struct Writable
      {
         DbId db;
         bool readable;
      };

      Writable getDbWrite(NativeFunctions& self, uint32_t db, psio::input_stream key)
      {
         check(!self.transactionContext.blockContext.isReadOnly, "writes disabled during query");

         if (keyHasContractPrefix(db))
         {
            uint64_t prefix = self.contractAccount.num.value;
            std::reverse(reinterpret_cast<char*>(&prefix), reinterpret_cast<char*>(&prefix + 1));
            check(key.remaining() >= sizeof(prefix) && !memcmp(key.pos, &prefix, sizeof(prefix)),
                  "key prefix must match contract during write");
         };

         if (db == uint32_t(DbId::subjective) &&
             (self.contractAccount.flags & AccountRow::isSubjective))
            return {(DbId)db, true};

         // Prevent poison block; subjective contracts skip execution during replay
         check(!(self.contractAccount.flags & AccountRow::isSubjective),
               "subjective contracts may only write to DbId::subjective");

         if (db == uint32_t(DbId::contract) || db == uint32_t(DbId::writeOnly))
            return {(DbId)db, false};
         if (db == uint32_t(DbId::nativeConstrained) &&
             (self.contractAccount.flags & AccountRow::allowWriteNative))
            return {(DbId)db, true};
         if (db == uint32_t(DbId::nativeUnconstrained) &&
             (self.contractAccount.flags & AccountRow::allowWriteNative))
            return {(DbId)db, true};
         throw std::runtime_error("contract may not write this db (" + std::to_string(db) +
                                  "), or must use another intrinsic");
      }

      DbId getDbWriteSequential(NativeFunctions& self, uint32_t db)
      {
         check(!self.transactionContext.blockContext.isReadOnly, "writes disabled during query");

         // Prevent poison block; subjective contracts skip execution during replay
         check(!(self.contractAccount.flags & AccountRow::isSubjective),
               "contract may not write this db, or must use another intrinsic");

         if (db == uint32_t(DbId::historyEvent))
            return (DbId)db;
         if (db == uint32_t(DbId::uiEvent))
            return (DbId)db;
         throw std::runtime_error("contract may not write this db (" + std::to_string(db) +
                                  "), or must use another intrinsic");
      }

      void verifyWriteConstrained(psio::input_stream key, psio::input_stream value)
      {
         // Currently, code is the only table which lives in nativeConstrained
         // which is writable by contracts. The other tables aren't writable by
         // contracts.
         //
         // TODO: use a view here instead of unpacking to a rich object
         // TODO: verify fracpack; no unknown
         auto code     = psio::convert_from_frac<codeRow>(psio::input_stream(value.pos, value.end));
         auto codeHash = sha256(code.code.data(), code.code.size());
         check(code.codeHash == codeHash, "codeRow has incorrect codeHash");
         auto expected_key = psio::convert_to_key(code.key());
         check(key.remaining() == expected_key.size() &&
                   !memcmp(key.pos, expected_key.data(), key.remaining()),
               "codeRow has incorrect key");
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
      clearResult(*this);
   }

   void NativeFunctions::abortMessage(eosio::vm::span<const char> str)
   {
      throw std::runtime_error("contract '" + contractAccount.num.str() +
                               "' aborted with message: " + std::string(str.data(), str.size()));
   }

   uint64_t NativeFunctions::getBillableTime()
   {
      // A more-accurate message is "only subjective contracts may
      // call getBillableTime", but that may mislead contract developers
      // into thinking they should create a subjective contract;
      // they shouldn't.
      check(contractAccount.flags & AccountRow::isSubjective,
            "unprivileged contracts may not call getBillableTime");
      return transactionContext.getBillableTime().count();
   }

   void NativeFunctions::setMaxTransactionTime(uint64_t nanoseconds)
   {
      check(contractAccount.flags & AccountRow::canSetTimeLimit,
            "setMaxTransactionTime requires canSetTimeLimit privilege");
      if (transactionContext.blockContext.isProducing)
         transactionContext.setWatchdog(
             std::chrono::duration_cast<std::chrono::steady_clock::duration>(
                 std::chrono::nanoseconds{nanoseconds}));
   }

   uint32_t NativeFunctions::getCurrentAction()
   {
      return setResult(*this, psio::convert_to_frac(currentActContext->action));
   }

   uint32_t NativeFunctions::call(eosio::vm::span<const char> data)
   {
      // TODO: replace temporary rule
      if (++currentActContext->transactionContext.callDepth > 6)
         check(false, "call depth exceeded (temporary rule)");

      // TODO: don't unpack rawData
      // TODO: verify no extra data
      check(psio::fracvalidate<Action>(data.data(), data.end()).valid_and_known(),
            "call: invalid data format");
      auto act = psio::convert_from_frac<Action>({data.data(), data.size()});
      check(act.sender == contractAccount.num || (contractAccount.flags & AccountRow::allowSudo),
            "contract is not authorized to call as another sender");

      currentActContext->actionTrace.innerTraces.push_back({ActionTrace{}});
      auto& inner_action_trace =
          std::get<ActionTrace>(currentActContext->actionTrace.innerTraces.back().inner);
      // TODO: avoid reserialization
      currentActContext->transactionContext.execCalledAction(contractAccount.flags, act,
                                                             inner_action_trace);
      setResult(*this, inner_action_trace.rawRetval);

      --currentActContext->transactionContext.callDepth;
      return result_value.size();
   }

   void NativeFunctions::setRetval(eosio::vm::span<const char> data)
   {
      currentActContext->actionTrace.rawRetval.assign(data.begin(), data.end());
      clearResult(*this);
   }

   // TODO: restrict key size
   // TODO: restrict value size
   void NativeFunctions::kvPut(uint32_t                    db,
                               eosio::vm::span<const char> key,
                               eosio::vm::span<const char> value)
   {
      timeDbVoid(
          *this,
          [&]
          {
             if (db == uint32_t(DbId::nativeConstrained))
                verifyWriteConstrained({key.data(), key.size()}, {value.data(), value.size()});
             clearResult(*this);
             auto [m, readable] = getDbWrite(*this, db, {key.data(), key.size()});
             if (!(contractAccount.flags & AccountRow::isSubjective))
             {
                auto& delta =
                    transactionContext.kvResourceDeltas[KvResourceKey{contractAccount.num, db}];
                delta.records += 1;
                delta.keyBytes += key.size();
                delta.valueBytes += value.size();
                if (readable)
                {
                   if (auto existing = database.kvGetRaw(m, {key.data(), key.size()}))
                   {
                      delta.records -= 1;
                      delta.keyBytes -= key.size();
                      delta.valueBytes -= existing->remaining();
                   }
                }
             }
             database.kvPutRaw(m, {key.data(), key.size()}, {value.data(), value.size()});
          });
   }

   // TODO: restrict value size
   uint64_t NativeFunctions::kvPutSequential(uint32_t db, eosio::vm::span<const char> value)
   {
      return timeDb(  //
          *this,
          [&]
          {
             clearResult(*this);
             auto m = getDbWriteSequential(*this, db);

             if (!(contractAccount.flags & AccountRow::isSubjective))
             {
                auto& delta =
                    transactionContext.kvResourceDeltas[KvResourceKey{contractAccount.num, db}];
                delta.records += 1;
                delta.keyBytes += sizeof(uint64_t);
                delta.valueBytes += value.size();
             }

             psio::input_stream v{value.data(), value.size()};
             check(v.remaining() >= sizeof(AccountNumber::value),
                   "value prefix must match contract during write");
             auto contract = psio::from_bin<AccountNumber>(v);
             check(contract == contractAccount.num,
                   "value prefix must match contract during write");

             auto&    dbStatus = transactionContext.blockContext.databaseStatus;
             uint64_t indexNumber;
             if (db == uint32_t(DbId::historyEvent))
                indexNumber = dbStatus.nextHistoryEventNumber++;
             else if (db == uint32_t(DbId::uiEvent))
                indexNumber = dbStatus.nextUIEventNumber++;
             else
                check(false, "kvPutSequential: unsupported db");
             database.kvPut(DatabaseStatusRow::db, dbStatus.key(), dbStatus);

             database.kvPutRaw(m, psio::convert_to_key(indexNumber), {value.data(), value.size()});
             return indexNumber;
          });
   }  // kvPutSequential()

   void NativeFunctions::kvRemove(uint32_t db, eosio::vm::span<const char> key)
   {
      timeDbVoid(
          *this,
          [&]
          {
             clearResult(*this);
             auto [m, readable] = getDbWrite(*this, db, {key.data(), key.size()});
             if (readable && !(contractAccount.flags & AccountRow::isSubjective))
             {
                if (auto existing = database.kvGetRaw(m, {key.data(), key.size()}))
                {
                   auto& delta =
                       transactionContext.kvResourceDeltas[KvResourceKey{contractAccount.num, db}];
                   delta.records -= 1;
                   delta.keyBytes -= key.size();
                   delta.valueBytes -= existing->remaining();
                }
             }
             database.kvRemoveRaw(m, {key.data(), key.size()});
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

   uint32_t NativeFunctions::kvGetSequential(uint32_t db, uint64_t indexNumber)
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
             if (keyHasContractPrefix(db))
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
             if (keyHasContractPrefix(db))
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
             if (keyHasContractPrefix(db))
                check(key.size() >= sizeof(AccountNumber::value), "key is shorter than 8 bytes");
             return setResult(*this,
                              database.kvMaxRaw(getDbRead(*this, db), {key.data(), key.size()}));
          });
   }

   uint32_t NativeFunctions::kvGetTransactionUsage()
   {
      auto seq  = transactionContext.kvResourceDeltas.extract_sequence();
      auto size = setResult(*this, psio::convert_to_frac(seq));
      transactionContext.kvResourceDeltas.adopt_sequence(boost::container::ordered_unique_range,
                                                         std::move(seq));
      return size;
   }
}  // namespace psibase
