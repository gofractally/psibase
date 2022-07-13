#pragma once

#include <psibase/Contract.hpp>
#include <psibase/nativeTables.hpp>

namespace system_contract
{
   struct AuthInterface
   {
      // TODO: return error message instead?
      void checkAuthSys(psibase::Action action, std::vector<psibase::Claim> claims);
   };
   PSIO_REFLECT(AuthInterface, method(checkAuthSys, action, claims))

   // This table tracks block suffixes to verify TAPOS
   struct BlockSummary
   {
      std::array<uint32_t, 256> blockSuffixes;

      std::tuple<> key() const { return {}; }
   };
   PSIO_REFLECT(BlockSummary, blockSuffixes)
   using BlockSummaryTable = psibase::Table<BlockSummary, &BlockSummary::key>;

   // This table tracks transaction IDs to detect duplicates.
   struct IncludedTrx
   {
      psibase::Checksum256  id;
      psibase::TimePointSec expiration;

      auto by_expiration() const { return std::make_tuple(expiration, id); }
   };
   PSIO_REFLECT(IncludedTrx, id, expiration)
   using IncludedTrxTable =
       psibase::Table<IncludedTrx, &IncludedTrx::id, &IncludedTrx::by_expiration>;

   struct TransactionSys : psibase::Contract<TransactionSys>
   {
      static constexpr auto     contract = psibase::AccountNumber("transact-sys");
      static constexpr uint64_t contractFlags =
          psibase::AccountRow::allowSudo | psibase::AccountRow::allowWriteNative;

      using Tables = psibase::ContractTables<BlockSummaryTable, IncludedTrxTable>;

      // Called by native code at the beginning of each block
      void startBlock();

      // TODO: currentBlockNum(), currentBlockTime(): fetch from new status fields
      //       also update contracts which use `head + 1`
      psibase::BlockNum     headBlockNum() const;
      psibase::TimePointSec headBlockTime() const;

      // TODO: move to another contract
      uint8_t setCode(psibase::AccountNumber contract,
                      uint8_t                vmType,
                      uint8_t                vmVersion,
                      std::vector<char>      code);
   };
   PSIO_REFLECT(TransactionSys,
                method(startBlock),
                method(setCode, contact, vmType, vmVersion, code),
                method(headBlockNum),
                method(headBlockTime))

   // The status will never be nullopt during transaction execution or during RPC.
   // It will be nullopt when called by a test wasm before the genesis transaction
   // is pushed.
   inline const std::optional<psibase::StatusRow>& getOptionalStatus()
   {
#ifdef COMPILING_TESTS
      static std::optional<psibase::StatusRow> status;
      // The status row changes during test execution, so always read fresh
      status = psibase::kvGet<psibase::StatusRow>(psibase::StatusRow::db, psibase::statusKey());
      return status;
#else
      // Most fields in the status row don't change during transaction execution.
      // Configuration may change, but most code doesn't read that. No fields change
      // during RPC.
      static const auto status =
          psibase::kvGet<psibase::StatusRow>(psibase::StatusRow::db, psibase::statusKey());
      return status;
#endif
   }

   inline const psibase::StatusRow& getStatus()
   {
      auto& status = getOptionalStatus();
#ifdef COMPILING_TESTS
      psibase::check(status.has_value(), "missing status record");
#endif
      return *status;
   }

   // Get the current block summary. Update the in-memory copy if needed;
   // doesn't write the changed row back.
   inline const BlockSummary& getBlockSummary()
   {
      static std::optional<BlockSummary> summary;

#ifndef COMPILING_TESTS
      // We only skip work when not running a test wasm. Test wasms can't
      // skip since we don't know when blocks were pushed.
      if (summary)
         return *summary;
#endif

      auto table = TransactionSys::Tables(TransactionSys::contract).open<BlockSummaryTable>();
      auto idx   = table.getIndex<0>();
      summary    = idx.get(std::tuple<>{});
      if (!summary)
         summary.emplace();

      // If we've reached here, and
      // * We're in TransactionSys::startBlock(): this update hasn't been done yet.
      // * We're handling an RPC request: this update hasn't been done yet.
      //   RPC starts a temporary new block, but since it can't write,
      //   RPC doesn't call TransactionSys::startBlock().
      // * We're in a test wasm: we don't know when a new block has been pushed, so
      //   always do this update.
      // * All other cases: this update has already been done, but is safe to repeat.

      auto& stat = getOptionalStatus();
      if (stat && stat->head)
      {
         auto update = [&](uint8_t i)
         {
            auto& suffix = summary->blockSuffixes[i];
            memcpy(&suffix,
                   stat->head->blockId.data() + stat->head->blockId.size() - sizeof(suffix),
                   sizeof(suffix));
         };
         update(stat->head->header.blockNum & 0x7f);
         if (!(stat->head->header.blockNum & 0x1fff))
            update((stat->head->header.blockNum >> 13) | 0x80);
      }
      return *summary;
   }  // getBlockSummary()

   // Return tapos information for the head block
   inline std::pair<uint8_t, uint32_t> headTapos()
   {
      auto& stat = getOptionalStatus();
      if (stat && stat->head)
      {
         auto&   summary = getBlockSummary();
         uint8_t index   = stat->head->header.blockNum & 0x7f;
         auto    suffix  = summary.blockSuffixes[index];
         return {index, suffix};
      }
      else
         return {0, 0};  // Usable for transactions in the genesis block
   }
}  // namespace system_contract
