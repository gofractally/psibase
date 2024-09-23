#include <cstdint>
#include <fstream>
#include <iostream>
#include <vector>

#include <psibase/KvMerkle.hpp>
#include <psibase/db.hpp>
#include <psibase/testerApi.hpp>
#include "SnapshotHeader.hpp"

using psibase::DbId;
using psibase::KvMerkle;
using namespace psibase::snapshot;
namespace raw = psibase::tester::raw;

// snapshot format:
// header
// (dbid size32 key size32 value)*

// A snapshot must include a subset of blocks (sufficient to prove validity)

void write_u32(std::uint32_t value, auto& stream)
{
   stream.write(reinterpret_cast<const char*>(&value), sizeof(value));
}

void write_row(std::uint32_t         db,
               std::span<const char> key,
               std::span<const char> value,
               auto&                 stream)
{
   std::uint32_t key_size   = key.size();
   std::uint32_t value_size = value.size();
   write_u32(db, stream);
   write_u32(key_size, stream);
   stream.write(key.data(), key_size);
   write_u32(value_size, stream);
   stream.write(value.data(), value_size);
}

void write_db(std::uint32_t chain, DbId db, auto& stream, KvMerkle& merkle)
{
   KvMerkle::Item item{{}, {}};
   while (true)
   {
      auto          key        = sspan(item.key());
      std::uint32_t value_size = raw::kvGreaterEqual(chain, db, key.data(), key.size(), 0);
      if (value_size == 0xffffffffu)
         return;
      item.fromResult(value_size);
      write_row(static_cast<std::uint32_t>(db), sspan(item.key()), sspan(item.value()), stream);
      merkle.push(item);
      item.nextKey();
   }
}

void write_header(const SnapshotHeader& header, auto& stream)
{
   write_u32(header.magic, stream);
   write_u32(header.version, stream);
}

void write_footer(const SnapshotFooter& self, auto& stream)
{
   write_row(SnapshotFooter::id, self.hash->key(), psio::to_frac(*self.hash), stream);
   for (const auto& sig : self.signatures)
      write_row(SnapshotFooter::id, sig.key(), psio::to_frac(sig), stream);
}

int main(int argc, const char* const* argv)
{
   if (argc < 3)
   {
      std::cerr << "Usage: psibase create-snapshot DATABASE SNAPSHOT-FILE" << std::endl;
      return 2;
   }
   std::string_view in_path  = argv[1];
   auto             out_path = argv[2];
   auto handle = raw::openChain(in_path.data(), in_path.size(), 0, __WASI_RIGHTS_FD_READ, nullptr);
   std::ofstream out(out_path, std::ios_base::trunc | std::ios_base::binary);
   if (!out)
   {
      std::cerr << "Failed to open " << out_path << std::endl;
      return 1;
   }
   write_header({}, out);
   SnapshotFooter footer;
   footer.hash.emplace();
   KvMerkle merkle;
   write_db(handle, DbId::service, out, merkle);
   footer.hash->serviceRoot = std::move(merkle).root();
   write_db(handle, DbId::native, out, merkle);
   footer.hash->nativeRoot = std::move(merkle).root();
   write_footer(footer, out);
}
