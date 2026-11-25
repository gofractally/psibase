#pragma once

#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <memory>
#include <optional>
#include <span>
#include <vector>

namespace psibase
{
   // Where compiled-module records are kept. A store holds opaque records by
   // key and promises nothing about their content: NativeAotCache checks every
   // record it reads. All members may be called from any thread at once.
   struct NativeArtifactStore
   {
      using Key                      = std::array<std::uint8_t, 32>;
      virtual ~NativeArtifactStore() = default;
      virtual bool                             usable() const noexcept          = 0;
      virtual std::optional<std::vector<char>> read(const Key& key) noexcept    = 0;
      virtual void write(const Key& key, std::span<const char> record) noexcept = 0;
      virtual void erase(const Key& key) noexcept                               = 0;
   };

   // Records as files in a directory private to the user. Any number of
   // processes may share one directory: a record becomes visible by rename.
   class NativeAotDirectory final : public NativeArtifactStore
   {
     public:
      // Largest record read or written.
      static constexpr std::size_t maxRecordSize = 256u * 1024u * 1024u + 64u;

      explicit NativeAotDirectory(const std::filesystem::path& directory) noexcept;
      ~NativeAotDirectory();
      NativeAotDirectory(const NativeAotDirectory&)            = delete;
      NativeAotDirectory& operator=(const NativeAotDirectory&) = delete;

      bool                             usable() const noexcept override;
      std::optional<std::vector<char>> read(const Key& key) noexcept override;
      void write(const Key& key, std::span<const char> record) noexcept override;
      void erase(const Key& key) noexcept override;

     private:
      int directory = -1;
   };

   // Records in a psitri database of their own: what a node uses. The database
   // is separate from the chain's (its own directory, its own roots), so it is
   // in no state hash, snapshot or revision, and deleting the directory while
   // the node is stopped costs recompiles and nothing else.
   //
   // Threads. psitri sessions belong to the thread that created them. Every
   // thread that reads or writes here gets its own read session and write
   // session the first time it does, and no session is ever used by two
   // threads. The database object owns them: a thread reaches its own through
   // thread-local state, without a lock; they are released when the thread
   // exits, or when the database closes, whichever is first.
   //
   // Writers. Records are spread over 64 psitri roots by the first byte of
   // their key. psitri has one writer per root at a time and writers on
   // different roots do not wait for each other, so speculative runs, block
   // execution and verify threads that compile different modules store them
   // side by side; two that land on one root queue for the length of one
   // insert, never for a compile.
   //
   // Readers. A read takes a snapshot of one root and copies the record out.
   // It waits for no writer, on that root or another, beyond the instant a
   // root is published, and takes none of this class's own locks (keeping the
   // order of use is skipped when that would mean waiting). Reads happen when
   // a module is not in memory: once per module per run, not per transaction.
   //
   // Durability. None is asked for (psitri's sync_mode::none, its cheapest):
   // a record lost in a crash is compiled again, and one that survives in
   // part fails NativeAotCache's digest.
   //
   // Size. An entry is not removed when its code is: the row can be removed
   // by a speculative run that never lands or by a block that is later
   // reverted, the same code can be a node-local service, and one code has
   // an entry per set of limits it was compiled under, which the removal
   // does not name. Instead the database is bounded: what it holds never
   // exceeds maxBytes, and making room evicts the least recently used
   // records (read or written in this run; those not yet touched since the
   // database was opened go first). A record larger than maxBytes is not
   // kept. psitri stores a value of any size up to 4 GiB as chunks of just
   // under 32 MiB, so no artifact needs splitting here.
   class NativeAotDatabase final : public NativeArtifactStore
   {
     public:
      static constexpr std::uint64_t defaultMaxBytes = std::uint64_t(4) << 30;

      // Opens or creates the database. If it cannot be opened it is left as
      // it is and reported, and the store is not usable.
      explicit NativeAotDatabase(const std::filesystem::path& directory,
                                 std::uint64_t                maxBytes = defaultMaxBytes) noexcept;
      ~NativeAotDatabase();
      NativeAotDatabase(const NativeAotDatabase&)            = delete;
      NativeAotDatabase& operator=(const NativeAotDatabase&) = delete;

      bool                             usable() const noexcept override;
      std::optional<std::vector<char>> read(const Key& key) noexcept override;
      void write(const Key& key, std::span<const char> record) noexcept override;
      void erase(const Key& key) noexcept override;

      // Bytes of records held, and how many.
      std::uint64_t bytes() const noexcept;
      std::size_t   entries() const noexcept;

     private:
      struct Impl;
      std::shared_ptr<Impl> impl;
   };

   // Compiled modules kept between runs: native code an engine executes as it
   // is. The cache therefore returns only content it has verified. A record is
   //
   //    artifact || key || SHA-256(artifact || key)
   //
   // and load() returns the artifact only if the digest matches and the key is
   // the one asked for. Anything else (truncated, altered, written before
   // records carried a digest, moved from another key) is erased and reported
   // with one log line, and the caller compiles again. The digest detects
   // damage; it is not a signature, so the store must still be writable only
   // by the user the node runs as.
   //
   // What the key covers (the code, the limits it was admitted under, the
   // engine's options and build) is the caller's: an artifact loaded under a
   // key is exactly what was stored under it.
   class NativeAotCache
   {
     public:
      using Key                                    = NativeArtifactStore::Key;
      static constexpr std::size_t maxArtifactSize = 256u * 1024u * 1024u;

      explicit NativeAotCache(const std::filesystem::path& directory) noexcept;
      explicit NativeAotCache(std::unique_ptr<NativeArtifactStore> store) noexcept;
      ~NativeAotCache();
      NativeAotCache(const NativeAotCache&)            = delete;
      NativeAotCache& operator=(const NativeAotCache&) = delete;

      bool                             usable() const noexcept;
      std::optional<std::vector<char>> load(const Key& key) const noexcept;
      void store(const Key& key, std::span<const char> artifact) const noexcept;
      void remove(const Key& key) const noexcept;

      // Records load() found damaged and erased, since this object was made.
      std::uint64_t discarded() const noexcept { return discardedCount.load(); }

     private:
      std::unique_ptr<NativeArtifactStore> records;
      mutable std::atomic<std::uint64_t>   discardedCount{0};
   };
}  // namespace psibase
