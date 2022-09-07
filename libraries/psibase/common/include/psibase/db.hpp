#pragma once

#include <psibase/block.hpp>

namespace psibase
{
   /// Identify database to operate on
   ///
   /// Native functions expose a set of databases which serve
   /// various purposes. This enum identifies which database to
   /// use when invoking those functions.
   enum class DbId : uint32_t
   {
      /// Contracts should store their tables here
      ///
      /// The first 64 bits of the key match the contract.
      contract,

      /// Data for RPC
      ///
      /// Write-only during transactions, and read-only during RPC.
      /// Individual nodes may modify this database, expire data from this
      /// database, or wipe it entirely at will.
      ///
      /// The first 64 bits of the key match the contract.
      writeOnly,

      /// Data that is not part of consensus
      ///
      /// Only accessible to subjective contracts during transactions,
      /// but readable by all contracts during RPC. Doesn't undo
      /// from aborting transactions, aborting blocks, or forking
      /// blocks. Individual nodes may modify this database or wipe
      //  it entirely at will.
      ///
      /// The first 64 bits of the key match the contract.
      subjective,

      /// Tables used by native code
      ///
      /// This database enforces constraints during write. Only
      /// writable by priviledged contracts, but readable by all
      /// contracts.
      ///
      /// Some writes to this database indicate chain upgrades. If a
      /// priviledged contract writes to a table that an older
      /// node version doesn't know about, or writes new fields
      /// to an existing table that an older node doesn't know about,
      /// then that node will reject the write. If the producers
      /// accepted the write into a block, then the node will stop
      /// following the chain until it's upgraded to a newer version.
      nativeConstrained,

      /// Tables used by native code
      ///
      /// This database doesn't enforce constraints during write.
      /// Only writable by priviledged contracts, but readable by all
      /// contracts.
      nativeUnconstrained,

      /// Block log
      ///
      /// Transactions don't have access to this, but RPC does.
      blockLog,

      /// Long-term history event storage
      ///
      /// Write-only during transactions, and read-only during RPC.
      /// Individual nodes may modify this database, expire data from this
      /// database, or wipe it entirely at will.
      ///
      /// TODO: this policy may eventually change to allow time-limited
      /// read access during transactions.
      ///
      /// Key is an auto-incremented, 64-bit unsigned number.
      ///
      /// Value must begin with:
      /// * 32 bit: block number
      /// * 64 bit: contract
      ///
      /// Only usable with these native functions:
      /// * [putSequential]
      /// * [getSequential]
      ///
      /// TODO: right now the value must begin with the contract. Revisit
      /// whether beginning with the block number is useful.
      historyEvent,

      /// Short-term history event storage
      ///
      /// These events are erased once the block that produced them becomes final.
      /// They notify user interfaces which subscribe to activity.
      ///
      /// Write-only during transactions, and read-only during RPC.
      /// Individual nodes may modify this database, expire data from this
      /// database, or wipe it entirely at will.
      ///
      /// Key is an auto-incremented, 64-bit unsigned number.
      ///
      /// Value must begin with:
      /// * 32 bit: block number
      /// * 64 bit: contract
      ///
      /// Only usable with these native functions:
      /// * [putSequential]
      /// * [getSequential]
      ///
      /// TODO: right now the value must begin with the contract. Revisit
      /// whether beginning with the block number is useful.
      uiEvent,

      /// Events which go into the merkle tree
      ///
      /// TODO: read support; right now only RPC mode can read
      ///
      /// Contracts may produce these events during transactions and may read them
      /// up to 1 hour (configurable) after they were produced, or they reach finality,
      /// which ever is longer.
      ///
      /// Key is an auto-incremented, 64-bit unsigned number.
      ///
      /// Value must begin with:
      /// * 32 bit: block number
      /// * 64 bit: contract
      ///
      /// Only usable with these native functions:
      /// * [putSequential]
      /// * [getSequential]
      ///
      /// TODO: right now the value must begin with the contract. Revisit
      /// whether beginning with the block number is useful.
      merkleEvent,

      /// block signatures
      blockProof,

      /// Number of defined databases
      ///
      /// This number may grow in the future
      numDatabases,
   };

   inline constexpr uint32_t numDatabases = (uint32_t)DbId::numDatabases;

   struct KvResourceKey
   {
      AccountNumber contract = {};
      uint32_t      db       = {};

      friend auto operator<=>(const KvResourceKey&, const KvResourceKey&) = default;
   };
   PSIO_REFLECT(KvResourceKey, definitionWillNotChange(), contract, db)

   struct KvResourceDelta
   {
      int64_t records    = 0;
      int64_t keyBytes   = 0;
      int64_t valueBytes = 0;
   };
   PSIO_REFLECT(KvResourceDelta, definitionWillNotChange(), records, keyBytes, valueBytes)

   struct KvResourcePair
   {
      KvResourceKey   first  = {};
      KvResourceDelta second = {};

      KvResourcePair() = default;
      KvResourcePair(KvResourceKey first, KvResourceDelta second) : first{first}, second{second} {}
   };
   PSIO_REFLECT(KvResourcePair, definitionWillNotChange(), first, second)
}  // namespace psibase
