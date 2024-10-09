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
      return keyFingerprint(SystemService::AuthSig::SubjectPublicKeyInfo{
          .data = {claim.rawData.begin(), claim.rawData.end()}});
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
      validator.push(
          psibase::SignedBlock{std::move(*block), std::move(*sig), std::move(auxConsensusData)});
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
      psibase::Action     act{.service = sig.claim.service, .rawData = psio::to_frac(args)};
      auto                packed = psio::to_frac(act);
      auto                size   = raw::verify(authServices, packed.data(), packed.size());
      auto trace = psio::from_frac<psibase::TransactionTrace>(psibase::getResult(size));
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
      producerSignatures.erase(std::ranges::unique(producerSignatures, compareProducers).begin(),
                               producerSignatures.end());
      if (producerSignatures.size() >= weakThreshold(consensus.current))
      {
         std::cerr << "Verified signature" << std::endl;
      }
      else
      {
         std::cerr << "Warning: not enough signatures on snapshot" << std::endl;
         for (const auto& prod : producerSignatures)
         {
            std::cerr << "Good signature from " << prod.name.str() << std::endl;
         }
      }
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
      if (authServices != status.consensus.current.services)
      {
         psibase::abortMessage("Not implemented: don't know how to get current auth services");
      }
   }
   else
   {
      psibase::check(authServices == status.consensus.current.services,
                     "Auth services in chain state do not match block header");
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
   psibase::LightValidator validator{psibase::ChainHandle{handle}, oldStatus};
   clearDb(handle, DbId::service);
   clearDb(handle, DbId::native);
   clearDb(handle, DbId::writeOnly);
   SnapshotFooter        footer;
   StateChecksum         hash;
   std::vector<BlockNum> blocks;
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
   if (oldStatus && oldStatus->chainId != newStatus->chainId)
   {
      std::cerr << "Snapshot is for a different chain" << std::endl;
      return 1;
   }
   if (int res = verifyState(handle, *newStatus))
      return res;
   if (int res = verifyHeaders(chain, validator, blocks, *newStatus))
      return res;
   if (validator.stateHash != newStatus->head->header.consensusState)
   {
      std::cerr << psio::format_json(validator.state) << std::endl;
      std::cerr << psio::format_json(newStatus->consensus) << std::endl;
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
      std::cerr << "Warning: snapshot is not signed\n";
   }
   raw::commitState(handle);
   std::cerr << "Snapshot successfully loaded\n"
             << "Chain: " << psio::hex(newStatus->chainId.begin(), newStatus->chainId.end())
             << "\nHead: "
             << psio::hex(newStatus->head->blockId.begin(), newStatus->head->blockId.end())
             << std::endl;
}
