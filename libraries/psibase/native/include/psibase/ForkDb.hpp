#pragma once

#include <boost/container/flat_map.hpp>
#include <boost/log/attributes/constant.hpp>
#include <iostream>
#include <psibase/BlockContext.hpp>
#include <psibase/KvMerkle.hpp>
#include <psibase/Prover.hpp>
#include <psibase/Socket.hpp>
#include <psibase/VerifyProver.hpp>
#include <psibase/block.hpp>
#include <psibase/db.hpp>
#include <psibase/headerValidation.hpp>
#include <psibase/log.hpp>
#include <psibase/serviceEntry.hpp>
#include <psio/to_hex.hpp>

#include <ranges>

namespace psibase
{

   inline BlockNum getBlockNum(const Checksum256& id)
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

   // TODO: num is encoded in id now
   struct ExtendedBlockId
   {
      Checksum256 _id;
      BlockNum    _num;
      Checksum256 id() const { return _id; }
      BlockNum    num() const { return _num; }
      friend bool operator==(const ExtendedBlockId&, const ExtendedBlockId&) = default;
   };
   PSIO_REFLECT(ExtendedBlockId, _id, _num)

   enum class ConsensusAlgorithm : std::uint8_t
   {
      cft,
      bft
   };
   inline std::tuple<ConsensusAlgorithm, const std::vector<Producer>&> split(const CftConsensus& c)
   {
      return {ConsensusAlgorithm::cft, c.producers};
   }
   inline std::tuple<ConsensusAlgorithm, const std::vector<Producer>&> split(const BftConsensus& c)
   {
      return {ConsensusAlgorithm::bft, c.producers};
   }

   struct consensus_failure
   {
   };

   struct BlockAuthState;

   struct ProducerSet
   {
      ConsensusAlgorithm                               algorithm;
      boost::container::flat_map<AccountNumber, Claim> activeProducers;
      // Holds the services that can be used to verify producer
      // signatures.
      std::shared_ptr<BlockAuthState> authState;
      ProducerSet() = default;
      ProducerSet(const ConsensusData& c)
      {
         const auto& [alg, prods] = std::visit([](auto& c) { return split(c); }, c);
         algorithm                = alg;
         decltype(activeProducers)::sequence_type result;
         for (const auto& [name, claim] : prods)
         {
            result.emplace_back(name, claim);
         }
         activeProducers.adopt_sequence(std::move(result));
      }
      ProducerSet(const Consensus& c) : ProducerSet(c.data) {}
      bool isProducer(AccountNumber producer) const
      {
         return activeProducers.find(producer) != activeProducers.end();
      }
      std::optional<std::size_t> getIndex(AccountNumber producer) const
      {
         auto iter = activeProducers.find(producer);
         if (iter != activeProducers.end())
         {
            return iter - activeProducers.begin();
         }
         else
         {
            return {};
         }
      }
      std::optional<std::size_t> getIndex(AccountNumber producer, const Claim& claim) const
      {
         auto iter = activeProducers.find(producer);
         if (iter != activeProducers.end() && iter->second == claim)
         {
            return iter - activeProducers.begin();
         }
         else
         {
            return {};
         }
      }
      std::optional<Claim> getClaim(AccountNumber producer) const
      {
         auto iter = activeProducers.find(producer);
         if (iter != activeProducers.end())
         {
            return iter->second;
         }
         else
         {
            return {};
         }
      }
      std::size_t size() const { return activeProducers.size(); }
      friend bool operator==(const ProducerSet&, const ProducerSet&) = default;
      std::size_t threshold() const
      {
         if (algorithm == ConsensusAlgorithm::cft)
         {
            return activeProducers.size() / 2 + 1;
         }
         else
         {
            assert(algorithm == ConsensusAlgorithm::bft);
            return activeProducers.size() * 2 / 3 + 1;
         }
      }
      std::size_t weak_threshold() const
      {
         if (algorithm == ConsensusAlgorithm::cft)
         {
            return 1;
         }
         else
         {
            assert(algorithm == ConsensusAlgorithm::bft);
            return (activeProducers.size() + 2) / 3;
         }
      }
      std::string to_string() const
      {
         std::string result;
         if (algorithm == ConsensusAlgorithm::cft)
         {
            result += "CFT:";
         }
         else if (algorithm == ConsensusAlgorithm::bft)
         {
            result += "BFT:";
         }
         result += '[';
         bool first = true;
         for (const auto& [name, auth] : activeProducers)
         {
            if (first)
            {
               first = false;
            }
            else
            {
               result += ',';
            }
            result += name.str();
         }
         result += ']';
         return result;
      }
   };

   inline std::ostream& operator<<(std::ostream& os, const ProducerSet& prods)
   {
      return os << prods.to_string();
   }

   struct BlockAuthState
   {
      ConstRevisionPtr                    revision;
      std::vector<BlockHeaderAuthAccount> services;

      // Reads the next or current state
      BlockAuthState(SystemContext* systemContext, const WriterPtr& writer, Database& db)
      {
         revision = systemContext->sharedDatabase.emptyRevision();
         if (auto status = db.kvGet<StatusRow>(StatusRow::db, StatusRow::key()))
         {
            Database dst{systemContext->sharedDatabase, revision};
            auto     session = dst.startWrite(writer);
            if (status->consensus.next)
            {
               services = status->consensus.next->consensus.services;
            }
            else
            {
               services = status->consensus.current.services;
            }
            copyServices(dst, db, services);
            revision = dst.getModifiedRevision();
         }
      }

      // Loads the current state
      BlockAuthState(SystemContext*   systemContext,
                     const WriterPtr& writer,
                     Database&        db,
                     ConstRevisionPtr revision)
          : revision(revision ? std::move(revision) : systemContext->sharedDatabase.emptyRevision())
      {
         if (auto status = db.kvGet<StatusRow>(StatusRow::db, StatusRow::key()))
         {
            services = status->consensus.current.services;
         }
      }

      const std::vector<BlockHeaderAuthAccount>* getUpdatedAuthServices(
          const BlockHeader& header) const
      {
         if (header.newConsensus)
         {
            auto& result = header.newConsensus->services;
            if (result != services)
               return &result;
         }
         return nullptr;
      }

      static std::shared_ptr<BlockAuthState> next(SystemContext*   systemContext,
                                                  const WriterPtr& writer,
                                                  const std::shared_ptr<BlockAuthState>& prev,
                                                  const BlockHeader&                     header)
      {
         if (const auto* newServices = prev->getUpdatedAuthServices(header))
         {
            check(!!header.authCode, "code must be provided when changing auth services");
            return std::make_shared<BlockAuthState>(systemContext, writer, *prev, header,
                                                    *newServices);
         }
         else
         {
            check(!header.authCode, "authCode unexpected");
            return prev;
         }
      }

      BlockAuthState(SystemContext*                             systemContext,
                     const WriterPtr&                           writer,
                     const BlockAuthState&                      prev,
                     const BlockHeader&                         header,
                     const std::vector<BlockHeaderAuthAccount>& newServices)
      {
         check(!!header.authCode, "code must be provided when changing auth services");
         services = newServices;
         Database db{systemContext->sharedDatabase, prev.revision};
         auto     session = db.startWrite(writer);
         updateServices(db, prev.services, services, *header.authCode);
         revision = db.getModifiedRevision();
      }
   };

   struct BuildStateChecksum
   {
      snapshot::StateChecksum operator()()
      {
         Database                db{sharedDatabase, revision};
         auto                    session = db.startRead();
         snapshot::StateChecksum result{.serviceRoot = hash(db, DbId::service),
                                        .nativeRoot  = hash(db, DbId::native)};
         return result;
      }
      Checksum256 hash(Database& database, DbId db)
      {
         KvMerkle       merkle;
         KvMerkle::Item item{{}, {}};
         while (true)
         {
            auto key = item.key();
            auto kv  = database.kvGreaterEqualRaw(db, key, 0);
            if (!kv)
               return std::move(merkle).root();
            item.from(kv->key, kv->value);
            merkle.push(item);
            item.nextKey();
         }
      }
      ConstRevisionPtr revision;
      SharedDatabase   sharedDatabase;
   };

   class SnapshotLoader;

   struct BlockHeaderState
   {
      BlockInfo info;
      // May be null if the block has not been executed
      ConstRevisionPtr revision;
      // The producer set for this block
      std::shared_ptr<ProducerSet> producers;
      std::shared_ptr<ProducerSet> nextProducers;
      // Only valid if nextProducers is non-null
      BlockNum nextProducersBlockNum;
      // Set to true if this block or an ancestor failed validation
      bool invalid = false;
      // Creates the initial state
      BlockHeaderState() : info()
      {
         info.header.blockNum = 1;
         producers            = std::make_shared<ProducerSet>();
      }
      // This constructor is used to load a state from the database
      // It should be followed by either initAuthState or loadAuthState
      BlockHeaderState(const BlockInfo& info,
                       SystemContext*   systemContext,
                       ConstRevisionPtr revision)
          : info(info), revision(revision)
      {
         // Reads the active producer set from the database
         Database db{systemContext->sharedDatabase, revision};
         auto     session = db.startRead();
         auto     status  = db.kvGet<StatusRow>(StatusRow::db, statusKey());
         if (!status)
         {
            producers = std::make_shared<ProducerSet>();
         }
         else
         {
            producers = std::make_shared<ProducerSet>(status->consensus.current);
            if (status->consensus.next)
            {
               const auto& [prods, num] = *status->consensus.next;
               nextProducers            = std::make_shared<ProducerSet>(prods);
               nextProducersBlockNum    = num;
            }
         }
      }
      BlockHeaderState(SystemContext*          systemContext,
                       const WriterPtr&        writer,
                       const BlockHeaderState& prev,
                       const BlockInfo&        info,
                       ConstRevisionPtr        revision = nullptr)
          : info(info),
            revision(revision),
            producers(prev.producers),
            nextProducers(prev.nextProducers),
            nextProducersBlockNum(prev.nextProducersBlockNum)
      {
         // Handling of the producer schedule must match BlockContext::writeRevision
         if (prev.endsJointConsensus())
         {
            producers = std::move(nextProducers);
         }
         if (info.header.newConsensus)
         {
            nextProducers = std::make_shared<ProducerSet>(*info.header.newConsensus);
            if (producers->authState)
            {
               nextProducers->authState =
                   BlockAuthState::next(systemContext, writer, producers->authState, info.header);
            }
            else
            {
               loadAuthState(systemContext, writer);
            }
            // N.B. joint consensus with two identical producer sets
            // is functionally indistinguishable from non-joint consensus.
            // Don't both detecting this case here.
            nextProducersBlockNum = info.header.blockNum;
         }
      }

      BlockHeaderState(SystemContext* systemContext, SnapshotLoader&& loader);

      // initAuthState and loadAuthState should only be used when
      // loading blocks from the database. initAuthState is preferred
      // because it saves space.
      void initAuthState(SystemContext*          systemContext,
                         const WriterPtr&        writer,
                         const BlockHeaderState& prev)
      {
         if (prev.endsJointConsensus())
         {
            producers->authState = prev.nextProducers->authState;
         }
         else
         {
            producers->authState = prev.producers->authState;
         }
         if (nextProducers)
         {
            if (producers->authState)
            {
               auto prevAuthState =
                   (prev.nextProducers ? prev.nextProducers : prev.producers)->authState;
               nextProducers->authState =
                   BlockAuthState::next(systemContext, writer, prevAuthState, info.header);
            }
            else
            {
               loadAuthState(systemContext, writer);
            }
         }
         else
         {
            check(!info.header.authCode, "Unexpected authCode");
         }
      }
      void loadAuthState(SystemContext* systemContext, const WriterPtr& writer)
      {
         auto&    authState = nextProducers ? nextProducers->authState : producers->authState;
         Database db{systemContext->sharedDatabase, revision};
         auto     session = db.startRead();
         authState        = std::make_shared<BlockAuthState>(systemContext, writer, db);
         if (nextProducers)
         {
            producers->authState = std::make_shared<BlockAuthState>(systemContext, writer, db,
                                                                    db.getPrevAuthServices());
         }
      }
      JointConsensus readState(SystemContext* systemContext) const
      {
         Database db{systemContext->sharedDatabase, revision};
         auto     session = db.startRead();
         if (auto status = db.kvGet<StatusRow>(StatusRow::db, StatusRow::key()))
         {
            return status->consensus;
         }
         return JointConsensus{};
      }
      bool endsJointConsensus() const
      {
         return nextProducers && info.header.commitNum >= nextProducersBlockNum;
      }
      // Returns the claim for an immediate successor of this block
      std::optional<Claim> getNextProducerClaim(AccountNumber producer)
      {
         // N.B. The producers that may confirm a block are not necessarily the
         // same as the producers that may produce a block. In particular,
         // new joint producers are included in the confirm set, but NOT
         // in the producer set.
         if (!nextProducers || info.header.commitNum < nextProducersBlockNum)
         {
            if (producers->size() == 0 && !nextProducers)
            {
               assert(blockNum() == 1);
               return Claim{};
            }
            if (auto result = producers->getClaim(producer))
            {
               return *result;
            }
         }
         if (nextProducers)
         {
            if (auto result = nextProducers->getClaim(producer))
            {
               return *result;
            }
         }
         return {};
      }
      ConstRevisionPtr getProdsAuthRevision() const
      {
         check(!!producers->authState,
               "Auth services not loaded (this should only be possible for blocks that are already "
               "committed, which we shouldn't need signatures for...)");
         return producers->authState->revision;
      }
      ConstRevisionPtr getNextAuthRevision() const
      {
         if (endsJointConsensus())
         {
            return nextProducers->authState->revision;
         }
         else
         {
            return getProdsAuthRevision();
         }
      }
      ConstRevisionPtr getAuthRevision(AccountNumber producer, const Claim& claim)
      {
         if (producers->getIndex(producer, claim))
         {
            return getProdsAuthRevision();
         }
         else if (nextProducers && nextProducers->getIndex(producer, claim))
         {
            return nextProducers->authState->revision;
         }
         else
         {
            abortMessage(producer.str() + " is not an active producer at block " +
                         loggers::to_string(info.blockId));
            return nullptr;
         }
      }
      // The block that finalizes a swap to a new producer set needs to
      // contain proof that the block that started the switch is irreversible.
      bool needsIrreversibleSignature() const
      {
         return nextProducers && info.header.commitNum >= nextProducersBlockNum;
      }
      bool singleProducer() const
      {
         if (producers->size() == 1)
         {
            return !nextProducers;
         }
         else if (producers->size() == 0)
         {
            if (!nextProducers)
            {
               return true;
            }
            return nextProducers->size() == 1 && nextProducers->isProducer(info.header.producer);
         }
         return false;
      }
      auto order() const
      {
         return std::tuple(info.header.term, info.header.blockNum, info.blockId);
      }
      BlockNum           blockNum() const { return info.header.blockNum; }
      const Checksum256& blockId() const { return info.blockId; }
      ExtendedBlockId    xid() const { return ExtendedBlockId{blockId(), blockNum()}; }
   };

   struct LightHeaderState
   {
      LightHeaderState(SystemContext* context, const BlockHeaderState* base)
          : prevBlockNum(base->blockNum()),
            producers(base->producers),
            nextProducers(base->nextProducers),
            state(base->readState(context)),
            stateHash(sha256(state)),
            revision(base->revision)
      {
         if (state.next && base->info.header.commitNum >= state.next->blockNum)
         {
            state.current = std::move(state.next->consensus);
            state.next.reset();
            stateHash = sha256(state);
         }
      }
      BlockNum                     prevBlockNum;
      std::shared_ptr<ProducerSet> producers;
      std::shared_ptr<ProducerSet> nextProducers;
      std::vector<ExtendedBlockId> pendingBlocks;

      JointConsensus state;
      Checksum256    stateHash;
      bool           consensusChangeReady = false;

      ConstRevisionPtr revision;

      template <typename Consensus>
      void push(SystemContext*                            systemContext,
                const WriterPtr&                          writer,
                const psio::shared_view_ptr<SignedBlock>& block,
                Consensus&                                consensus)
      {
         BlockInfo info{block->block().header()};
         // The initial state used to contruct the light validator
         // might be ahead of the point that the peer starts sending.
         if (info.header.blockNum <= prevBlockNum)
            return;
         maybeAdvance();
         if (info.header.newConsensus)
         {
            check(!nextProducers, "Already in joint consensus");
            nextProducers = std::make_shared<ProducerSet>(*info.header.newConsensus);
            nextProducers->authState =
                BlockAuthState::next(systemContext, writer, producers->authState, info.header);
            state.next = {*info.header.newConsensus, info.header.blockNum};
            stateHash  = sha256(state);
         }
         check(stateHash == info.header.consensusState, "consensus state does not match");
         if (state.next)
         {
            pendingBlocks.push_back({BlockInfo{info.header}.blockId, info.header.blockNum});
         }
         if (state.next && info.header.commitNum >= state.next->blockNum)
         {
            auto start           = state.next->blockNum;
            auto commit          = consensus.light_verify(*this, info, block);
            consensusChangeReady = true;
            ConsensusChangeRow changeRow{start, commit, info.header.blockNum};
            systemContext->sharedDatabase.kvPutSubjective(
                *writer, psio::convert_to_key(changeRow.key()), psio::to_frac(changeRow));
         }
         prevBlockNum         = info.header.blockNum;
         auto     blockNumKey = psio::convert_to_key(info.header.blockNum);
         Database database(systemContext->sharedDatabase, revision);
         auto     session = database.startWrite(writer);
         database.kvPutRaw(DbId::blockLog, blockNumKey, psio::to_frac(block->block().unpack()));
         if (!block->signature().empty())
         {
            database.kvPutRaw(DbId::blockProof, blockNumKey,
                              psio::to_frac(block->signature().unpack()));
         }
         if (block->auxConsensusData())
         {
            BlockDataRow row{info.blockId, *block->auxConsensusData()};
            systemContext->sharedDatabase.kvPutSubjective(*writer, psio::convert_to_key(row.key()),
                                                          psio::to_frac(row));
         }
         revision = database.getModifiedRevision();
      }

      void maybeAdvance()
      {
         if (consensusChangeReady)
         {
            state.current = std::move(state.next->consensus);
            state.next.reset();
            stateHash = sha256(state);
            pendingBlocks.clear();
            producers            = std::move(nextProducers);
            consensusChangeReady = false;
         }
      }
   };

   struct SnapshotItem
   {
      std::vector<char> key;
      std::vector<char> value;
      PSIO_REFLECT(SnapshotItem, key, value)
   };

   struct SnapshotLoader
   {
      struct KeyRange
      {
         std::vector<char> low;
         std::vector<char> high;
      };
      struct KeyRanges
      {
         // sorted, non-overlapping
         std::vector<KeyRange> ranges;
         // returns false if the new range overlaps with an existing range
         bool add(std::vector<char>&& low, std::vector<char>&& high)
         {
            auto pos = std::ranges::lower_bound(ranges, low, blob_less{}, &KeyRange::low);
            if (pos != ranges.begin())
            {
               auto prev = pos;
               --prev;
               if (prev->high.empty())
                  return false;
               if (auto cmp = compare_blob(low, prev->high); cmp == 0)
               {
                  if (pos != ranges.end())
                  {
                     if (high.empty())
                        return false;
                     if (auto cmp = compare_blob(high, pos->low); cmp == 0)
                     {
                        // merge both
                        prev->high = std::move(pos->high);
                        ranges.erase(pos);
                     }
                     else if (cmp > 0)
                     {
                        return false;
                     }
                  }
                  // merge left
                  prev->high = high;
                  return true;
               }
               else if (cmp < 0)
               {
                  return false;
               }
            }
            if (pos != ranges.end())
            {
               if (high.empty())
                  return false;
               if (auto cmp = compare_blob(high, pos->low); cmp == 0)
               {
                  // merge right
                  pos->low = std::move(low);
                  return true;
               }
               else if (cmp > 0)
               {
                  return false;
               }
            }
            // insert new range
            ranges.insert(pos, {std::move(low), std::move(high)});
            return true;
         }
         bool complete() const
         {
            return ranges.size() == 1 && ranges.front().low.empty() && ranges.front().high.empty();
         }
      };
      Checksum256      blockId;
      ConstRevisionPtr revision;
      KeyRanges        serviceKeys;
      KeyRanges        nativeKeys;

      std::unique_ptr<LightHeaderState> validator;

      SnapshotLoader(std::unique_ptr<LightHeaderState>&& state, const Checksum256& blockId)
          : blockId(blockId), revision(state->revision), validator(std::move(state))
      {
      }

      KeyRanges* getRanges(DbId db)
      {
         switch (db)
         {
            case DbId::service:
               return &serviceKeys;
            case DbId::native:
               return &nativeKeys;
            default:
               abortMessage("Wrong database in snapshot");
         }
      }
      void add(SystemContext*                   systemContext,
               const WriterPtr&                 writer,
               DbId                             db,
               std::vector<char>                low,
               std::vector<char>                high,
               const std::vector<SnapshotItem>& rows)
      {
         // TODO: consider allowing overlapping ranges, but verify that the contents
         // are identical.
         if (!getRanges(db)->add(std::move(low), std::move(high)))
            abortMessage("Snapshot parts overlap");
         Database database(systemContext->sharedDatabase, revision);
         auto     session = database.startWrite(writer);
         for (const SnapshotItem& row : rows)
         {
            database.kvPutRaw(db, row.key, row.value);
         }
         revision = database.getModifiedRevision();
      }
      bool complete() const { return serviceKeys.complete() && nativeKeys.complete(); }
   };

   struct SnapshotSender
   {
      SnapshotSender(SystemContext* context, ConstRevisionPtr revision)
          : database(context->sharedDatabase, std::move(revision))
      {
      }
      std::vector<char> currentKey;
      DbId              currentDb = DbId::service;
      Database          database;
      bool              next(DbId&                      db,
                             std::vector<char>&         low,
                             std::vector<char>&         high,
                             std::vector<SnapshotItem>& rows)
      {
         static constexpr DbId nullDb = static_cast<DbId>(0xffffffffu);
         if (currentDb == nullDb)
            return false;
         db                              = currentDb;
         low                             = currentKey;
         constexpr std::size_t limit     = 1024 * 1024;
         std::size_t           totalSize = 0;
         {
            auto sesssion = database.startRead();
            while (totalSize < limit)
            {
               if (auto row = database.kvGreaterEqualRaw(currentDb, currentKey, 0))
               {
                  auto key   = std::vector<char>{row->key.pos, row->key.end};
                  auto value = std::vector<char>{row->value.pos, row->value.end};
                  currentKey = key;
                  totalSize += key.size() + value.size() + 16;
                  rows.push_back({std::move(key), std::move(value)});
               }
               else
               {
                  currentKey.clear();
                  if (currentDb == DbId::service)
                  {
                     currentDb = DbId::native;
                  }
                  else
                  {
                     currentDb = nullDb;
                  }
                  break;
               }
               currentKey.push_back(0);
            }
         }
         high = currentKey;
         return true;
      }
   };

   ExtendedBlockId orderToXid(const auto& order)
   {
      return ExtendedBlockId{std::get<2>(order), std::get<1>(order)};
   }

   TermNum orderToTerm(const auto& order)
   {
      return std::get<0>(order);
   }

   class ForkDb
   {
     public:
      using id_type = Checksum256;
      // \return a pointer to the header state for the block and a bool indicating
      // whether a new block was inserted.
      // \post if the block was successfully inserted, a fork switch is required.
      std::pair<const BlockHeaderState*, bool> insert(const psio::shared_view_ptr<SignedBlock>& b)
      {
         BlockInfo info(b->block());
         PSIBASE_LOG_CONTEXT_BLOCK(blockLogger, info.header, info.blockId);
         if (info.header.blockNum <= commitIndex)
         {
            PSIBASE_LOG(blockLogger, debug) << "Block ignored because it is before commitIndex";
            return {nullptr, false};
         }
         auto [iter, inserted] = blocks.try_emplace(info.blockId, b);
         if (!inserted)
         {
            PSIBASE_LOG(blockLogger, debug) << "Block skipped because it is already known";
            return {get_state(info.blockId), false};
         }
         if (auto* prev = get_state(info.header.previous))
         {
            try
            {
               validateBlockSignature(prev, info, b->signature());
            }
            catch (...)
            {
               blocks.erase(iter);
               throw;
            }
            auto [pos, inserted] =
                states.try_emplace(info.blockId, systemContext, writer, *prev, info);
            assert(inserted);
            if (prev->invalid)
            {
               PSIBASE_LOG(blockLogger, debug) << "Block parent is invalid";
               pos->second.invalid = true;
            }
            else if (byOrderIndex.find(prev->order()) != byOrderIndex.end())
            {
               byOrderIndex.insert({pos->second.order(), info.blockId});
            }
            else
            {
               PSIBASE_LOG(blockLogger, debug) << "Block is outside current tree";
            }
            return {&pos->second, true};
         }
         else
         {
            blocks.erase(iter);
            PSIBASE_LOG(blockLogger, debug) << "Block dropped because its parent is missing";
         }
         return {nullptr, false};
      }
      // \pre The block must not be in the current chain and
      // must not have any children. Practially speaking, this
      // function can only be called immediately after insert,
      // before any fork switch.
      // \post This removes the need for a fork switch if the
      // the erased block is the only reason why a fork switch
      // is needed.
      void erase(const BlockHeaderState* state)
      {
         assert(!in_best_chain(state->xid()));
         byOrderIndex.erase(state->order());
         blocks.erase(state->blockId());
         states.erase(state->blockId());
      }
      // \pre A fork switch is not required
      BlockHeader* get_head() const { return &head->info.header; }
      // \pre A fork switch is not required
      const BlockHeaderState*            get_head_state() const { return head; }
      psio::shared_view_ptr<SignedBlock> get(const id_type& id) const
      {
         auto pos = blocks.find(id);
         if (pos != blocks.end())
         {
            return pos->second;
         }
         else
         {
            Database db{systemContext->sharedDatabase, head->revision};
            auto     session  = db.startRead();
            auto     blockNum = getBlockNum(id);
            if (auto block = db.kvGet<Block>(DbId::blockLog, blockNum))
            {
               if (BlockInfo{*block}.blockId == id)
               {
                  auto proof = db.kvGet<std::vector<char>>(DbId::blockProof, blockNum);
                  return psio::shared_view_ptr<SignedBlock>(
                      SignedBlock{*block, proof ? *proof : std::vector<char>(), getBlockData(id)});
               }
            }
            return nullptr;
         }
      }
      // \pre A fork switch is not required
      Checksum256 get_block_id(BlockNum num) const
      {
         auto iter = byBlocknumIndex.find(num);
         if (iter != byBlocknumIndex.end())
         {
            return iter->second;
         }
         else
         {
            Database db{systemContext->sharedDatabase, head->revision};
            auto     session = db.startRead();
            if (auto next = db.kvGet<Block>(DbId::blockLog, num + 1))
            {
               return next->header.previous;
            }
            else if (auto block = db.kvGet<Block>(DbId::blockLog, num))
            {
               return BlockInfo{*block}.blockId;
            }
            else
            {
               return {};
            }
         }
      }
      // \pre A fork switch is not required
      psio::shared_view_ptr<SignedBlock> get_block_by_num(BlockNum num) const
      {
         auto iter = byBlocknumIndex.find(num);
         if (iter != byBlocknumIndex.end())
         {
            return get(iter->second);
         }
         else
         {
            Database db{systemContext->sharedDatabase, head->revision};
            auto     session = db.startRead();
            if (auto block = db.kvGet<Block>(DbId::blockLog, num))
            {
               auto proof = db.kvGet<std::vector<char>>(DbId::blockProof, num);
               auto id    = BlockInfo{*block}.blockId;
               return psio::shared_view_ptr<SignedBlock>(
                   SignedBlock{*block, proof ? *proof : std::vector<char>(), getBlockData(id)});
            }
            else
            {
               return nullptr;
            }
         }
      }
      // \pre id represents a known block
      auto get_prev_id(const id_type& id)
      {
         return Checksum256(get(id)->block().header().previous());
      }

      void setTerm(TermNum term) { currentTerm = term; }

      // \post fork switch needed
      // \post only blocks that are descendents of root will be considered
      // as the head block
      void set_subtree(const BlockHeaderState* root, const char* reason)
      {
         assert(root->info.header.term <= currentTerm);
         PSIBASE_LOG_CONTEXT_BLOCK(logger, root->info.header, root->blockId());
         if (root->invalid)
         {
            PSIBASE_LOG(logger, critical) << "Consensus failure: invalid block " << reason;
            throw consensus_failure{};
         }
         PSIBASE_LOG(logger, debug) << "Setting subtree " << reason;
         if (byOrderIndex.find(root->order()) == byOrderIndex.end())
         {
            // The new root is not a descendant of the current root.
            // refill the index with all blocks
            byOrderIndex.clear();
            for (const auto& [id, state] : states)
            {
               if (!state.invalid)
               {
                  byOrderIndex.insert({state.order(), id});
               }
            }
         }
         // Prune blocks that are not descendants of root
         std::set<Checksum256> ids;
         for (auto iter = byOrderIndex.begin(), end = byOrderIndex.end(); iter != end;)
         {
            if (iter->second == root->blockId() ||
                ids.find(states.find(iter->second)->second.info.header.previous) != ids.end())
            {
               ids.insert(iter->second);
               ++iter;
            }
            else
            {
               iter = byOrderIndex.erase(iter);
            }
         }
         assert(!byOrderIndex.empty());
      }

      // \pre root is in byOrderIndex
      void blacklist_subtree(BlockHeaderState* root)
      {
         assert(!root->invalid);
         root->invalid = true;
         for (auto iter = byOrderIndex.find(root->order()), end = byOrderIndex.end(); iter != end;)
         {
            auto current = states.find(iter->second);
            auto prev    = states.find(current->second.info.header.previous);
            if (prev != states.end() && prev->second.invalid)
            {
               current->second.invalid = true;
            }
            if (current->second.invalid)
            {
               iter = byOrderIndex.erase(iter);
            }
            else
            {
               ++iter;
            }
         }
      }

      template <typename F, typename Accept>
      void async_switch_fork(F&& callback, Accept&& on_accept_block)
      {
         auto original_head = head;
         while (true)
         {
            auto pos =
                byOrderIndex.lower_bound(std::tuple(currentTerm + 1, BlockNum(0), Checksum256{}));
            if (pos == byOrderIndex.begin())
            {
               PSIBASE_LOG(logger, critical) << "Consensus failure: failed to switch forks, "
                                                "because there is no viable head block";
               throw consensus_failure{};
            }
            --pos;
            auto new_head = get_state(pos->second);
            // Also consider the block currently being built, if it exists
            if (blockContext)
            {
               if (  // We should always abandon an unbooted chain
                   !blockContext->needGenesisAction &&
                   // If the previous head block is no longer viable, we need
                   // to abort the pending block regardless of block ordering.
                   byOrderIndex.find(original_head->order()) != byOrderIndex.end() &&
                   // The block id of the pending block is still unknown.  Only
                   // keep the pending block if it is definitely better than new_head.
                   new_head->order() < std::tuple(blockContext->current.header.term,
                                                  blockContext->current.header.blockNum,
                                                  Checksum256{}))
               {
                  if (original_head != head)
                  {
                     bool res = trySetHead(original_head, std::forward<Accept>(on_accept_block));
                     // We were already on this fork, so we know that it's definitely good.
                     assert(res);
                  }
                  return;
               }
            }
            if (trySetHead(new_head, std::forward<Accept>(on_accept_block)))
               break;
         }
         if (head != original_head)
         {
            callback(head->info);
         }
      }
      template <typename Accept>
      bool trySetHead(BlockHeaderState* new_head, Accept&& on_accept_block)
      {
         if (head == new_head)
            return true;
         if (new_head->blockNum() < head->blockNum())
         {
            if (new_head->blockNum() < commitIndex)
            {
               PSIBASE_LOG_CONTEXT_BLOCK(logger, new_head->info.header, new_head->blockId());
               PSIBASE_LOG(logger, critical)
                   << "Consensus failure: multiple conflicting forks confirmed";
               throw consensus_failure{};
            }
            byBlocknumIndex.erase(byBlocknumIndex.find(new_head->blockNum() + 1),
                                  byBlocknumIndex.end());
         }
         auto id = new_head->blockId();
         for (auto i = new_head->blockNum(); i > head->blockNum(); --i)
         {
            byBlocknumIndex.insert({i, id});
            id = get_prev_id(id);
         }
         for (auto iter = byBlocknumIndex.upper_bound(
                       std::min(new_head->blockNum(), head->blockNum())),
                   begin = byBlocknumIndex.begin();
              ;)
         {
            assert(iter != begin);
            --iter;
            if (iter->second == id)
            {
               if (execute_fork(iter, byBlocknumIndex.end(), on_accept_block))
               {
                  head = new_head;
                  assert(!!head->revision);
                  return true;
               }
               else
               {
                  return false;
               }
            }
            if (iter->first <= commitIndex)
            {
               PSIBASE_LOG_CONTEXT_BLOCK(logger, new_head->info.header, new_head->blockId());
               PSIBASE_LOG(logger, critical)
                   << "Consensus failure: multiple conflicting forks confirmed";
               throw consensus_failure{};
            }
            iter->second = id;
            id           = get_prev_id(id);
         }
      }
      // TODO: somehow prevent poisoning the cache if a malicious peer
      // sends a correct block with the wrong signature.
      Claim validateBlockSignature(BlockHeaderState* prev, const BlockInfo& info, const auto& sig)
      {
         BlockContext verifyBc(*systemContext, prev->getNextAuthRevision());
         VerifyProver prover{verifyBc, sig};
         auto         claim = prev->getNextProducerClaim(info.header.producer);
         if (!claim)
         {
            throw std::runtime_error("Invalid producer for block");
         }
         prover.prove(BlockSignatureInfo(info), *claim);
         return std::move(*claim);
      }
      // TODO: this can run concurrently.
      void validateTransactionSignatures(const Block& b, const ConstRevisionPtr& revision)
      {
         BlockContext verifyBc(*systemContext, revision);
         verifyBc.start(b.header.time);
         for (const auto& trx : b.transactions)
         {
            check(trx.proofs.size() == trx.transaction->claims().size(),
                  "proofs and claims must have same size");
            for (std::size_t i = 0; i < trx.proofs.size(); ++i)
            {
               TransactionTrace trace;
               verifyBc.verifyProof(trx, trace, i, std::nullopt, nullptr);
            }
         }
      }
      // \pre the state of prev has been set
      bool execute_block(BlockHeaderState* prev, BlockHeaderState* state, auto&& on_accept_block)
      {
         std::error_code ec{};
         if (!state->revision)
         {
            BlockContext ctx(*systemContext, prev->revision, writer, false);
            auto         blockPtr = get(state->blockId());
            PSIBASE_LOG_CONTEXT_BLOCK(blockLogger, state->info.header, state->blockId());
            try
            {
               auto claim = validateBlockSignature(prev, state->info, blockPtr->signature());
               ctx.start(Block(blockPtr->block()));
               validateTransactionSignatures(ctx.current, prev->revision);
               ctx.callStartBlock();
               ctx.execAllInBlock();
               auto [newRevision, id] = ctx.writeRevision(FixedProver(blockPtr->signature()), claim,
                                                          state->getProdsAuthRevision());
               // TODO: diff header fields
               check(id == state->blockId(), "blockId does not match");
               state->revision = newRevision;

               try
               {
                  on_accept_block(state);
               }
               catch (std::exception& e)
               {
                  PSIBASE_LOG(blockLogger, error)
                      << "on_accept_block needs to handle any errors, but it failed with: "
                      << e.what();
               }
               PSIBASE_LOG(blockLogger, info) << "Accepted block";
            }
            catch (std::exception& e)
            {
               PSIBASE_LOG(blockLogger, warning) << e.what();
               return false;
            }
         }
         return true;
      }
      // TODO: run this in a separate thread and make it interruptable
      bool execute_fork(auto iter, auto end, auto&& on_accept_block)
      {
         if (iter != end)
         {
            auto* prev = get_state(iter->second);
            assert(prev->revision);
            ++iter;
            for (; iter != end; ++iter)
            {
               BlockHeaderState* nextState = get_state(iter->second);
               if (!execute_block(prev, nextState, on_accept_block))
               {
                  byBlocknumIndex.erase(iter, end);
                  blacklist_subtree(nextState);
                  head = prev;
                  return false;
               }
               systemContext->sharedDatabase.setHead(*writer, nextState->revision);
               prev = nextState;
            }
         }
         return true;
      }
      LightHeaderState light_validate()
      {
         return LightHeaderState{systemContext, get_state(get_block_id(commitIndex))};
      }
      void push_light_header(LightHeaderState&                         state,
                             const psio::shared_view_ptr<SignedBlock>& block,
                             auto&                                     consensus)
      {
         state.push(systemContext, writer, block, consensus);
      }
      std::optional<BlockNum> get_next_light_header_num(BlockNum           prev,
                                                        const Checksum256& snapshotId)
      {
         // If the snapshot is in joint consensus, send all the headers after
         // the new producers were set.
         {
            auto revision = systemContext->sharedDatabase.getRevision(*writer, snapshotId);
            auto status   = getStatus(revision);
            if (status.consensus.next && status.consensus.next->blockNum <= prev)
            {
               return prev + 1;
            }
         }
         Database database{systemContext->sharedDatabase, systemContext->sharedDatabase.getHead()};
         auto     session = database.startRead();
         database.checkoutSubjective();
         psio::size_stream prefixLen;
         psio::to_key(consensusChangePrefix(), prefixLen);
         auto key = psio::convert_to_key(consensusChangeKey(prev + 1));
         if (auto row = database.kvLessThanRaw(ConsensusChangeRow::db, key, prefixLen.size))
         {
            auto value = psio::from_frac<ConsensusChangeRow>(row->value);
            if (value.start > prev)
               return value.start;
            if (value.commit > prev)
               return value.commit;
            if (value.end > prev)
               return value.end;
         }
         if (auto row = database.kvGreaterEqualRaw(ConsensusChangeRow::db, key, prefixLen.size))
         {
            auto value = psio::from_frac<ConsensusChangeRow>(row->value);
            return value.start;
         }
         return {};
      }
      SnapshotLoader start_snapshot(std::unique_ptr<LightHeaderState>&& state,
                                    const Checksum256&                  blockId)
      {
         if (getBlockNum(blockId) > state->prevBlockNum)
         {
            state->maybeAdvance();
         }
         return SnapshotLoader(std::move(state), blockId);
      }
      void add_to_snapshot(SnapshotLoader&                  loader,
                           DbId                             db,
                           std::vector<char>                low,
                           std::vector<char>                high,
                           const std::vector<SnapshotItem>& rows)
      {
         loader.add(systemContext, writer, db, std::move(low), std::move(high), rows);
      }
      // \post fork switch needed to execute any post-snapshot blocks
      // returns the state for the snapshot or nullptr if the snapshot was not ignored.
      BlockHeaderState* apply_snapshot(SnapshotLoader&&                             loader,
                                       snapshot::StateChecksum                      hash,
                                       const std::vector<snapshot::StateSignature>& signatures)
      {
         check(loader.complete(), "Incomplete snapshot");
         snapshot::StateSignatureInfo preimage{hash};
         // verify signatures
         AccountNumber prev{};
         PSIBASE_LOG(logger, info)
             << "Verifying snapshot with producers: " << *loader.validator->producers;
         for (const auto& sig : signatures)
         {
            check(!!loader.validator->producers->getIndex(sig.account, sig.claim),
                  "Not a producer " + sig.account.str());
            check(prev < sig.account, "Producers must be in order");
            verify(loader.validator->producers->authState->revision, preimage, sig.claim,
                   sig.rawData);
         }
         check(signatures.size() >= loader.validator->producers->weak_threshold(),
               "Not enough signatures on snapshot");
         // verify hash
         auto revision   = loader.revision;
         auto actualHash = BuildStateChecksum{revision, systemContext->sharedDatabase}();
         check(actualHash == hash, "State checksum does not match");
         // Load state
         auto id              = loader.blockId;
         auto [pos, inserted] = states.try_emplace(id, systemContext, std::move(loader));
         if (id != pos->second.blockId())
         {
            states.erase(pos);
            throw std::runtime_error("Wrong id in snapshot: " + loggers::to_string(id) +
                                     " != " + loggers::to_string(pos->second.blockId()));
         }
         if (!inserted)
         {
            if (pos->second.revision)
               // We've already executed the block. The snapshot isn't needed
               return nullptr;
            else if (pos->second.invalid)
            {
               PSIBASE_LOG_CONTEXT_BLOCK(logger, pos->second.info.header, pos->second.info.blockId);
               PSIBASE_LOG(logger, critical) << "Received verified snapshot for invalid block";
               throw consensus_failure{};
            }
            else
               pos->second.revision = revision;
         }
         else if (pos->second.blockNum() < commitIndex)
         {
            states.erase(pos);
            return nullptr;
         }
         currentTerm = std::max(currentTerm, pos->second.info.header.term);
         set_subtree(&pos->second, "received snapshot");
         {
            Database database{systemContext->sharedDatabase, revision};
            auto     session = database.startWrite(writer);
            database.writeRevision(session, id);
         }
         systemContext->sharedDatabase.setHead(*writer, revision);
         head = &pos->second;
         // Do not call commit(). It tries to step forward over blocks that
         // we don't have.
         commitIndex = head->blockNum();
         byBlocknumIndex.clear();
         byBlocknumIndex.insert({head->blockNum(), head->blockId()});
         // Record the snapshot
         SnapshotRow snapshotRow{id, SnapshotRow::Item{hash, signatures}};
         systemContext->sharedDatabase.kvPutSubjective(
             *writer, psio::convert_to_key(snapshotRow.key()), psio::to_frac(snapshotRow));
         logStart = head->blockNum();
         LogTruncateRow logTruncateRow{logStart};
         systemContext->sharedDatabase.kvPutSubjective(
             *writer, psio::convert_to_key(logTruncateRow.key()), psio::to_frac(logTruncateRow));
         return head;
      }
      Checksum256 get_last_snapshot_id()
      {
         Database db(systemContext->sharedDatabase, systemContext->sharedDatabase.getHead());
         auto     session = db.startRead();
         db.checkoutSubjective();
         auto key       = psio::convert_to_key(snapshotPrefix());
         auto prefixLen = key.size();
         for (auto row = db.kvMaxRaw(DbId::nativeSubjective, key); row;
              row      = db.kvLessThanRaw(DbId::nativeSubjective, key, prefixLen))
         {
            auto value = psio::view<const SnapshotRow>(std::span{row->value.pos, row->value.end});
            if (value.state())
            {
               auto        id       = value.id().unpack();
               auto        revision = systemContext->sharedDatabase.getRevision(*writer, id);
               auto        status   = getStatus(revision);
               ProducerSet producers(status.consensus.current.data);
               if (value.state()->signatures().size() >= producers.weak_threshold())
               {
                  return id;
               }
               else
               {
                  PSIBASE_LOG(logger, debug)
                      << "Snapshot " << loggers::to_string(value.id())
                      << " cannot be sent because it does not have enough producer signatures "
                      << value.state()->signatures().size() << "/" << producers.size();
               }
            }
            else
            {
               PSIBASE_LOG(logger, debug)
                   << "Snapshot " << loggers::to_string(value.id())
                   << " cannot be sent, because its checksum is not available";
            }
            key.assign(row->key.pos, row->key.end);
         }
         return Checksum256{};
      }
      SnapshotSender send_snapshot(const Checksum256& id)
      {
         return SnapshotSender(systemContext,
                               systemContext->sharedDatabase.getRevision(*writer, id));
      }
      SnapshotRow get_snapshot_info(const Checksum256& id)
      {
         auto row = systemContext->sharedDatabase.kvGetSubjective(
             *writer, psio::convert_to_key(snapshotKey(id)));
         if (!row)
            return SnapshotRow{id};
         return psio::from_frac<SnapshotRow>(*row);
      }
      BlockHeaderState* get_state(const id_type& id)
      {
         auto pos = states.find(id);
         if (pos != states.end())
         {
            return &pos->second;
         }
         else
         {
            return nullptr;
         }
      }
      bool is_complete_chain(const id_type& id) { return get_state(id) != nullptr; }
      std::pair<std::shared_ptr<ProducerSet>, std::shared_ptr<ProducerSet>> getProducers()
      {
         if (head->endsJointConsensus())
         {
            return {head->nextProducers, nullptr};
         }
         else
         {
            return {head->producers, head->nextProducers};
         }
      }
      bool commit(BlockNum num)
      {
         auto newCommitIndex = std::max(std::min(num, head->blockNum()), commitIndex);
         auto result         = newCommitIndex != commitIndex;
         if (result)
            PSIBASE_LOG(logger, debug) << "Committing block " << newCommitIndex;
         for (auto i = commitIndex; i < newCommitIndex; ++i)
         {
            auto id    = get_block_id(i);
            auto state = get_state(id);
            // A block that needs proof of irreversibility is not necessarily
            // committed itself.
            if (state->needsIrreversibleSignature() && !getBlockData(id))
            {
               auto pos = blocks.find(id);
               assert(pos != blocks.end());
               if (pos->second->auxConsensusData())
               {
                  setBlockData(id, *pos->second->auxConsensusData());
               }
            }
            onCommitFn(state);
         }
         // ensure that only descendants of the committed block
         // are considered when searching for the best block.
         // The subtree should not be changed if it is already ahead
         // of the committed block.
         if (std::get<1>(byOrderIndex.begin()->first) < newCommitIndex)
         {
            // no error is possible, because the committed block is in the
            // current chain.
            set_subtree(get_state(get_block_id(newCommitIndex)), "commitIndex");
         }
         commitIndex = newCommitIndex;
         return result;
      }

      void setBlockData(const Checksum256& id, std::vector<char>&& data)
      {
         BlockDataRow row{id, std::move(data)};
         systemContext->sharedDatabase.kvPutSubjective(*writer, psio::convert_to_key(row.key()),
                                                       psio::to_frac(row));
      }

      std::optional<std::vector<char>> getBlockData(const Checksum256& id) const
      {
         if (auto data = systemContext->sharedDatabase.kvGetSubjective(
                 *writer, psio::convert_to_key(blockDataKey(id))))
         {
            auto row = psio::from_frac<BlockDataRow>(*data);
            if (row.auxConsensusData)
               return std::move(*row.auxConsensusData);
         }
         return {};
      }

      // removes blocks and states before irreversible
      void gc(auto&& f)
      {
         for (auto iter = blocks.begin(), end = blocks.end(); iter != end;)
         {
            auto        blockNum = getBlockNum(iter->first);
            bool        remove   = false;
            const char* msg      = nullptr;
            if (blockNum < commitIndex)
            {
               msg    = "block before irreversible";
               remove = true;
            }
            else if ((blockNum == commitIndex &&
                      !in_best_chain(ExtendedBlockId{iter->first, blockNum})) ||
                     (blockNum > commitIndex &&
                      states.find(iter->second->block().header().previous()) == states.end()))
            {
               msg    = "forked block";
               remove = true;
            }
            if (remove)
            {
               PSIBASE_LOG_CONTEXT_BLOCK(blockLogger, iter->second->block().header(), iter->first);
               PSIBASE_LOG(blockLogger, debug) << "GC " << msg;
               f(iter->first);
               auto state_iter = states.find(iter->first);
               if (state_iter != states.end())
               {
                  // TODO: is removal from byOrderIndex still needed here
                  // now that commit updates byOrderIndex?
                  byOrderIndex.erase(state_iter->second.order());
                  states.erase(state_iter);
               }
               iter = blocks.erase(iter);
            }
            else
            {
               ++iter;
            }
         }
         assert(!byOrderIndex.empty());
         byBlocknumIndex.erase(byBlocknumIndex.begin(), byBlocknumIndex.find(commitIndex));

         systemContext->sharedDatabase.removeRevisions(*writer,
                                                       byBlocknumIndex.find(commitIndex)->second);
      }

      template <typename T>
      T get_prev_id(const T& t)
      {
         return T{get_prev_id(t.id()), t.num() - 1};
      }
      auto            commit_index() const { return commitIndex; }
      ExtendedBlockId xid(const ExtendedBlockId& id) { return id; }
      ExtendedBlockId xid(const Checksum256& id) { return {id, getBlockNum(id)}; }
      id_type         get_ancestor(id_type id, auto n)
      {
         for (; n > 0; --n)
         {
            id = get_prev_id(id);
         }
         return id;
      }
      template <typename T>
      T get_common_ancestor(const T& t)
      {
         auto iter = byBlocknumIndex.find(t.num());
         auto id   = t.id();
         if (iter == byBlocknumIndex.end())
         {
            --iter;
            if (iter->first < t.num())
            {
               id = get_ancestor(id, t.num() - iter->first);
            }
            else
            {
               auto existing = get_block_id(t.num());
               if (existing == t.id())
               {
                  return t;
               }
               else if (existing != Checksum256{})
               {
                  throw std::runtime_error("Cannot find common ancestor for block " +
                                           loggers::to_string(t.id()) +
                                           " because it has been irreversibly forked");
               }
               else
               {
                  throw std::runtime_error("Cannot find common ancestor for block " +
                                           loggers::to_string(t.id()) + " because it is not known");
               }
            }
         }
         while (true)
         {
            if (iter->second == id)
            {
               return {iter->second, iter->first};
            }
            else
            {
               if (iter == byBlocknumIndex.begin())
               {
                  throw std::runtime_error("no common ancestor");
               }
               else
               {
                  --iter;
                  id = get_prev_id(id);
               }
            }
         }
      }
      bool is_ancestor(const ExtendedBlockId& ancestor, const ExtendedBlockId& descendant)
      {
         Checksum256 tmp = descendant.id();
         for (auto idx = descendant.num(); idx >= ancestor.num(); --idx)
         {
            if (tmp == ancestor.id())
            {
               return true;
            }
            if (auto current_block = get(tmp))
            {
               tmp = current_block->block().header().previous();
            }
            else
            {
               return false;
            }
         }
         return false;
      }
      bool is_ancestor(const Checksum256& ancestor, const ExtendedBlockId& descendant)
      {
         return is_ancestor(xid(ancestor), descendant);
      }
      bool in_best_chain(const ExtendedBlockId& t)
      {
         auto iter = byBlocknumIndex.find(t.num());
         return iter != byBlocknumIndex.end() && iter->second == t.id();
      }

      bool in_best_chain(const Checksum256& id)
      {
         return in_best_chain(ExtendedBlockId{id, getBlockNum(id)});
      }

      // Block production:
      template <typename... A>
      void start_block(A&&... a)
      {
         assert(!blockContext);
         blockContext.emplace(*systemContext, head->revision, writer, true);
         blockContext->start(std::forward<A>(a)...);
         blockContext->callStartBlock();
      }
      void abort_block()
      {
         assert(!!blockContext);
         blockContext.reset();
      }
      // Returns a function that can safely be run in another thread
      auto snapshot_builder(const BlockHeaderState* state)
      {
         PSIBASE_LOG_CONTEXT_BLOCK(logger, state->info.header, state->info.blockId);
         PSIBASE_LOG(logger, info) << "Calculating state checksum";
         return BuildStateChecksum{state->revision, systemContext->sharedDatabase};
      }
      bool should_make_snapshot(const BlockHeaderState* state)
      {
         Database db(systemContext->sharedDatabase, state->revision);
         auto     session = db.startRead();
         if (db.kvGet<ScheduledSnapshotRow>(ScheduledSnapshotRow::db,
                                            scheduledSnapshotKey(state->info.header.blockNum)))
         {
            return true;
         }
         return false;
      }

      enum class ChecksumLog
      {
         never,
         exact,
         always,
      };

      std::optional<snapshot::StateSignature> on_state_checksum(
          const Checksum256&             id,
          const snapshot::StateChecksum& checksum,
          AccountNumber                  me)
      {
         auto        revision = systemContext->sharedDatabase.getRevision(*writer, id);
         auto        status   = getStatus(revision);
         ProducerSet producers(status.consensus.current.data);
         bool        inserted = false;
         SnapshotRow row{.id = id};
         auto        key = psio::convert_to_key(row.key());
         if (auto bytes = systemContext->sharedDatabase.kvGetSubjective(*writer, key))
         {
            psio::from_frac(row, *bytes);
         }
         // Check whether there are existing signatures for the same state
         if (row.state)
         {
            if (row.state->state != checksum)
            {
               PSIBASE_LOG_CONTEXT_BLOCK(logger, status.head->header, id);
               PSIBASE_LOG(logger, error)
                   << "The recorded state checksum (" << psio::convert_to_json(row.state->state)
                   << ") does not match the newly computed checksum ("
                   << psio::convert_to_json(checksum) << ")";
               row.state = {.state = checksum};
            }
         }
         else
         {
            auto pos = std::ranges::find(row.other, checksum, &SnapshotRow::Item::state);
            if (pos != row.other.end())
            {
               row.state = std::move(*pos);
               row.other.erase(pos);
            }
            else
            {
               row.state = {.state = checksum};
            }
         }
         // Add my signature
         if (auto claim = producers.getClaim(me))
         {
            if (std::ranges::find(row.state->signatures, me, &snapshot::StateSignature::account) ==
                row.state->signatures.end())
            {
               auto sig = prover.prove(snapshot::StateSignatureInfo{checksum}, *claim);
               row.state->signatures.push_back({me, *claim, sig});
               inserted = true;
            }
         }
         systemContext->sharedDatabase.kvPutSubjective(*writer, key, psio::to_frac(row));
         PSIBASE_LOG_CONTEXT_BLOCK(logger, status.head->header, id);
         verify_state_checksum(row, producers, ChecksumLog::always);
         if (inserted)
         {
            return std::move(row.state->signatures.back());
         }
         else
         {
            return {};
         }
      }

      StatusRow getStatus(ConstRevisionPtr revision) const
      {
         check(!!revision, "Missing revision for state signature");
         // look up active producers
         Database db{systemContext->sharedDatabase, std::move(revision)};
         auto     session = db.startRead();
         auto     status  = db.kvGet<StatusRow>(StatusRow::db, statusKey());
         check(!!status, "Missing status row");
         check(!!status->head, "StatusRow missing head");
         return std::move(*status);
      }

      // This can lag significantly behind irreversibility, so we can't rely
      // on the BlockHeaderState being available
      // Returns true if the signature is new
      bool on_state_signature(const Checksum256&              id,
                              const snapshot::StateChecksum&  checksum,
                              const snapshot::StateSignature& sig)
      {
         auto        revision = systemContext->sharedDatabase.getRevision(*writer, id);
         auto        status   = getStatus(revision);
         ProducerSet producers(status.consensus.current.data);
         if (!producers.getIndex(sig.account, sig.claim))
         {
            abortMessage(sig.account.str() + " is not a producer for block " +
                         loggers::to_string(id));
         }
         auto authRevision = revision;
         if (status.consensus.next)
         {
            Database db{systemContext->sharedDatabase, revision};
            auto     session = db.startRead();
            authRevision     = db.getPrevAuthServices();
         }
         verify(authRevision, snapshot::StateSignatureInfo{checksum}, sig.claim, sig.rawData);

         // Check whether we already have a signature from this producers
         // and insert it if we don't.
         bool        inserted = false;
         auto        log      = ChecksumLog::never;
         SnapshotRow row{.id = id};
         auto        key = psio::convert_to_key(row.key());
         if (auto bytes = systemContext->sharedDatabase.kvGetSubjective(*writer, key))
         {
            psio::from_frac(row, *bytes);
         }
         if (row.state && row.state->state == checksum)
         {
            if (std::ranges::find(row.state->signatures, sig.account,
                                  &snapshot::StateSignature::account) ==
                row.state->signatures.end())
            {
               row.state->signatures.push_back(sig);
               inserted = true;
            }
            log = ChecksumLog::exact;
         }
         else
         {
            auto pos = std::ranges::find(row.other, checksum, &SnapshotRow::Item::state);
            if (pos == row.other.end())
            {
               row.other.push_back({.state = checksum, .signatures = {sig}});
               inserted = true;
            }
            else
            {
               if (std::ranges::find(pos->signatures, sig.account,
                                     &snapshot::StateSignature::account) == pos->signatures.end())
               {
                  pos->signatures.push_back(sig);
                  inserted = true;
               }
            }
         }
         if (inserted)
         {
            systemContext->sharedDatabase.kvPutSubjective(*writer, key, psio::to_frac(row));
            PSIBASE_LOG_CONTEXT_BLOCK(logger, status.head->header, id);
            verify_state_checksum(row, producers, log);
         }
         return inserted;
      }

      // returns true if the number of producers is exactly the threshold
      void verify_state_checksum(const SnapshotRow& row,
                                 const ProducerSet& prods,
                                 ChecksumLog        shouldLog)
      {
         auto        threshold = prods.weak_threshold();
         std::size_t total     = 0;
         std::size_t max       = 0;
         for (const auto& item : row.other)
         {
            total += item.signatures.size();
            max = std::max(max, item.signatures.size());
         }
         if (row.state)
         {
            if (total >= threshold)
            {
               PSIBASE_LOG(logger, critical) << "Consensus failure: state does not match producers";
               throw consensus_failure{};
            }
            if (shouldLog == ChecksumLog::exact && row.state->signatures.size() == threshold ||
                shouldLog == ChecksumLog::always && row.state->signatures.size() >= threshold)
            {
               PSIBASE_LOG(logger, info) << "Verified state checksum";
            }
            else if (shouldLog == ChecksumLog::always)
            {
               PSIBASE_LOG(logger, info) << "Finished state checksum";
            }
         }
         else
         {
            if (total - max >= threshold)
            {
               PSIBASE_LOG(logger, critical) << "Consensus failure: producer state has diverged";
               throw consensus_failure{};
            }
         }
      }
      BlockHeaderState* finish_block(auto&& makeData)
      {
         assert(!!blockContext);
         if (blockContext->needGenesisAction)
         {
            abort_block();
            return nullptr;
         }
         try
         {
            auto claim = head->getNextProducerClaim(blockContext->current.header.producer);
            // If we're not a valid producer for the next block, then
            // we shouldn't have started block production.
            assert(!!claim);
            // If the head block is changed, the pending block needs to be cancelled.
            assert(blockContext->current.header.previous == head->blockId());
            auto [revision, id] =
                blockContext->writeRevision(prover, *claim, head->getNextAuthRevision());
            systemContext->sharedDatabase.setHead(*writer, revision);
            assert(head->blockId() == blockContext->current.header.previous);
            BlockInfo info;
            info.header  = blockContext->current.header;
            info.blockId = id;
            auto [state_iter, ins2] =
                states.try_emplace(id, systemContext, writer, *head, info, revision);
            byOrderIndex.insert({state_iter->second.order(), id});
            head = &state_iter->second;
            assert(!!head->revision);
            byBlocknumIndex.insert({head->blockNum(), head->blockId()});
            auto proof = getBlockProof(revision, blockContext->current.header.blockNum);
            blocks.try_emplace(id, SignedBlock{blockContext->current, proof, makeData(head)});
            PSIBASE_LOG_CONTEXT_BLOCK(blockLogger, blockContext->current.header, id);
            PSIBASE_LOG(blockLogger, info) << "Produced block";
            blockContext.reset();
            return head;
         }
         catch (std::exception& e)
         {
            blockContext.reset();
            PSIBASE_LOG(logger, error) << e.what() << std::endl;
            return nullptr;
         }
      }

      void pushTransaction(SignedTransaction&& trx)
      {
         auto bc = getBlockContext();

         auto             revisionAtBlockStart = getHeadRevision();
         TransactionTrace trace;
         try
         {
            if (bc->needGenesisAction)
               trace.error = "Node is not connected to any psibase network.";
            else
            {
               check(trx.proofs.size() == trx.transaction->claims().size(),
                     "proofs and claims must have same size");
               // All proofs execute as of the state at block begin. This will allow
               // consistent parallel execution of all proofs within a block during
               // replay. Proofs don't have direct database access, but they do rely
               // on the set of services stored within the database. They may call
               // other services; e.g. to call crypto functions.
               //
               // TODO: move proof execution to background threads
               // TODO: track CPU usage of proofs and pass it somehow to the main
               //       execution for charging
               // TODO: If by the time the transaction executes it's on a different
               //       block than the proofs were verified on, then either the proofs
               //       need to be rerun, or the hashes of the services which ran
               //       during the proofs need to be compared against the current
               //       service hashes. This will prevent a poison block.
               // TODO: If the first proof and the first auth pass, but the transaction
               //       fails (including other proof failures), then charge the first
               //       authorizer
               BlockContext proofBC{*systemContext, revisionAtBlockStart};
               proofBC.start(bc->current.header.time);
               for (size_t i = 0; i < trx.proofs.size(); ++i)
               {
                  proofBC.verifyProof(trx, trace, i, proofWatchdogLimit, bc);
               }

               // TODO: in another thread: check first auth and first proof. After
               //       they pass, schedule the remaining proofs. After they pass,
               //       schedule the transaction for execution in the main thread.
               //
               // The first auth check is a prefiltering measure and is mostly redundant
               // with main execution. Unlike the proofs, the first auth check is allowed
               // to run with any state on any fork. This is OK since the main execution
               // checks all auths including the first; the worst that could happen is
               // the transaction being rejected because it passes on one fork but not
               // another, potentially charging the user for the failed transaction. The
               // first auth check, when not part of the main execution, runs in read-only
               // mode. Transact lets the account's auth service know it's in a
               // read-only mode so it doesn't fail the transaction trying to update its
               // tables.
               //
               // Replay doesn't run the first auth check separately. This separate
               // execution is a subjective measure; it's possible, but not advisable,
               // for a modified node to skip it during production. This won't hurt
               // consensus since replay never uses read-only mode for auth checks.
               auto saveTrace = trace;
               proofBC.checkFirstAuth(trx, trace, std::nullopt, bc);
               trace = std::move(saveTrace);

               // TODO: RPC: don't forward failed transactions to P2P; this gives users
               //       feedback.
               // TODO: P2P: do forward failed transactions; this enables producers to
               //       bill failed transactions which have tied up P2P nodes.
               // TODO: If the first authorizer doesn't have enough to bill for failure,
               //       then drop before running any other checks. Don't propagate.
               // TODO: Don't propagate failed transactions which have
               //       do_not_broadcast_flag.
               // TODO: Revisit all of this. It doesn't appear to eliminate the need to
               //       shadow bill, and once shadow billing is in place, failed
               //       transaction billing seems unnecessary.

               bc->pushTransaction(std::move(trx), trace, std::nullopt);
            }
         }
         catch (std::bad_alloc&)
         {
            throw;
         }
         catch (...)
         {
            // Don't give a false positive
            if (!trace.error)
               throw;
         }
      }

      std::optional<SignedTransaction> nextTransaction()
      {
         auto bc = getBlockContext();
         if (!bc || bc->needGenesisAction)
            return {};
         auto session = bc->db.startWrite(writer);
         auto result  = bc->callNextTransaction();
         session.commit();
         return result;
      }

      void onChangeNextTransaction(auto&& fn) { dbCallbacks.nextTransaction = fn; }
      void onChangeRunQueue(auto&& fn) { dbCallbacks.runQueue = fn; }

      void recvMessage(const Socket& sock, const std::vector<char>& data)
      {
         Action action{.service = proxyServiceNum,
                       .rawData = psio::to_frac(std::tuple(sock.id, data))};

         // TODO: This can run concurrently
         BlockContext     bc{*systemContext, systemContext->sharedDatabase.getHead(),
                         systemContext->sharedDatabase.createWriter(), true};
         TransactionTrace trace;
         try
         {
            auto& atrace = bc.execAsyncExport("recv", std::move(action), trace);
            BOOST_LOG_SCOPED_LOGGER_TAG(bc.trxLogger, "Trace", std::move(trace));
            PSIBASE_LOG(bc.trxLogger, debug) << action.service.str() << "::recv succeeded";
         }
         catch (std::exception& e)
         {
            BOOST_LOG_SCOPED_LOGGER_TAG(bc.trxLogger, "Trace", std::move(trace));
            PSIBASE_LOG(bc.trxLogger, warning)
                << action.service.str() << "::recv failed: " << e.what();
         }
      }

      void setSocket(std::int32_t fd, const std::shared_ptr<Socket>& sock)
      {
         systemContext->sockets->set(*writer, fd, sock);
      }

      std::vector<char> getBlockProof(ConstRevisionPtr revision, BlockNum blockNum)
      {
         Database db{systemContext->sharedDatabase, std::move(revision)};
         auto     session = db.startRead();
         if (auto row = db.kvGet<std::vector<char>>(DbId::blockProof, blockNum))
         {
            return *row;
         }
         else
         {
            return {};
         }
      }

      void onCommit(std::function<void(BlockHeaderState*)> fn) { onCommitFn = std::move(fn); }

      bool isProducing() const { return !!blockContext; }

      auto& getLogger() { return logger; }
      auto& getBlockLogger() { return blockLogger; }

      explicit ForkDb(SystemContext*          sc,
                      std::shared_ptr<Prover> prover = std::make_shared<CompoundProver>())
          : prover{std::move(prover)}
      {
         logger.add_attribute("Channel", boost::log::attributes::constant(std::string("chain")));
         blockLogger.add_attribute("Channel",
                                   boost::log::attributes::constant(std::string("block")));
         systemContext = sc;
         writer        = sc->sharedDatabase.createWriter();

         Database db{sc->sharedDatabase, sc->sharedDatabase.getHead()};
         auto     session = db.startRead();
         auto     status  = db.kvGet<StatusRow>(StatusRow::db, statusKey());
         if (!status || !status->head)
         {
            // Initialize new chain state
            states.emplace();
            head = &states.begin()->second;
            byBlocknumIndex.insert({head->blockNum(), head->blockId()});
            byOrderIndex.insert({head->order(), head->blockId()});
            head->revision = systemContext->sharedDatabase.getHead();
            assert(!!head->revision);
         }
         else
         {
            // Add blocks in [irreversible, head]
            // for now ignore other forks
            auto blockId  = status->head->blockId;
            auto revision = sc->sharedDatabase.getHead();
            do
            {
               // Initialize state
               BlockInfo info = readHead(revision);
               auto [state_iter, _] =
                   states.try_emplace(info.blockId, info, systemContext, revision);
               byOrderIndex.try_emplace(state_iter->second.order(), info.blockId);
               byBlocknumIndex.try_emplace(info.header.blockNum, info.blockId);
               if (!head)
               {
                  head = &state_iter->second;
                  assert(!!head->revision);
                  PSIBASE_LOG_CONTEXT_BLOCK(logger, info.header, info.blockId);
                  PSIBASE_LOG(logger, debug) << "Read head block";
               }

               // load block
               auto block = db.kvGet<Block>(DbId::blockLog, info.header.blockNum);
               if (!block)
               {
                  break;
               }
               auto proof = db.kvGet<std::vector<char>>(DbId::blockProof, info.header.blockNum);
               if (!proof)
               {
                  proof.emplace();
               }
               blocks.try_emplace(info.blockId, SignedBlock{*block, *proof});

               // Find the previous block
               blockId  = info.header.previous;
               revision = sc->sharedDatabase.getRevision(*this->writer, blockId);
            } while (revision);
            const auto& info = states.begin()->second.info;
            PSIBASE_LOG_CONTEXT_BLOCK(logger, info.header, info.blockId);
            PSIBASE_LOG(logger, debug) << "Read last committed block";
         }
         // Initialize AuthState. This is a separate step because it needs
         // to run forwards, while the blocks are loaded in reverse order.
         {
            BlockHeaderState* prev = nullptr;
            for (auto& [id, state] : states)
            {
               if (prev)
               {
                  state.initAuthState(systemContext, writer, *prev);
               }
               else
               {
                  state.loadAuthState(systemContext, writer);
               }
               prev = &state;
            }
         }
         // TODO: if this doesn't exist, the database is corrupt
         assert(!byBlocknumIndex.empty());
         commitIndex = byBlocknumIndex.begin()->first;
         currentTerm = head->info.header.term;

         // If the block log is truncated, find where it starts
         if (auto row = sc->sharedDatabase.kvGetSubjective(*writer,
                                                           psio::convert_to_key(logTruncateKey())))
         {
            logStart = psio::from_frac<LogTruncateRow>(*row).start;
         }

         systemContext->sharedDatabase.setCallbacks(&dbCallbacks);
      }
      ~ForkDb() { systemContext->sharedDatabase.setCallbacks(nullptr); }

      BlockContext* getBlockContext()
      {
         if (blockContext)
         {
            return &*blockContext;
         }
         else
         {
            return nullptr;
         }
      }
      ConstRevisionPtr getHeadRevision() { return head->revision; }

      std::vector<char> sign(std::span<char> data, const Claim& claim)
      {
         return prover.prove(data, claim);
      }

      // Verifies a signature on a message associated with a block.
      void verify(const Checksum256&       blockId,
                  std::span<char>          data,
                  AccountNumber            producer,
                  const Claim&             claim,
                  const std::vector<char>& signature)
      {
         auto stateIter = states.find(blockId);
         check(stateIter != states.end(), "Unknown block");
         // TODO: if the producer has the same key but the authServices changed, should
         // we check the signature twice?
         verify(stateIter->second.getAuthRevision(producer, claim), data, claim, signature);
      }

      void verify(std::span<const char>    data,
                  const Claim&             claim,
                  const std::vector<char>& signature)
      {
         verify(head->getProdsAuthRevision(), data, claim, signature);
      }

      void verify(ConstRevisionPtr         revision,
                  std::span<const char>    data,
                  const Claim&             claim,
                  const std::vector<char>& signature)
      {
         BlockContext verifyBc(*systemContext, std::move(revision));
         VerifyProver prover{verifyBc, signature};
         prover.prove(data, claim);
      }

      BlockInfo readHead(ConstRevisionPtr revision)
      {
         Database db{systemContext->sharedDatabase, std::move(revision)};
         auto     session = db.startRead();
         auto     status  = db.kvGet<StatusRow>(StatusRow::db, statusKey());
         check(status && status->head, "Missing head");
         return *status->head;
      }

      BlockNum getLogStart() const { return logStart; }

     private:
      // TODO: Use command line argument (read from database?, rearrange so services can set it explicitly?)
      std::chrono::microseconds                                 proofWatchdogLimit{200000};
      std::optional<BlockContext>                               blockContext;
      SystemContext*                                            systemContext = nullptr;
      WriterPtr                                                 writer;
      CheckedProver                                             prover;
      BlockNum                                                  commitIndex = 1;
      BlockNum                                                  logStart    = 0;
      TermNum                                                   currentTerm = 1;
      BlockHeaderState*                                         head        = nullptr;
      std::map<Checksum256, psio::shared_view_ptr<SignedBlock>> blocks;
      std::map<Checksum256, BlockHeaderState>                   states;

      std::map<decltype(std::declval<BlockHeaderState>().order()), Checksum256> byOrderIndex;
      std::map<BlockNum, Checksum256>                                           byBlocknumIndex;

      std::function<void(BlockHeaderState*)> onCommitFn;
      DatabaseCallbacks                      dbCallbacks;

      loggers::common_logger logger;
      loggers::common_logger blockLogger;
   };
}  // namespace psibase
