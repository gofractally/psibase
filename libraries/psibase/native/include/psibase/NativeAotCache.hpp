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
