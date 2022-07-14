#include <contracts/system/AuthFakeSys.hpp>
#include <contracts/system/TransactionSys.hpp>
#include <psibase/dispatch.hpp>

#include <psibase/crypto.hpp>
#include <psibase/print.hpp>

using namespace psibase;

static constexpr bool enable_print = false;

// TODO: remove this limit after billing accounts for the storage
static constexpr uint32_t maxTrxLifetime = 60 * 60;  // 1 hour

namespace system_contract
{
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

      // Add head block to BlockSummaryTable; process_transaction uses it to
      // verify TAPoS on transactions.
      tables.open<BlockSummaryTable>().put(getBlockSummary());

      // TODO: expire transaction IDs
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

   // TODO: move to another contract
   uint8_t TransactionSys::setCode(AccountNumber     contract,
                                   uint8_t           vmType,
                                   uint8_t           vmVersion,
                                   std::vector<char> code)
   {
      // TODO: validate code
      check(getSender() == contract, "sender must match contract account");
      auto account = kvGet<AccountRow>(AccountRow::db, accountKey(contract));
      check(account.has_value(), "can not set code on a missing account");
      auto codeHash = sha256(code.data(), code.size());
      if (vmType == account->vmType && vmVersion == account->vmVersion &&
          codeHash == account->codeHash)
         return 0;
      if (account->codeHash != Checksum256{})
      {
         // TODO: Refund RAM? A different resource?
         auto code_obj = kvGet<codeRow>(
             codeRow::db, codeKey(account->codeHash, account->vmType, account->vmVersion));
         check(code_obj.has_value(), "missing code object");
         if (--code_obj->numRefs)
            kvPut(code_obj->db, code_obj->key(), *code_obj);
         else
         {
            // TODO: erase code_obj
         }
      }

      // TODO: Bill RAM? A different resource?
      account->codeHash  = codeHash;
      account->vmType    = vmType;
      account->vmVersion = vmVersion;
      kvPut(account->db, account->key(), *account);

      auto code_obj = kvGet<codeRow>(
          codeRow::db, codeKey(account->codeHash, account->vmType, account->vmVersion));
      if (!code_obj)
      {
         code_obj.emplace(codeRow{
             .codeHash  = account->codeHash,
             .vmType    = account->vmType,
             .vmVersion = account->vmVersion,
         });
         code_obj->code.assign(code.begin(), code.end());
      }
      ++code_obj->numRefs;
      kvPut(code_obj->db, code_obj->key(), *code_obj);

      return 0;
   }  // setCode

   // Native code calls this on the transaction-sys account
   //
   // All transactions pass through this function, so it's critical
   // for chain operations. A bug here can stop any new transactions
   // from entering the chain, including transactions which try to
   // fix the problem.
   extern "C" [[clang::export_name("process_transaction")]] void process_transaction()
   {
      if constexpr (enable_print)
         print("process_transaction\n");

      // TODO: check max_net_usage_words, max_cpu_usage_ms
      // TODO: resource billing
      // TODO: subjective mitigation hooks
      // TODO: limit execution time
      auto top_act = getCurrentAction();
      // TODO: avoid copying inner rawData during unpack
      // TODO: verify fracpack (no unknown, no extra data)
      auto trx = psio::convert_from_frac<Transaction>(top_act.rawData);
      auto id  = sha256(top_act.rawData.data(), top_act.rawData.size());

      check(trx.actions.size() > 0, "transaction has no actions");

      const auto& stat = getStatus();
      // print("time: ", psio::convert_to_json(stat.current.time),
      //       " expiration: ", psio::convert_to_json(trx.tapos.expiration), "\n");

      check(!(trx.tapos.flags & ~Tapos::valid_flags), "unsupported flags on transaction");
      check(stat.current.time <= trx.tapos.expiration, "transaction has expired");
      check(trx.tapos.expiration.seconds < stat.current.time.seconds + maxTrxLifetime,
            "transaction was submitted too early");

      auto tables        = TransactionSys::Tables(TransactionSys::contract);
      auto includedTable = tables.open<IncludedTrxTable>();
      auto includedIdx   = includedTable.getIndex<0>();
      auto summaryTable  = tables.open<BlockSummaryTable>();
      auto summaryIdx    = summaryTable.getIndex<0>();

      check(!includedIdx.get(id), "duplicate transaction");
      includedTable.put({id, trx.tapos.expiration});

      if (auto summary = summaryIdx.get(std::tuple<>{}))
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

      for (auto& act : trx.actions)
      {
         auto account = kvGet<AccountRow>(AccountRow::db, accountKey(act.sender));
         if (!account)
            abortMessage("unknown sender \"" + act.sender.str() + "\"");

         if constexpr (enable_print)
            print("call checkAuthSys on ", account->authContract.str(), " for account ",
                  act.sender.str(), "\n");
         Actor<AuthInterface> auth(TransactionSys::contract, account->authContract);
         auth.checkAuthSys(act, trx.claims);
         if constexpr (enable_print)
            print("call action\n");
         call(act);  // TODO: avoid copy (serializing)
      }
   }

}  // namespace system_contract

PSIBASE_DISPATCH(system_contract::TransactionSys)
