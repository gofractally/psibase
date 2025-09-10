#pragma once

#include <psibase/SnapshotHeader.hpp>
#include <psibase/SocketInfo.hpp>
#include <psibase/block.hpp>
#include <psibase/db.hpp>

namespace psibase
{
   using NativeTableNum = uint16_t;

   static constexpr NativeTableNum statusTable                = 1;   // objective
   static constexpr NativeTableNum codeTable                  = 2;   // both
   static constexpr NativeTableNum codeByHashTable            = 3;   // both
   static constexpr NativeTableNum databaseStatusTable        = 4;   // objective
   static constexpr NativeTableNum transactionWasmConfigTable = 5;   // objective
   static constexpr NativeTableNum proofWasmConfigTable       = 6;   // Also for first auth
   static constexpr NativeTableNum configTable                = 7;   // both
   static constexpr NativeTableNum notifyTable                = 8;   // both
   static constexpr NativeTableNum blockDataTable             = 9;   // subjective
   static constexpr NativeTableNum consensusChangeTable       = 10;  // subjective
   static constexpr NativeTableNum snapshotTable              = 11;  // subjective
   static constexpr NativeTableNum scheduledSnapshotTable     = 12;  // both
   static constexpr NativeTableNum logTruncateTable           = 13;  // subjective
   static constexpr NativeTableNum socketTable                = 14;  // subjective
   static constexpr NativeTableNum runTable                   = 15;  // subjective
   static constexpr NativeTableNum envTable                   = 16;  // subjective

   static constexpr uint8_t nativeTablePrimaryIndex = 0;

   using KeyPrefixType = std::tuple<std::uint16_t, std::uint8_t>;
   auto statusKey() -> KeyPrefixType;
   struct StatusRow
   {
      Checksum256              chainId;
      BlockHeader              current;
      std::optional<BlockInfo> head;
      JointConsensus           consensus;

      static constexpr auto db = psibase::DbId::native;
      static auto           key() -> KeyPrefixType;
      PSIO_REFLECT(StatusRow, chainId, current, head, consensus)
   };

   struct ConfigRow
   {
      uint32_t maxKeySize   = 128;
      uint32_t maxValueSize = 8 << 20;

      static constexpr auto db = psibase::DbId::native;

      static auto key() -> KeyPrefixType;
      PSIO_REFLECT(ConfigRow, maxKeySize, maxValueSize)
   };

   struct WasmConfigRow
   {
      uint32_t  numExecutionMemories = 32;
      VMOptions vmOptions;

      static constexpr auto db = psibase::DbId::native;

      static auto key(NativeTableNum TableNum) -> KeyPrefixType;
      PSIO_REFLECT(WasmConfigRow, numExecutionMemories, vmOptions)
   };

   using CodeKeyType = std::tuple<std::uint16_t, std::uint8_t, AccountNumber>;
   auto codePrefix() -> KeyPrefixType;
   auto codeKey(AccountNumber codeNum) -> CodeKeyType;
   struct CodeRow
   {
      // Constants for flags
      static constexpr uint64_t isPrivileged    = uint64_t(1) << 0;
      static constexpr uint64_t isVerify        = uint64_t(1) << 1;
      static constexpr uint64_t runModeRpc      = uint64_t(1) << 2;
      static constexpr uint64_t runModeCallback = uint64_t(2) << 2;
      static constexpr uint64_t isReplacement   = uint64_t(1) << 32;

      static constexpr auto runMode = runModeRpc | runModeCallback;
      static constexpr auto chainServiceFlags =
          isPrivileged | isVerify | runModeRpc | runModeCallback;
      static constexpr auto localServiceFlags = isPrivileged | isReplacement;
      static constexpr auto allFlags          = chainServiceFlags | localServiceFlags;

      AccountNumber codeNum;
      uint64_t      flags = 0;  // Constants above

      Checksum256 codeHash  = {};
      uint8_t     vmType    = 0;
      uint8_t     vmVersion = 0;

      static constexpr auto db = psibase::DbId::native;
      auto                  key() const -> CodeKeyType;
      PSIO_REFLECT(CodeRow, codeNum, flags, codeHash, vmType, vmVersion)
   };

   using CodeByHashKeyType =
       std::tuple<std::uint16_t, std::uint8_t, Checksum256, std::uint8_t, std::uint8_t>;
   auto codeByHashKey(const Checksum256& codeHash, uint8_t vmType, uint8_t vmVersion)
       -> CodeByHashKeyType;

   /// where code is actually stored, duplicate services are reused
   struct CodeByHashRow
   {
      Checksum256 codeHash  = {};
      uint8_t     vmType    = 0;
      uint8_t     vmVersion = 0;

      std::vector<uint8_t> code = {};  // actual code, TODO: compressed

      // The code table is in native. The native code
      // verifies codeHash and the key. This prevents a poison block
      // that could happen if the key->code map doesn't match the
      // key->(jitted code) map or the key->(optimized code) map.
      static constexpr auto db = psibase::DbId::native;
      auto                  key() const -> CodeByHashKeyType;
      PSIO_REFLECT(CodeByHashRow, codeHash, vmType, vmVersion, code)
   };

   auto getCodeKeys(const std::vector<BlockHeaderAuthAccount>& services)
       -> std::vector<CodeByHashKeyType>;

   auto databaseStatusKey() -> KeyPrefixType;
   struct DatabaseStatusRow
   {
      uint64_t nextHistoryEventNumber = 1;
      uint64_t nextUIEventNumber      = 1;
      uint64_t nextMerkleEventNumber  = 1;

      uint64_t blockMerkleEventNumber = 1;

      // This table is in native. The native code blocks services
      // from writing to this since it could break backing stores.
      static constexpr auto db = psibase::DbId::native;
      static auto           key() -> KeyPrefixType;
      PSIO_REFLECT(DatabaseStatusRow,
                   nextHistoryEventNumber,
                   nextUIEventNumber,
                   nextMerkleEventNumber,
                   blockMerkleEventNumber)
   };

   // Notifications are sent by native code
   //
   // Each action is run in subjective mode and errors are ignored.
   //
   // Because it is subjective, the kinds of notifications that
   // are sent can be changed without breaking consensus.
   enum class NotifyType : std::uint32_t
   {
      // A block is produced or validated. The notification is
      // sent after the StatusRow is updated with the new head.
      acceptBlock,
      // A transaction is accepted or validated
      acceptTransaction,
      // A transaction is rejected
      rejectTransaction,
      // Returns a transaction to apply
      nextTransaction,
      // Determines which signatures (if any) have
      // already been verified.
      preverifyTransaction,
   };

   using NotifyKeyType = std::tuple<std::uint16_t, std::uint8_t, NotifyType>;
   auto notifyKey(NotifyType type) -> NotifyKeyType;
   struct NotifyRow
   {
      NotifyType          type;
      std::vector<Action> actions;

      // TODO: we need a native subjective table
      static constexpr auto db = psibase::DbId::native;
      auto                  key() const -> NotifyKeyType;
      PSIO_REFLECT(NotifyRow, type, actions)
   };

   using BlockDataKeyType = std::tuple<std::uint16_t, std::uint8_t, Checksum256>;
   auto blockDataPrefix() -> KeyPrefixType;
   auto blockDataKey(const Checksum256&) -> BlockDataKeyType;
   struct BlockDataRow
   {
      Checksum256 blockId;
      // Contains additional signatures if required by the consensus algorithm
      std::optional<std::vector<char>> auxConsensusData;

      static constexpr auto db = psibase::DbId::nativeSubjective;
      auto                  key() const -> BlockDataKeyType;
      PSIO_REFLECT(BlockDataRow, blockId, auxConsensusData);
   };

   using ConsensusChangeKeyType = std::tuple<std::uint16_t, std::uint8_t, BlockNum>;
   /// Indicates the blocks that change consensus
   auto consensusChangePrefix() -> KeyPrefixType;
   auto consensusChangeKey(BlockNum start) -> ConsensusChangeKeyType;
   struct ConsensusChangeRow
   {
      BlockNum start;
      BlockNum commit;
      BlockNum end;

      static constexpr auto db = psibase::DbId::nativeSubjective;
      auto                  key() const -> ConsensusChangeKeyType;
      PSIO_REFLECT(ConsensusChangeRow, start, commit, end);
   };

   struct SnapshotStateItem
   {
      snapshot::StateChecksum               state;
      std::vector<snapshot::StateSignature> signatures;
      PSIO_REFLECT(SnapshotStateItem, state, signatures)
   };

   using SnapshotKeyType = std::tuple<std::uint16_t, std::uint8_t, Checksum256>;
   auto snapshotPrefix() -> KeyPrefixType;
   auto snapshotKey(const Checksum256&) -> SnapshotKeyType;
   struct SnapshotRow
   {
      using Item = SnapshotStateItem;
      Checksum256         id;
      std::optional<Item> state;
      std::vector<Item>   other;

      static constexpr auto db = psibase::DbId::nativeSubjective;
      auto                  key() const -> SnapshotKeyType;
      PSIO_REFLECT(SnapshotRow, id, state, other)
   };

   using ScheduledSnapshotKeyType = std::tuple<std::uint16_t, std::uint8_t, BlockNum>;
   auto scheduledSnapshotKey(BlockNum num) -> ScheduledSnapshotKeyType;
   struct ScheduledSnapshotRow
   {
      BlockNum blockNum;

      static constexpr auto db = psibase::DbId::native;
      auto                  key() const -> ScheduledSnapshotKeyType;
      PSIO_REFLECT(ScheduledSnapshotRow, blockNum)
   };

   // If this row is present it indicates the height the block log starts at.
   using LogTruncateKeyType = KeyPrefixType;
   auto logTruncateKey() -> LogTruncateKeyType;
   struct LogTruncateRow
   {
      BlockNum start;

      static const auto db = psibase::DbId::nativeSubjective;
      auto              key() const -> LogTruncateKeyType;
      PSIO_REFLECT(LogTruncateRow, start)
   };

   using SocketKeyType = std::tuple<std::uint16_t, std::uint8_t, std::int32_t>;
   auto socketPrefix() -> KeyPrefixType;
   auto socketKey(std::int32_t fd) -> SocketKeyType;
   struct SocketRow
   {
      // Well-known fds
      static constexpr std::int32_t producer_multicast = 0;

      std::int32_t fd;
      SocketInfo   info;

      static const auto db = psibase::DbId::nativeSession;
      auto              key() const -> SocketKeyType;
      PSIO_REFLECT(SocketRow, fd, info)
   };

   enum class RunMode : std::uint8_t
   {
      // No database access, and only services with isAuthService
      // are allowed.
      verify,
      // Access is equivalent to transactions. Changes to the
      // database are allowed, but will be discarded after
      // the action completes.
      speculative,
      // Read-only access to chain state. Read/write access
      // to chain-independent databases.
      rpc,
      // Read-only access to objective state, Read/write access
      // to subjective state. When running in an async context,
      // changes to chain state will be discarded.
      callback,
   };

   // A RunToken is an opaque value that can be used to
   // prove that a particular execution succeeded. Operations
   // that take tokens may skip execution if a token is provided.
   //
   // A token matches an execution if it was created by an
   // execution with the same action, mode, and context.
   //
   // - If the mode is verify, the context consists of all
   //   the verify services.
   // - If the mode is transaction, the context consists of
   //   all objective chain state.
   // - If the mode is rpc or callback, every execution has
   //   a distinct context.
   //
   // - If the token matches, the implementation MAY skip execution
   // - On an active block producer, if the token does not
   //   match, the implementation MUST NOT skip execution
   // - If the implementation receives a non-matching
   //   token, it SHOULD issue a warning
   // - Services that use tokens MUST ensure that only
   //   matching tokens are passed to native
   // - It is implementation-defined whether tokens can
   //   be transferred between nodes.
   using RunToken = std::vector<char>;

   //struct ContinuationArgs
   //{
   //   std::uint64_t id;
   //   TransactionTrace trace;
   //   std::optional<RunToken> token;
   //   PSIO_REFLECT(ContinuationArgs, id, trace, token)
   //};

   struct BoundMethod
   {
      AccountNumber service;
      MethodNumber  method;
      PSIO_REFLECT(BoundMethod, service, method)
   };

   using RunKeyType = std::tuple<std::uint16_t, std::uint8_t, std::uint64_t>;
   auto runPrefix() -> KeyPrefixType;
   auto runKey(std::uint64_t id) -> RunKeyType;

   // The run table holds actions to be run concurrently.
   // An entry may begin executing whenever it is not
   // currently running. Rows with a lower id are preferred,
   // but the order is not guaranteed. After the action
   // finishes, whether successfully or not, the continuation
   // will be run with the trace.
   //
   // The state used to run the action is the head block state
   // whenever execution begins. The continuation is run with
   // the same state as the action.
   //
   // Execution can be terminated at any time. It is the
   // continuation's resposibility to remove the row. Native
   // code does not remove or modify entries in the table.
   // If the row is still present, it will start execution
   // from the beginning.
   //
   // Note: The server itself may be terminated abruptly
   // and this cannot be prevented. When this happens, it is
   // impossible to resume where we left off. Changes committed
   // by commitSubjective (including PSIBASE_SUBJECTIVE_TX)
   // will persist.
   //
   // To implement async cancellation, replace the
   // action with a no-op and the continuation with a
   // cancel handler. N.B. Do not implement cancellation
   // by deleting the row. Deleting it anywhere except the
   // continuation makes it impossible to re-use the id safely.
   //
   // If the row is deleted (don't) or the continuation is
   // changed after execution starts, it is unspecified which
   // version of the continuation is run.
   struct RunRow
   {
      // queue management
      std::uint64_t id;
      // permitted database access.
      RunMode mode;
      // The initial time limit for the action. If the
      // action has sufficient permissions, it can change
      // the limit using setMaxTransactionTime. The limit
      // only applies to the action. The continuation is
      // not limited and therefore should be a system service.
      MicroSeconds maxTime;
      // the action to run
      Action      action;
      BoundMethod continuation;

      static const auto db = psibase::DbId::nativeSubjective;
      auto              key() const -> RunKeyType;
      PSIO_REFLECT(RunRow, id, mode, maxTime, action, continuation)
   };

   using EnvKeyType = std::tuple<std::uint16_t, std::uint8_t, std::string>;
   auto envPrefix() -> KeyPrefixType;
   auto envKey(std::string_view) -> EnvKeyType;
   struct EnvRow
   {
      std::string       name;
      std::string       value;
      static const auto db = psibase::DbId::nativeSession;
      auto              key() const -> EnvKeyType;
      PSIO_REFLECT(EnvRow, name, value);
   };

}  // namespace psibase
