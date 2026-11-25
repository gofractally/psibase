#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <optional>
#include <span>
#include <vector>

namespace psibase
{
   // Opaque, per-user native artifacts. The caller must validate artifact content
   // and its compiler/options/Wasm identity before executing anything loaded here.
   class NativeAotCache
   {
     public:
      using Key                                    = std::array<std::uint8_t, 32>;
      static constexpr std::size_t maxArtifactSize = 256u * 1024u * 1024u;

      explicit NativeAotCache(const std::filesystem::path& directory) noexcept;
      ~NativeAotCache();
      NativeAotCache(const NativeAotCache&)            = delete;
      NativeAotCache& operator=(const NativeAotCache&) = delete;

      bool                             usable() const noexcept;
      std::optional<std::vector<char>> load(const Key& key) const noexcept;
      void store(const Key& key, std::span<const char> artifact) const noexcept;

     private:
      int directory = -1;
   };
}  // namespace psibase
