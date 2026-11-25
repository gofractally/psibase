// NativeAotCache: the verified front of a NativeArtifactStore. See the header
// for the record layout and what a caller may rely on.

#include <psibase/NativeAotCache.hpp>

#include <psibase/crypto.hpp>
#include <psibase/log.hpp>
#include <psio/to_hex.hpp>

#include <cstring>

namespace psibase
{
   namespace
   {
      constexpr std::size_t keySize     = std::tuple_size<NativeAotCache::Key>::value;
      constexpr std::size_t digestSize  = std::tuple_size<Checksum256>::value;
      constexpr std::size_t trailerSize = keySize + digestSize;

      // Whether `record` is exactly what store() wrote under `key`.
      bool verified(const NativeAotCache::Key& key, const std::vector<char>& record) noexcept
      {
         if (record.size() <= trailerSize ||
             record.size() - trailerSize > NativeAotCache::maxArtifactSize)
            return false;
         const std::size_t hashed = record.size() - digestSize;
         if (std::memcmp(record.data() + hashed - keySize, key.data(), keySize) != 0)
            return false;
         const auto digest = sha256(record.data(), hashed);
         return std::memcmp(record.data() + hashed, digest.data(), digestSize) == 0;
      }
   }  // namespace

   NativeAotCache::NativeAotCache(const std::filesystem::path& directory) noexcept
   {
      try
      {
         records = std::make_unique<NativeAotDirectory>(directory);
      }
      catch (...)
      {
         // Caching cannot prevent VM execution, including allocation failures.
      }
   }

   NativeAotCache::NativeAotCache(std::unique_ptr<NativeArtifactStore> store) noexcept
       : records(std::move(store))
   {
   }

   NativeAotCache::~NativeAotCache() = default;

   bool NativeAotCache::usable() const noexcept
   {
      return records && records->usable();
   }

   std::optional<std::vector<char>> NativeAotCache::load(const Key& key) const noexcept
   {
      try
      {
         if (!records)
            return std::nullopt;
         auto record = records->read(key);
         if (!record)
            return std::nullopt;
         if (!verified(key, *record))
         {
            records->erase(key);
            ++discardedCount;
            PSIBASE_LOG(loggers::generic::get(), warning)
                << "Compiled-module cache entry " << psio::to_hex(key.begin(), key.end())
                << " failed verification (" << record->size()
                << " bytes); discarded, the module will be compiled again";
            return std::nullopt;
         }
         record->resize(record->size() - trailerSize);
         return record;
      }
      catch (...)
      {
         return std::nullopt;
      }
   }

   void NativeAotCache::store(const Key& key, std::span<const char> artifact) const noexcept
   {
      try
      {
         if (!records || artifact.empty() || artifact.size() > maxArtifactSize)
            return;
         std::vector<char> record;
         record.reserve(artifact.size() + trailerSize);
         record.insert(record.end(), artifact.begin(), artifact.end());
         record.insert(record.end(), key.begin(), key.end());
         const auto digest = sha256(record.data(), record.size());
         record.insert(record.end(), digest.begin(), digest.end());
         records->write(key, record);
      }
      catch (...)
      {
      }
   }

   void NativeAotCache::remove(const Key& key) const noexcept
   {
      if (records)
         records->erase(key);
   }
}  // namespace psibase
