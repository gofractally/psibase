#include <cstdint>
#include <fstream>
#include <iostream>
#include <vector>

#include <psibase/tester.hpp>
#include "SnapshotHeader.hpp"

using psibase::DbId;
using namespace psibase::snapshot;

namespace raw
{
   [[clang::import_module("psibase"), clang::import_name("openChain")]]
   std::uint32_t openChain(const char*   path,
                           std::uint32_t pathlen,
                           std::uint16_t oflags,
                           std::uint64_t fs_rights_base,
                           const void*   config);

   [[clang::import_module("psibase"), clang::import_name("kvPut")]]
   void kvPut(std::uint32_t chain,
              psibase::DbId db,
              const char*   key,
              std::uint32_t keyLen,
              const char*   value,
              std::uint32_t valueLen);

   [[clang::import_module("psibase"), clang::import_name("commitState")]]
   void commitState(std::uint32_t chain);
}  // namespace raw

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

int main(int argc, const char* const* argv)
{
   if (argc < 3)
   {
      std::cerr << "Usage: " << argv[0] << " DATABASE SNAPSHOT-FILE" << std::endl;
      return 2;
   }
   std::string_view        out_path = argv[1];
   auto                    in_path  = argv[2];
   psibase::DatabaseConfig config;
   auto          handle = raw::openChain(out_path.data(), out_path.size(), __WASI_OFLAGS_CREAT,
                                         __WASI_RIGHTS_FD_READ | __WASI_RIGHTS_FD_WRITE, &config);
   std::ifstream in(in_path);
   if (!in)
   {
      std::cerr << "Failed to open " << in_path << std::endl;
      return 1;
   }
   read_header({}, in);
   read(handle, in);
   raw::commitState(handle);
}
