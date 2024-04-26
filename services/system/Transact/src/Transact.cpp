#include <psibase/dispatch.hpp>
#include <services/system/Accounts.hpp>
#include <services/system/AuthAny.hpp>
#include <services/system/CpuLimit.hpp>
#include <services/system/Transact.hpp>

#include <boost/container/flat_map.hpp>
#include <psibase/crypto.hpp>
#include <psibase/serviceEntry.hpp>

#include <cstdio>

using namespace psibase;

static constexpr bool enable_print = false;

// TODO: remove this limit after billing accounts for the storage
static constexpr uint32_t maxTrxLifetime = 60 * 60;  // 1 hour

namespace SystemService
{
   void Transact::startBoot(psio::view<const std::vector<Checksum256>> bootTransactions)
   {
      auto tables      = Transact::Tables(Transact::service);
      auto statusTable = tables.open<TransactStatusTable>();
      auto statusIdx   = statusTable.getIndex<0>();
      check(!statusIdx.get(std::tuple{}), "already started");
      statusTable.put({.enforceAuth = false, .bootTransactions = bootTransactions});
   }

   void Transact::finishBoot()
   {
      auto tables      = Transact::Tables(Transact::service);
      auto statusTable = tables.open<TransactStatusTable>();
      auto statusIdx   = statusTable.getIndex<0>();
      auto status      = statusIdx.get(std::tuple{});
      if (!status)
      {
         check(
             !getStatus().head,
             "fatal error: The boot process must use startBoot when split across multiple blocks");
      }
      else
      {
         check(!status->enforceAuth, "already started");
         check(!!status->bootTransactions, "Invariant failure");
         check(status->bootTransactions->empty(), "Not all boot transactions have been run");
      }
      statusTable.put({.enforceAuth = true});

      // TODO: Move these to a config service
      // TODO: Reduce numExecutionMemories on proofWasmConfigTable. Waiting for
      //       a fix to SystemContext caching, to prevent frequent allocating
      //       and freeing of ExecutionMemory instances.
      ConfigRow config;
      kvPut(config.db, config.key(), config);
      WasmConfigRow wasmConfig;
      kvPut(wasmConfig.db, wasmConfig.key(transactionWasmConfigTable), wasmConfig);
      kvPut(wasmConfig.db, wasmConfig.key(proofWasmConfigTable), wasmConfig);
   }

   // CAUTION: startBlock() is critical to chain operations. If it fails, the chain stops.
   //          If the chain stops, it can only be fixed by forking out the misbehaving
   //          transact.wasm and replacing it with a working one. That procedure
   //          isn't implemented yet, and will likely be painful once it is (if ever).
   //          If you're tempted to do anything application-specific in startBlock,
   //          or are considering adding new features to startBlock, then consider
   //          the risk of it halting the chain if a bug or exploit appears.
   void Transact::startBlock()
   {
      check(getSender().value == 0, "Only native code may call startBlock");

      Tables tables(Transact::service);

      // Add head block to BlockSummaryTable; processTransaction uses it to
      // verify TAPoS on transactions.
      tables.open<BlockSummaryTable>().put(getBlockSummary());

      // Remove expired transaction IDs. The iteration limit on the loop helps to
      // mitigate a potential attack.
      const auto& stat          = getStatus();
      auto        includedTable = tables.open<IncludedTrxTable>();
      auto        includedIndex = includedTable.getIndex<0>();
      auto        includedEnd   = includedIndex.end();
      for (int i = 0; i < 20; ++i)
      {
         auto it = includedIndex.begin();
         if (it == includedEnd)
            break;
         auto obj = *it;
         if (obj.expiration > stat.current.time)
            break;
         includedTable.remove(obj);
      }
   }

   void Transact::addCallback(CallbackType type, bool objective, psibase::Action act)
   {
      auto me = getReceiver();
      check(getSender() == me, "Wrong sender");
      if (objective)
      {
         check(act.sender == me, "Objective callbacks must have 'trasact' as sender");
         check(type == CallbackType::onTransaction, "Objective block callbacks not supported");
         Tables tables(me);
         auto   table = tables.open<CallbacksTable>();
         auto   index = table.getIndex<0>();
         auto   value = index.get(type);
         if (!value)
         {
            value = Callbacks{.type = type};
         }
         value->actions.push_back(std::move(act));
         table.put(*value);
      }
      else
      {
         check(act.sender == AccountNumber{}, "Subjective callbacks must not have a sender");
         check(type == CallbackType::onBlock, "Subjective transaction callbacks not supported");
         auto ntype = NotifyType::acceptBlock;
         auto key   = notifyKey(ntype);
         auto value = kvGet<NotifyRow>(NotifyRow::db, key);
         if (!value)
         {
            value = NotifyRow{.type = ntype};
         }
         value->actions.push_back(std::move(act));
         kvPut(NotifyRow::db, key, *value);
      }
   }

   void Transact::removeCallback(CallbackType type, bool objective, psibase::Action act)
   {
      auto me = getReceiver();
      check(getSender() == me, "Wrong sender");
      if (objective)
      {
         Tables tables(me);
         auto   table = tables.open<CallbacksTable>();
         auto   index = table.getIndex<0>();
         if (auto value = index.get(type))
         {
            auto pos = std::ranges::find(value->actions, act);
            if (pos != value->actions.end())
            {
               value->actions.erase(pos);
               if (value->actions.empty())
                  table.remove(*value);
               else
                  table.put(*value);
               return;
            }
         }
      }
      else
      {
         check(type == CallbackType::onBlock, "Subjective transaction callbacks not supported");
         auto ntype = NotifyType::acceptBlock;
         auto key   = notifyKey(ntype);
         if (auto value = kvGet<NotifyRow>(NotifyRow::db, key))
         {
            auto pos = std::ranges::find(value->actions, act);
            if (pos != value->actions.end())
            {
               value->actions.erase(pos);
               if (value->actions.empty())
                  kvRemove(key);
               else
                  kvPut(NotifyRow::db, key, *value);
               return;
            }
         }
      }
      abortMessage("Callback not found");
   }

   struct RunAsKey
   {
      AccountNumber sender;
      AccountNumber authorizedSender;
      AccountNumber receiver;
      MethodNumber  method;

      friend auto operator<=>(const RunAsKey&, const RunAsKey&) = default;
   };
   boost::container::flat_map<RunAsKey, uint32_t> runAsMap;

   std::vector<char> Transact::runAs(psibase::Action            action,
                                     std::vector<ServiceMethod> allowedActions)
   {
      auto requester = getSender();

      auto tables         = Transact::Tables(Transact::service);
      auto statusTable    = tables.open<TransactStatusTable>();
      auto statusIdx      = statusTable.getIndex<0>();
      auto transactStatus = statusIdx.get(std::tuple{});

      if (transactStatus && transactStatus->enforceAuth)
      {
         auto accountsTables = Accounts::Tables(Accounts::service);
         auto accountTable   = accountsTables.open<AccountTable>();
         auto accountIndex   = accountTable.getIndex<0>();
         auto account        = accountIndex.get(action.sender);
         if (!account)
            abortMessage("unknown sender \"" + action.sender.str() + "\"");

         if (requester != account->authService)
         {
            uint32_t flags = 0;
            if (requester == action.sender)
               flags = AuthInterface::runAsRequesterReq;
            else
            {
               auto it = runAsMap.lower_bound(RunAsKey{action.sender, requester, {}, {}});
               while (it != runAsMap.end() &&  //
                      it->first.sender == action.sender && it->first.authorizedSender == requester)
               {
                  if (it->second &&  //
                      (!it->first.receiver.value || it->first.receiver == action.service) &&
                      (!it->first.method.value || it->first.method == action.method))
                  {
                     if (allowedActions.empty())
                        flags = AuthInterface::runAsMatchedReq;
                     else
                        flags = AuthInterface::runAsMatchedExpandedReq;
                     break;
                  }
                  ++it;
               }
               if (!flags)
                  flags = AuthInterface::runAsOtherReq;
            }

            Actor<AuthInterface> auth(Transact::service, account->authService);
            auth.checkAuthSys(flags, requester, action.sender,
                              ServiceMethod{action.service, action.method}, allowedActions,
                              std::vector<Claim>{});
         }  // if (requester != account->authService)
      }     // if(enforceAuth)

      for (auto& a : allowedActions)
         ++runAsMap[{action.sender, action.service, a.service, a.method}];

      auto result = call(action);

      for (auto& a : allowedActions)
         --runAsMap[{action.sender, action.service, a.service, a.method}];

      return result;
   }  // Transact::runAs

   static std::span<const char>  trxData;
   psio::view<const Transaction> Transact::getTransaction() const
   {
      check(trxData.data() != nullptr, "No transaction");
      return psio::view<const Transaction>(psio::prevalidated{trxData});
   }

   psibase::BlockHeader Transact::currentBlock() const
   {
      return getStatus().current;
   }

   psibase::BlockHeader Transact::headBlock() const
   {
      auto& stat = getStatus();
      check(stat.head.has_value(), "head does not exist yet");
      return stat.head->header;
   }

   psibase::TimePointSec Transact::headBlockTime() const
   {
      auto& stat = getStatus();
      if (stat.head)
         return stat.head->header.time;
      return {};
   }

   // Native code calls this on the Transact account
   //
   // All transactions pass through this function, so it's critical
   // for chain operations. A bug here can stop any new transactions
   // from entering the chain, including transactions which try to
   // fix the problem.
   //
   // TODO: reconsider which functions, if any, are direct exports
   //       instead of going through dispatch
   extern "C" [[clang::export_name("processTransaction")]] void processTransaction()
   {
      if constexpr (enable_print)
         std::printf("processTransaction\n");

      // TODO: check max_net_usage_words, max_cpu_usage_ms
      // TODO: resource billing
      // TODO: subjective mitigation hooks
      // TODO: limit execution time
      // TODO: limit charged CPU & NET which can go into a block
      auto top_act = getCurrentActionView();
      auto args    = psio::view<const ProcessTransactionArgs>(top_act->rawData());
      auto t       = args.transaction().data_without_size_prefix();
      check(psio::fracpack_validate_strict<Transaction>(t), "transaction has invalid format");
      trxData  = t;
      auto trx = psio::view<const Transaction>(psio::prevalidated{t});
      auto id  = sha256(t.data(), t.size());
      // unpack some fields for convenience
      auto tapos  = trx.tapos().unpack();
      auto claims = trx.claims().unpack();

      check(trx.actions().size() > 0, "transaction has no actions");

      const auto& stat = getStatus();
      // printf("time: ", psio::convert_to_json(stat.current.time),
      //       " expiration: ", psio::convert_to_json(tapos.expiration), "\n");

      check(!(tapos.flags & ~Tapos::valid_flags), "unsupported flags on transaction");
      check(stat.current.time < tapos.expiration, "transaction has expired");
      check(tapos.expiration.seconds < stat.current.time.seconds + maxTrxLifetime,
            "transaction was submitted too early");

      auto tables        = Transact::Tables(Transact::service);
      auto statusTable   = tables.open<TransactStatusTable>();
      auto statusIdx     = statusTable.getIndex<0>();
      auto includedTable = tables.open<IncludedTrxTable>();
      auto includedIdx   = includedTable.getIndex<0>();
      auto summaryTable  = tables.open<BlockSummaryTable>();
      auto summaryIdx    = summaryTable.getIndex<0>();

      check(!includedIdx.get(std::tuple{tapos.expiration, id}), "duplicate transaction");
      if (!args.checkFirstAuthAndExit())
         includedTable.put({tapos.expiration, id});

      auto transactStatus = statusIdx.get(std::tuple{});

      std::optional<BlockSummary> summary;
      if (args.checkFirstAuthAndExit())
         summary = getBlockSummary();  // startBlock() might not have run
      else
         summary = summaryIdx.get(std::tuple<>{});

      if (transactStatus && transactStatus->bootTransactions)
      {
         auto& bootTransactions = *transactStatus->bootTransactions;
         check(!bootTransactions.empty(),
               "fatal error: All boot transactions have been pushed, but finishBoot was not run.");
         check(!tapos.refBlockIndex && !tapos.refBlockSuffix,
               "transaction references non-existing block");
         if (!args.checkFirstAuthAndExit())
         {
            check(id == bootTransactions.front(),
                  "Wrong transaction during boot " + psio::convert_to_json(id) +
                      " != " + psio::convert_to_json(bootTransactions.front()));
            bootTransactions.erase(bootTransactions.begin());
            statusTable.put(*transactStatus);
         }
         else
         {
            check(std::find(bootTransactions.begin(), bootTransactions.end(), id) !=
                      bootTransactions.end(),
                  "Wrong transaction during boot " + psio::convert_to_json(id));
         }
      }
      else if (summary)
      {
         if (tapos.refBlockIndex & 0x80)
            check(((tapos.refBlockIndex - 2) & 0x7f) <= (stat.head->header.blockNum >> 13) - 2,
                  "transaction references non-existing block");
         else
            check(((tapos.refBlockIndex - 2) & 0x7f) <= stat.head->header.blockNum - 2,
                  "transaction references non-existing block");

         // printf("expected suffix: ", summary->blockSuffixes[tapos.refBlockIndex], "\n");
         check(tapos.refBlockSuffix == summary->blockSuffixes[tapos.refBlockIndex],
               "transaction references non-existing block");
      }
      else
      {
         // printf("refBlockIndex: ", tapos.refBlockIndex,
         //       " refBlockSuffix: ", tapos.refBlockSuffix, "; should be 0\n");
         check(!tapos.refBlockIndex && !tapos.refBlockSuffix,
               "transaction references non-existing block");
      }

      Actor<CpuLimit> cpuLimit(Transact::service, CpuLimit::service);
      Actor<Accounts> accounts(Transact::service, Accounts::service);

      auto accountsTables = Accounts::Tables(Accounts::service);
      auto accountTable   = accountsTables.open<AccountTable>();
      auto accountIndex   = accountTable.getIndex<0>();

      for (auto act : trx.actions())
      {
         if (transactStatus && transactStatus->enforceAuth)
         {
            auto account = accountIndex.get(act.sender().unpack());
            if (!account)
               abortMessage("unknown sender \"" + act.sender().unpack().str() + "\"");

            if constexpr (enable_print)
               std::printf("call checkAuthSys on %s for sender account %s\n",
                           account->authService.str().c_str(), act.sender().unpack().str().c_str());
            Actor<AuthInterface> auth(Transact::service, account->authService);
            uint32_t             flags = AuthInterface::topActionReq;
            if (get_view_data(act) == get_view_data(trx.actions()[0]))
            {
               flags |= AuthInterface::firstAuthFlag;
               cpuLimit.setCpuLimit(act.sender());
            }
            if (args.checkFirstAuthAndExit())
               flags |= AuthInterface::readOnlyFlag;
            // This can execute user defined code, so we must set the timer first
            auth.checkAuthSys(flags, psibase::AccountNumber{}, act.sender(),
                              ServiceMethod{act.service(), act.method()},
                              std::vector<ServiceMethod>{}, claims);
         }
         if (args.checkFirstAuthAndExit())
            break;
         if constexpr (enable_print)
            std::printf("call action\n");

         auto data = find_view_span(act);
         if (data.data() != nullptr)
         {
            psibase::raw::call(data.data(), data.size());
         }
         else
         {
            psibase::call(act.unpack());
         }
      }

      if (auto callbacks =
              tables.open<CallbacksTable>().getIndex<0>().get(CallbackType::onTransaction))
      {
         for (const auto& act : callbacks->actions)
         {
            psibase::call(act);
         }
      }

      check(!trx.actions().empty(), "transaction must have at least one action");
      if (transactStatus && transactStatus->enforceAuth)
      {
         std::chrono::nanoseconds cpuUsage = cpuLimit.getCpuTime();
         accounts.billCpu(trx.actions()[0].sender(), cpuUsage);
      }

      trxData = std::span<const char>{};
   }

}  // namespace SystemService

PSIBASE_DISPATCH(SystemService::Transact)
