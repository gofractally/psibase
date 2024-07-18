#pragma once

#include <boost/container/flat_map.hpp>
#include <boost/log/attributes/constant.hpp>
#include <iostream>
#include <psibase/BlockContext.hpp>
#include <psibase/Prover.hpp>
#include <psibase/Socket.hpp>
#include <psibase/VerifyProver.hpp>
#include <psibase/block.hpp>
#include <psibase/db.hpp>
#include <psibase/log.hpp>
#include <psibase/serviceEntry.hpp>

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

   inline std::ostream& operator<<(std::ostream& os, const ProducerSet& prods)
   {
      if (prods.algorithm == ConsensusAlgorithm::cft)
      {
         os << "CFT:";
      }
      else if (prods.algorithm == ConsensusAlgorithm::bft)
      {
         os << "BFT:";
      }
      os << '[';
      bool first = true;
      for (const auto& [name, auth] : prods.activeProducers)
      {
         if (first)
         {
            first = false;
         }
         else
         {
            os << ',';
         }
         os << name.str();
      }
      os << ']';
      return os;
   }

   struct BlockAuthState
   {
      ConstRevisionPtr                    revision;
      std::vector<BlockHeaderAuthAccount> services;

      static auto makeCodeIndex(const BlockHeader* header)
      {
         using K = decltype(codeByHashKey(Checksum256(), 0, 0));
         using R = boost::container::flat_map<K, const BlockHeaderCode*>;
         R::sequence_type seq;
         for (const auto& code : *header->authCode)
         {
            auto codeHash = sha256(code.code.data(), code.code.size());
            auto key      = codeByHashKey(codeHash, code.vmType, code.vmVersion);
            seq.push_back({key, &code});
         }
         R result;
         result.adopt_sequence(std::move(seq));
         return result;
      }

      static void writeServices(Database& db, const std::vector<BlockHeaderAuthAccount>& accounts)
      {
         for (const auto& account : accounts)
         {
            CodeRow row{.codeNum   = account.codeNum,
                        .flags     = 0,
                        .codeHash  = account.codeHash,
                        .vmType    = account.vmType,
                        .vmVersion = account.vmVersion};
            db.kvPut(CodeRow::db, row.key(), row);
         }
      }

      static void updateServices(Database&                                  db,
                                 const std::vector<BlockHeaderAuthAccount>& oldServices,
                                 const std::vector<BlockHeaderAuthAccount>& services)
      {
         std::vector<AccountNumber> removedAccounts;
         auto codeNumView = std::views::transform([](auto& p) { return p.codeNum; });
         std::ranges::set_difference(oldServices | codeNumView, services | codeNumView,
                                     std::back_inserter(removedAccounts));
         for (AccountNumber account : removedAccounts)
         {
            db.kvRemove(CodeRow::db, codeKey(account));
         }
         writeServices(db, services);
      }

      // Read state at revision
      BlockAuthState(SystemContext*   systemContext,
                     const WriterPtr& writer,
                     Database&        db,
                     const BlockInfo& info)
      {
         revision = systemContext->sharedDatabase.emptyRevision();
         if (auto status = db.kvGet<StatusRow>(StatusRow::db, StatusRow::key()))
         {
            Database dst{systemContext->sharedDatabase, revision};
            auto     session = dst.startWrite(writer);
            services         = status->authServices;
            auto keys        = getCodeKeys(services);
            for (const auto& key : keys)
            {
               if (auto row = db.kvGet<CodeByHashRow>(CodeByHashRow::db, key))
               {
                  dst.kvPut(CodeByHashRow::db, key, *row);
               }
               else
               {
                  check(false, "Missing code for auth service");
               }
            }
            writeServices(dst, services);
            revision = dst.getModifiedRevision();
         }
      }

      BlockAuthState(SystemContext*        systemContext,
                     const WriterPtr&      writer,
                     const BlockAuthState& prev,
                     const BlockHeader&    header)
      {
         if (header.authServices)
         {
            check(!!header.authCode, "code must be provided when changing auth services");
            services                    = *header.authServices;
            auto               prevKeys = getCodeKeys(prev.services);
            auto               nextKeys = getCodeKeys(*header.authServices);
            decltype(prevKeys) removed, added;
            std::ranges::set_difference(prevKeys, nextKeys, std::back_inserter(removed));
            std::ranges::set_difference(nextKeys, prevKeys, std::back_inserter(added));
            auto code = makeCodeIndex(&header);
            check(std::ranges::includes(
                      nextKeys,
                      code | std::views::transform([](auto& arg) -> auto& { return arg.first; })),
                  "Wrong code");
            Database db{systemContext->sharedDatabase, prev.revision};
            auto     session = db.startWrite(writer);
            for (const auto& r : removed)
            {
               db.kvRemove(CodeByHashRow::db, r);
            }
            for (const auto& a : added)
            {
               const auto& [prefix, index, codeHash, vmType, vmVersion] = a;
               auto iter                                                = code.find(a);
               check(iter != code.end(), "Missing required code");
               CodeByHashRow code{.codeHash  = codeHash,
                                  .vmType    = vmType,
                                  .vmVersion = vmVersion,
                                  .numRefs   = 0,
                                  .code      = iter->second->code};
               db.kvPut(CodeByHashRow::db, a, code);
            }
            updateServices(db, prev.services, services);
            revision = db.getModifiedRevision();
         }
         else
         {
            check(!header.authCode, "authCode unexpected");
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
      // Holds the services that can be used to verify producer
      // signatures for the next block.
      std::shared_ptr<BlockAuthState> authState;
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
            producers = std::make_shared<ProducerSet>(status->consensus);
            if (status->nextConsensus)
            {
               const auto& [prods, num] = *status->nextConsensus;
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
            // N.B. joint consensus with two identical producer sets
            // is functionally indistinguishable from non-joint consensus.
            // Don't both detecting this case here.
            nextProducersBlockNum = info.header.blockNum;
         }
         initAuthState(systemContext, writer, prev);
      }
      // initAuthState and loadAuthState should only be used when
      // loading blocks from the database. initAuthState is preferred
      // because it saves space.
      void initAuthState(SystemContext*          systemContext,
                         const WriterPtr&        writer,
                         const BlockHeaderState& prev)
      {
         if (info.header.authServices)
         {
            authState = std::make_shared<BlockAuthState>(systemContext, writer, *prev.authState,
                                                         info.header);
         }
         else
         {
            check(!info.header.authCode, "Unexpected authCode");
            authState = prev.authState;
         }
      }
      void loadAuthState(SystemContext* systemContext, const WriterPtr& writer)
      {
         Database db{systemContext->sharedDatabase, revision};
         auto     session = db.startRead();
         authState        = std::make_shared<BlockAuthState>(systemContext, writer, db, info);
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
               return psio::shared_view_ptr<SignedBlock>(
                   SignedBlock{*block, proof ? *proof : std::vector<char>()});
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
         if (root->invalid)
         {
            PSIBASE_LOG_CONTEXT_BLOCK(logger, root->info.header, root->blockId());
            PSIBASE_LOG(logger, critical) << "Consensus failure: invalid block " << reason;
            throw consensus_failure{};
         }
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
         BlockContext verifyBc(*systemContext, prev->authState->revision);
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
               verifyBc.verifyProof(trx, trace, i, std::nullopt);
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
               auto [newRevision, id] =
                   ctx.writeRevision(FixedProver(blockPtr->signature()), claim);
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
                  head = prev;
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
         }
         // ensure that only descendants of the committed block
         // are considered when searching for the best block.
         // The subtree should not be changed if it is already ahead
         // of the committed block.
         if (std::get<1>(byOrderIndex.begin()->first) < newCommitIndex)
         {
            // no error is possible, because the committed block is in the
            // current chain.
            set_subtree(get_state(get_block_id(newCommitIndex)), "");
         }
         commitIndex = newCommitIndex;
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
                 states.find(iter->second->block().header().previous()) == states.end()))
            {
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
            auto [revision, id] = blockContext->writeRevision(prover, *claim);
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
               trace.error = "Need genesis block; use 'psibase boot' to boot chain";
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
                  proofBC.verifyProof(trx, trace, i, proofWatchdogLimit);
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
               proofBC.checkFirstAuth(trx, trace, std::nullopt);
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
         if (!bc)
            return {};
         Action action{.service = transactionServiceNum, .rawData = psio::to_frac(std::tuple())};
         std::optional<SignedTransaction> result;
         TransactionTrace                 trace;
         try
         {
            auto& atrace = bc->execExport("nextTransaction", std::move(action), trace);
            if (!psio::from_frac(result, atrace.rawRetval))
            {
               BOOST_LOG_SCOPED_LOGGER_TAG(bc->trxLogger, "Trace", std::move(trace));
               PSIBASE_LOG(bc->trxLogger, warning) << "failed to deserialize result of "
                                                   << action.service.str() << "::nextTransaction";
               result.reset();
            }
            else
            {
               BOOST_LOG_SCOPED_LOGGER_TAG(bc->trxLogger, "Trace", std::move(trace));
               PSIBASE_LOG(bc->trxLogger, info)
                   << action.service.str() << "::nextTransaction succeeded";
            }
         }
         catch (std::exception& e)
         {
            BOOST_LOG_SCOPED_LOGGER_TAG(bc->trxLogger, "Trace", std::move(trace));
            PSIBASE_LOG(bc->trxLogger, warning)
                << action.service.str() << "::nextTransaction failed: " << e.what();
         }
         return result;
      }

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
            PSIBASE_LOG(bc.trxLogger, info) << action.service.str() << "::recv succeeded";
         }
         catch (std::exception& e)
         {
            BOOST_LOG_SCOPED_LOGGER_TAG(bc.trxLogger, "Trace", std::move(trace));
            PSIBASE_LOG(bc.trxLogger, warning)
                << action.service.str() << "::recv failed: " << e.what();
         }
      }

      void addSocket(const std::shared_ptr<Socket>& sock) { systemContext->sockets->add(sock); }

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
                  if (blocks.empty())
                  {
                     revision = sc->sharedDatabase.getHead();
                  }
                  else
                  {
                     break;
                  }
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
                  assert(!!head->revision);
                  PSIBASE_LOG_CONTEXT_BLOCK(logger, info.header, info.blockId);
                  PSIBASE_LOG(logger, debug) << "Read head block";
               }
            } while (blockNum--);
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

      // Verifies a signature on a message associated with a block.
      // The signature is verified using the state at the end of
      // the previous block
      void verify(const Checksum256&       blockId,
                  std::span<char>          data,
                  const Claim&             claim,
                  const std::vector<char>& signature)
      {
         auto stateIter = states.find(blockId);
         check(stateIter != states.end(), "Unknown block");
         stateIter = states.find(stateIter->second.info.header.previous);
         check(stateIter != states.end(), "Previous block unknown");
         BlockContext verifyBc(*systemContext, stateIter->second.authState->revision);
         VerifyProver prover{verifyBc, signature};
         prover.prove(data, claim);
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
      // TODO: Use command line argument (read from database?, rearrange so services can set it explicitly?)
      std::chrono::microseconds                                 proofWatchdogLimit{200000};
      std::optional<BlockContext>                               blockContext;
      SystemContext*                                            systemContext = nullptr;
      WriterPtr                                                 writer;
      CheckedProver                                             prover;
      BlockNum                                                  commitIndex = 1;
      TermNum                                                   currentTerm = 1;
      BlockHeaderState*                                         head        = nullptr;
      std::map<Checksum256, psio::shared_view_ptr<SignedBlock>> blocks;
      std::map<Checksum256, BlockHeaderState>                   states;

      std::map<decltype(std::declval<BlockHeaderState>().order()), Checksum256> byOrderIndex;
      std::map<BlockNum, Checksum256>                                           byBlocknumIndex;

      loggers::common_logger logger;
      loggers::common_logger blockLogger;
   };
}  // namespace psibase
