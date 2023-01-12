#pragma once

#include <psibase/ForkDb.hpp>
#include <psibase/SignedMessage.hpp>
#include <psibase/blocknet.hpp>

#include <boost/dynamic_bitset/dynamic_bitset.hpp>

#include <algorithm>
#include <cassert>
#include <map>
#include <memory>
#include <optional>
#include <tuple>
#include <vector>

namespace psibase::net
{
   enum class confirm_result
   {
      unconfirmed,
      confirmed,
      duplicate
   };
   inline confirm_result operator&(confirm_result lhs, confirm_result rhs)
   {
      return std::min(lhs, rhs);
   }
   inline confirm_result& operator&=(confirm_result& lhs, confirm_result rhs)
   {
      lhs = lhs & rhs;
      return lhs;
   }

   struct PrepareMessage
   {
      static constexpr unsigned type = 38;
      Checksum256               block_id;
      AccountNumber             producer;
      Claim                     signer;

      std::string to_string() const
      {
         return "prepare: id=" + loggers::to_string(block_id) + " producer=" + producer.str();
      }
   };
   PSIO_REFLECT(PrepareMessage, block_id, producer, signer)

   struct CommitMessage
   {
      static constexpr unsigned type = 39;
      Checksum256               block_id;
      AccountNumber             producer;
      Claim                     signer;

      std::string to_string() const
      {
         return "commit: id=" + loggers::to_string(block_id) + " producer=" + producer.str();
      }
   };
   // To save space, we're picking this apart and reconstituting it, while
   // assuming that the signature remains valid.
   PSIO_REFLECT(CommitMessage, definitionWillNotChange(), block_id, producer, signer)

   struct ViewChangeMessage
   {
      static constexpr unsigned type = 40;
      TermNum                   term;
      AccountNumber             producer;
      Claim                     signer;

      std::string to_string() const
      {
         return "view change: term=" + std::to_string(term) + " producer=" + producer.str();
      }
   };
   PSIO_REFLECT(ViewChangeMessage, term, producer, signer)

   struct ProducerConfirm
   {
      AccountNumber     producer;
      std::vector<char> signature;
   };
   PSIO_REFLECT(ProducerConfirm, producer, signature)

   // TODO: consider using a multiparty signature scheme to save space
   struct BlockConfirm
   {
      BlockNum                                    blockNum;
      std::vector<ProducerConfirm>                commits;
      std::optional<std::vector<ProducerConfirm>> nextCommits;
   };
   PSIO_REFLECT(BlockConfirm, blockNum, commits, nextCommits)

   template <typename Base, typename Timer>
   struct basic_bft_consensus : Base
   {
      using Base::_state;
      using Base::active_producers;
      using Base::chain;
      using Base::current_term;
      using Base::for_each_key;
      using Base::is_producer;
      using Base::logger;
      using Base::network;
      using Base::recv;
      using Base::self;
      using Base::start_leader;
      using Base::stop_leader;
      using typename Base::producer_state;
      enum class confirm_type
      {
         prepare,
         commit
      };

      void verifyMsig(const auto&        revision,
                      const Checksum256& id,
                      const auto&        commits,
                      const ProducerSet& prods)
      {
         AccountNumber prevAccount{};
         check(commits.size() >= prods.threshold(), "Not enough commits");
         for (const auto& [prod, sig] : commits)
         {
            // mostly to guarantee that the producers are unique
            check(prevAccount < prod, "Commits must be ordered by producer");
            auto claim = prods.getClaim(prod);
            check(!!claim, "Not a valid producer");
            CommitMessage originalCommit{id, prod, *claim};
            auto          msg = network().serialize_unsigned_message(originalCommit);
            chain().verify(revision, {msg.data(), msg.size()}, *claim, sig);
         }
      }

      void verifyIrreversibleSignature(const auto&             revision,
                                       const BlockConfirm&     commits,
                                       const BlockHeaderState* state)
      {
         verifyMsig(revision, state->blockId(), commits.commits, *state->producers);
         if (state->nextProducers)
         {
            check(!!commits.nextCommits, "nextCommits required during joint consensus");
            verifyMsig(revision, state->blockId(), *commits.nextCommits, *state->nextProducers);
         }
         else
         {
            check(!commits.nextCommits, "Unexpected nextCommits outside joint consensus");
         }
      }

      struct block_confirm_data
      {
         explicit block_confirm_data(const std::shared_ptr<ProducerSet>& ptr)
             : block_confirm_data(ptr ? ptr->size() : 0)
         {
         }
         explicit block_confirm_data(std::size_t num_producers)
             : confirms{boost::dynamic_bitset<>{num_producers},
                        boost::dynamic_bitset<>{num_producers}}
         {
         }
         boost::dynamic_bitset<> confirms[2];
         confirm_result          confirm(std::optional<std::size_t> idx,
                                         confirm_type               type,
                                         std::size_t                threshold)
         {
            auto& c = confirms[static_cast<unsigned>(type)];
            if (idx && !c[*idx])
            {
               c[*idx]    = true;
               auto count = c.count();
               if (count == threshold)
               {
                  return confirm_result::confirmed;
               }
               else if (count > threshold)
               {
                  return confirm_result::duplicate;
               }
               else
               {
                  return confirm_result::unconfirmed;
               }
            }
            return confirmed(type, threshold);
         }
         confirm_result confirmed(confirm_type type, std::size_t threshold) const
         {
            if (confirms[static_cast<unsigned>(type)].count() >= threshold)
            {
               return confirm_result::duplicate;
            }
            else
            {
               return confirm_result::unconfirmed;
            }
         }
      };

      struct block_info
      {
         explicit block_info(const BlockHeaderState* irreversible)
             : confirmations{block_confirm_data{irreversible->producers},
                             block_confirm_data{irreversible->nextProducers}},
               producers{irreversible->producers, irreversible->nextProducers}
         {
         }
         block_info(const auto& chain, const BlockHeaderState* state)
             : block_info(chain.get_state(chain.get_block_id(state->info.header.commitNum)))
         {
         }
         block_info(std::shared_ptr<ProducerSet> p0, std::shared_ptr<ProducerSet> p1)
             : confirmations{block_confirm_data{p0}, block_confirm_data{p1}},
               producers{std::move(p0), std::move(p1)}
         {
         }
         block_confirm_data                         confirmations[2];
         std::shared_ptr<ProducerSet>               producers[2];
         std::vector<SignedMessage<PrepareMessage>> prepares;
         std::vector<SignedMessage<CommitMessage>>  commits;
         bool                                       committedByBlock = false;
         void add_message(const SignedMessage<PrepareMessage>& msg) { prepares.push_back(msg); }
         void add_message(const SignedMessage<CommitMessage>& msg) { commits.push_back(msg); }
         static void get_type(const PrepareMessage&) { return confirm_type::prepare; }
         static void get_type(const CommitMessage&) { return confirm_type::commit; }
         bool        confirm(const std::optional<std::size_t>& idx0,
                             const std::optional<std::size_t>& idx1,
                             confirm_type                      type,
                             const auto&                       msg)
         {
            if (idx0 && !confirmations[0].confirms[static_cast<unsigned>(type)][*idx0] ||
                idx1 && !confirmations[1].confirms[static_cast<unsigned>(type)][*idx1])
            {
               add_message(msg);
            }
            auto result = confirmations[0].confirm(idx0, type, producers[0]->threshold());
            if (producers[1])
            {
               if (producers[1]->algorithm == ConsensusAlgorithm::bft ||
                   type == confirm_type::commit)
               {
                  result &= confirmations[1].confirm(idx1, type, producers[1]->threshold());
               }
            }
            return result == confirm_result::confirmed;
         }
         bool confirmed(confirm_type type) const
         {
            auto result = confirmations[0].confirmed(type, producers[0]->threshold());
            if (producers[1])
            {
               if (producers[1]->algorithm == ConsensusAlgorithm::bft ||
                   type == confirm_type::commit)
               {
                  result &= confirmations[1].confirmed(type, producers[1]->threshold());
               }
            }
            return result != confirm_result::unconfirmed;
         }
      };

      std::map<Checksum256, block_info> confirmations;

      using BlockOrder = decltype(std::declval<BlockHeaderState>().order());

      BlockOrder best_prepared = {};
      BlockOrder best_prepare  = {};
      BlockOrder alt_prepare   = {};

      // Stores a record of the last view change seen for each producer
      std::vector<TermNum> producer_views;

      Timer                     _new_term_timer;
      std::chrono::milliseconds _timeout = std::chrono::seconds(10);

      template <typename ExecutionContext>
      explicit basic_bft_consensus(ExecutionContext& ctx) : Base(ctx), _new_term_timer(ctx)
      {
      }

      std::tuple<const std::shared_ptr<ProducerSet>&, const std::shared_ptr<ProducerSet>&>
      get_producers(const BlockHeaderState* state)
      {
#if 0
         std::cout << "producers for block: " << loggers::to_string(state->blockId());
         std::cout << " {";
         for(const auto& [name,key] : state->producers->activeProducers)
         {
            std::cout << name.str() << ',';
         }
         std::cout << '}';
         if(state->nextProducers)
         {
            std::cout << " {";
            for(const auto& [name,key] : state->nextProducers->activeProducers)
            {
               std::cout << name.str() << ',';
            }
            std::cout << '}';
         }
         std::cout << std::endl;
#endif
         return {state->producers, state->nextProducers};
      }

      // TODO: reduce code bloat by passing msg through as const void*
      bool confirm(const BlockHeaderState* state,
                   AccountNumber           producer,
                   confirm_type            type,
                   const auto&             msg)
      {
         const auto& [p0, p1] = get_producers(state);
         if (p0->size() == 0)
         {
            return true;
         }
         auto idx0 = p0->getIndex(producer, msg.data->signer());
         auto idx1 = p1 ? p1->getIndex(producer, msg.data->signer()) : std::optional<std::size_t>();
         if (idx0 || idx1)
         {
            auto [iter, inserted] =
                confirmations.try_emplace(state->blockId(), std::move(p0), std::move(p1));
            return iter->second.confirm(idx0, idx1, type, msg);
         }
         else
         {
            // TODO: This shouldn't be possible, because we've already
            // validated the producer.
            throw std::runtime_error("Wrong signer for block");
         }
      }

      bool prepare(const BlockHeaderState* state, AccountNumber producer, const auto& msg)
      {
         return confirm(state, producer, confirm_type::prepare, msg);
      }

      bool commit(const BlockHeaderState* state, AccountNumber producer, const auto& msg)
      {
         return confirm(state, producer, confirm_type::commit, msg);
      }

      bool isCommitted(const BlockHeaderState* state)
      {
         auto pos = confirmations.find(state->blockId());
         return pos != confirmations.end() &&
                (pos->second.confirmed(confirm_type::commit) || pos->second.committedByBlock);
      }

      void validate_producer(BlockHeaderState* state, AccountNumber producer, const Claim& claim)
      {
         bool found           = false;
         const auto& [p0, p1] = get_producers(state);
         if (auto claim0 = p0->getClaim(producer))
         {
            found = true;
            if (claim == *claim0)
            {
               return;
            }
         }
         if (p1)
         {
            if (auto claim1 = p1->getClaim(producer))
            {
               found = true;
               if (claim == *claim1)
               {
                  return;
               }
            }
         }
         if (!found)
         {
            throw std::runtime_error(producer.str() + " is not an active producer");
         }
         else
         {
            throw std::runtime_error("Wrong key for " + producer.str());
         }
      }

      using message_type = boost::mp11::mp_push_back<typename Base::message_type,
                                                     PrepareMessage,
                                                     CommitMessage,
                                                     ViewChangeMessage>;
      bool is_leader()
      {
         if (auto idx = active_producers[0]->getIndex(self))
         {
            auto num_producers = active_producers[0]->size();
            return *idx == current_term % num_producers;
         }
         return Base::is_sole_producer();
      }

      static bool is_leader(const ProducerSet& producers, TermNum term, AccountNumber prod)
      {
         auto num_producers = producers.size();
         if (auto idx = producers.getIndex(prod))
         {
            return *idx == term % num_producers;
         }
         return num_producers == 0;
      }

      void cancel()
      {
         _new_term_timer.cancel();
         Base::cancel();
      }
      void set_producers(
          std::pair<std::shared_ptr<ProducerSet>, std::shared_ptr<ProducerSet>> prods)
      {
         if (prods.first->algorithm != ConsensusAlgorithm::bft)
         {
            _new_term_timer.cancel();
            return Base::set_producers(std::move(prods));
         }
         bool start_bft =
             active_producers[0] && active_producers[0]->algorithm != ConsensusAlgorithm::bft;
         if (start_bft)
         {
            PSIBASE_LOG(logger, info) << "Switching consensus: BFT";
            Base::cancel();
         }
         bool new_producers = !active_producers[0] || *active_producers[0] != *prods.first;
         if ((_state == producer_state::leader || _state == producer_state::follower) &&
             (start_bft || new_producers))
         {
            // TODO: start tracking views of joint producers early. Not necessary for safety,
            // but will help reduce unnecessary delays on a producer change.
            producer_views.clear();
            producer_views.resize(prods.first->size());
         }
         if (new_producers)
         {
            PSIBASE_LOG(logger, info) << "New producers: " << prods.first->size() << ", "
                                      << (prods.second ? prods.second->size() : 0);
         }
         active_producers[0] = std::move(prods.first);
         active_producers[1] = std::move(prods.second);
         if (is_producer())
         {
            if (_state == producer_state::nonvoting || _state == producer_state::unknown)
            {
               PSIBASE_LOG(logger, info) << "Node is active producer";
               _state = producer_state::follower;
               producer_views.resize(active_producers[0]->size());
               start_timer();
            }
            else if (start_bft)
            {
               start_timer();
            }
            if (start_bft || new_producers)
            {
               broadcast_current_term();
            }
            set_producer_view(current_term, self);
         }
         else if (_state != producer_state::shutdown)
         {
            if (_state != producer_state::nonvoting)
            {
               PSIBASE_LOG(logger, info) << "Node is non-voting";
               _new_term_timer.cancel();
               stop_leader();
            }
            _state = producer_state::nonvoting;
         }
      }

      void start_timer()
      {
         if (_state == producer_state::follower || _state == producer_state::leader)
         {
            // TODO: increase timeout if no progress since last timeout
            _new_term_timer.expires_after(_timeout);
            _new_term_timer.async_wait(
                [this, old_term = current_term](const std::error_code& ec)
                {
                   if (!ec && old_term == current_term)
                   {
                      increase_view();
                      start_timer();
                   }
                });
         }
      }

      // returns true if a quorum of producers are believed to be in the current term.
      bool is_term_ready() const
      {
         auto threshold = producer_views.size() * 2 / 3 + 1;
         return std::count_if(producer_views.begin(), producer_views.end(),
                              [current_term = current_term](auto v)
                              { return v == current_term; }) >= threshold;
      }

      void broadcast_current_term()
      {
         for_each_key(
             [&](const auto& k)
             {
                network().multicast_producers(
                    ViewChangeMessage{.term = current_term, .producer = self, .signer = k});
             });
      }

      void increase_view()
      {
         auto threshold = producer_views.size() * 2 / 3 + 1;
         if (std::count_if(producer_views.begin(), producer_views.end(),
                           [current_term = current_term](auto v)
                           { return v >= current_term; }) >= threshold)
         {
            set_view(current_term + 1);
         }
         else
         {
            // Periodically resend view changes if we're stuck. This is
            // required because peers might drop the regular view change
            // message for a new producer schedule if they receive it before
            // they're ready for it.
            broadcast_current_term();
         }
      }

      void set_view(TermNum term)
      {
         if (term > current_term)
         {
            PSIBASE_LOG(logger, info) << "view change: " << term;
            current_term = term;
            chain().setTerm(current_term);
            broadcast_current_term();
            set_producer_view(term, self);
         }
      }

      void set_producer_view(TermNum term, AccountNumber prod)
      {
         if (auto idx = active_producers[0]->getIndex(prod))
         {
            producer_views[*idx] = std::max(term, producer_views[*idx]);
            if (_state == producer_state::follower)
            {
               if (is_leader() && is_term_ready())
               {
                  _state = producer_state::leader;

                  PSIBASE_LOG(logger, info) << "Starting block production for term " << current_term
                                            << " as " << self.str();
                  start_leader();
               }
            }
            else if (_state == producer_state::leader)
            {
               if (!is_leader() || !is_term_ready())
               {
                  stop_leader();
                  _state = producer_state::follower;
               }
            }
         }
      }

      // track best committed, best prepared, best prepared on different fork
      bool can_prepare(const BlockHeaderState* state)
      {
         if (_state != producer_state::leader && _state != producer_state::follower)
         {
            return false;
         }
         if (state->producers->algorithm != ConsensusAlgorithm::bft)
         {
            return false;
         }
         if (state->nextProducers && state->nextProducers->algorithm != ConsensusAlgorithm::bft)
         {
            return state->producers->isProducer(self);
         }
         return true;
      }
      bool can_commit(const BlockHeaderState* state)
      {
         if (_state != producer_state::leader && _state != producer_state::follower)
         {
            return false;
         }
         if (state->producers->algorithm != ConsensusAlgorithm::bft)
         {
            return false;
         }
         // have threshold prepares AND have not prepared a better conflicting block
         if (chain().in_best_chain(state->xid()))
         {
            return state->order() > alt_prepare;
         }
         else
         {
            return state->order() > best_prepare;
         }
         return false;
      }
      void on_fork_switch(BlockHeader* head)
      {
         if (!chain().in_best_chain(orderToXid(best_prepare)))
         {
            alt_prepare = best_prepare;
         }
         Base::on_fork_switch(head);
      }
      void on_prepare(const BlockHeaderState* state, AccountNumber producer, const auto& msg)
      {
         const auto& id = state->blockId();
         if (prepare(state, producer, msg))
         {
            if (state->order() > best_prepared)
            {
               best_prepared = state->order();
               chain().set_subtree(state);
            }
            if (can_commit(state))
            {
               do_commit(state, producer);
            }
         }
      }
      void do_prepare(const BlockHeaderState* state)
      {
         const auto& id = state->blockId();
         assert(chain().in_best_chain(state->xid()));
         best_prepare = state->order();
         for_each_key(
             [&](const auto& key)
             {
                auto message = network().sign_message(
                    PrepareMessage{.block_id = id, .producer = self, .signer = key});
                on_prepare(state, self, message);
                network().multicast_producers(message);
             });
      }
      void save_commit_data(const BlockHeaderState* state)
      {
         auto iter = confirmations.find(state->blockId());
         assert(iter != confirmations.end());
         BlockConfirm result{state->blockNum()};
         if (state->nextProducers)
         {
            result.nextCommits.emplace();
         }
         for (const auto& msg : iter->second.commits)
         {
            if (auto expected = state->producers->getClaim(msg.data->producer());
                expected && expected == msg.data->signer())
            {
               result.commits.push_back({msg.data->producer(), msg.signature});
            }
            if (state->nextProducers)
            {
               if (auto expected = state->nextProducers->getClaim(msg.data->producer());
                   expected && expected == msg.data->signer())
               {
                  result.nextCommits->push_back({msg.data->producer(), msg.signature});
               }
            }
         }
         auto compareProducer = [](const auto& lhs, const auto& rhs)
         { return lhs.producer < rhs.producer; };
         std::sort(result.commits.begin(), result.commits.end(), compareProducer);
         if (result.nextCommits)
         {
            std::sort(result.nextCommits->begin(), result.nextCommits->end(), compareProducer);
         }
         chain().setBlockData(state->blockId(), psio::convert_to_frac(result));
      }
      //
      void verify_commit(const BlockHeaderState* state)
      {
         if (state->order() < best_prepared)
         {
            PSIBASE_LOG(logger, critical)
                << "Consensus failure: committing a block that that is not in the best "
                   "chain. This means that either there is a severe bug in the software, or "
                   "the maximum number of byzantine faults was exceeded.";
            // TODO: Now what?  Trigger shutdown? Halt block production, but
            // leave the server running at the last valid state?
         }
      }
      void on_commit(const BlockHeaderState*             state,
                     AccountNumber                       producer,
                     const SignedMessage<CommitMessage>& msg)
      {
         const auto& id = state->blockId();
         if (commit(state, producer, msg))
         {
            save_commit_data(state);
            if (!chain().in_best_chain(state->xid()))
            {
               verify_commit(state);
               // This is possible if we receive the commits before the corresponding prepares
               chain().set_subtree(state);
               Base::switch_fork();
            }
            else if (chain().commit(state->blockNum()))
            {
               start_timer();
            }
         }
      }
      void do_commit(const BlockHeaderState* state, AccountNumber producer)
      {
         const auto& id = state->blockId();
         for_each_key(
             [&](const auto& key)
             {
                auto message = network().sign_message(
                    CommitMessage{.block_id = id, .producer = self, .signer = key});
                on_commit(state, self, message);
                network().multicast_producers(message);
             });
      }
      std::optional<std::vector<char>> makeBlockData(const BlockHeaderState* state)
      {
         if (state->producers->algorithm == ConsensusAlgorithm::bft)
         {
            return chain().getBlockData(chain().get_block_id(state->info.header.commitNum));
         }
         else
         {
            return Base::makeBlockData(state);
         }
      }
      void on_produce_block(const BlockHeaderState* state)
      {
         Base::on_produce_block(state);
         if (can_prepare(state))
         {
            do_prepare(state);
         }
      }
      void on_accept_block(const BlockHeaderState* state)
      {
         Base::on_accept_block(state);
         if (state->producers->algorithm == ConsensusAlgorithm::bft)
         {
            if (state->singleProducer())
            {
               chain().commit(state->info.header.commitNum);
            }
            // When a block outside the current best chain is committed, we
            // can't commit it immediately, because the best committed block
            // is tracked by blockNum rather than blockId. Commit it here instead.
            if (isCommitted(state))
            {
               chain().commit(state->blockNum());
            }
         }
         // if we can confirm the block, send confirmation
         if (can_prepare(state))
         {
            do_prepare(state);
         }
      }
      void on_erase_block(const Checksum256& id)
      {
         Base::on_erase_block(id);
         confirmations.erase(id);
      }
      void post_send_block(peer_id peer, const Checksum256& id)
      {
         if (auto iter = confirmations.find(id); iter != confirmations.end())
         {
            for (const auto& msg : iter->second.prepares)
            {
               network().async_send_block(peer, msg, [](const std::error_code&) {});
            }
            for (const auto& msg : iter->second.commits)
            {
               network().async_send_block(peer, msg, [](const std::error_code&) {});
            }
         }
      }

      void on_accept_block_header(const BlockHeaderState* state)
      {
         if (state->producers->algorithm == ConsensusAlgorithm::bft)
         {
            check(
                is_leader(*state->producers, state->info.header.term, state->info.header.producer),
                "Wrong producer");
            auto block = chain().get(state->blockId());
            if (auto aux = block->auxConsensusData().get(); aux.valid())
            {
               auto data   = psio::convert_from_frac<BlockConfirm>(*aux);
               auto header = block->block()->header().get();
               check(data.blockNum >= header->commitNum().get() &&
                         data.blockNum <= header->blockNum().get(),
                     "blockNum out of range");
               auto committed = state;
               while (committed->blockNum() > data.blockNum)
               {
                  committed = chain().get_state(committed->info.header.previous);
                  if (!committed)
                  {
                     // TODO: We can't verify the signatures, but that's okay because
                     // they're proving somthing that we already know. We just
                     // need to remove or replace them for outgoing blocks.
                     return;
                  }
               }
               // TODO: Signature validation should depend on header state only
               // once we track the verify service code in the block headers.
               auto verifyState = chain().get_state(chain().get_block_id(chain().commit_index()));
               verifyIrreversibleSignature(verifyState->revision, data, committed);
               // Ensure that the committed block is a candidate for the best block
               set_view(committed->info.header.term);
               if (!chain().in_best_chain(committed->xid()))
               {
                  verify_commit(committed);
                  chain().set_subtree(committed);
                  // fork switch will be handled by the caller
                  auto [iter, _] = confirmations.try_emplace(committed->blockId(), state->producers,
                                                             state->nextProducers);
                  // Signal to on_accept_block that it should commit this block
                  // as soon as it is applied.
                  iter->second.committedByBlock = true;
               }
               else if (chain().commit(data.blockNum))
               {
                  start_timer();
               }
            }
            else
            {
               // Allow most signatures to be pruned, but don't advance
               // irreversibility until we receive a valid set of signatures
               check(state->singleProducer() || !state->needsIrreversibleSignature(),
                     "Missing irreversibility proof");
            }
         }
         return Base::on_accept_block_header(state);
      }

      void connect(peer_id peer)
      {
         Base::connect(peer);
         if (active_producers[0]->algorithm == ConsensusAlgorithm::bft)
         {
            if (auto claim = active_producers[0]->getClaim(self))
            {
               network().async_send_block(
                   peer,
                   ViewChangeMessage{.term = current_term, .producer = self, .signer = *claim},
                   [](const std::error_code&) {});
            }
         }
      }

      void recv(peer_id peer, const SignedMessage<PrepareMessage>& msg)
      {
         auto* state = chain().get_state(msg.data->block_id());
         if (!state)
         {
            return;
         }
         validate_producer(state, msg.data->producer(), msg.data->signer());
         // TODO: should we update the sender's view here? same for commit.
         on_prepare(state, msg.data->producer(), msg);
      }
      void recv(peer_id peer, const SignedMessage<CommitMessage>& msg)
      {
         auto* state = chain().get_state(msg.data->block_id());
         if (!state)
         {
            return;
         }
         validate_producer(state, msg.data->producer(), msg.data->signer());
         on_commit(state, msg.data->producer(), msg);
      }

      void recv(peer_id peer, const ViewChangeMessage& msg)
      {
         if (producer_views.empty())
         {
            // Not a producer
            return;
         }
         // ignore unexpected view changes. We can fail to recognize a valid
         // view change due to being ahead or behind other nodes.
         if (auto expected = active_producers[0]->getClaim(msg.producer))
         {
            if (*expected == msg.signer)
            {
               set_producer_view(msg.term, msg.producer);
               auto view_copy = producer_views;
               auto offset    = active_producers[0]->size() * 2 / 3;
               // if > 1/3 are ahead of current view trigger view change
               std::nth_element(view_copy.begin(), view_copy.begin() + offset, view_copy.end());
               if (view_copy[offset] > current_term)
               {
                  set_view(view_copy[offset]);
                  start_timer();
               }
            }
         }
      }
   };

}  // namespace psibase::net
