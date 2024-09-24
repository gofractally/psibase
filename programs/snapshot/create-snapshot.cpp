#include <cstdint>
#include <fstream>
#include <iostream>
#include <vector>

#include <psibase/KvMerkle.hpp>
#include <psibase/db.hpp>
#include <psibase/tester.hpp>
#include <psibase/testerApi.hpp>
#include <services/system/VerifySig.hpp>
#include "SnapshotHeader.hpp"
#include "cli.hpp"

#include <tuple>

using psibase::DbId;
using psibase::KvMerkle;
using namespace psibase::snapshot;
namespace raw = psibase::tester::raw;
using psibase::cli::Option;
using psibase::cli::parse;
using psibase::cli::PositionalOptions;

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

static const char* usage_brief =
    "Usage: psibase create-snapshot [-s KEY]... DATABASE SNAPSHOT-FILE";

static auto usage_full = R"(
Writes a snapshot of the chain to a file

Options:
  -s, --sign KEY-FILE   Signs the snapshot with this key
  -h, --help            Prints a help message
)";

int main(int argc, const char* const* argv)
{
   std::vector<std::string_view> key_files;
   std::string_view              database_file;
   std::string_view              snapshot_file;
   bool                          help = false;
   auto opts = std::tuple(Option{&key_files, 's', "sign"}, Option{&help, 'h', "help"},
                          PositionalOptions{&database_file, &snapshot_file});
   if (!parse(argc, argv, opts))
   {
      std::cerr << usage_brief << std::endl;
      return 2;
   }
   if (help)
   {
      std::cerr << usage_brief << '\n' << usage_full;
      return 2;
   }
   if (snapshot_file.data() == nullptr)
   {
      std::cerr << usage_brief << std::endl;
      return 2;
   }
   psibase::KeyList keys;
   for (auto key : key_files)
   {
      auto contents = psibase::readWholeFile(key);
      auto pvt      = SystemService::AuthSig::PrivateKeyInfo{
          SystemService::AuthSig::parsePrivateKeyInfo({contents.data(), contents.size()})};
      auto pub = SystemService::AuthSig::getSubjectPublicKeyInfo(pvt);
      keys.emplace_back(std::move(pub), std::move(pvt));
   }
   auto          handle = raw::openChain(database_file.data(), database_file.size(), 0,
                                         __WASI_RIGHTS_FD_READ, nullptr);
   std::ofstream out(snapshot_file, std::ios_base::trunc | std::ios_base::binary);
   if (!out)
   {
      std::cerr << "Failed to open " << snapshot_file << std::endl;
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
   if (!keys.empty())
   {
      StateSignatureInfo    info{*footer.hash};
      std::span<const char> preimage{info};
      auto                  hash = psibase::sha256(preimage.data(), preimage.size());
      for (const auto& key : keys)
      {
         auto           sigData = sign(key.second, hash);
         StateSignature sig{.claim = {.service = SystemService::VerifySig::service,
                                      .rawData = {key.first.data.begin(), key.first.data.end()}},
                            .rawData{sigData.begin(), sigData.end()}};
         footer.signatures.push_back(std::move(sig));
      }
   }
   write_footer(footer, out);
}
