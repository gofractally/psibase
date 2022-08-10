#pragma once

#include <psibase/Contract.hpp>
#include <psibase/nativeTables.hpp>

namespace system_contract
{
   /// Identify a contract and method
   ///
   /// An empty `contract` or `method` indicates a wildcard.
   struct ContractMethod
   {
      psibase::AccountNumber contract;
      psibase::MethodNumber  method;
   };
   PSIO_REFLECT(ContractMethod, contract, method)

   /// Authenticate actions
   ///
   /// [TransactionSys] calls into auth contracts using this interface
   /// to authenticate senders of top-level actions and uses of
   /// [TransactionSys::runAs]. Any contract may become an auth
   /// contract by implementing `AuthInterface`. Any account may
   /// select any contract to be its authenticator. Be careful;
   /// this allows that contract to act on the account's behalf and
   /// that contract to authorize other accounts and contracts to
   /// act on the account's behalf. It can also can lock out that
   /// account. See `AuthEcSys` for a canonical example of
   /// implementing this interface.
   ///
   /// This interface can't authenticate non-top-level actions other
   /// than [TransactionSys::runAs] actions. Most contracts shouldn't
   /// call or implement `AuthInterface`; use `getSender()`.
   ///
   /// Auth contracts shouldn't inherit from this struct. Instead,
   /// they should define methods with matching signatures.
   struct AuthInterface
   {
      /// See header
      ///
      /// The database is in read-only mode. This flag is only
      /// used for `topActionReq`.
      ///
      /// Auth contracts shouldn't try writing to the database if
      /// readOnly is set. If they do, the transaction will abort.
      /// Auth contracts shouldn't skip their check based on the
      /// value of the read-only flag. If they do, they'll hurt
      /// their users, either by allowing charging where it
      /// shouldn't be allowed, or by letting actions execute
      /// using the user's auth when they shouldn't.
      static constexpr uint32_t readOnlyFlag = 0x8000'0000;

      /// See header
      ///
      /// Transaction's first authorizer. This flag is only
      /// used for `topActionReq`.
      ///
      /// Auth contracts should be aware that if this flag
      /// is set, then only the first proof has been verified.
      /// If they rely on other proofs when this flag is set,
      /// they'll open up the accounts they're trying to
      /// protect to resource billing attacks.
      static constexpr uint32_t firstAuthFlag = 0x4000'0000;

      /// Bits which identify kind of request
      static constexpr uint32_t requestMask = 0x0000'00ff;

      /// Top-level action
      static constexpr uint32_t topActionReq = 0x01;

      /// See header
      ///
      /// `runAs` request. The requester matches the action's
      /// sender.
      ///
      /// Auth contracts should normally approve this unless
      /// they enforce stronger rules, e.g. by restricting
      /// `action` or `allowedActions`.
      static constexpr uint32_t runAsRequesterReq = 0x02;

      /// See header
      ///
      /// `runAs` request. The request matches the criteria from
      /// a `runAs` request currently in the call stack. `requester`
      /// matches the earlier `action.contract`. `action` matches
      /// one of the earlier `allowedActions` from the same request.
      ///
      /// Auth contracts should normally approve this unless
      /// they enforce stronger rules.
      static constexpr uint32_t runAsMatchedReq = 0x03;

      /// See header
      ///
      /// `runAs` request. Same as `runAsMatched`, except the
      /// requestor provided a non-empty `allowedActions`. This
      /// expands the authority beyond what was originally granted.
      ///
      /// Auth contracts should normally reject this unless
      /// they have filtering criteria which allow it.
      static constexpr uint32_t runAsMatchedExpandedReq = 0x04;

      /// See header
      ///
      /// `runAs` request. The other criteria don't match.
      ///
      /// Auth contracts should normally reject this unless
      /// they have filtering criteria which allow it.
      static constexpr uint32_t runAsOtherReq = 0x05;

      /// Authenticate a top-level action or a `runAs` action
      ///
      /// * `flags`:          One of the type constants, or'ed with
      ///                     0 or more of the flag constants
      /// * `requester`:      `""` if this is a top-level action, or
      ///                     the sender of the `runAs` action.
      ///                     This is often different than
      ///                     `action.sender`.
      /// * `action`:         Action to authenticate
      /// * `allowedActions`: Argument from `runAs`
      /// * `claims`:         Claims in transaction (e.g. public keys).
      ///                     Empty if `runAs`
      //
      // TODO: return error message instead?
      void checkAuthSys(uint32_t                    flags,
                        psibase::AccountNumber      requester,
                        psibase::Action             action,
                        std::vector<ContractMethod> allowedActions,
                        std::vector<psibase::Claim> claims);

      // TODO: add a method to allow the auth contract to verify
      //       that it's OK with being the auth contract for a
      //       particular account. AccountSys would call it.
   };
   PSIO_REFLECT(AuthInterface,
                method(checkAuthSys, flags, requester, action, allowedActions, claims))

   struct TransactionSysStatus
   {
      bool enforceAuth = true;

      std::tuple<> key() const { return {}; }
   };
   PSIO_REFLECT(TransactionSysStatus, enforceAuth)
   using TransactionSysStatusTable =
       psibase::Table<TransactionSysStatus, &TransactionSysStatus::key>;

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
      psibase::TimePointSec expiration;
      psibase::Checksum256  id;

      auto key() const { return std::make_tuple(expiration, id); }
   };
   PSIO_REFLECT(IncludedTrx, expiration, id)
   using IncludedTrxTable = psibase::Table<IncludedTrx, &IncludedTrx::key>;

   /// All transactions enter the chain through this contract
   ///
   /// This privileged contract dispatches top-level actions to other
   /// contracts, checks TAPoS, detects duplicate transactions, and
   /// checks authorizations using [system_contract::AuthInterface].
   ///
   /// Other contracts use it to get information about the chain,
   /// current block, and head block. They also use it to call actions
   /// using other accounts' authorities via [runAs].
   struct TransactionSys : psibase::Contract<TransactionSys>
   {
      /// "transact-sys"
      static constexpr auto contract = psibase::AccountNumber("transact-sys");

      /// Flags this contract must run with
      static constexpr uint64_t contractFlags =
          psibase::CodeRow::allowSudo | psibase::CodeRow::allowWriteNative;

      using Tables =
          psibase::ContractTables<TransactionSysStatusTable, BlockSummaryTable, IncludedTrxTable>;

      /// Only called once during chain initialization
      ///
      /// This enables the auth checking system. Before this point, `TransactionSys`
      /// allows all transactions to execute without auth checks. After this point,
      /// `TransactionSys` uses [AuthInterface::checkAuthSys] to authenticate
      /// top-level actions and uses of [runAs].
      void startup();

      /// Called by native code at the beginning of each block
      void startBlock();

      /// Run `action` using `action.sender's` authority
      ///
      /// Also adds `allowedActions` to the list of actions that `action.contract`
      /// may perform on `action.sender's` behalf, for as long as this call to
      /// `runAs` is in the call stack. Use `""` for `contract` in
      /// `allowedActions` to allow use of any contract (danger!). Use `""` for
      /// `method` to allow any method.
      ///
      /// Returns the action's return value, if any.
      ///
      /// This will succeed if any of the following are true:
      /// * `getSender() == action.sender's authContract`
      /// * `getSender() == action.sender`. Requires `action.sender's authContract`
      ///   to approve with flag `AuthInterface::runAsRequesterReq` (normally succeeds).
      /// * An existing `runAs` is currently on the call stack, `getSender()` matches
      ///   `action.contract` on that earlier call, and `action` matches
      ///   `allowedActions` from that same earlier call. Requires `action.sender's
      ///   authContract` to approve with flag `AuthInterface::runAsMatchedReq`
      ///   if `allowedActions` is empty (normally succeeds), or
      ///   `AuthInterface::runAsMatchedExpandedReq` if not empty (normally fails).
      /// * All other cases, requires `action.sender's authContract`
      ///   to approve with flag `AuthInterface::runAsOtherReq` (normally fails).
      std::vector<char> runAs(psibase::Action action, std::vector<ContractMethod> allowedActions);

      /// Get the currently executing transaction
      psibase::Transaction getTransaction() const;

      // TODO: currentBlockNum(), currentBlockTime(): fetch from new status fields
      //       also update contracts which use `head + 1`

      /// Get the head block number
      ///
      /// This is *not* the currently executing block number.
      psibase::BlockNum headBlockNum() const;

      /// Get the head block time
      ///
      /// This is *not* the currently executing block time.
      psibase::TimePointSec headBlockTime() const;
   };
   PSIO_REFLECT(TransactionSys,
                method(startup),
                method(startBlock),
                method(runAs, action, allowedActions),
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
