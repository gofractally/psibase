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

std::vector<KvHandle> BucketSet::add(std::vector<Bucket>&& src, std::uint32_t limit)
{
   std::vector<KvHandle> result;
   auto                  srcIter  = src.begin();
   auto                  srcEnd   = src.end();
   auto                  destIter = buckets.begin();
   auto                  destEnd  = buckets.end();
   while (srcIter != srcEnd)
   {
      while (destIter != destEnd && *destIter)
      {
         ++destIter;
      }
      if (destIter == destEnd)
      {
         check(srcEnd - srcIter <= limit - buckets.size(), "Too many database handles");
         while (srcIter != srcEnd)
         {
            result.push_back(static_cast<KvHandle>(buckets.size()));
            buckets.push_back(*srcIter);
            ++srcIter;
         }
         break;
      }
      *destIter = std::move(*srcIter);
      result.push_back(static_cast<KvHandle>(destIter - buckets.begin()));
      ++srcIter;
      ++destIter;
   }
   src.clear();
   return result;
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
