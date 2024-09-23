#include <cstdint>
#include <fstream>
#include <iostream>
#include <vector>

#include <psibase/db.hpp>
#include <psibase/testerApi.hpp>
#include "SnapshotHeader.hpp"

using psibase::DbId;
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

void write_db(std::uint32_t chain, DbId db, auto& stream)
{
   std::vector<char> key;
   std::vector<char> value;
   while (true)
   {
      std::uint32_t value_size = raw::kvGreaterEqual(chain, db, key.data(), key.size(), 0);
      if (value_size == 0xffffffffu)
         return;
      value.resize(value_size);
      raw::getResult(value.data(), value_size, 0);
      std::uint32_t key_size = raw::getKey(nullptr, 0);
      key.resize(key_size);
      raw::getKey(key.data(), key_size);
      //
      write_u32(static_cast<std::uint32_t>(db), stream);
      write_u32(key_size, stream);
      stream.write(key.data(), key_size);
      write_u32(value_size, stream);
      stream.write(value.data(), value_size);
      key.push_back(0);
   }
}

void write_header(const SnapshotHeader& header, auto& stream)
{
   write_u32(header.magic, stream);
   write_u32(header.version, stream);
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
   write_db(handle, DbId::service, out);
   write_db(handle, DbId::nativeConstrained, out);
   write_db(handle, DbId::nativeUnconstrained, out);
}