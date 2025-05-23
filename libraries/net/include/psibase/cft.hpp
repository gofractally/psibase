#pragma once

#include <psibase/ForkDb.hpp>
#include <psibase/blocknet.hpp>
#include <psibase/net_base.hpp>
#include <psibase/random_timer.hpp>
#include <psio/reflect.hpp>

#include <algorithm>
#include <cassert>
#include <chrono>
#include <cstdint>
#include <memory>
#include <variant>
#include <vector>

#include <iostream>

namespace psibase::net
{

   struct ConfirmMessage
   {
      static constexpr unsigned type = 35;
      TermNum                   term;
      producer_id               follower_id;
      BlockNum                  head_num;
      Claim                     signer;

      std::string to_string() const
      {
         return "confirm: term=" + std::to_string(term) + " follower=" + follower_id.str() +
                " blocknum=" + std::to_string(head_num);
      }
   };
   PSIO_REFLECT(ConfirmMessage, term, follower_id, head_num, signer);

   struct RequestVoteRequest
   {
      static constexpr unsigned type = 36;
      TermNum                   term;
      producer_id               candidate_id;
      BlockNum                  last_log_index;
      TermNum                   last_log_term;
      Claim                     signer;

      std::string to_string() const
      {
         return "request vote: term=" + std::to_string(term) + " candidate=" + candidate_id.str();
      }
   };
   PSIO_REFLECT(RequestVoteRequest, term, candidate_id, last_log_index, last_log_term, signer)
   struct RequestVoteResponse
   {
      static constexpr unsigned type = 37;
      TermNum                   term;
      producer_id               candidate_id;
      producer_id               voter_id;
      bool                      vote_granted;
      Claim                     signer;

      std::string to_string() const
      {
         return "vote: term=" + std::to_string(term) + " candidate=" + candidate_id.str() +
                " voter=" + voter_id.str() + " vote granted=" + std::to_string(vote_granted);
      }
   };
   PSIO_REFLECT(RequestVoteResponse, term, candidate_id, voter_id, vote_granted, signer)

   // This protocol is based on RAFT, with some simplifications.
   // i.e. the blockchain structure is sufficient to guarantee log matching.
   template <typename Base, typename Timer>
   struct basic_cft_consensus : Base
   {
      using block_num = std::uint32_t;

      using Base::_state;
      using Base::active_producers;
      using Base::chain;
      using Base::consensus;
      using Base::current_term;
      using Base::for_each_key;
      using Base::is_producer;
      using Base::logger;
      using Base::network;
      using Base::recv;
      using Base::self;
      using Base::start_leader;
      using Base::stop_leader;
      using Base::validate_message;
      using Base::validate_producer;
      using typename Base::producer_state;

      template <typename ExecutionContext>
      explicit basic_cft_consensus(ExecutionContext& ctx) : Base(ctx), _election_timer(ctx)
      {
      }

      producer_id              voted_for = null_producer;
      std::vector<producer_id> votes_for_me[2];

      basic_random_timer<Timer> _election_timer;
      std::chrono::milliseconds _timeout = std::chrono::seconds(3);

      std::vector<block_num> match_index[2];

      using message_type = boost::mp11::mp_push_back<typename Base::message_type,
                                                     ConfirmMessage,
                                                     RequestVoteRequest,
                                                     RequestVoteResponse>;

      void cancel()
      {
         _election_timer.cancel();
         match_index[0].clear();
         match_index[1].clear();
         Base::cancel();
      }
      bool is_cft() const { return active_producers[0]->algorithm == ConsensusAlgorithm::cft; }
      void set_producers(
          std::pair<std::shared_ptr<ProducerSet>, std::shared_ptr<ProducerSet>> prods)
      {
         bool start_cft = false;
         if (prods.first->algorithm != ConsensusAlgorithm::cft)
         {
            _election_timer.cancel();
            return Base::set_producers(std::move(prods));
         }
         if (active_producers[0] && active_producers[0]->algorithm != ConsensusAlgorithm::cft)
         {
            PSIBASE_LOG(logger, info) << "Switching consensus: CFT";
            Base::cancel();
            start_cft = true;
         }
         if (_state == producer_state::leader)
         {
            // match_index
            if (start_cft)
            {
               match_index[0].clear();
               match_index[0].resize(prods.first->size());
            }
            else if (*active_producers[0] != *prods.first)
            {
               if (active_producers[1] && *active_producers[1] == *prods.first)
               {
                  // Leaving joint consensus
                  match_index[0] = match_index[1];
               }
               else
               {
                  match_index[0].clear();
                  match_index[0].resize(prods.first->size());
               }
            }
            // Second match_index is only active during joint consensus
            if (!prods.second)
            {
               match_index[1].clear();
            }
            else if (start_cft || !active_producers[1] || *active_producers[1] != *prods.second)
            {
               match_index[1].clear();
               match_index[1].resize(prods.second->size());
            }
            // Before boot, every node can be be a leader. This is the only time when
            // it is possble to have multiple leaders. Exit leader mode and start a new
            // election.
            if (active_producers[0]->size() == 0 && !active_producers[1])
            {
               _election_timer.cancel();
               stop_leader("Stopping boot block production");
               _state = producer_state::unknown;
            }
         }
         if (active_producers[0] != prods.first || active_producers[1] != prods.second)
         {
            PSIBASE_LOG(logger, info) << "Active producers: " << *prods.first
                                      << print_function{[&](std::ostream& os)
                                                        {
                                                           if (prods.second)
                                                           {
                                                              os << ", " << *prods.second;
                                                           }
                                                        }};
         }
         active_producers[0] = std::move(prods.first);
         active_producers[1] = std::move(prods.second);
         if (is_producer())
         {
            if (_state == producer_state::nonvoting || _state == producer_state::unknown)
            {
               PSIBASE_LOG(logger, info) << "Node is active producer";
               _state = producer_state::follower;
               randomize_timer();
            }
            else if (start_cft)
            {
               randomize_timer();
            }
         }
         else if (_state != producer_state::shutdown)
         {
            if (_state != producer_state::nonvoting)
            {
               PSIBASE_LOG(logger, info) << "Node is non-voting";
               _election_timer.cancel();
               stop_leader();
            }
            _state = producer_state::nonvoting;
         }
      }
      // Since this check is not associated with a block, we have to be permissive
      // and ignore wrong produers, to avoid closing connections due to network delays.
      bool is_valid_producer(producer_id producer, const Claim& claim)
      {
         auto expected0 = active_producers[0]->getClaim(producer);
         auto expected1 =
             active_producers[1] ? active_producers[1]->getClaim(producer) : decltype(expected0)();
         if (!(expected0 && claim == *expected0) && !(expected1 && claim == *expected1))
         {
            return false;
         }
         return true;
      }

      void on_fork_switch(const BlockHeader* new_head)
      {
         if (is_cft() && _state == producer_state::follower && new_head->term == current_term &&
             new_head->blockNum > chain().commit_index())
         {
            for_each_key(
                [&](const auto& k)
                {
                   try
                   {
                      network().sendto(new_head->producer,
                                       ConfirmMessage{current_term, self, new_head->blockNum, k});
                   }
                   catch (std::exception& e)
                   {
                      PSIBASE_LOG(logger, warning) << "Failed to confirm: " << e.what();
                   }
                });
         }
         Base::on_fork_switch(new_head);
      }
      // ---------------- block production loop --------------------------

      void on_accept_block_header(const BlockHeaderState* state)
      {
         if (state->producers->algorithm == ConsensusAlgorithm::cft)
         {
            auto term = state->info.header.term;
            update_term(term);
            if (term >= current_term)
            {
               _election_timer.restart();
            }
            if (state->info.header.commitNum > chain().commit_index())
            {
               // Find the committed block
               auto committed = state;
               while (committed->blockNum() > state->info.header.commitNum)
               {
                  committed = chain().get_state(committed->info.header.previous);
                  // Since state is valid and is ahead of commitIndex, all
                  // the states [commitNum, blockNum] definitely exist.
                  assert(committed);
               }
               // Ensure that the committed block is considered viable
               if (!chain().in_best_chain(committed->xid()))
               {
                  chain().set_subtree(committed, "made irreversible by a subsequent block");
               }
            }
         }
         return Base::on_accept_block_header(state);
      }
      void on_produce_block(const BlockHeaderState* state)
      {
         Base::on_produce_block(state);
         if (is_cft())
         {
            update_match_index(self, state->blockNum());
         }
      }
      void on_accept_block(const BlockHeaderState* state)
      {
         Base::on_accept_block(state);
         if (state->producers->algorithm == ConsensusAlgorithm::cft)
         {
            chain().commit(state->info.header.commitNum);
         }
      }
      // ------------------- Implementation utilities ----- -----------
      void update_match_index(producer_id producer, block_num match)
      {
         auto jointCommitIndex = std::min(update_match_index(producer, match, 0),
                                          update_match_index(producer, match, 1));
         if (jointCommitIndex == std::numeric_limits<BlockNum>::max())
         {
            assert(active_producers[0]->size() == 0);
            assert(!active_producers[1]);
            assert(producer == self);
            jointCommitIndex = match;
         }
         if (chain().commit(jointCommitIndex))
         {
            _election_timer.restart();
            consensus().set_producers(chain().getProducers());
         }
      }
      BlockNum update_match_index(producer_id producer, BlockNum confirmed, std::size_t group)
      {
         if (active_producers[group])
         {
            if (auto idx = active_producers[group]->getIndex(producer))
            {
               match_index[group][*idx] = std::max(match_index[group][*idx], confirmed);
            }
            if (!match_index[group].empty())
            {
               std::vector<block_num> match = match_index[group];
               auto mid = active_producers[group]->size() - active_producers[group]->threshold();
               std::nth_element(match.begin(), match.begin() + mid, match.end());
               return match[mid];
            }
         }
         return std::numeric_limits<BlockNum>::max();
      }
      // This should always run first when handling any message
      void update_term(TermNum term)
      {
         if (term > current_term)
         {
            votes_for_me[0].clear();
            votes_for_me[1].clear();
            current_term = term;
            chain().setTerm(current_term);
            voted_for = null_producer;
            if (_state == producer_state::leader)
            {
               match_index[0].clear();
               match_index[1].clear();
               stop_leader();
               _state = producer_state::follower;
               randomize_timer();
               Base::switch_fork();
            }
            else if (_state == producer_state::candidate)
            {
               _state = producer_state::follower;
            }
         }
      }
      void check_votes()
      {
         if (votes_for_me[0].size() > active_producers[0]->size() / 2 &&
             (!active_producers[1] || votes_for_me[1].size() >= active_producers[1]->threshold()))
         {
            _state = producer_state::leader;
            match_index[0].clear();
            match_index[0].resize(active_producers[0]->size());
            if (active_producers[1])
            {
               match_index[1].clear();
               match_index[1].resize(active_producers[1]->size());
            }
            PSIBASE_LOG(logger, info)
                << "Starting block production for term " << current_term << " as " << self.str();
            start_leader();
         }
      }
      // -------------- The timer loop --------------------
      void randomize_timer()
      {
         // Don't bother waiting if we're the only producer
         if (this->is_sole_producer() && _state == producer_state::follower)
         {
            request_vote();
         }
         else if (!active_producers[1] ||
                  active_producers[1]->algorithm == ConsensusAlgorithm::cft ||
                  active_producers[0]->isProducer(self))
         {
            _election_timer.expires_after(_timeout, _timeout * 2);
            _election_timer.async_wait(
                [this](const std::error_code& ec)
                {
                   if (ec || !is_cft())
                      return;
                   if (_state == producer_state::leader)
                   {
                      stop_leader();
                      _state = producer_state::candidate;
                   }
                   if (_state == producer_state::follower || _state == producer_state::candidate)
                   {
                      PSIBASE_LOG(logger, info)
                          << "Timeout: Starting leader election for term " << (current_term + 1);
                      request_vote();
                   }
                });
         }
      }
      void request_vote()
      {
         ++current_term;
         chain().setTerm(current_term);
         voted_for = self;
         votes_for_me[0].clear();
         votes_for_me[1].clear();
         if (active_producers[0]->isProducer(self) || active_producers[0]->size() == 0)
         {
            votes_for_me[0].push_back(self);
         }
         if (active_producers[1] && active_producers[1]->isProducer(self))
         {
            votes_for_me[1].push_back(self);
         }
         _state = producer_state::candidate;
         randomize_timer();
         for_each_key(
             [&](const auto& k)
             {
                try
                {
                   network().multicast_producers(RequestVoteRequest{current_term, self,
                                                                    chain().get_head()->blockNum,
                                                                    chain().get_head()->term, k});
                }
                catch (std::exception& e)
                {
                   PSIBASE_LOG(logger, warning) << "Failed to request vote: " << e.what();
                }
             });
         check_votes();
      }
      // ----------- handling of incoming messages -------------
      void recv(peer_id, const ConfirmMessage& response)
      {
         if (!is_cft())
         {
            return;
         }
         if (response.head_num < chain().commit_index())
         {
            return;
         }
         auto  id    = chain().get_block_id(response.head_num);
         auto* state = chain().get_state(id);
         if (!state || state->info.header.term != response.term)
         {
            return;
         }
         validate_producer(state, response.follower_id, response.signer);
         update_term(response.term);
         if (response.term == current_term)
         {
            if (_state == producer_state::leader)
            {
               update_match_index(response.follower_id, response.head_num);
            }
         }
         // otherwise ignore out-dated response
      }
      void recv(peer_id, const RequestVoteRequest& request)
      {
         if (!is_cft())
         {
            return;
         }
         if (!is_valid_producer(request.candidate_id, request.signer))
         {
            return;
         }
         update_term(request.term);
         bool vote_granted = false;
         // Can we vote for this candidate?
         if (_state == producer_state::follower)
         {
            if (request.term >= current_term &&
                (voted_for == null_producer || voted_for == request.candidate_id))
            {
               // Is the candidate up-to-date?
               auto head = chain().get_head();
               if (request.last_log_term > head->term || (request.last_log_term == head->term &&
                                                          request.last_log_index >= head->blockNum))
               {
                  _election_timer.restart();
                  vote_granted = true;
                  voted_for    = request.candidate_id;
               }
            }
            for_each_key(
                [&](const auto& k)
                {
                   try
                   {
                      network().sendto(request.candidate_id,
                                       RequestVoteResponse{.term         = current_term,
                                                           .candidate_id = request.candidate_id,
                                                           .voter_id     = self,
                                                           .vote_granted = vote_granted,
                                                           .signer       = k});
                   }
                   catch (std::exception& e)
                   {
                      PSIBASE_LOG(logger, warning) << "Failed to vote: " << e.what();
                   }
                });
         }
      }
      void recv(peer_id, const RequestVoteResponse& response)
      {
         if (!is_cft())
         {
            return;
         }
         if (!is_valid_producer(response.voter_id, response.signer))
         {
            return;
         }
         update_term(response.term);
         if (response.candidate_id == self && response.term == current_term &&
             response.vote_granted && _state == producer_state::candidate)
         {
            for (auto i : {0, 1})
            {
               auto& votes = votes_for_me[i];
               if (active_producers[i] && active_producers[i]->isProducer(response.voter_id) &&
                   std::find(votes.begin(), votes.end(), response.voter_id) == votes.end())
               {
                  votes.push_back(response.voter_id);
               }
            }
            check_votes();
         }
      }
      bool validate_message(const ConfirmMessage&)
      {
         // TODO:
         return true;
      }
      bool validate_message(const RequestVoteRequest&)
      {
         // TODO:
         return true;
      }
      bool validate_message(const RequestVoteResponse&)
      {
         // TODO:
         return true;
      }
      BlockNum light_verify(const LightHeaderState&                   state,
                            const BlockInfo&                          info,
                            const psio::shared_view_ptr<SignedBlock>& block)
      {
         if (state.producers->algorithm == ConsensusAlgorithm::cft)
         {
            if (state.producers->size() != 0)
            {
               auto claim = state.producers->getClaim(info.header.producer);
               auto sig   = block->signature();
               if (!claim)
                  abortMessage(info.header.producer.str() + " is not a producer at block " +
                               loggers::to_string(info.blockId));
               chain().verify(state.producers->authState->revision, BlockSignatureInfo(info),
                              *claim, sig);
            }
            return info.header.commitNum;
         }
         else
         {
            return Base::light_verify(state, info, block);
         }
      }
   };

}  // namespace psibase::net
