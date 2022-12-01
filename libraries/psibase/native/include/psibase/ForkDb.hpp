#pragma once

#include <boost/container/flat_map.hpp>
#include <boost/log/attributes/constant.hpp>
#include <iostream>
#include <psibase/BlockContext.hpp>
#include <psibase/Prover.hpp>
#include <psibase/VerifyProver.hpp>
#include <psibase/block.hpp>
#include <psibase/db.hpp>
#include <psibase/log.hpp>

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
   std::tuple<ConsensusAlgorithm, const std::vector<Producer>&> split(const CftConsensus& c)
   {
      return {ConsensusAlgorithm::cft, c.producers};
   }
   std::tuple<ConsensusAlgorithm, const std::vector<Producer>&> split(const BftConsensus& c)
   {
      return {ConsensusAlgorithm::bft, c.producers};
   }

   struct ProducerSet
   {
      ConsensusAlgorithm                               algorithm;
      boost::container::flat_map<AccountNumber, Claim> activeProducers;
      ProducerSet() = default;
      ProducerSet(const Consensus& c)
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
   };

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
      // TODO: track setcode of contracts used to verify producer signatures
      // in the BlockHeader. To make this work, we probably need to forbid
      // calls to other contracts and access to state.
      BlockHeaderState() : info()
      {
         info.header.blockNum = 1;
         producers            = std::make_shared<ProducerSet>();
      }
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
            producers = std::make_shared<ProducerSet>(status->consensus);
            if (status->nextConsensus)
            {
               const auto& [prods, num] = *status->nextConsensus;
               nextProducers            = std::make_shared<ProducerSet>(prods);
               nextProducersBlockNum    = num;
            }
         }
      }
      BlockHeaderState(const BlockHeaderState& prev,
                       const BlockInfo&        info,
                       ConstRevisionPtr        revision = nullptr)
          : info(info),
            revision(revision),
            producers(prev.producers),
            nextProducers(prev.nextProducers),
            nextProducersBlockNum(prev.nextProducersBlockNum)
      {
         // Handling of the producer schedule must match BlockContext::writeRevision
         // Note: technically we could use this block's commitNum instead of the
         // previous block's commitNum, but that complicates the producer hand-off.
         if (nextProducers && prev.info.header.commitNum >= nextProducersBlockNum)
         {
            producers = std::move(nextProducers);
         }
         if (info.header.newConsensus)
         {
            nextProducers = std::make_shared<ProducerSet>(*info.header.newConsensus);
            // N.B. joint consensus with two identical producer sets
            // is functionally indistinguishable from non-joint consensus.
            // Don't both detecting this case here.
            nextProducersBlockNum = info.header.blockNum;
         }
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
            if (producers->size() == 0)
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

   ExtendedBlockId orderToXid(const auto& order)
   {
      return ExtendedBlockId{std::get<2>(order), std::get<1>(order)};
   }

   class ForkDb
   {
     public:
      using id_type = Checksum256;
      bool insert(const psio::shared_view_ptr<SignedBlock>& b)
      {
         BlockInfo info(*b->block());
         PSIBASE_LOG_CONTEXT_BLOCK(info.header, info.blockId);
         if (info.header.blockNum <= commitIndex)
         {
            PSIBASE_LOG(logger, debug) << "Block ignored because it is before commitIndex";
            return false;
         }
         if (!blocks.try_emplace(info.blockId, b).second)
         {
            PSIBASE_LOG(logger, debug) << "Block skipped because it is already known";
            return false;
         }
         if (auto* prev = get_state(info.header.previous))
         {
            auto [pos, inserted] = states.try_emplace(info.blockId, *prev, info);
            assert(inserted);
            if (prev->invalid)
            {
               PSIBASE_LOG(logger, debug) << "Block parent is invalid";
               pos->second.invalid = true;
            }
            else if (byOrderIndex.find(prev->order()) != byOrderIndex.end())
            {
               byOrderIndex.insert({pos->second.order(), info.blockId});
            }
            else
            {
               PSIBASE_LOG(logger, debug) << "Block is outside current tree";
            }
            return true;
         }
         else
         {
            PSIBASE_LOG(logger, debug) << "Block dropped because its parent is missing";
         }
         return false;
      }
      BlockHeader*                       get_head() const { return &head->info.header; }
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
            if (auto block = db.kvGet<Block>(DbId::blockLog, num))
            {
               // TODO: we can look up the next block and get prev instead of calculating the hash
               return BlockInfo{*block}.blockId;
            }
            else
            {
               return {};
            }
         }
      }
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
               return psio::shared_view_ptr<SignedBlock>(
                   SignedBlock{*block, proof ? *proof : std::vector<char>()});
            }
            else
            {
               return nullptr;
            }
         }
      }
      auto get_prev_id(const id_type& id)
      {
         return Checksum256(*get(id)->block()->header()->previous());
      }

      // If root is non-null, the head block must be a descendant of root
      void set_subtree(const BlockHeaderState* root)
      {
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
               iter                    = byOrderIndex.erase(iter);
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
         // Don't switch if we are currently building a block.
         // TODO: interrupt the current block if it is better than the block being built.
         if (blockContext)
         {
            switchForkCallback = std::move(callback);
            return;
         }
         auto pos = byOrderIndex.end();
         --pos;
         auto new_head = get_state(pos->second);
         if (head != new_head)
         {
            for (auto i = new_head->blockNum() + 1; i <= head->blockNum(); ++i)
            {
               // TODO: this should not be an assert, because it depends on other nodes behaving correctly
               assert(i > commitIndex);
               byBlocknumIndex.erase(i);
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
                 iter != begin;)
            {
               --iter;
               if (iter->second == id)
               {
                  if (execute_fork(iter, byBlocknumIndex.end(), on_accept_block))
                  {
                     break;
                  }
                  else
                  {
                     // If execute fork fails, the trial head block and possibly
                     // others are removed from byOrderIndex and byBlocknumIndex.
                     // Start over.
                     return async_switch_fork(
                         static_cast<decltype(callback)>(callback),
                         static_cast<decltype(on_accept_block)>(on_accept_block));
                  }
               }
               assert(iter->first > commitIndex);
               iter->second = id;
               id           = get_prev_id(id);
            }
            head = new_head;
            callback(&head->info.header);
         }
      }
      // TODO: somehow prevent poisoning the cache if a malicious peer
      // sends a correct block with the wrong signature.
      Claim validateBlockSignature(BlockHeaderState* prev, const BlockInfo& info, const auto& sig)
      {
         BlockContext verifyBc(*systemContext, prev->revision);
         VerifyProver prover{verifyBc, sig};
         auto         claim = prev->getNextProducerClaim(info.header.producer);
         if (!claim)
         {
            throw std::runtime_error("Invalid producer for block");
         }
         prover.prove(BlockSignatureInfo(info), *claim);
         return std::move(*claim);
      }
      // \pre the state of prev has been set
      bool execute_block(BlockHeaderState* prev, BlockHeaderState* state, auto&& on_accept_block)
      {
         std::error_code ec{};
         if (!state->revision)
         {
            BlockContext ctx(*systemContext, prev->revision, writer, true);
            auto         blockPtr = get(state->blockId());
            PSIBASE_LOG_CONTEXT_BLOCK(state->info.header, state->blockId());
            try
            {
               auto claim = validateBlockSignature(prev, state->info, blockPtr->signature());
               ctx.start(Block(blockPtr->block()));
               ctx.callStartBlock();
               ctx.execAllInBlock();
               auto [newRevision, id] =
                   ctx.writeRevision(FixedProver(blockPtr->signature().get()), claim);
               // TODO: diff header fields
               check(id == state->blockId(), "blockId does not match");
               state->revision = newRevision;

               on_accept_block(state);
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
                  return false;
               }
               systemContext->sharedDatabase.setHead(*writer, nextState->revision);
               prev = nextState;
            }
         }
         return true;
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
         if (head->nextProducers && head->info.header.commitNum >= head->nextProducersBlockNum)
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
         commitIndex         = newCommitIndex;
         systemContext->sharedDatabase.removeRevisions(*writer,
                                                       byBlocknumIndex.find(commitIndex)->second);
         return result;
      }

      void setBlockData(const Checksum256& id, std::vector<char>&& data)
      {
         char key[] = {0};
         systemContext->sharedDatabase.setBlockData(*writer, id, key, data);
      }

      std::optional<std::vector<char>> getBlockData(const Checksum256& id) const
      {
         char key[] = {0};
         return systemContext->sharedDatabase.getBlockData(*writer, id, key);
      }

      // removes blocks and states before irreversible
      void gc(auto&& f)
      {
         for (auto iter = blocks.begin(), end = blocks.end(); iter != end;)
         {
            auto blockNum = getBlockNum(iter->first);
            if (blockNum < commitIndex ||
                (blockNum == commitIndex &&
                 !in_best_chain(ExtendedBlockId{iter->first, blockNum})) ||
                (blockNum > commitIndex &&
                 states.find(iter->second->block()->header()->previous()) == states.end()))
            {
               f(iter->first);
               auto state_iter = states.find(iter->first);
               if (state_iter != states.end())
               {
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
      }

      template <typename T>
      T get_prev_id(const T& t)
      {
         return T{get_prev_id(t.id()), t.num() - 1};
      }
      auto    commit_index() const { return commitIndex; }
      id_type get_ancestor(id_type id, auto n)
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
            else if (get_block_id(t.num()) == t.id())
            {
               return t;
            }
            else
            {
               throw std::runtime_error("block number is irreversible but block id does not match");
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
      BlockHeaderState* finish_block(auto&& makeData)
      {
         assert(!!blockContext);
         if (blockContext->needGenesisAction)
         {
            abort_block();
            // if we've received blocks while trying to produce, make sure that
            // we handle them.
            if (switchForkCallback)
            {
               auto callback = std::move(switchForkCallback);
               // TODO: get rid of this. the caller should handle nullptr and call async_switch_fork instead of calling it here.
               async_switch_fork(std::move(callback), [](const void*) {});
            }
            return nullptr;
         }
         try
         {
            auto claim = head->getNextProducerClaim(blockContext->current.header.producer);
            // If we're not a valid producer for the next block, then
            // we shouldn't have started block production.
            assert(!!claim);
            auto [revision, id] = blockContext->writeRevision(prover, *claim);
            systemContext->sharedDatabase.setHead(*writer, revision);
            assert(head->blockId() == blockContext->current.header.previous);
            BlockInfo info;
            info.header             = blockContext->current.header;
            info.blockId            = id;
            auto [state_iter, ins2] = states.try_emplace(id, *head, info, revision);
            byOrderIndex.insert({state_iter->second.order(), id});
            head = &state_iter->second;
            byBlocknumIndex.insert({head->blockNum(), head->blockId()});
            auto proof = getBlockProof(revision, blockContext->current.header.blockNum);
            blocks.try_emplace(id, SignedBlock{blockContext->current, proof, makeData(head)});
            PSIBASE_LOG_CONTEXT_BLOCK(blockContext->current.header, id);
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

      bool isProducing() const { return !!blockContext; }

      auto& getLogger() { return logger; }

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
         }
         else
         {
            // Add blocks in [irreversible, head]
            // for now ignore other forks
            auto blockNum = status->head->header.blockNum;
            do
            {
               auto block = db.kvGet<Block>(DbId::blockLog, blockNum);
               if (!block)
               {
                  break;
               }
               BlockInfo info{*block};
               auto      revision = sc->sharedDatabase.getRevision(*this->writer, info.blockId);
               if (!revision)
               {
                  break;
               }
               auto proof = db.kvGet<std::vector<char>>(DbId::blockProof, blockNum);
               if (!proof)
               {
                  proof.emplace();
               }
               blocks.try_emplace(info.blockId, SignedBlock{*block, *proof});
               auto [state_iter, _] =
                   states.try_emplace(info.blockId, info, systemContext, revision);
               byOrderIndex.try_emplace(state_iter->second.order(), info.blockId);
               byBlocknumIndex.try_emplace(blockNum, info.blockId);
               if (!head)
               {
                  head = &state_iter->second;
                  PSIBASE_LOG_CONTEXT_BLOCK(info.header, info.blockId);
                  PSIBASE_LOG(logger, debug) << "Read head block";
               }
            } while (blockNum--);
            const auto& info = states.begin()->second.info;
            PSIBASE_LOG_CONTEXT_BLOCK(info.header, info.blockId);
            PSIBASE_LOG(logger, debug) << "Read last committed block";
         }
         // TODO: if this doesn't exist, the database is corrupt
         assert(!byBlocknumIndex.empty());
         commitIndex = byBlocknumIndex.begin()->first;
      }
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

      void verify(std::span<char> data, const Claim& claim, const std::vector<char>& signature)
      {
         auto iter = byBlocknumIndex.find(commitIndex);
         // The last committed block is guaranteed to be present
         assert(iter != byBlocknumIndex.end());
         auto stateIter = states.find(iter->second);
         // We'd better have a state for this block
         assert(stateIter != states.end());
         assert(stateIter->second.revision);
         BlockContext verifyBc(*systemContext, stateIter->second.revision);
         VerifyProver prover{verifyBc, signature};
         prover.prove(data, claim);
      }

      void verify(ConstRevisionPtr         revision,
                  std::span<char>          data,
                  const Claim&             claim,
                  const std::vector<char>& signature)
      {
         BlockContext verifyBc(*systemContext, std::move(revision));
         VerifyProver prover{verifyBc, signature};
         prover.prove(data, claim);
      }

     private:
      std::optional<BlockContext>                               blockContext;
      std::function<void(BlockHeader*)>                         switchForkCallback;
      SystemContext*                                            systemContext = nullptr;
      WriterPtr                                                 writer;
      CheckedProver                                             prover;
      BlockNum                                                  commitIndex = 1;
      BlockHeaderState*                                         head        = nullptr;
      std::map<Checksum256, psio::shared_view_ptr<SignedBlock>> blocks;
      std::map<Checksum256, BlockHeaderState>                   states;

      std::map<decltype(std::declval<BlockHeaderState>().order()), Checksum256> byOrderIndex;
      std::map<BlockNum, Checksum256>                                           byBlocknumIndex;

      loggers::common_logger logger;
      loggers::common_logger blockLogger;
   };
}  // namespace psibase
