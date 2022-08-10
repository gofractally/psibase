#include <contracts/system/AccountSys.hpp>
#include <contracts/system/AuthFakeSys.hpp>
#include <contracts/system/TransactionSys.hpp>
#include <psibase/dispatch.hpp>

#include <boost/container/flat_map.hpp>
#include <psibase/crypto.hpp>
#include <psibase/print.hpp>

using namespace psibase;

static constexpr bool enable_print = false;

// TODO: remove this limit after billing accounts for the storage
static constexpr uint32_t maxTrxLifetime = 60 * 60;  // 1 hour

namespace system_contract
{
   void TransactionSys::startup()
   {
      auto tables      = TransactionSys::Tables(TransactionSys::contract);
      auto statusTable = tables.open<TransactionSysStatusTable>();
      auto statusIdx   = statusTable.getIndex<0>();
      check(!statusIdx.get(std::tuple{}), "already started");
      statusTable.put({.enforceAuth = true});

      // TODO: Move this to a config contract
      // TODO: Reduce numExecutionMemories on proofWasmConfigTable. Waiting for
      //       a fix to SystemContract caching, to prevent frequent allocating
      //       and freeing of ExecutionMemory instances.
      WasmConfigRow wasmConfig;
      kvPut(wasmConfig.db, wasmConfig.key(transactionWasmConfigTable), wasmConfig);
      kvPut(wasmConfig.db, wasmConfig.key(proofWasmConfigTable), wasmConfig);
   }

   // CAUTION: startBlock() is critical to chain operations. If it fails, the chain stops.
   //          If the chain stops, it can only be fixed by forking out the misbehaving
   //          transact-sys.wasm and replacing it with a working one. That procedure
   //          isn't implemented yet, and will likely be painful once it is (if ever).
   //          If you're tempted to do anything application-specific in startBlock,
   //          or are considering adding new features to startBlock, then consider
   //          the risk of it halting the chain if a bug or exploit appears.
   void TransactionSys::startBlock()
   {
      check(getSender().value == 0, "Only native code may call startBlock");

      Tables tables(TransactionSys::contract);

      // Add head block to BlockSummaryTable; processTransaction uses it to
      // verify TAPoS on transactions.
      tables.open<BlockSummaryTable>().put(getBlockSummary());

      // Remove expired transaction IDs
      const auto& stat          = getStatus();
      auto        includedTable = tables.open<IncludedTrxTable>();
      auto        includedIndex = includedTable.getIndex<0>();
      auto        includedEnd   = includedIndex.end();
      while (true)
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

   struct RunAsKey
   {
      AccountNumber sender;
      AccountNumber authorizedSender;
      AccountNumber receiver;
      MethodNumber  method;

      friend auto operator<=>(const RunAsKey&, const RunAsKey&) = default;
   };
   boost::container::flat_map<RunAsKey, uint32_t> runAsMap;

   std::vector<char> TransactionSys::runAs(psibase::Action             action,
                                           std::vector<ContractMethod> allowedActions)
   {
      auto requester = getSender();

      auto tables               = TransactionSys::Tables(TransactionSys::contract);
      auto statusTable          = tables.open<TransactionSysStatusTable>();
      auto statusIdx            = statusTable.getIndex<0>();
      auto transactionSysStatus = statusIdx.get(std::tuple{});

      if (transactionSysStatus && transactionSysStatus->enforceAuth)
      {
         auto accountSysTables = AccountSys::Tables(AccountSys::contract);
         auto accountTable     = accountSysTables.open<AccountTable>();
         auto accountIndex     = accountTable.getIndex<0>();
         auto account          = accountIndex.get(action.sender);
         if (!account)
            abortMessage("unknown sender \"" + action.sender.str() + "\"");

         if (requester != account->authContract)
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
                      (!it->first.receiver.value || it->first.receiver == action.contract) &&
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

            Actor<AuthInterface> auth(TransactionSys::contract, account->authContract);
            auth.checkAuthSys(flags, requester, action, allowedActions, std::vector<Claim>{});
         }  // if (requester != account->authContract)
      }     // if(enforceAuth)

      for (auto& a : allowedActions)
         ++runAsMap[{action.sender, action.contract, a.contract, a.method}];

      auto result = call(action);

      for (auto& a : allowedActions)
         --runAsMap[{action.sender, action.contract, a.contract, a.method}];

      return result;
   }  // TransactionSys::runAs

   static Transaction trx;
   Transaction        TransactionSys::getTransaction() const
   {
      return trx;
   }

   psibase::BlockNum TransactionSys::headBlockNum() const
   {
      auto& stat = getStatus();
      if (stat.head)
         return stat.head->header.blockNum;
      return 1;  // next block (currently being produced) is 2 (genesis)
   }
   psibase::TimePointSec TransactionSys::headBlockTime() const
   {
      auto& stat = getStatus();
      if (stat.head)
         return stat.head->header.time;
      return {};
   }

   // Native code calls this on the transaction-sys account
   //
   // All transactions pass through this function, so it's critical
   // for chain operations. A bug here can stop any new transactions
   // from entering the chain, including transactions which try to
   // fix the problem.
   //
   // TODO: move checkFirstAuthAndExit into getCurrentAction()
   // TODO: reconsider which functions, if any, are direct exports
   //       instead of going through dispatch
   extern "C" [[clang::export_name("processTransaction")]] void processTransaction(
       bool checkFirstAuthAndExit)
   {
      if constexpr (enable_print)
         print("processTransaction\n");

      // TODO: check max_net_usage_words, max_cpu_usage_ms
      // TODO: resource billing
      // TODO: subjective mitigation hooks
      // TODO: limit execution time
      // TODO: limit charged CPU & NET which can go into a block
      auto top_act = getCurrentAction();
      // TODO: avoid copying inner rawData during unpack
      // TODO: verify fracpack (no unknown, no extra data)
      trx     = psio::convert_from_frac<Transaction>(top_act.rawData);
      auto id = sha256(top_act.rawData.data(), top_act.rawData.size());

      check(trx.actions.size() > 0, "transaction has no actions");

      const auto& stat = getStatus();
      // print("time: ", psio::convert_to_json(stat.current.time),
      //       " expiration: ", psio::convert_to_json(trx.tapos.expiration), "\n");

      check(!(trx.tapos.flags & ~Tapos::valid_flags), "unsupported flags on transaction");
      check(stat.current.time < trx.tapos.expiration, "transaction has expired");
      check(trx.tapos.expiration.seconds < stat.current.time.seconds + maxTrxLifetime,
            "transaction was submitted too early");

      auto tables        = TransactionSys::Tables(TransactionSys::contract);
      auto statusTable   = tables.open<TransactionSysStatusTable>();
      auto statusIdx     = statusTable.getIndex<0>();
      auto includedTable = tables.open<IncludedTrxTable>();
      auto includedIdx   = includedTable.getIndex<0>();
      auto summaryTable  = tables.open<BlockSummaryTable>();
      auto summaryIdx    = summaryTable.getIndex<0>();

      check(!includedIdx.get(std::tuple{trx.tapos.expiration, id}), "duplicate transaction");
      if (!checkFirstAuthAndExit)
         includedTable.put({trx.tapos.expiration, id});

      std::optional<BlockSummary> summary;
      if (checkFirstAuthAndExit)
         summary = getBlockSummary();  // startBlock() might not have run
      else
         summary = summaryIdx.get(std::tuple<>{});

      if (summary)
      {
         if (trx.tapos.refBlockIndex & 0x80)
            check(((trx.tapos.refBlockIndex - 2) & 0x7f) <= (stat.head->header.blockNum >> 13) - 2,
                  "transaction references non-existing block");
         else
            check(((trx.tapos.refBlockIndex - 2) & 0x7f) <= stat.head->header.blockNum - 2,
                  "transaction references non-existing block");

         // print("expected suffix: ", summary->blockSuffixes[trx.tapos.refBlockIndex], "\n");
         check(trx.tapos.refBlockSuffix == summary->blockSuffixes[trx.tapos.refBlockIndex],
               "transaction references non-existing block");
      }
      else
      {
         // print("refBlockIndex: ", trx.tapos.refBlockIndex,
         //       " refBlockSuffix: ", trx.tapos.refBlockSuffix, "; should be 0\n");
         check(!trx.tapos.refBlockIndex && !trx.tapos.refBlockSuffix,
               "transaction references non-existing block");
      }

      auto transactionSysStatus = statusIdx.get(std::tuple{});
      auto accountSysTables     = AccountSys::Tables(AccountSys::contract);
      auto accountTable         = accountSysTables.open<AccountTable>();
      auto accountIndex         = accountTable.getIndex<0>();

      for (auto& act : trx.actions)
      {
         if (transactionSysStatus && transactionSysStatus->enforceAuth)
         {
            auto account = accountIndex.get(act.sender);
            if (!account)
               abortMessage("unknown sender \"" + act.sender.str() + "\"");

            if constexpr (enable_print)
               print("call checkAuthSys on ", account->authContract.str(), " for account ",
                     act.sender.str(), "\n");
            Actor<AuthInterface> auth(TransactionSys::contract, account->authContract);
            uint32_t             flags = AuthInterface::topActionReq;
            if (&act == &trx.actions[0])
               flags |= AuthInterface::firstAuthFlag;
            if (checkFirstAuthAndExit)
               flags |= AuthInterface::readOnlyFlag;
            auth.checkAuthSys(flags, psibase::AccountNumber{}, act, std::vector<ContractMethod>{},
                              trx.claims);
         }
         if (checkFirstAuthAndExit)
            break;
         if constexpr (enable_print)
            print("call action\n");
         call(act);  // TODO: avoid copy (serializing)
      }
   }

}  // namespace system_contract

PSIBASE_DISPATCH(system_contract::TransactionSys)
