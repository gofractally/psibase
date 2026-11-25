#include <psibase/NativeFunctions.hpp>

#include <psibase/ActionContext.hpp>
#include <psibase/Mount.hpp>
#include <psibase/PsizamPolicy.hpp>
#include <psibase/Rpc.hpp>
#include <psibase/Socket.hpp>
#include <psibase/UsageMeter.hpp>
#include <psibase/saturating.hpp>
#include <psibase/serviceEntry.hpp>
#include <psibase/finally.hpp>
#include <psio/to_hex.hpp>

#include <sys/stat.h>
#include <unistd.h>
#include <random>

namespace psibase
{
   namespace
   {
      inline constexpr uint16_t wasi_errno_inval = 28;
      inline constexpr uint16_t wasi_errno_nosys = 52;

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
         return self.dbMode.isSubjective;
      }

      bool keyHasServicePrefix(DbId db)
      {
         return db == DbId::service || db == DbId::writeOnly || db == DbId::subjective ||
                db == DbId::session || db == DbId::temporary;
      }

      struct Writable
      {
         bool chargeable;
         bool refundable;
      };

      Writable getDbWrite(NativeFunctions& self, DbId db, std::span<const char> key)
      {
         if (db == DbId::subjective || db == DbId::session || db == DbId::temporary ||
             db == DbId::nativeSubjective || db == DbId::nativeSession)
         {
            return {false, false};
         }

         if (db == DbId::writeOnly)
         {
            return {!isSubjectiveContext(self), false};
         }

         if (db == DbId::service || db == DbId::native)
         {
            return {true, true};
         }
         throw std::runtime_error("service may not write this db (" +
                                  std::to_string(static_cast<std::uint32_t>(db)) +
                                  "), or must use another intrinsic");
      }

      void verifyStatusRow(std::span<const char>                key,
                           std::span<const char>                value,
                           std::optional<std::span<const char>> oldValue)
      {
         check(psio::validate_strict<StatusRow>(psio::pssz{}, value).ok(),
               "StatusRow has invalid format");
         // TODO: Verify that only nextConsensus has changed
         auto expectedKey = psio::to_key(statusKey());
         check(key.size() == expectedKey.size() &&
                   !std::memcmp(key.data(), expectedKey.data(), key.size()),
               "StatusRow has incorrect key");
      }

      void verifyCodeRow(TransactionContext&               ctx,
                         std::span<const char>                key,
                         std::span<const char>                value,
                         std::optional<std::span<const char>> oldValue)
      {
         check(psio::validate_strict<CodeRow>(psio::pssz{}, value).ok(), "CodeRow has invalid format");
         auto code      = psio::pssz_view<CodeRow>(value);
         bool oldIsAuth = false;
         if (oldValue)
         {
            auto oldCode = psio::pssz_view<CodeRow>(*oldValue);
            if (oldCode.flags() & CodeRow::isVerify)
            {
               oldIsAuth = true;
            }
            //ctx.incCode(oldCode.codeHash(), oldCode.vmType(), oldCode.vmVersion(), -1);
         }
         bool isAuth = code.flags() & CodeRow::isVerify;
         if (oldIsAuth || isAuth)
         {
            ctx.blockContext.modifiedAuthAccounts.insert(code.codeNum());
         }
         //ctx.incCode(code.codeHash(), code.vmType(), code.vmVersion(), 1);
         auto expected_key = psio::to_key(codeKey(code.codeNum()));
         check(key.size() == expected_key.size() &&
                   !std::memcmp(key.data(), expected_key.data(), key.size()),
               "CodeRow has incorrect key");
      }

      void verifyRemoveCodeRow(TransactionContext& ctx,
                               std::span<const char>  key,
                               std::span<const char>  value)
      {
         auto code = psio::pssz_view<CodeRow>(value);
         if (code.flags() & CodeRow::isVerify)
         {
            ctx.blockContext.modifiedAuthAccounts.insert(code.codeNum());
         }
         //ctx.incCode(code.codeHash(), code.vmType(), code.vmVersion(), -1);
      }

      void verifyCodeByHashRow(std::span<const char> key, std::span<const char> value)
      {
         check(psio::validate_strict<CodeByHashRow>(psio::pssz{}, value).ok(),
               "CodeByHashRow has invalid format");
         // TODO: use a view here instead of unpacking to a rich object
         auto code =
             psio::from_pssz<CodeByHashRow>(psio::trusted{value});
         auto codeHash = sha256(code.code.data(), code.code.size());
         check(code.codeHash == codeHash, "CodeByHashRow has incorrect codeHash");
         auto expected_key = psio::to_key(code.key());
         check(key.size() == expected_key.size() &&
                   !memcmp(key.data(), expected_key.data(), key.size()),
               "CodeByHashRow has incorrect key");
      }

      // A code row is being written: service code must pass the chain's
      // admission rule now, or the write (and the transaction) fails. See
      // TransactionContext::admitCode.
      void admitStoredCode(TransactionContext&   context,
                           std::span<const char> key,
                           std::span<const char> value)
      {
         NativeTableNum table;
         if (key.size() < sizeof(table))
            return;
         memcpy(&table, key.data(), sizeof(table));
         std::reverse((char*)&table, (char*)(&table + 1));
         if (table != codeByHashTable)
            return;
         auto code = psio::pssz_view<CodeByHashRow>(
             value);
         if (code.vmType() != 0)
            return;
         std::span<const char> bytes = psio::bytes(code.code());
         // The caller counts this write as database time. What admitCode
         // does unbilled (compiling) is no more database time than it is
         // billed time.
         const auto billed = context.getBillableTime();
         const auto start  = std::chrono::steady_clock::now();
         context.admitCode(code.codeHash(), {bytes.data(), bytes.size()}, code.vmVersion());
         context.databaseTime -= (std::chrono::steady_clock::now() - start) -
                                 (context.getBillableTime() - billed);
      }

      void verifyRemoveCodeByHashRow(TransactionContext& ctx,
                                     std::span<const char>  key,
                                     std::span<const char>  value)
      {
         auto code = psio::pssz_view<CodeByHashRow>(value);
         ctx.blockContext.removedCode.insert(
             codeByHashKey(code.codeHash(), code.vmType(), code.vmVersion()));
      }

      void verifyConfigRow(std::span<const char> key, std::span<const char> value)
      {
         check(psio::validate_strict<ConfigRow>(psio::pssz{}, value).ok(),
               "ConfigRow has invalid format");
         auto row = psio::from_pssz<ConfigRow>(psio::trusted{value});
         auto expected_key = psio::to_key(row.key());
         check(key.size() == expected_key.size() &&
                   !memcmp(key.data(), expected_key.data(), key.size()),
               "ConfigRow has incorrect key");

         // Both of these are on the conservative side for the storage engine. The actual
         // max values are odd.
         check(row.maxKeySize <= 128, "maxKeySize too big for the storage engine");
         check(row.maxValueSize <= (15 << 20), "maxValueSize too big for the storage engine");
         // A block is sent to peers as one message, which they refuse above
         // 16 MiB; a block may run over maxBlockSize by its subjective data
         // and header.
         check(row.maxBlockSize >= 1024, "maxBlockSize too small to make progress");
         check(row.maxBlockSize <= (8 << 20), "maxBlockSize too big to send to peers");
      }

      void verifyWasmConfigRow(NativeTableNum     table,
                               std::span<const char> key,
                               std::span<const char> value)
      {
         check(psio::validate_strict<WasmConfigRow>(psio::pssz{}, value).ok(),
               "WasmConfigRow has invalid format");
         auto row =
             psio::from_pssz<WasmConfigRow>(psio::trusted{value});
         auto expected_key = psio::to_key(row.key(table));
         check(key.size() == expected_key.size() &&
                   !memcmp(key.data(), expected_key.data(), key.size()),
               "WasmConfigRow has incorrect key");
         // Reject an unusable execution policy while the privileged write can
         // still fail, rather than accepting a row that prevents its repair.
         // No member above the lowest absolute limit of any supported
         // engine (vmOptionCeilings): above it, nodes on different engines
         // would not accept the same code.
         checkVMOptionCeilings(row.vmOptions);
         static_cast<void>(NativeVMOptions{row.vmOptions});
      }

      void verifyNotifyTableRow(std::span<const char> key, std::span<const char> value)
      {
         // The notifyTable is only processed subjectively
      }

      void verifySubjectiveNotifyTableRow(Database&          db,
                                          std::span<const char> key,
                                          std::span<const char> value)
      {
         // The notifyTable is only processed subjectively
         if (psio::validate_pssz<NotifyRow>(value).ok())
         {
            auto row =
                psio::pssz_view<NotifyRow>(value);
            if (row.type() == NotifyType::nextTransaction)
            {
               db.setCallbackFlags(DatabaseCallbacks::nextTransactionFlag);
            }
         }
      }

      void verifySubjectiveCodeRow(std::span<const char> key, std::span<const char> value)
      {
         check(psio::validate_strict<CodeRow>(psio::pssz{}, value).ok(), "CodeRow has invalid format");
         auto code         = psio::pssz_view<CodeRow>(value);
         auto expected_key = psio::to_key(codeKey(code.codeNum()));
         check(key.size() == expected_key.size() &&
                   !std::memcmp(key.data(), expected_key.data(), key.size()),
               "CodeRow has incorrect key");
      }

      void verifySubjectiveRunTableRow(Database&          db,
                                       std::span<const char> key,
                                       std::span<const char> value)
      {
         // The runTable is only processed subjectively
         if (psio::validate_pssz<RunRow>(value).ok())
         {
            auto row =
                psio::pssz_view<NotifyRow>(value);
            db.setCallbackFlags(DatabaseCallbacks::runQueueFlag);
         }
      }

      // Usage metering (gofractally/psibase#2270): the identity whose
      // request, message or run is executing is remembered as the origin of
      // a run it posts, in memory, keyed by the run's id, until the row is
      // removed. Nothing is written for it. The write may belong to a
      // subjective transaction that is retried or abandoned; remembering
      // an origin for a run that never exists costs one map entry.
      std::optional<std::uint64_t> runIdOfKey(std::span<const char> key)
      {
         static const auto prefix = psio::to_key(runPrefix());
         if (key.size() != prefix.size() + 8 ||
             std::memcmp(key.data(), prefix.data(), prefix.size()) != 0)
            return {};
         std::uint64_t id = 0;
         for (std::size_t i = 0; i < 8; ++i)
            id = (id << 8) | static_cast<unsigned char>(key[prefix.size() + i]);
         return id;
      }

      void noteRunPosted(TransactionContext& tc, std::span<const char> key)
      {
         auto& bc    = tc.blockContext;
         auto  meter = bc.systemContext.usage.get();
         if (!meter || !meter->enabled())
            return;
         if (auto id = runIdOfKey(key))
            meter->setRunOrigin(*id, bc.usage ? bc.usage : meter->node());
      }

      void noteRunRemoved(TransactionContext& tc, std::span<const char> key)
      {
         auto meter = tc.blockContext.systemContext.usage.get();
         if (!meter || !meter->enabled())
            return;
         if (auto id = runIdOfKey(key))
            meter->clearRunOrigin(*id);
      }

      void verifyScheduledSnapshotRow(std::span<const char> key, std::span<const char> value)
      {
         check(psio::validate_strict<ScheduledSnapshotRow>(psio::pssz{}, value).ok(),
               "ScheduledSnapshotRow has invalid format");
         auto row = psio::from_pssz<ScheduledSnapshotRow>(
             psio::trusted{value});
         auto expected_key = psio::to_key(row.key());
         check(key.size() == expected_key.size() &&
                   !memcmp(key.data(), expected_key.data(), key.size()),
               "ScheduledSnapshotRow has incorrect key");
      }

      void verifySocketRow(TransactionContext& tc, std::span<const char> key, std::span<const char> value)
      {
         auto existing = tc.blockContext.db.kvGetRaw(DbId::nativeSession, key);
         if (!existing)
            abortMessage("Cannot write a new socket");
         auto old = psio::pssz_view<SocketRow>(
             std::span<const char>{*existing});
         check(psio::validate_strict<SocketRow>(psio::pssz{}, value).ok(),
               "SocketRow has invalid format");
         auto row =
             psio::pssz_view<SocketRow>(value);
         if (old.fd() != row.fd())
            abortMessage("SocketRow has incorrect key");

         if (auto oldInfo = get_if<WebSocketInfo>(old.info()))
         {
            if (auto newInfo = get_if<P2PSocketInfo>(row.info()))
            {
               if (oldInfo->endpoint() == newInfo->endpoint() && oldInfo->tls() == newInfo->tls())
               {
                  auto err = tc.blockContext.db.socketEnableP2P(
                      row.fd(), *tc.blockContext.systemContext.sockets, tc.ownedSockets);
                  if (err != 0)
                     abortMessage("Socket cannot enable P2P: " + std::to_string(err));
                  return;
               }
            }
         }
         if (old.info() != row.info())
         {
            abortMessage("Invalid update to SocketRow");
         }
      }

      void verifyEnvRow(std::span<const char> key, std::span<const char> value)
      {
         // Native doesn't do anything with the env table.
      }

      void verifyHostConfigRow(TransactionContext& context,
                               std::span<const char>  key,
                               std::span<const char>  value)
      {
         check(psio::validate_pssz<HostConfigRow>(value).ok(),
               "HostConfigRow has invalid format");
         auto expected_key = psio::to_key(hostConfigKey());
         check(key.size() == expected_key.size() &&
                   !memcmp(key.data(), expected_key.data(), key.size()),
               "HostConfigRow has incorrect key");
         if (auto* callbacks = context.blockContext.systemContext.sharedDatabase.getCallbacks())
         {
            if (callbacks->validateHostConfig)
            {
               callbacks->validateHostConfig(value);
            }
         }
         context.blockContext.db.setCallbackFlags(DatabaseCallbacks::hostConfigFlag);
      }

      void verifyPendingShutdownRow(TransactionContext& context,
                                    std::span<const char>  key,
                                    std::span<const char>  value)
      {
         check(psio::validate_pssz<PendingShutdownRow>(value).ok(),
               "PendingShutdownRow has invalid format");
         auto expected_key = psio::to_key(pendingShutdownKey());
         check(key.size() == expected_key.size() &&
                   !memcmp(key.data(), expected_key.data(), key.size()),
               "PendingShutdownRow has incorrect key");
         context.blockContext.db.setCallbackFlags(DatabaseCallbacks::shutdownFlag);
      }

      void verifyTimerRow(Database& db, std::span<const char> key, std::span<const char> value)
      {
         if (psio::validate_pssz<TimerRow>(value).ok())
         {
            db.setCallbackFlags(DatabaseCallbacks::runQueueFlag);
         }
      }

      void verifyWriteConstrained(TransactionContext&               context,
                                  std::span<const char>                key,
                                  std::span<const char>                value,
                                  std::optional<std::span<const char>> existing)
      {
         NativeTableNum table;
         check(key.size() >= sizeof(table), "Unrecognized key in nativeConstrained");
         memcpy(&table, key.data(), sizeof(table));
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

      void verifyWriteSubjective(Database& db, std::span<const char> key, std::span<const char> value)
      {
         NativeTableNum table;
         check(key.size() >= sizeof(table), "Unrecognized key in nativeSubjective");
         memcpy(&table, key.data(), sizeof(table));
         std::reverse((char*)&table, (char*)(&table + 1));
         if (table == notifyTable)
            verifySubjectiveNotifyTableRow(db, key, value);
         else if (table == codeTable)
            verifySubjectiveCodeRow(key, value);
         else if (table == codeByHashTable)
            verifyCodeByHashRow(key, value);
         else if (table == runTable)
            verifySubjectiveRunTableRow(db, key, value);
         else
            throw std::runtime_error("Unrecognized key in nativeSubjective");
      }

      // Usage metering (gofractally/psibase#2270): SocketIdentityRow is a
      // message, not a row. A local service (x-http) writes it once it has
      // verified the login token of the request on socket `fd`; from then
      // on that request is charged to the account instead of the client's
      // address: its socket (the request's counts, the reply, a websocket
      // it becomes) and, if this context is serving that request, the runs
      // it posts. Nothing is stored.
      void applySocketIdentity(TransactionContext& tc,
                               std::span<const char> key,
                               std::span<const char> value)
      {
         check(psio::validate_strict<SocketIdentityRow>(psio::pssz{}, value).ok(),
               "SocketIdentityRow has invalid format");
         auto row      = psio::from_pssz<SocketIdentityRow>(psio::trusted{value});
         auto expected = psio::to_key(row.key());
         check(key.size() == expected.size() &&
                   !std::memcmp(key.data(), expected.data(), key.size()),
               "SocketIdentityRow has incorrect key");
         auto& bc    = tc.blockContext;
         auto  meter = bc.systemContext.usage.get();
         if (!meter || !meter->enabled())
            return;
         auto identity = UsageIdentity::account(row.account);
         check(isValid(identity), "SocketIdentityRow does not name an account");
         auto socket = bc.systemContext.sockets->get(row.fd);
         if (!socket)
            return;
         auto previous = socket->usage();
         auto record   = meter->find(identity);
         socket->setUsage(record);
         // Only the context that serves this socket's request changes with it
         if (bc.usage && bc.usage == previous)
            bc.usage = record;
      }

      // Returns false if the write was consumed and must not be stored.
      bool verifyWriteSession(TransactionContext& context,
                              std::span<const char>  key,
                              std::span<const char>  value)
      {
         NativeTableNum table;
         check(key.size() >= sizeof(table), "Unrecognized key in nativeSession");
         memcpy(&table, key.data(), sizeof(table));
         std::reverse((char*)&table, (char*)(&table + 1));
         if (table == socketTable)
            verifySocketRow(context, key, value);
         else if (table == envTable)
            verifyEnvRow(key, value);
         else if (table == hostConfigTable)
            verifyHostConfigRow(context, key, value);
         else if (table == pendingShutdownTable)
            verifyPendingShutdownRow(context, key, value);
         else if (table == timerTable)
            verifyTimerRow(context.blockContext.db, key, value);
         else if (table == socketIdentityTable)
         {
            applySocketIdentity(context, key, value);
            return false;
         }
         else
            throw std::runtime_error("Unrecognized key in nativeSession");
         return true;
      }

      void verifyRemoveConstrained(TransactionContext& context,
                                   std::span<const char>  key,
                                   std::span<const char>  value)
      {
         NativeTableNum table;
         check(key.size() >= sizeof(table), "Unrecognized key in nativeConstrained");
         memcpy(&table, key.data(), sizeof(table));
         std::reverse((char*)&table, (char*)(&table + 1));
         if (table == codeTable)
            verifyRemoveCodeRow(context, key, value);
         else if (table == codeByHashTable)
            verifyRemoveCodeByHashRow(context, key, value);
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

      uint32_t setResult(NativeFunctions& self, const std::optional<std::span<const char>>& o)
      {
         if (!o)
            return clearResult(self);
         self.result_key.clear();
         self.result_value.assign(o->begin(), o->end());
         return self.result_value.size();
      }

      uint32_t setResult(NativeFunctions& self, const std::optional<Database::KVResult>& o)
      {
         if (!o)
            return clearResult(self);
         self.result_key.assign(o->key.begin(), o->key.end());
         self.result_value.assign(o->value.begin(), o->value.end());
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

      void notifyKvMut(NativeFunctions& self,
                       DbId             db,
                       std::uint32_t    keyLen,
                       std::uint32_t    oldValueLen,
                       std::uint32_t    newValueLen)
      {
         auto& transactionStack = self.currentActContext->transactionContext.remainingStack;
         auto  saved            = transactionStack;
         auto  restoreStack     = psibase::finally{[&] { transactionStack = saved; }};
         auto remainingStack = self.currentExecContext->remainingStack();
         check(remainingStack >= VMOptions::stack_usage_for_call, "stack overflow");
         remainingStack -= VMOptions::stack_usage_for_call;
         self.currentActContext->transactionContext.remainingStack = remainingStack;

         Action act{
             .service = transactionServiceNum,
             .method  = MethodNumber{"kvNotify"},
             .rawData =
                 psio::to_pssz(std::tuple(self.code.codeNum, db, keyLen, oldValueLen, newValueLen)),
         };

         auto flags       = CallFlags::none;
         auto callerFlags = self.code.flags;

         auto savedImported = std::move(self.transactionContext.importedHandles);
         auto savedExported = std::move(self.transactionContext.exportedHandles);
         auto _ =
             psibase::finally{[&]
                           {
                              self.transactionContext.importedHandles = std::move(savedImported);
                              self.transactionContext.exportedHandles = std::move(savedExported);
                           }};

         self.currentActContext->actionTrace.innerTraces.push_back({ActionTrace{}});
         auto& inner_action_trace =
             std::get<ActionTrace>(self.currentActContext->actionTrace.innerTraces.back().inner);
         self.currentActContext->transactionContext.execCalledAction(callerFlags, act,
                                                                     inner_action_trace, flags);
      }
   }  // namespace

   uint32_t NativeFunctions::getResult(std::span<char> dest, uint32_t offset)
   {
      if (offset < result_value.size() && dest.size())
         memcpy(dest.data(), result_value.data() + offset,
                std::min(result_value.size() - offset, dest.size()));
      return result_value.size();
   }

   uint32_t NativeFunctions::getKey(std::span<char> dest)
   {
      if (!result_key.empty())
         memcpy(dest.data(), result_key.data(), std::min(result_key.size(), dest.size()));
      return result_key.size();
   }

   void NativeFunctions::writeConsole(std::span<const char> str)
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

   void NativeFunctions::abortMessage(std::span<const char> str)
   {
      throw std::runtime_error("service '" + code.codeNum.str() +
                               "' aborted with message: " + std::string(str.data(), str.size()));
   }

   int32_t NativeFunctions::clockTimeGet(uint32_t                                  id,
                                         psizam::detail::argument_proxy<uint64_t*> time)
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

   void NativeFunctions::getRandom(std::span<char> dest)
   {
      check(isSubjectiveContext(*this), "getRandom cannot be called in a deterministic context");
      std::random_device rng;
      std::ranges::generate(dest, [&] { return rng(); });
   }

   void NativeFunctions::setMaxCpuTime(uint64_t nanoseconds)
   {
      check(code.flags & CodeRow::isPrivileged, "setMaxCpuTime requires privileges");
      clearResult(*this);
      // Ensure no overflow by capping the value. The exact value is not visible to
      // wasm and does not affect consensus and there's no way a transaction can
      // run for 300 years.
      if (transactionContext.blockContext.isProducing)
         transactionContext.setWatchdog(saturatingCast<RunClock::duration>(
             std::chrono::duration<std::uint64_t, std::nano>(nanoseconds)));
   }

   uint32_t NativeFunctions::getCurrentAction()
   {
      return setResult(*this, psio::to_pssz(currentActContext->action));
   }

   uint32_t NativeFunctions::call(std::span<const char> data, std::uint64_t flagsRaw)
   {
      auto& transactionStack = currentActContext->transactionContext.remainingStack;
      auto  saved            = transactionStack;
      auto  restoreStack     = psibase::finally{[&] { transactionStack = saved; }};
      auto remainingStack = currentExecContext->remainingStack();
      check(remainingStack >= VMOptions::stack_usage_for_call, "stack overflow");
      remainingStack -= VMOptions::stack_usage_for_call;
      currentActContext->transactionContext.remainingStack = remainingStack;

      // TODO: don't unpack rawData
      check(psio::validate_strict<Action>(psio::pssz{}, data).ok(), "call: invalid data format");
      auto flags = static_cast<CallFlags>(flagsRaw);
      if (flags == CallFlags::runModeRpc || flags == CallFlags::runModeCallback)
      {
         check(dbMode.isSync && !dbMode.isSubjective, "Can only change run mode in a transaction");
      }
      else if (flags != CallFlags::none)
      {
         abortMessage("Invalid call flags: " + std::to_string(flagsRaw));
      }
      auto act         = psio::from_pssz<Action>(psio::trusted{data});
      auto callerFlags = code.flags;
      if (act.sender != code.codeNum)
      {
         check((code.flags & CodeRow::isPrivileged) != 0,
               "service is not authorized to call as another sender");
         callerFlags |= ExecutionContext::callerSudo;
      }

      currentActContext->actionTrace.innerTraces.push_back({ActionTrace{}});
      auto& inner_action_trace =
          std::get<ActionTrace>(currentActContext->actionTrace.innerTraces.back().inner);
      // TODO: avoid reserialization
      currentActContext->transactionContext.execCalledAction(callerFlags, act, inner_action_trace,
                                                             flags);
      setResult(*this, inner_action_trace.rawRetval);

      return result_value.size();
   }

   void NativeFunctions::setRetval(std::span<const char> data)
   {
      currentActContext->actionTrace.rawRetval.assign(data.begin(), data.end());
      clearResult(*this);
   }

   uint32_t NativeFunctions::kvOpen(uint32_t dbRaw, std::span<const char> prefix, uint32_t mode)
   {
      check(prefix.size() <= transactionContext.config.maxKeySize, "key is too big");

      auto db = static_cast<DbId>(dbRaw);

      bool isRead  = false;
      bool isWrite = false;
      switch (mode)
      {
         case uint32_t(KvMode::read):
            isRead = true;
            break;
         case uint32_t(KvMode::write):
            isWrite = true;
            break;
         case uint32_t(KvMode::readWrite):
            isRead  = true;
            isWrite = true;
            break;
         default:
            abortMessage("invalid mode");
      }

      if (!(code.flags & CodeRow::isPrivileged))
      {
         abortMessage("service may not open databases");
      }

      switch (db)
      {
         // Objective databases
         case DbId::native:
         case DbId::service:
            check(dbMode.isSubjective || dbMode.isSync,
                  "database access disabled during proof verification");
            check(!isWrite || !isSubjectiveContext(*this),
                  "database cannot be written in subjective context");
            check(!isWrite || dbMode.isSync, "database cannot be written in async context");
            break;
         // Subjective databases that follow forks
         case DbId::blockLog:
         case DbId::writeOnly:
            check(!isRead || isSubjectiveContext(*this),
                  "subjective databases cannot be read in a deterministic context");
            check(!isWrite || dbMode.isSync, "database cannot be written in async context");
            break;
         // Chain independent databases
         case DbId::nativeSubjective:
         case DbId::nativeSession:
         case DbId::subjective:
         case DbId::session:
         case DbId::temporary:
            check(isSubjectiveContext(*this),
                  "subjective databases cannot be accessed in a deterministic context");
            check(code.flags & ExecutionContext::isLocal, "service may not open this db");
            break;
         default:
            throw std::runtime_error("service may not read this db, or must use another intrinsic");
      }

      return static_cast<std::uint32_t>(
          buckets.open(db, std::vector(prefix.begin(), prefix.end()), static_cast<KvMode>(mode),
                       transactionContext.getWasmConfig().maxHandles));
   }

   uint32_t NativeFunctions::kvOpenAt(uint32_t handle, std::span<const char> prefix, uint32_t mode)
   {
      const auto& bucket    = buckets[static_cast<KvHandle>(handle)];
      auto        newPrefix = bucket.key(prefix);
      check(newPrefix.size() <= transactionContext.config.maxKeySize, "key is too big");
      check((static_cast<std::uint32_t>(bucket.mode) & mode) == mode,
            "Cannot increase permissions");

      return static_cast<std::uint32_t>(
          buckets.open(bucket.db, newPrefix, static_cast<KvMode>(mode),
                       transactionContext.getWasmConfig().maxHandles));
   }

   void NativeFunctions::kvClose(uint32_t handle)
   {
      buckets.close(static_cast<KvHandle>(handle));
   }

   void NativeFunctions::exportHandles(std::span<const char> data)
   {
      using Handles = std::vector<KvHandle>;
      check(psio::validate_strict<Handles>(psio::pssz{}, data).ok(), "Expected list of handles");
      auto handles = psio::pssz_view<Handles>{data};
      check(handles.size() <= transactionContext.getWasmConfig().maxHandles,
            "Too many handles exported");
      transactionContext.exportedHandles.clear();
      transactionContext.exportedHandles.reserve(handles.size());
      for (auto handle : handles)
      {
         transactionContext.exportedHandles.push_back(buckets[handle]);
      }
   }

   uint32_t NativeFunctions::importHandles()
   {
      return setResult(*this,
                       psio::to_pssz(buckets.add(std::move(transactionContext.importedHandles),
                                                 transactionContext.getWasmConfig().maxHandles)));
   }

   void NativeFunctions::kvPut(uint32_t              handle,
                               std::span<const char> key,
                               std::span<const char> value)
   {
      timeDbVoid(
          *this,
          [&]
          {
             clearResult(*this);
             const auto& bucket = buckets[static_cast<KvHandle>(handle)];
             if (!bucket.isWrite())
                abortMessage("Cannot write to this db handle " + bucket.to_string());
             auto fullKey  = bucket.key(key);
             auto bucketDb = bucket.db;
             check(fullKey.size() <= transactionContext.config.maxKeySize, "key is too big");
             check(value.size() <= transactionContext.config.maxValueSize, "value is too big");
             auto w = getDbWrite(*this, bucketDb, fullKey);
             if (w.chargeable)
             {
                auto& delta =
                    getDelta(transactionContext.kvResourceDeltas,
                             KvResourceKey{code.codeNum, static_cast<std::uint32_t>(bucketDb)});
                delta.records += 1;
                delta.keyBytes += fullKey.size();
                delta.valueBytes += value.size();
                if (w.refundable)
                {
                   auto existing = database.kvGetRaw(bucketDb, fullKey);
                   if (existing)
                   {
                      delta.records -= 1;
                      delta.keyBytes -= fullKey.size();
                      delta.valueBytes -= existing->size();
                   }
                   // nativeConstrained is both refundable and chargeable
                   if (bucketDb == DbId::native)
                   {
                      verifyWriteConstrained(transactionContext, fullKey,
                                             {value.data(), value.size()}, existing);
                      admitStoredCode(transactionContext, fullKey, {value.data(), value.size()});
                   }
                   notifyKvMut(*this, bucketDb, fullKey.size(),
                               existing ? existing->size() : -1, value.size());
                }
                else
                {
                   notifyKvMut(*this, bucketDb, fullKey.size(), -1, value.size());
                }
             }
             else if (bucketDb == DbId::nativeSubjective)
             {
                verifyWriteSubjective(database, fullKey, {value.data(), value.size()});
                admitStoredCode(transactionContext, fullKey, {value.data(), value.size()});
                noteRunPosted(transactionContext, fullKey);
             }
             else if (bucketDb == DbId::nativeSession)
             {
                if (!verifyWriteSession(transactionContext, fullKey,
                                        {value.data(), value.size()}))
                   return;
             }
             database.kvPutRaw(bucketDb, {fullKey.data(), fullKey.size()},
                               {value.data(), value.size()});
          });
   }

   void NativeFunctions::kvRemove(uint32_t handle, std::span<const char> key)
   {
      timeDbVoid(*this,
                 [&]
                 {
                    clearResult(*this);
                    const auto& bucket = buckets[static_cast<KvHandle>(handle)];
                    if (!bucket.isWrite())
                       abortMessage("Cannot write to this db handle " + bucket.to_string());
                    auto fullKey  = bucket.key(key);
                    auto bucketDb = bucket.db;
                    auto w        = getDbWrite(*this, bucketDb, fullKey);
                    if (w.refundable)
                    {
                       if (auto existing = database.kvGetRaw(bucketDb, fullKey))
                       {
                          auto& delta = getDelta(
                              transactionContext.kvResourceDeltas,
                              KvResourceKey{code.codeNum, static_cast<std::uint32_t>(bucketDb)});
                          delta.records -= 1;
                          delta.keyBytes -= fullKey.size();
                          delta.valueBytes -= existing->size();
                          if (bucketDb == DbId::native)
                          {
                             verifyRemoveConstrained(transactionContext, fullKey, *existing);
                          }
                          notifyKvMut(*this, bucketDb, fullKey.size(), existing->size(), -1);
                       }
                    }
                    if (bucketDb == DbId::nativeSubjective)
                       noteRunRemoved(transactionContext, fullKey);
                    database.kvRemoveRaw(bucketDb, fullKey);
                 });
   }

   uint32_t NativeFunctions::kvGet(uint32_t handle, std::span<const char> key)
   {
      return timeDb(  //
          *this,
          [&]
          {
             const auto& bucket = buckets[static_cast<KvHandle>(handle)];
             if (!bucket.isRead())
                abortMessage("Cannot read from this db handle " + bucket.to_string());
             auto fullKey = bucket.key(key);
             return setResult(*this, database.kvGetRaw(bucket.db, fullKey));
          });
   }

   uint32_t NativeFunctions::kvGreaterEqual(uint32_t              handle,
                                            std::span<const char> key,
                                            uint32_t              matchKeySize)
   {
      return timeDb(  //
          *this,
          [&]
          {
             check(matchKeySize <= key.size(), "matchKeySize is larger than key");
             const auto& bucket = buckets[static_cast<KvHandle>(handle)];
             if (!bucket.isRead())
                abortMessage("Cannot read from this db handle " + bucket.to_string());
             auto fullKey       = bucket.key(key);
             auto fullMatchSize = bucket.prefix.size() + matchKeySize;
             return setResult(*this, bucket.trimResult(database.kvGreaterEqualRaw(
                                         bucket.db, fullKey, fullMatchSize)));
          });
   }

   uint32_t NativeFunctions::kvLessThan(uint32_t              handle,
                                        std::span<const char> key,
                                        uint32_t              matchKeySize)
   {
      return timeDb(  //
          *this,
          [&]
          {
             check(matchKeySize <= key.size(), "matchKeySize is larger than key");
             const auto& bucket = buckets[static_cast<KvHandle>(handle)];
             if (!bucket.isRead())
                abortMessage("Cannot read from this db handle " + bucket.to_string());
             auto fullKey       = bucket.key(key);
             auto fullMatchSize = bucket.prefix.size() + matchKeySize;
             return setResult(*this, bucket.trimResult(database.kvLessThanRaw(bucket.db, fullKey,
                                                                              fullMatchSize)));
          });
   }

   uint32_t NativeFunctions::kvMax(uint32_t handle, std::span<const char> key)
   {
      return timeDb(  //
          *this,
          [&]
          {
             const auto& bucket = buckets[static_cast<KvHandle>(handle)];
             if (!bucket.isRead())
                abortMessage("Cannot read from this db handle " + bucket.to_string());
             auto fullKey = bucket.key(key);
             return setResult(*this, bucket.trimResult(database.kvMaxRaw(bucket.db, fullKey)));
          });
   }

   // TODO: return an extensible struct instead of a vector.
   //       maybe include intrinsic usage so transact can veto?
   uint32_t NativeFunctions::kvGetTransactionUsage()
   {
      auto size = setResult(*this, psio::to_pssz(transactionContext.kvResourceDeltas));
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

   int32_t NativeFunctions::socketOpen(std::span<const char> args)
   {
      check(isSubjectiveContext(*this), "Sockets are only available during subjective execution");
      check(code.flags & CodeRow::isPrivileged, "Service is not allowed to open sockets");
      check(code.flags & ExecutionContext::isLocal, "Service is not allowed to open sockets");

      using Args = std::tuple<HttpRequest, std::optional<TLSInfo>, std::optional<SocketEndpoint>>;
      check(psio::validate_pssz<Args>(args).ok(), "Malformed arguments to socketOpen");

      if (auto* callbacks =
              transactionContext.blockContext.systemContext.sharedDatabase.getCallbacks())
      {
         if (callbacks->socketOpen)
         {
            std::int32_t result = -1;
            callbacks->socketOpen(args,
                                  [&](const std::shared_ptr<Socket>& socket)
                                  {
                                     check(result == -1, "socket already added");
                                     transactionContext.blockContext.systemContext.sockets->add(
                                         *transactionContext.blockContext.writer, socket,
                                         &transactionContext.ownedSockets);
                                     result = socket->id;
                                  });
            check(result != -1, "socketOpen failed to add a socket");
            return result;
         }
      }
      return -static_cast<std::int32_t>(wasi_errno_nosys);
   }

   int32_t NativeFunctions::socketSend(int32_t fd, std::span<const char> msg, std::uint32_t flags)
   {
      check(isSubjectiveContext(*this), "Sockets are only available during subjective execution");
      check(code.flags & CodeRow::isPrivileged, "Service is not allowed to write to socket");
      check(code.flags & ExecutionContext::isLocal, "Service is not allowed to write to socket");
      check(dbMode.sockets, "Sockets disabled during speculative execution");
      return transactionContext.blockContext.systemContext.sockets->send(
          *transactionContext.blockContext.writer, fd, msg, flags);
   }

   int32_t NativeFunctions::socketSetFlags(int32_t fd, std::uint32_t mask, std::uint32_t value)
   {
      check(isSubjectiveContext(*this), "Sockets are only available during subjective execution");
      check(code.flags & CodeRow::isPrivileged, "Service is not allowed to write to socket");
      check(code.flags & ExecutionContext::isLocal, "Service is not allowed to write to socket");
      check(dbMode.sockets, "Sockets disabled during speculative execution");
      return database.socketSetFlags(fd, mask, value,
                                     *transactionContext.blockContext.systemContext.sockets,
                                     transactionContext.ownedSockets);
   }

   std::uint32_t NativeFunctions::readFile(std::span<const char> filename)
   {
      check(isSubjectiveContext(*this), "Files are only available during subjective execution");
      check(code.flags & CodeRow::isPrivileged, "Service is not allowed to read files");
      check(code.flags & ExecutionContext::isLocal, "Service is not allowed to read files");
      try
      {
         auto file = transactionContext.blockContext.systemContext.mountpoints->open(
             std::string_view{filename.data(), filename.size()});

         struct stat stat;
         if (::fstat(file.fd, &stat) < 0)
            return clearResult(*this);
         // -1 is reserved to indicate errors
         if (stat.st_size >= std::numeric_limits<std::uint32_t>::max())
            return clearResult(*this);
         std::vector<char> result(static_cast<std::size_t>(stat.st_size));
         char*             pos       = result.data();
         std::size_t       remaining = result.size();
         while (remaining)
         {
            auto count = ::read(file.fd, pos, remaining);
            if (count <= 0)
               return clearResult(*this);
            remaining -= count;
            pos += count;
         }
         return setResult(*this, std::move(result));
      }
      catch (std::system_error&)
      {
         return clearResult(*this);
      }
   }

}  // namespace psibase
