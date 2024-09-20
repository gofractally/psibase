#include <cstdint>
#include <fstream>
#include <iostream>
#include <vector>

#include <psibase/tester.hpp>
#include <psibase/testerApi.hpp>
#include "SnapshotHeader.hpp"

using psibase::DbId;
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

void read(std::uint32_t chain, auto& stream)
{
   std::uint32_t     db;
   std::vector<char> key, value;
   while (read_u32(db, stream))
   {
      switch (db)
      {
         case static_cast<std::uint32_t>(DbId::service):
         case static_cast<std::uint32_t>(DbId::nativeConstrained):
         case static_cast<std::uint32_t>(DbId::nativeUnconstrained):
            break;
         default:
            psibase::check(false, "Unexpected database id: " + std::to_string(db));
      }

      key.resize(read_u32(stream));
      stream.read(key.data(), key.size());
      value.resize(read_u32(stream));
      stream.read(value.data(), value.size());
      raw::kvPut(chain, static_cast<DbId>(db), key.data(), key.size(), value.data(), value.size());
   }
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
   auto               oldStatus =
       chain.kvGet<psibase::StatusRow>(DbId::nativeUnconstrained, psibase::statusKey());
   std::ifstream in(in_path);
   if (!in)
   {
      std::cerr << "Failed to open " << in_path << std::endl;
      return 1;
   }
   read_header({}, in);
   clearDb(handle, DbId::service);
   clearDb(handle, DbId::nativeConstrained);
   clearDb(handle, DbId::nativeUnconstrained);
   clearDb(handle, DbId::writeOnly);
   read(handle, in);
   auto newStatus =
       chain.kvGet<psibase::StatusRow>(DbId::nativeUnconstrained, psibase::statusKey());
   psibase::check(!!newStatus, "Missing status row");
   if (oldStatus)
      psibase::check(oldStatus->chainId == newStatus->chainId, "Snapshot is for a different chain");
   raw::commitState(handle);
}
