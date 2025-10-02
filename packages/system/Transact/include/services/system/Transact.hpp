#pragma once

#include <psibase/Service.hpp>
#include <psibase/nativeTables.hpp>

namespace SystemService
{
   /// Identify a service and method
   ///
   /// An empty `service` or `method` indicates a wildcard.
   struct ServiceMethod
   {
      psibase::AccountNumber service;
      psibase::MethodNumber  method;
   };
   PSIO_REFLECT(ServiceMethod, service, method)

   /// Authenticate actions
   ///
   /// [Transact] calls into auth services using this interface
   /// to authenticate senders of top-level actions and uses of
   /// [Transact::runAs]. Any service may become an auth
   /// service by implementing `AuthInterface`. Any account may
   /// select any service to be its authenticator. Be careful;
   /// this allows that service to act on the account's behalf and
   /// that service to authorize other accounts and services to
   /// act on the account's behalf. It can also can lock out that
   /// account. See `AuthSig` for a canonical example of
   /// implementing this interface.
   ///
   /// This interface can't authenticate non-top-level actions other
   /// than [Transact::runAs] actions. Most services shouldn't
   /// call or implement `AuthInterface`; use `getSender()`.
   ///
   /// Auth services shouldn't inherit from this struct. Instead,
   /// they should define methods with matching signatures.
   struct AuthInterface
   {
      /// See header
      ///
      /// The database is in read-only mode. This flag is only
      /// used for `topActionReq`.
      ///
      /// Auth services shouldn't try writing to the database if
      /// readOnly is set. If they do, the transaction will abort.
      /// Auth services shouldn't skip their check based on the
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
      /// Auth services should be aware that if this flag
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
      /// Auth services should normally approve this unless
      /// they enforce stronger rules, e.g. by restricting
      /// `action` or `allowedActions`.
      static constexpr uint32_t runAsRequesterReq = 0x02;

      /// See header
      ///
      /// `runAs` request. The request matches the criteria from
      /// a `runAs` request currently in the call stack. `requester`
      /// matches the earlier `action.service`. `action` matches
      /// one of the earlier `allowedActions` from the same request.
      ///
      /// Auth services should normally approve this unless
      /// they enforce stronger rules.
      static constexpr uint32_t runAsMatchedReq = 0x03;

      /// See header
      ///
      /// `runAs` request. Same as `runAsMatched`, except the
      /// requestor provided a non-empty `allowedActions`. This
      /// expands the authority beyond what was originally granted.
      ///
      /// Auth services should normally reject this unless
      /// they have filtering criteria which allow it.
      static constexpr uint32_t runAsMatchedExpandedReq = 0x04;

      /// See header
      ///
      /// `runAs` request. The other criteria don't match.
      ///
      /// Auth services should normally reject this unless
      /// they have filtering criteria which allow it.
      static constexpr uint32_t runAsOtherReq = 0x05;

      /// Authenticate a top-level action or a `runAs` action
      ///
      /// * `flags`:          One of the Req (request) constants,
      ///                     or'ed with 0 or more of the flag
      ///                     constants
      /// * `requester`:      `""` if this is a top-level action, or
      ///                     the sender of the `runAs` action.
      ///                     This is often different from
      ///                     `action.sender`.
      /// * `sender`          The sender being requested for the action.
      /// * `action`:         Action to authenticate
      /// * `allowedActions`: Argument from `runAs`
      /// * `claims`:         Claims in transaction (e.g. public keys).
      ///                     Empty if `runAs`
      //
      // TODO: return error message instead?
      void checkAuthSys(uint32_t                    flags,
                        psibase::AccountNumber      requester,
                        psibase::AccountNumber      sender,
                        ServiceMethod               action,
                        std::vector<ServiceMethod>  allowedActions,
                        std::vector<psibase::Claim> claims);

      /// Verify that a particular user is allowed to use a
      /// particular auth service. Allows auth services to use user
      /// whitelists.
      ///
      /// Called by Accounts.
      ///
      /// * `user`:  The user being checked
      // TODO: Return error message instead?
      void canAuthUserSys(psibase::AccountNumber user);

      /// Check whether a specified set of authorizer accounts are sufficient to authorize sending a
      /// transaction from a specified sender.
      ///
      /// * `sender`: The sender account for the transaction potentially being authorized.
      /// * `authorizers`: The set of accounts that have already authorized the execution of the transaction.
      /// * `authSet`: The set of accounts that are already being checked for authorization. If
      ///              the sender is already in this set, then the function should return false.
      ///
      /// Returns:
      /// * `true`: The authorizers are sufficient to authorize a transaction from the sender.
      /// * `false`: The authorizers are not sufficient to authorize a transaction from the sender.
      bool isAuthSys(psibase::AccountNumber                             sender,
                     std::vector<psibase::AccountNumber>                authorizers,
                     std::optional<std::vector<psibase::AccountNumber>> authSet);

      /// Check whether a specified set of rejecter accounts are sufficient to reject (cancel) a
      /// transaction from a specified sender.
      ///
      /// * `sender`: The sender account for the transaction potentially being rejected.
      /// * `rejecters`: The set of accounts that have already authorized the rejection of the transaction.
      /// * `authSet`: The set of accounts that are already being checked for authorization. If
      ///              the sender is already in this set, then the function should return false.
      ///
      /// Returns:
      /// * `true`: The rejecters are sufficient to reject a transaction from the sender.
      /// * `false`: The rejecters are not sufficient to reject a transaction from the sender.
      bool isRejectSys(psibase::AccountNumber                             sender,
                       std::vector<psibase::AccountNumber>                rejecters,
                       std::optional<std::vector<psibase::AccountNumber>> authSet);
   };
   PSIO_REFLECT(AuthInterface,
                method(checkAuthSys, flags, requester, sender, action, allowedActions, claims),
                method(canAuthUserSys, user),
                method(isAuthSys, sender, authorizers),
                method(isRejectSys, sender, rejecters)
                //
   )

   struct VerifyInterface
   {
      void verifySys(psibase::Checksum256 transactionHash,
                     psibase::Claim       claim,
                     std::vector<char>    proof);
   };
   PSIO_REFLECT(VerifyInterface, method(verifySys, transactionHash, claim, proof))

   struct TransactStatus
   {
      bool enforceAuth = true;

      std::optional<std::vector<psibase::Checksum256>> bootTransactions;
   };
   PSIO_REFLECT(TransactStatus, enforceAuth, bootTransactions)
   using TransactStatusTable = psibase::Table<TransactStatus, psibase::SingletonKey{}>;
   PSIO_REFLECT_TYPENAME(TransactStatusTable)

   // This table tracks block suffixes to verify TAPOS
   struct BlockSummary
   {
      std::array<uint32_t, 256> blockSuffixes;
   };
   PSIO_REFLECT(BlockSummary, blockSuffixes)
   using BlockSummaryTable = psibase::Table<BlockSummary, psibase::SingletonKey{}>;
   PSIO_REFLECT_TYPENAME(BlockSummaryTable)

   // This table tracks transaction IDs to detect duplicates.
   struct IncludedTrx
   {
      psibase::TimePointSec expiration;
      psibase::Checksum256  id;

      using Key = psibase::CompositeKey<&IncludedTrx::expiration, &IncludedTrx::id>;
   };
   PSIO_REFLECT(IncludedTrx, expiration, id)
   using IncludedTrxTable = psibase::Table<IncludedTrx, IncludedTrx::Key{}>;
   PSIO_REFLECT_TYPENAME(IncludedTrxTable)

   enum class CallbackType : std::uint32_t
   {
      onTransaction,
      onBlock,
      onFailedTransaction,
   };

   struct Callbacks
   {
      CallbackType                 type;
      std::vector<psibase::Action> actions;
   };
   PSIO_REFLECT(Callbacks, type, actions)

   using CallbacksTable = psibase::Table<Callbacks, &Callbacks::type>;
   PSIO_REFLECT_TYPENAME(CallbacksTable)

   struct SnapshotInfo
   {
      psibase::BlockTime lastSnapshot;
      psibase::Seconds   snapshotInterval;
   };
   PSIO_REFLECT(SnapshotInfo, lastSnapshot, snapshotInterval)
   using SnapshotInfoTable = psibase::Table<SnapshotInfo, psibase::SingletonKey{}>;
   PSIO_REFLECT_TYPENAME(SnapshotInfoTable)

   /// All transactions enter the chain through this service
   ///
   /// This privileged service dispatches top-level actions to other
   /// services, checks TAPoS, detects duplicate transactions, and
   /// checks authorizations using [SystemService::AuthInterface].
   ///
   /// Other services use it to get information about the chain,
   /// current block, and head block. They also use it to call actions
   /// using other accounts' authorities via [runAs].
   struct Transact : psibase::Service
   {
      /// "transact"
      static constexpr auto service = psibase::AccountNumber("transact");

      /// Flags this service must run with
      static constexpr uint64_t serviceFlags = psibase::CodeRow::isPrivileged;

      using Tables = psibase::ServiceTables<TransactStatusTable,
                                            BlockSummaryTable,
                                            IncludedTrxTable,
                                            CallbacksTable,
                                            SnapshotInfoTable>;

      /// This action enables the boot procedure to be split across multiple blocks
      ///
      /// It is only called once, immediately after the boot transaction.
      ///
      /// `bootTransactions` defines the list of subsequent transaction hashes to which
      /// the node operator is committing as part of the boot sequence. The subsequent
      /// transactions listed must then be pushed in order, and no other transactions
      /// will be accepted until [finishBoot] is run.
      void startBoot(psio::view<const std::vector<psibase::Checksum256>> bootTransactions);

      /// Only called once during chain initialization
      ///
      /// This enables the auth checking system. Before this point, `Transact`
      /// allows all transactions to execute without auth checks. After this point,
      /// `Transact` uses [AuthInterface::checkAuthSys] to authenticate
      /// top-level actions and uses of [runAs].
      void finishBoot();

      /// Called by native code at the beginning of each block
      void startBlock();

      /// Called by RTransact to execute a transaction speculatively
      void execTrx(psio::view<const psio::shared_view_ptr<psibase::Transaction>> trx,
                   bool                                                          speculative);

      /// Sets the time between snapshots
      ///
      /// A value of 0 will disable snapshots. This is a chain-wide
      /// setting because snapshots are signed by the block producers.
      void setSnapTime(uint32_t seconds);

      /// Adds a callback that will be run whenever the trigger happens.
      /// - onTransaction is run at the end of every transaction
      /// - onBlock runs at the end of every block
      ///
      /// Objective callbacks are run by the transaction service and
      /// must have this service as the sender. If an objective callback
      /// fails, it will abort the block or transaction.
      ///
      /// Subjective callbacks are run by native and must have no sender.
      ///
      /// Callbacks are unique. `addCallback` will have no effect if an
      /// identical callback is already registered.
      ///
      /// The order in which callbacks are executed is unspecified.
      void addCallback(CallbackType type, bool objective, psibase::Action act);
      /// Removes an existing callback
      void removeCallback(CallbackType type, bool objective, psibase::Action act);

      /// Run `action` using `action.sender's` authority
      ///
      /// Also adds `allowedActions` to the list of actions that `action.service`
      /// may perform on `action.sender's` behalf, for as long as this call to
      /// `runAs` is in the call stack. Use `""` for `service` in
      /// `allowedActions` to allow use of any service (danger!). Use `""` for
      /// `method` to allow any method.
      ///
      /// Returns the action's return value, if any.
      ///
      /// This will succeed if any of the following are true:
      /// * `getSender() == action.sender's authService`
      /// * `getSender() == action.sender`. Requires `action.sender's authService`
      ///   to approve with flag `AuthInterface::runAsRequesterReq` (normally succeeds).
      /// * An existing `runAs` is currently on the call stack, `getSender()` matches
      ///   `action.service` on that earlier call, and `action` matches
      ///   `allowedActions` from that same earlier call. Requires `action.sender's
      ///   authService` to approve with flag `AuthInterface::runAsMatchedReq`
      ///   if `allowedActions` is empty (normally succeeds), or
      ///   `AuthInterface::runAsMatchedExpandedReq` if not empty (normally fails).
      /// * All other cases, requires `action.sender's authService`
      ///   to approve with flag `AuthInterface::runAsOtherReq` (normally fails).
      // TODO: rename. Requires changes throughout C++, Rust, js, and documentation.
      std::vector<char> runAs(psibase::Action action, std::vector<ServiceMethod> allowedActions);

      /// Checks authorization for the sender of the first action
      bool checkFirstAuth(psibase::Checksum256                   id,
                          psio::view<const psibase::Transaction> transaction);

      /// Get the currently executing transaction
      psio::view<const psibase::Transaction> getTransaction() const;

      /// Returns true if running a transaction
      bool isTransaction() const;

      /// Get the current block header
      psibase::BlockHeader currentBlock() const;

      /// Get the head block header
      ///
      /// This is *not* the currently executing block.
      /// See [currentBlock].
      psibase::BlockHeader headBlock() const;

      /// Get the head block time
      ///
      /// This is *not* the currently executing block time.
      /// TODO: remove
      psibase::BlockTime headBlockTime() const;
   };
   PSIO_REFLECT(Transact,
                method(startBoot, bootTransactions),
                method(finishBoot),
                method(startBlock),
                method(execTrx, transaction, speculative),
                method(setSnapTime, seconds),
                method(addCallback, type, objective, action),
                method(removeCallback, type, objective, action),
                method(runAs, action, allowedActions),
                method(checkFirstAuth, id, transaction),
                method(getTransaction),
                method(isTransaction),
                method(currentBlock),
                method(headBlock),
                method(headBlockTime))

   PSIBASE_REFLECT_TABLES(Transact, Transact::Tables)

   // The status will never be nullopt during transaction execution or during RPC.
   // It will be nullopt when called by a test wasm before the genesis transaction
   // is pushed.
   inline const std::optional<psibase::StatusRow>& getOptionalStatus()
   {
#ifdef COMPILING_TESTS
      static std::optional<psibase::StatusRow> status;
      // The status row changes during test execution, so always read fresh
      status = psibase::Native::tables(psibase::KvMode::read).open<psibase::StatusTable>().get({});
      return status;
#else
      // Most fields in the status row don't change during transaction execution.
      // Configuration may change, but most code doesn't read that. No fields change
      // during RPC.
      static const auto status =
          psibase::Native::tables(psibase::KvMode::read).open<psibase::StatusTable>().get({});
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

      auto table =
          Transact::Tables(Transact::service, psibase::KvMode::read).open<BlockSummaryTable>();
      auto idx = table.getIndex<0>();
      summary  = idx.get(std::tuple<>{});
      if (!summary)
         summary.emplace();

      // If we've reached here, and
      // * We're in Transact::startBlock(): this update hasn't been done yet.
      // * We're handling an RPC request: this update hasn't been done yet.
      //   RPC starts a temporary new block, but since it can't write,
      //   RPC doesn't call Transact::startBlock().
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
}  // namespace SystemService
