#pragma once

#include <psibase/SnapshotHeader.hpp>
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
   static constexpr NativeTableNum logTruncateTable           = 13;

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

   // The existing eos-vm implementation limits are:
   // - branch offsets, and stack offsets must fit in a signed 32-bit int
   // - The total compiled module size must be < 1 GB (note that this
   //   implies that 32-bit branches are okay.) The maximum amplification
   //   factor is currently 79, if we round up to 128, that means that
   //   wasms up to 8 MB are safe, which is coincidentally the db maxValueSize.
   //
   struct VMOptions
   {
      // This is a safe value that is larger than any reasonable stack size
      static constexpr std::uint32_t max_func_local_bytes = 128 * 1024 * 1024;
      static constexpr bool          enable_simd          = true;
      static constexpr bool          enable_bulk_memory   = true;
      static constexpr std::uint32_t stack_usage_for_call = 4096;

      std::uint32_t max_mutable_global_bytes = 1024;
      std::uint32_t max_pages                = 512;  // 32 MiB
      std::uint32_t max_table_elements       = 8192;
      // This is the total across all modules
      std::uint32_t max_stack_bytes = 1024 * 1024;

      friend auto operator<=>(const VMOptions&, const VMOptions&) = default;
      PSIO_REFLECT(VMOptions,
                   max_mutable_global_bytes,
                   max_pages,
                   max_table_elements,
                   max_stack_bytes)
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
      static constexpr uint64_t allowSudo             = uint64_t(1) << 0;
      static constexpr uint64_t allowWriteNative      = uint64_t(1) << 1;
      static constexpr uint64_t isSubjective          = uint64_t(1) << 2;
      static constexpr uint64_t allowWriteSubjective  = uint64_t(1) << 3;
      static constexpr uint64_t canNotTimeOut         = uint64_t(1) << 4;
      static constexpr uint64_t canSetTimeLimit       = uint64_t(1) << 5;
      static constexpr uint64_t isAuthService         = uint64_t(1) << 6;
      static constexpr uint64_t forceReplay           = uint64_t(1) << 7;
      static constexpr uint64_t allowSocket           = uint64_t(1) << 8;
      static constexpr uint64_t allowNativeSubjective = uint64_t(1) << 9;

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
   auto codeByHashKey(const Checksum256& codeHash,
                      uint8_t            vmType,
                      uint8_t            vmVersion) -> CodeByHashKeyType;

   /// where code is actually stored, duplicate services are reused
   struct CodeByHashRow
   {
      Checksum256 codeHash  = {};
      uint8_t     vmType    = 0;
      uint8_t     vmVersion = 0;

      uint32_t             numRefs = 0;   // number accounts that ref this
      std::vector<uint8_t> code    = {};  // actual code, TODO: compressed

      // The code table is in native. The native code
      // verifies codeHash and the key. This prevents a poison block
      // that could happen if the key->code map doesn't match the
      // key->(jitted code) map or the key->(optimized code) map.
      static constexpr auto db = psibase::DbId::native;
      auto                  key() const -> CodeByHashKeyType;
      PSIO_REFLECT(CodeByHashRow, codeHash, vmType, vmVersion, numRefs, code)
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
      // A block is produced or validated
      acceptBlock,
      // A transaction is accepted or validated
      acceptTransaction,
      // A transaction is rejected
      rejectTransaction,
      // Returns a transaction to apply
      nextTransaction,
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

}  // namespace psibase
