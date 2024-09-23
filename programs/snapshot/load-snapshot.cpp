#include <cstdint>
#include <fstream>
#include <iostream>
#include <vector>

#include <psibase/KvMerkle.hpp>
#include <psibase/tester.hpp>
#include <psibase/testerApi.hpp>
#include "SnapshotHeader.hpp"

#include <psio/to_hex.hpp>

using psibase::DbId;
using psibase::KvMerkle;
using namespace psibase::snapshot;

namespace raw = psibase::tester::raw;

bool read_u32(std::uint32_t& result, auto& stream)
{
   if (!stream.read(reinterpret_cast<char*>(&result), sizeof(result)))
      return false;
   return true;
}

std::uint32_t read_u32(auto& stream)
{
   std::uint32_t result;
   if (!read_u32(result, stream))
      psibase::check(false, "read");
   return result;
}

void read_header(const SnapshotHeader& header, auto& stream)
{
   psibase::check(read_u32(stream) == header.magic, "Not a snapshot file");
   psibase::check(read_u32(stream) == header.version, "Unexpected snapshot version");
}

void read_footer_row(SnapshotFooter& footer, std::span<const char> key, std::span<const char> value)
{
   if (key.size() >= 3 && key[0] == 0 && key[1] == StateChecksum::table && key[2] == 0)
   {
      footer.hash = psio::from_frac<StateChecksum>(value);
   }
   else if (key.size() == 3 && key[0] == 0 && key[1] == StateSignature::table && key[2] == 0)
   {
      footer.signatures.push_back(psio::from_frac<StateSignature>(value));
   }
}

int read(std::uint32_t chain, auto& stream)
{
   std::uint32_t  db;
   KvMerkle::Item item;
   std::uint32_t  current_db = 0;
   KvMerkle       merkle;
   SnapshotFooter footer;
   StateChecksum  hash;
   while (read_u32(db, stream))
   {
      switch (db)
      {
         case static_cast<std::uint32_t>(DbId::service):
         case static_cast<std::uint32_t>(DbId::native):
         case SnapshotFooter::id:
            break;
         default:
            psibase::check(false, "Unexpected database id: " + std::to_string(db));
      }

      if (db != current_db)
      {
         psibase::check(db > current_db, "Databases are in the wrong order");
         if (current_db == static_cast<std::uint32_t>(DbId::service))
         {
            hash.serviceRoot = std::move(merkle).root();
         }
         else if (current_db == static_cast<std::uint32_t>(DbId::native))
         {
            hash.nativeRoot = std::move(merkle).root();
         }
         current_db = db;
      }

      item.fromStream(stream);
      auto key   = sspan(item.key());
      auto value = sspan(item.value());
      if (db == SnapshotFooter::id)
         read_footer_row(footer, key, value);
      else
      {
         merkle.push(item);
         raw::kvPut(chain, static_cast<DbId>(db), key.data(), key.size(), value.data(),
                    value.size());
      }
   }
   if (footer.hash)
   {
      if (*footer.hash != hash)
      {
         std::cerr << "Snapshot checksum failed\n";
         return 1;
      }
   }
   else
   {
      std::cerr << "Warning: snapshot does not have a checksum\n";
   }
   return 0;
}

void clearDb(std::uint32_t chain, DbId db)
{
   std::vector<char> key;
   while (true)
   {
      std::uint32_t value_size = raw::kvGreaterEqual(chain, db, key.data(), key.size(), 0);
      if (value_size == 0xffffffffu)
         return;
      std::uint32_t key_size = raw::getKey(nullptr, 0);
      key.resize(key_size);
      raw::getKey(key.data(), key_size);
      raw::kvRemove(chain, db, key.data(), key.size());
   }
}

int main(int argc, const char* const* argv)
{
   if (argc < 3)
   {
      std::cerr << "Usage: psibase load-snapshot DATABASE SNAPSHOT-FILE" << std::endl;
      return 2;
   }
   std::string_view   out_path = argv[1];
   auto               in_path  = argv[2];
   psibase::TestChain chain(out_path, O_CREAT | O_RDWR);
   auto               handle = chain.nativeHandle();
   auto          oldStatus   = chain.kvGet<psibase::StatusRow>(DbId::native, psibase::statusKey());
   std::ifstream in(in_path);
   if (!in)
   {
      std::cerr << "Failed to open " << in_path << std::endl;
      return 1;
   }
   read_header({}, in);
   clearDb(handle, DbId::service);
   clearDb(handle, DbId::native);
   clearDb(handle, DbId::writeOnly);
   if (int res = read(handle, in))
      return res;
   auto newStatus = chain.kvGet<psibase::StatusRow>(DbId::native, psibase::statusKey());
   psibase::check(!!newStatus, "Missing status row");
   if (oldStatus)
      psibase::check(oldStatus->chainId == newStatus->chainId, "Snapshot is for a different chain");
   raw::commitState(handle);
}
