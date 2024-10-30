#include <cstdint>
#include <fstream>
#include <iostream>
#include <vector>

#include <psibase/KvMerkle.hpp>
#include <psibase/SnapshotHeader.hpp>
#include <psibase/db.hpp>
#include <psibase/tester.hpp>
#include <psibase/testerApi.hpp>
#include <services/system/VerifySig.hpp>
#include "LightValidator.hpp"
#include "cli.hpp"

#include <tuple>

using psibase::BlockNum;
using psibase::Checksum256;
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
      auto          key        = item.key();
      std::uint32_t value_size = raw::kvGreaterEqual(chain, db, key.data(), key.size(), 0);
      if (value_size == 0xffffffffu)
         return;
      item.fromResult(value_size);
      write_row(static_cast<std::uint32_t>(db), item.key(), item.value(), stream);
      merkle.push(item);
      item.nextKey();
   }
}

void write_rows(std::uint32_t chain, DbId db, std::span<const char> prefix, auto& stream)
{
   KvMerkle::Item item{prefix, {}};
   while (true)
   {
      auto          key = item.key();
      std::uint32_t value_size =
          raw::kvGreaterEqual(chain, db, key.data(), key.size(), prefix.size());
      if (value_size == 0xffffffffu)
         return;
      item.fromResult(value_size);
      write_row(static_cast<std::uint32_t>(db), item.key(), item.value(), stream);
      item.nextKey();
   }
}

// This needs to write three different locations
// - blockLog
// - blockProof
// - BlockData
// - ConsensusChange(?) can be reconstructed
void write_consensus_change_blocks(std::uint32_t             chain,
                                   BlockNum                  start,
                                   BlockNum                  end,
                                   auto&                     stream,
                                   std::vector<BlockNum>&    signatures_required,
                                   std::vector<Checksum256>& commit_required)
{
   BlockNum          last = 0;
   Checksum256       lastId;
   std::vector<char> key = psio::convert_to_key(psibase::consensusChangeKey(start));
   std::vector<char> value;
   std::vector<char> blockKey;
   std::vector<char> block;
   auto              copy_block = [&](BlockNum num)
   {
      if (num <= last || num >= end)
         return;
      blockKey.clear();
      psio::vector_stream kstream{blockKey};
      psio::to_key(num, kstream);
      auto size = raw::kvGet(chain, DbId::blockLog, blockKey.data(), blockKey.size());
      if (size == -1)
         psibase::abortMessage("Block " + std::to_string(num) + " is not in the block log");
      block.resize(size);
      raw::getResult(block.data(), size, 0);
      auto block_view = psio::view<const psibase::Block>(psio::prevalidated{block});
      auto header     = block_view.header().unpack();
      lastId          = psibase::BlockInfo{header}.blockId;
      // Drop transactions. We don't need them
      {
         block.clear();
         psio::vector_stream bstream{block};
         psio::to_frac(psibase::Block{header}, bstream);
      }
      write_row(static_cast<std::uint32_t>(DbId::blockLog), blockKey, block, stream);
      last = num;
   };
   psio::size_stream prefix_size;
   psio::to_key(psibase::consensusChangePrefix(), prefix_size);
   auto read_next = [&]() -> std::optional<psibase::ConsensusChangeRow>
   {
      auto size = raw::kvGreaterEqual(chain, psibase::ConsensusChangeRow::db, key.data(),
                                      key.size(), prefix_size.size);
      if (size == -1)
         return {};
      value.resize(size);
      raw::getResult(value.data(), value.size(), 0);
      key.resize(raw::getKey(nullptr, 0));
      raw::getKey(key.data(), key.size());
      key.push_back('\0');
      auto result = psio::from_frac<psibase::ConsensusChangeRow>(value);
      if (result.end >= end)
         return {};
      return result;
   };
   while (auto item = read_next())
   {
      copy_block(item->start);
      copy_block(item->commit);
      commit_required.push_back(lastId);
      copy_block(item->end);
      signatures_required.push_back(item->end);
   }
}

void write_block_signatures(std::uint32_t                chain,
                            const std::vector<BlockNum>& signatures_required,
                            auto&                        stream)
{
   std::vector<char> key;
   std::vector<char> value;
   for (BlockNum num : signatures_required)
   {
      key.clear();
      psio::vector_stream kstream{key};
      psio::to_key(num, kstream);
      auto size = raw::kvGet(chain, DbId::blockProof, key.data(), key.size());
      if (size != -1)
      {
         value.resize(size);
         raw::getResult(value.data(), value.size(), 0);
         write_row(static_cast<std::uint32_t>(DbId::blockProof), key, value, stream);
      }
   }
}

void write_block_data(std::uint32_t                   chain,
                      const std::vector<Checksum256>& commit_required,
                      auto&                           stream)
{
   std::vector<char> key;
   std::vector<char> value;
   for (auto id : commit_required)
   {
      key.clear();
      psio::vector_stream kstream{key};
      psio::to_key(psibase::blockDataKey(id), kstream);
      auto size =
          raw::kvGreaterEqual(chain, DbId::nativeSubjective, key.data(), key.size(), key.size());
      if (size != -1)
      {
         value.resize(size);
         raw::getResult(value.data(), value.size(), 0);
         key.clear();
         key.resize(raw::getKey(nullptr, 0));
         raw::getKey(key.data(), key.size());
         write_row(static_cast<std::uint32_t>(DbId::nativeSubjective), key, value, stream);
      }
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
Writes a snapshot of the chain to a file. The snapshot will hold the the most
recent state that is signed by the block producers.

Options:
  -s, --sign KEY-FILE   Signs the snapshot with this key
  -b, --blocks          Include the block log
  -h, --help            Prints a help message
)";

int main(int argc, const char* const* argv)
{
   std::vector<std::string_view> key_files;
   std::string_view              database_file;
   std::string_view              snapshot_file;
   bool                          help   = false;
   bool                          blocks = false;
   auto                          opts =
       std::tuple(Option{&blocks, 'b', "blocks"}, Option{&key_files, 's', "sign"},
                  Option{&help, 'h', "help"}, PositionalOptions{&database_file, &snapshot_file});
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
   SnapshotFooter   footer;
   for (auto key : key_files)
   {
      auto contents = psibase::readWholeFile(key);
      auto pvt      = SystemService::AuthSig::PrivateKeyInfo{
          SystemService::AuthSig::parsePrivateKeyInfo({contents.data(), contents.size()})};
      auto pub = SystemService::AuthSig::getSubjectPublicKeyInfo(pvt);
      keys.emplace_back(std::move(pub), std::move(pvt));
   }
   psibase::TestChain chain(database_file, O_RDONLY);
   auto               handle = chain.nativeHandle();
   {
      auto key       = psio::convert_to_key(psibase::snapshotPrefix());
      auto size      = raw::kvMax(handle, psibase::SnapshotRow::db, key.data(), key.size());
      auto prefixLen = key.size();
      while (true)
      {
         if (size == -1)
         {
            std::cerr << "No verified snapshot available" << std::endl;
            return 1;
         }
         auto snapshot = psio::from_frac<psibase::SnapshotRow>(psibase::getResult(size));
         key.resize(raw::getKey(nullptr, 0));
         raw::getKey(key.data(), key.size());
         raw::getFork(handle, snapshot.id);
         auto status = chain.kvGet<psibase::StatusRow>(DbId::native, psibase::statusKey());
         if (!status || !status->head)
         {
            std::cerr << "No chain" << std::endl;
         }
         std::size_t threshold;
         if (const auto* bft = std::get_if<psibase::BftConsensus>(&status->consensus.current.data))
         {
            threshold = (bft->producers.size() + 2) / 3;
         }
         else if (const auto* cft =
                      std::get_if<psibase::CftConsensus>(&status->consensus.current.data))
         {
            threshold = 1;
         }
         else
         {
            psibase::abortMessage("Invalid consensus");
         }
         if (snapshot.state && snapshot.state->signatures.size() >= threshold)
         {
            footer.signatures = std::move(snapshot.state->signatures);
            break;
         }
         else
         {
            size = raw::kvLessThan(handle, psibase::SnapshotRow::db, key.data(), key.size(),
                                   prefixLen);
         }
      }
   }
   auto status = chain.kvGet<psibase::StatusRow>(DbId::native, psibase::statusKey());
   if (!status || !status->head)
   {
      std::cerr << "No chain" << std::endl;
      return 1;
   }
   std::ofstream out(snapshot_file.data(), std::ios_base::trunc | std::ios_base::binary);
   if (!out)
   {
      std::cerr << "Failed to open " << snapshot_file << std::endl;
      return 1;
   }
   write_header({}, out);
   footer.hash.emplace();
   KvMerkle merkle;
   write_db(handle, DbId::service, out, merkle);
   footer.hash->serviceRoot = std::move(merkle).root();
   write_db(handle, DbId::native, out, merkle);
   footer.hash->nativeRoot = std::move(merkle).root();
   std::vector<BlockNum>             need_signatures;
   std::vector<psibase::Checksum256> need_commit;
   if (!blocks)
   {
      write_consensus_change_blocks(handle, 0, status->head->header.blockNum + 1, out,
                                    need_signatures, need_commit);
   }
   if (blocks)
   {
      write_rows(handle, DbId::blockLog, {}, out);
   }

   write_block_signatures(handle, need_signatures, out);
   if (blocks)
   {
      write_rows(handle, DbId::blockProof, {}, out);
   }

   write_block_data(handle, need_commit, out);
   if (!keys.empty())
   {
      StateSignatureInfo    info{*footer.hash};
      std::span<const char> preimage{info};
      auto                  hash = psibase::sha256(preimage.data(), preimage.size());
      for (const auto& key : keys)
      {
         psibase::Claim         pubkey{.service = SystemService::VerifySig::service,
                                       .rawData = {key.first.data.begin(), key.first.data.end()}};
         psibase::AccountNumber account;
         for (const auto& prod :
              std::visit([](auto& c) { return c.producers; }, status->consensus.current.data))
         {
            if (prod.auth == pubkey)
            {
               account = prod.name;
               break;
            }
         }
         auto           sigData = sign(key.second, hash);
         StateSignature sig{
             .account = account, .claim = pubkey, .rawData{sigData.begin(), sigData.end()}};
         footer.signatures.push_back(std::move(sig));
      }
   }
   write_footer(footer, out);
}
