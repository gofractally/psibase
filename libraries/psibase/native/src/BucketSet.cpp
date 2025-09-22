#include <psibase/BucketSet.hpp>

#include <psibase/check.hpp>
#include <psio/to_hex.hpp>

using namespace psibase;

std::vector<char> Bucket::key(std::span<const char> subkey) const
{
   std::vector<char> result;
   result.reserve(subkey.size() + prefix.size());
   result.insert(result.end(), prefix.begin(), prefix.end());
   result.insert(result.end(), subkey.begin(), subkey.end());
   return result;
}

std::string Bucket::to_string() const
{
   return "db=" + std::to_string(static_cast<std::uint32_t>(db)) +
          " prefix=" + psio::to_hex(prefix) +
          " mode=" + std::to_string(static_cast<std::uint32_t>(mode));
}

std::optional<Database::KVResult> Bucket::trimResult(std::optional<Database::KVResult> result) const
{
   if (result)
   {
      result->key.skip(prefix.size());
   }
   return result;
}

KvHandle BucketSet::open(DbId db, std::vector<char> prefix, KvMode mode, std::uint32_t limit)
{
   check(mode != KvMode::none, "Invalid mode");
   for (auto& bucket : buckets)
   {
      if (!bucket)
      {
         bucket = {db, std::move(prefix), mode};
         return static_cast<KvHandle>(&bucket - &buckets[0]);
      }
   }
   check(buckets.size() < limit, "Too many database handles");
   buckets.push_back({db, std::move(prefix), mode});
   return static_cast<KvHandle>(buckets.size() - 1);
}

void BucketSet::close(KvHandle handle)
{
   auto idx = static_cast<std::size_t>(handle);
   check(idx < buckets.size() && buckets[idx].mode != KvMode::none, "Invalid bucket");
   //buckets[idx] = {};
   buckets[idx].mode = KvMode::none;
}

const Bucket& BucketSet::operator[](KvHandle handle) const
{
   auto idx = static_cast<std::size_t>(handle);
   check(idx < buckets.size() && buckets[idx].mode != KvMode::none, "Invalid bucket");
   return buckets[idx];
}
