#pragma once

#include <optional>
#include <psibase/block.hpp>
#include <psibase/check.hpp>
#include <psibase/crypto.hpp>
#include <psibase/headerValidation.hpp>
#include <psibase/serviceEntry.hpp>
#include <psibase/testerApi.hpp>
#include <psio/fracpack.hpp>
#include <psio/stream.hpp>
#include <vector>

namespace psibase
{
   struct ChainHandle
   {
      std::optional<std::vector<char>> kvGetRaw(psibase::DbId db, psio::input_stream key)
      {
         auto size = tester::raw::kvGet(id, db, key.pos, key.remaining());
         if (size == -1)
            return std::nullopt;
         return psibase::getResult(size);
      }

      template <typename V, typename K>
      std::optional<V> kvGet(psibase::DbId db, const K& key)
      {
         auto v = kvGetRaw(db, psio::convert_to_key(key));
         if (!v)
            return std::nullopt;
         // TODO: validate (allow opt-in or opt-out)
         return psio::from_frac<V>(psio::prevalidated{*v});
      }

      void kvPutRaw(psibase::DbId db, psio::input_stream key, psio::input_stream value)
      {
         tester::raw::kvPut(id, db, key.pos, key.remaining(), value.pos, value.remaining());
      }
      template <typename K, typename V>
         requires(!psio::is_std_optional<V>::value)
      void kvPut(DbId db, const K& key, const V& value)
      {
         kvPutRaw(db, psio::convert_to_key(key), psio::convert_to_frac(value));
      }

      void kvRemoveRaw(psibase::DbId db, psio::input_stream key)
      {
         tester::raw::kvRemove(id, db, key.pos, key.remaining());
      }
      template <typename K>
      void kvRemove(DbId db, const K& key)
      {
         kvRemoveRaw(db, psio::convert_to_key(key));
      }

      std::uint32_t id;
   };

   struct ScopedChain : ChainHandle
   {
      explicit ScopedChain(const DatabaseConfig& config = DatabaseConfig())
          : ScopedChain(tester::raw::createChain(config.hotBytes,
                                                 config.warmBytes,
                                                 config.coolBytes,
                                                 config.coldBytes))
      {
      }
      explicit ScopedChain(std::uint32_t id) : ChainHandle{id} {}
      ~ScopedChain() { tester::raw::destroyChain(id); }
      ChainHandle& base() { return *this; }
   };

   struct CommitMessage
   {
      static constexpr unsigned type = 39;
      Checksum256               block_id;
      AccountNumber             producer;
      Claim                     signer;
      // To save space, we're picking this apart and reconstituting it, while
      // assuming that the signature remains valid.
      PSIO_REFLECT(CommitMessage, definitionWillNotChange(), block_id, producer, signer)
   };

   Checksum256 makeSignatureHash(const CommitMessage& msg)
   {
      std::vector<char>   result;
      psio::vector_stream stream{result};
      stream.write(static_cast<char>(CommitMessage::type));
      psio::to_frac(msg, stream);
      return sha256(result.data(), result.size());
   }

   struct ProducerConfirm
   {
      AccountNumber     producer;
      std::vector<char> signature;
      friend bool       operator==(const ProducerConfirm&, const ProducerConfirm&) = default;
   };
   PSIO_REFLECT(ProducerConfirm, producer, signature)

   struct BlockConfirm
   {
      BlockNum                                    blockNum;
      std::vector<ProducerConfirm>                commits;
      std::optional<std::vector<ProducerConfirm>> nextCommits;
      PSIO_REFLECT(BlockConfirm, blockNum, commits, nextCommits)
   };

   struct LightValidator
   {
      explicit LightValidator(ChainHandle handle, const std::optional<psibase::StatusRow>& status)
      {
         if (status)
         {
            state     = status->consensus;
            stateHash = sha256(state);
            const auto& services =
                state.next ? state.next->consensus.services : status->consensus.current.services;
            check(!!status->head, "Missing head");
            current = status->head->header;
            psibase::copyServices(authServices.base(), handle, services);
         }
      }
      // Requires up to three blocks for each consensus change:
      // - The block that starts joint consensus
      // - The block in joint consensus that is made irreversible
      // - The block that ends joint consensus
      //
      // Note that all these blocks are required, but they are
      // not necessarily distinct.
      //
      void push(SignedBlock block)
      {
         auto& header = block.block.header;
         check(header.blockNum > current.blockNum, "Blocks must be added in order");
         if (header.newConsensus)
         {
            check(!state.next, "Already in joint consensus");
            state.next = {*header.newConsensus, header.blockNum};
            stateHash  = sha256(state);
            if (header.authCode)
            {
               pendingCode = std::move(*header.authCode);
            }
         }
         check(stateHash == header.consensusState, "consensus state does not match");
         if (state.next)
         {
            pendingBlocks.push_back({header.blockNum, BlockInfo{header}.blockId});
         }
         if (state.next && header.commitNum >= state.next->blockNum)
         {
            verifyIrreversible(state, block);
            state.current = std::move(state.next->consensus);
            state.next.reset();
            stateHash = sha256(state);
            pendingBlocks.clear();
         }
      }
      static const Claim& getProducerKey(const std::vector<Producer>& producers, AccountNumber prod)
      {
         if (producers.empty())
         {
            static const Claim empty;
            return empty;
         }
         for (const auto& [name, auth] : producers)
         {
            if (prod == name)
               return auth;
         }
         abortMessage(prod.str() + " is not an active producer");
      }
      void verifyIrreversible(const CftConsensus& consensus,
                              const JointConsensus&,
                              const SignedBlock& block)
      {
         BlockSignatureInfo    info{BlockInfo{block.block.header}};
         std::span<const char> buf{info};
         verifySignature(sha256(buf.data(), buf.size()),
                         getProducerKey(consensus.producers, block.block.header.producer),
                         block.signature);
         updateVerifyState();
      }
      void verifyIrreversible(const BftConsensus&   consensus,
                              const JointConsensus& jointConsensus,
                              const SignedBlock&    block)
      {
         check(!!block.auxConsensusData, "BFT requires auxConsensusData to prove irreversibility");
         auto confirms = psio::from_frac<BlockConfirm>(*block.auxConsensusData);
         auto blockId  = getBlockId(confirms.blockNum);
         // verify old producers
         for (const auto& msg : confirms.commits)
         {
            auto key  = getProducerKey(consensus.producers, msg.producer);
            auto hash = makeSignatureHash(CommitMessage{blockId, msg.producer, key});
            verifySignature(hash, key, msg.signature);
         }
         updateVerifyState();
         // verify new producers
         if (jointConsensus.next)
         {
            check(!!confirms.nextCommits, "Missing commits");
            auto& producers = std::visit([](auto& c) -> auto& { return c.producers; },
                                         jointConsensus.next->consensus.data);
            for (const auto& msg : *confirms.nextCommits)
            {
               auto key  = getProducerKey(producers, msg.producer);
               auto hash = makeSignatureHash(CommitMessage{blockId, msg.producer, key});
               verifySignature(hash, key, msg.signature);
            }
         }
      }
      void verifyIrreversible(const JointConsensus& consensus, const SignedBlock& block)
      {
         std::visit([&](const auto& c) { verifyIrreversible(c, consensus, block); },
                    consensus.current.data);
      }
      void updateVerifyState()
      {
         updateServices(authServices.base(), state.current.services, state.next->consensus.services,
                        pendingCode);
         pendingCode.clear();
      }
      Checksum256 getBlockId(BlockNum num)
      {
         for (const auto& block : pendingBlocks)
         {
            if (block.blockNum == num)
               return block.blockId;
         }
         abortMessage("Block " + std::to_string(num) + " not known");
      }
      void verifySignature(const Checksum256&       hash,
                           const Claim&             claim,
                           const std::vector<char>& signature)
      {
         if (claim.service == psibase::AccountNumber{})
            return;
         psibase::VerifyArgs args{hash, claim, signature};
         psibase::Action     act{.service = claim.service, .rawData = psio::to_frac(args)};
         auto                packed = psio::to_frac(act);
         auto size  = tester::raw::verify(authServices.id, packed.data(), packed.size());
         auto trace = psio::from_frac<psibase::TransactionTrace>(psibase::getResult(size));
         if (trace.error && !trace.error->empty())
         {
            abortMessage("Signature verification failed: " + *trace.error);
         }
      }

      struct PendingBlock
      {
         BlockNum    blockNum;
         Checksum256 blockId;
      };
      JointConsensus               state;
      std::vector<BlockHeaderCode> pendingCode;
      Checksum256                  stateHash;
      BlockHeader                  current;
      std::vector<PendingBlock>    pendingBlocks;
      ScopedChain                  authServices;
   };
}  // namespace psibase
