#pragma once

#include <cstdint>
#include <psibase/db.hpp>
#include <vector>

namespace psibase
{
   struct Bucket
   {
      DbId                              db;
      std::vector<char>                 prefix;
      KvMode                            mode = KvMode::none;
      explicit                          operator bool() const { return mode != KvMode::none; }
      std::vector<char>                 key(std::span<const char>) const;
      std::optional<Database::KVResult> trimResult(std::optional<Database::KVResult> result) const;

      bool isRead() const { return mode == KvMode::read || mode == KvMode::readWrite; }
      bool isWrite() const { return mode == KvMode::write || mode == KvMode::readWrite; }

      std::string to_string() const;
   };

   struct BucketSet
   {
      std::vector<Bucket> buckets;

      KvHandle open(DbId db, std::vector<char> prefix, KvMode mode, std::uint32_t limit);
      std::vector<KvHandle> add(std::vector<Bucket>&& buckets, std::uint32_t limit);
      void                  close(KvHandle handle);

      const Bucket& operator[](KvHandle handle) const;
   };
}  // namespace psibase
