#pragma once

#include <psibase/Contract.hpp>
#include <psibase/nativeTables.hpp>

namespace system_contract
{
   // TransactionSys calls into auth contracts using this interface
   // to authenticate senders of top-level actions. Any contract
   // may become an auth contract by implementing it. Any account
   // may select any contract to be its sole authenticator. Be
   // careful; this allows that contract to act on the account's
   // behalf. It can also can lock out that account. See AuthEcSys
   // for a canonical example of implementing this interface.
   //
   // This interface can't authenticate non-top-level actions.
   // Most contracts shouldn't call or implement AuthInterface;
   // use getSender().
   struct AuthInterface
   {
      // Authenticate a top-level action
      //
      // action:     Action to authenticate
      // claims:     Claims in transaction (e.g. public keys)
      // firstAuth:  Is this the transaction's first authorizer?
      // readOnly:   Is the database in read-only mode?
      //
      // Auth contracts shouldn't try writing to the database if
      // readOnly is set. If they do, the transaction will abort.
      // Auth contracts shouldn't skip their check based on the
      // value of the read-only flag. If they do, they'll hurt
      // their users, either by allowing charging where it
      // shouldn't be allowed, or by letting actions execute
      // using the user's auth when they shouldn't.
      //
      // TODO: return error message instead?
      void checkAuthSys(psibase::Action             action,
                        std::vector<psibase::Claim> claims,
                        bool                        firstAuth,
                        bool                        readOnly);

      // TODO: add a method to allow the auth contract to verify
      //       that it's OK with being the auth contract for a
      //       particular account. AccountSys would call it.
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

      psibase::Transaction getTransaction() const;

      // TODO: currentBlockNum(), currentBlockTime(): fetch from new status fields
      //       also update contracts which use `head + 1`
      psibase::BlockNum     headBlockNum() const;
      psibase::TimePointSec headBlockTime() const;
   };
   PSIO_REFLECT(TransactionSys,
                method(startBlock),
                method(getTransaction),
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
