#include <boost/iostreams/filter/gzip.hpp>
#include <boost/iostreams/filtering_stream.hpp>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <vector>

#include <psibase/KvMerkle.hpp>
#include <psibase/SnapshotHeader.hpp>
#include <psibase/serviceEntry.hpp>
#include <psibase/tester.hpp>
#include <psibase/testerApi.hpp>
#include <services/system/VerifySig.hpp>
#include "LightValidator.hpp"

#include <psio/to_hex.hpp>

using psibase::BlockNum;
using psibase::DbId;
using psibase::KvMerkle;
using namespace psibase::snapshot;

namespace tester = psibase::tester;
namespace raw    = psibase::tester::raw;

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
   if (key.size() == 3 && key[0] == 0 && key[1] == StateChecksum::table && key[2] == 0)
   {
      footer.hash = psio::from_frac<StateChecksum>(value);
   }
   else if (key.size() >= 3 && key[0] == 0 && key[1] == StateSignature::table && key[2] == 0)
   {
      footer.signatures.push_back(psio::from_frac<StateSignature>(value));
   }
}

enum class ProducerGroup
{
   current      = 0,
   next         = 1,
   not_producer = -1,
};

bool isProducer(const psibase::Consensus& consensus, const StateSignature& sig)
{
   auto& producers = std::visit([](auto& c) -> auto& { return c.producers; }, consensus.data);
   return std::ranges::find_if(producers, [&](const auto& prod)
                               { return prod.name == sig.account && prod.auth == sig.claim; }) !=
          producers.end();
}

ProducerGroup findProducer(const psibase::JointConsensus& consensus, const StateSignature& sig)
{
   if (isProducer(consensus.current, sig))
      return ProducerGroup::current;
   else if (consensus.next && isProducer(consensus.next->consensus, sig))
      return ProducerGroup::next;
   else
      return ProducerGroup::not_producer;
}

std::string keyId(const psibase::Claim& claim)
{
   if (claim.service == SystemService::VerifySig::service)
   {
      auto fingerprint = keyFingerprint(SystemService::AuthSig::SubjectPublicKeyInfo{
          .data = {claim.rawData.begin(), claim.rawData.end()}});
      return psio::hex(fingerprint.data(), fingerprint.data() + 32, {':'});
   }
   else
      return psio::convert_to_json(claim);
}

std::size_t weakThreshold(const psibase::BftConsensus& c)
{
   return c.producers.size() / 3 + 1;
}

std::size_t weakThreshold(const psibase::CftConsensus& c)
{
   return 1;
}

std::size_t weakThreshold(const psibase::Consensus& consensus)
{
   return std::visit([](const auto& c) { return weakThreshold(c); }, consensus.data);
}

bool compareProducers(const psibase::Producer& lhs, const psibase::Producer& rhs)
{
   return std::tie(lhs.name, lhs.auth.service, lhs.auth.rawData) <
          std::tie(rhs.name, rhs.auth.service, rhs.auth.rawData);
};

int verifyHeaders(psibase::TestChain&          chain,
                  psibase::LightValidator&     validator,
                  const std::vector<BlockNum>& blocks,
                  const psibase::StatusRow&    status)
{
   psibase::check(!!status.head, "Missing head");
   auto maxNum = status.head->header.blockNum;
   for (BlockNum num : blocks)
   {
      // Skip blocks that are already known
      if (num <= validator.current.blockNum)
         continue;
      // Only process consensus changes up to but not including head.
      if (num >= maxNum)
         break;
      auto block = chain.kvGet<psibase::Block>(DbId::blockLog, num);
      if (!block)
      {
         std::cerr << "Missing block " << num << std::endl;
         return 1;
      }
      psibase::BlockInfo info{block->header};
      auto               sig = chain.kvGet<std::vector<char>>(DbId::blockProof, num);
      if (!sig)
         sig.emplace();
      std::optional<std::vector<char>> auxConsensusData;
      if (auto aux = chain.kvGet<psibase::BlockDataRow>(psibase::BlockDataRow::db,
                                                        psibase::blockDataKey(info.blockId)))
      {
         auxConsensusData = std::move(aux->auxConsensusData);
      }
      else
      {
         auto key  = psio::composite_key(psibase::blockDataPrefix(), info.header.commitNum);
         auto size = raw::kvGreaterEqual(chain.nativeHandle(), psibase::BlockDataRow::db,
                                         key.data(), key.size(), key.size());
         if (size != -1)
         {
            auto aux         = psibase::getResult(size);
            auxConsensusData = psio::from_frac<psibase::BlockDataRow>(aux).auxConsensusData;
         }
      }
      if (auto consensusChange = validator.push(psibase::SignedBlock{
              std::move(*block), std::move(*sig), std::move(auxConsensusData)}))
      {
         psibase::ChainHandle{chain.nativeHandle()}.kvPut(psibase::ConsensusChangeRow::db,
                                                          consensusChange->key(), *consensusChange);
      }
   }
   return 0;
}

BlockNum getBlockNum(const psibase::Checksum256& id)
{
   BlockNum result;
   auto     src  = id.data();
   auto     dest = reinterpret_cast<char*>(&result + 1);
   while (dest != reinterpret_cast<char*>(&result))
   {
      *--dest = *src++;
   }
   return result;
}

int verifyChainId(psibase::ChainHandle         chain,
                  const std::vector<BlockNum>& blocks,
                  const psibase::StatusRow&    status)
{
   if (blocks.empty())
   {
      // special case: the head block counts
      if (status.chainId == status.head->blockId)
      {
         return 0;
      }
      else
      {
         std::cerr << "Snapshot cannot be loaded in a new database" << std::endl;
         return 1;
      }
   }

   auto block = chain.kvGet<psibase::Block>(DbId::blockLog, blocks.front());
   if (!block)
   {
      std::cerr << "Missing block " << blocks.front() << std::endl;
      return 1;
   }
   psibase::BlockInfo info{block->header};
   if (info.blockId != status.chainId)
   {
      if (getBlockNum(status.chainId) < info.header.blockNum)
      {
         std::cerr << "Snapshot cannot be loaded in a new database" << std::endl;
      }
      else
      {
         std::cerr << "Snapshot chainId is inconsistent with block log" << std::endl;
      }
      return 1;
   }
   return 0;
}

int verifySignatures(std::uint32_t                  authServices,
                     const SnapshotFooter&          footer,
                     const psibase::JointConsensus& consensus)
{
   int                            result = 0;
   StateSignatureInfo             info{*footer.hash};
   std::span<const char>          preimage{info};
   auto                           hash = psibase::sha256(preimage.data(), preimage.size());
   std::vector<psibase::Producer> producerSignatures;
   for (const auto& sig : footer.signatures)
   {
      psibase::VerifyArgs args{hash, sig.claim, sig.rawData};
      psibase::Action     act{.service = sig.claim.service,
                              .method  = psibase::MethodNumber{"verifySys"},
                              .rawData = psio::to_frac(args)};
      auto trace = tester::runAction(authServices, psibase::RunMode::verify, false, act);
      if (!trace.error || trace.error->empty())
      {
         if (isProducer(consensus.current, sig))
         {
            producerSignatures.push_back({sig.account, sig.claim});
         }
         else
         {
            std::cerr << "Good signature from unverified key " << keyId(sig.claim) << std::endl;
         }
      }
      else
      {
         std::cerr << "Signature verification failed: " << *trace.error << std::endl;
         result = 1;
      }
   }
   if (!producerSignatures.empty())
   {
      std::ranges::sort(producerSignatures, compareProducers);
      producerSignatures.erase(std::ranges::unique(producerSignatures).begin(),
                               producerSignatures.end());
      if (producerSignatures.size() >= weakThreshold(consensus.current))
      {
         std::cerr << "Verified signature" << std::endl;
      }
      else
      {
         for (const auto& prod : producerSignatures)
         {
            std::cerr << "Good signature from " << prod.name.str() << std::endl;
         }
         std::cerr << "Not enough block producer signatures on snapshot" << std::endl;
         return 1;
      }
   }
   else
   {
      std::cerr << "Snapshot is not signed by the block producers" << std::endl;
      return 1;
   }
   return result;
}

int read(std::uint32_t          chain,
         auto&                  stream,
         SnapshotFooter&        footer,
         StateChecksum&         hash,
         std::vector<BlockNum>& blocks)
{
   std::uint32_t  db;
   KvMerkle::Item item;
   std::uint32_t  current_db = 0;
   KvMerkle       merkle;
   while (read_u32(db, stream))
   {
      switch (db)
      {
         case static_cast<std::uint32_t>(DbId::service):
         case static_cast<std::uint32_t>(DbId::native):
         case static_cast<std::uint32_t>(DbId::blockLog):
         case static_cast<std::uint32_t>(DbId::blockProof):
         case static_cast<std::uint32_t>(DbId::nativeSubjective):
         case SnapshotFooter::id:
            break;
         default:
            std::cerr << "Unexpected database id: " + std::to_string(db) << std::endl;
            return 1;
      }

      if (db != current_db)
      {
         if (db < current_db)
         {
            std::cerr << "Databases are in the wrong order" << std::endl;
            return 1;
         }
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
      auto key   = item.key();
      auto value = item.value();
      if (db == SnapshotFooter::id)
         read_footer_row(footer, key, value);
      else if (db == static_cast<std::uint32_t>(DbId::blockLog))
      {
         std::uint32_t num = 0;
         psibase::check(key.size() == 4, "wrong key size in blockLog");
         for (auto ch : key)
         {
            num = (num << 8) | static_cast<std::uint8_t>(ch);
         }
         blocks.push_back(num);
         // Only insert entries in the block log if they are missing.
         if (raw::kvGet(chain, static_cast<DbId>(db), key.data(), key.size()) == -1)
         {
            raw::kvPut(chain, static_cast<DbId>(db), key.data(), key.size(), value.data(),
                       value.size());
         }
      }
      else if (db == static_cast<std::uint32_t>(DbId::blockProof))
      {
         // Only insert entries in the block log if they are missing.
         if (raw::kvGet(chain, static_cast<DbId>(db), key.data(), key.size()) == -1)
         {
            raw::kvPut(chain, static_cast<DbId>(db), key.data(), key.size(), value.data(),
                       value.size());
         }
      }
      else if (db == static_cast<std::uint32_t>(DbId::nativeSubjective))
      {
         // TODO: validation
         if (raw::kvGet(chain, static_cast<DbId>(db), key.data(), key.size()) == -1)
         {
            raw::kvPut(chain, static_cast<DbId>(db), key.data(), key.size(), value.data(),
                       value.size());
         }
      }
      else
      {
         merkle.push(item);
         raw::kvPut(chain, static_cast<DbId>(db), key.data(), key.size(), value.data(),
                    value.size());
      }
   }
   return 0;
}

int verifyHeader(const psibase::BlockHeader& header)
{
   if (header.commitNum > header.blockNum)
      return 1;
   return 0;
}

std::vector<psibase::BlockHeaderAuthAccount> getAuthServices(std::uint32_t chain)
{
   std::vector<psibase::BlockHeaderAuthAccount> result;

   auto key   = psio::convert_to_key(psibase::codePrefix());
   auto value = std::vector<char>();
   auto match = key.size();
   while (true)
   {
      // load row
      std::uint32_t size = raw::kvGreaterEqual(chain, DbId::native, key.data(), key.size(), match);
      if (size == 0xffffffffu)
         break;
      value.resize(size);
      raw::getResult(value.data(), value.size(), 0);
      key.resize(raw::getKey(nullptr, 0));
      raw::getKey(key.data(), key.size());
      auto row = psio::from_frac<psibase::CodeRow>(value);

      if (row.flags & psibase::CodeRow::isAuthService)
      {
         result.push_back({.codeNum   = row.codeNum,
                           .codeHash  = row.codeHash,
                           .vmType    = row.vmType,
                           .vmVersion = row.vmVersion});
      }

      // increment key
      key.push_back(0);
   }
   return result;
}

int verifyState(std::uint32_t chain, const psibase::StatusRow& status)
{
   psibase::check(!!status.head, "Head block missing");
   psibase::check(psibase::BlockInfo(status.head->header).blockId == status.head->blockId,
                  "Head block id does not match header");
   psibase::check(sha256(status.consensus) == status.head->header.consensusState,
                  "Consensus state does not match block header");

   auto authServices = getAuthServices(chain);
   if (status.consensus.next)
   {
      psibase::check(authServices == status.consensus.next->consensus.services,
                     "Auth services in chain state do not match block header");
   }
   else
   {
      psibase::check(authServices == status.consensus.current.services,
                     "Auth services in chain state do not match block header");
   }
   return 0;
}

void writeSnapshotRow(psibase::ChainHandle      chain,
                      const psibase::StatusRow& status,
                      const SnapshotFooter&     footer)
{
   psibase::SnapshotRow row{
       .id    = status.head->blockId,
       .state = psibase::SnapshotStateItem{.state = *footer.hash, .signatures = footer.signatures}};
   chain.kvPut(psibase::SnapshotRow::db, row.key(), row);
}

void writeLogTruncateRow(psibase::ChainHandle         chain,
                         const psibase::StatusRow&    status,
                         const std::vector<BlockNum>& blocks)
{
   BlockNum start = status.head->header.blockNum;
   for (auto num : blocks | std::views::reverse)
   {
      if (num == start - 1)
         start = num;
      else if (num < start - 1)
         break;
   }
   psibase::LogTruncateRow row{start};
   chain.kvPut(psibase::LogTruncateRow::db, row.key(), row);
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

using input_stream = boost::iostreams::filtering_stream<boost::iostreams::input>;

bool setup_input(std::istream& is, input_stream& stream)
{
   switch (is.peek())
   {
      case '\0':
         break;
      case '\x1f':
         stream.push(boost::iostreams::gzip_decompressor());
         break;
      default:
         return false;
   }
   stream.push(is);
   return true;
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
   std::ifstream file;
   std::istream* is;
   if (in_path == std::string_view{"-"})
   {
      is = &std::cin;
   }
   else
   {
      file.open(in_path, std::ios_base::binary);
      if (!file)
      {
         std::cerr << "Failed to open " << argv[2] << std::endl;
         return 1;
      }
      is = &file;
   }
   input_stream in;
   if (!setup_input(*is, in))
   {
      std::cerr << in_path << " is not a snapshot file" << std::endl;
      return 1;
   }
   read_header({}, in);
   psibase::LightValidator validator{psibase::ChainHandle{handle}, oldStatus};
   clearDb(handle, DbId::service);
   clearDb(handle, DbId::native);
   clearDb(handle, DbId::writeOnly);
   SnapshotFooter        footer;
   StateChecksum         hash;
   std::vector<BlockNum> blocks;
   raw::checkoutSubjective(handle);
   if (int res = read(handle, in, footer, hash, blocks))
      return res;
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
      std::cerr << "Warning: snapshot does not include a checksum\n";
      footer.hash = hash;
   }
   auto newStatus = chain.kvGet<psibase::StatusRow>(DbId::native, psibase::statusKey());
   psibase::check(!!newStatus, "Missing status row");
   if (oldStatus)
   {
      if (oldStatus->chainId != newStatus->chainId)
      {
         std::cerr << "Snapshot is for a different chain" << std::endl;
         return 1;
      }
   }
   else
   {
      if (auto res = verifyChainId({handle}, blocks, *newStatus))
         return res;
   }
   if (int res = verifyState(handle, *newStatus))
      return res;
   if (int res = verifyHeaders(chain, validator, blocks, *newStatus))
      return res;
   if (validator.state.current != newStatus->consensus.current)
   {
      std::cerr << "Verification of current producers failed" << std::endl;
      return 1;
   }
   if (!footer.signatures.empty())
   {
      if (int res = verifySignatures(validator.authServices.id, footer, newStatus->consensus))
         return res;
   }
   else
   {
      std::cerr << "Snapshot is not signed\n";
      return 1;
   }
   if (newStatus->consensus.next)
      validator.writePrevAuthServices({handle});
   writeSnapshotRow({handle}, *newStatus, footer);
   writeLogTruncateRow({handle}, *newStatus, blocks);
   if (!raw::commitSubjective(handle))
   {
      std::cerr << "Failed to commit database changes" << std::endl;
      return 1;
   }
   raw::commitState(handle);
   std::cerr << "Snapshot successfully loaded\n"
             << "Chain: " << psio::hex(newStatus->chainId.begin(), newStatus->chainId.end())
             << "\nHead: "
             << psio::hex(newStatus->head->blockId.begin(), newStatus->head->blockId.end())
             << std::endl;
}
