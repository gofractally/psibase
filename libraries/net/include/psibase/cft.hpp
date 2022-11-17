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
   // This protocol is based on RAFT, with some simplifications.
   // i.e. the blockchain structure is sufficient to guarantee log matching.
   template <typename Base, typename Timer>
   struct basic_cft_consensus : Base
   {
      using block_num = std::uint32_t;

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
      using typename Base::append_entries_request;
      using typename Base::hello_request;
      using typename Base::hello_response;
      using typename Base::producer_state;
      using typename Base::term_id;

      template <typename ExecutionContext>
      explicit basic_cft_consensus(ExecutionContext& ctx) : Base(ctx), _election_timer(ctx)
      {
      }

      producer_id              voted_for = null_producer;
      std::vector<producer_id> votes_for_me[2];

      basic_random_timer<Timer> _election_timer;
      std::chrono::milliseconds _timeout = std::chrono::seconds(3);

      std::vector<block_num> match_index[2];

      struct append_entries_response
      {
         static constexpr unsigned type = 35;
         term_id                   term;
         producer_id               follower_id;
         BlockNum                  head_num;
         Claim                     claim;

         Claim signer() const { return claim; }
         PSIO_REFLECT_INLINE(append_entries_response, term, follower_id, head_num, claim);
         std::string to_string() const
         {
            return "append_entries response: term=" + std::to_string(term) +
                   " follower=" + follower_id.str() + " blocknum=" + std::to_string(head_num);
         }
      };

      struct request_vote_request
      {
         static constexpr unsigned type = 36;
         term_id                   term;
         producer_id               candidate_id;
         block_num                 last_log_index;
         term_id                   last_log_term;
         Claim                     claim;

         Claim signer() const { return claim; }
         PSIO_REFLECT_INLINE(request_vote_request,
                             term,
                             candidate_id,
                             last_log_index,
                             last_log_term,
                             claim)
         std::string to_string() const
         {
            return "request_vote: term=" + std::to_string(term) +
                   " candidate=" + candidate_id.str();
         }
      };
      struct request_vote_response
      {
         static constexpr unsigned type = 37;
         term_id                   term;
         producer_id               candidate_id;
         producer_id               voter_id;
         bool                      vote_granted;
         Claim                     claim;

         Claim signer() const { return claim; }
         PSIO_REFLECT_INLINE(request_vote_response,
                             term,
                             candidate_id,
                             voter_id,
                             vote_granted,
                             claim)
         std::string to_string() const
         {
            return "vote: term=" + std::to_string(term) + " candidate=" + candidate_id.str() +
                   " voter=" + voter_id.str() + " vote granted=" + std::to_string(vote_granted);
         }
      };

      using message_type = boost::mp11::mp_push_back<typename Base::message_type,
                                                     append_entries_response,
                                                     request_vote_request,
                                                     request_vote_response>;

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
            else if (_state == producer_state::follower && start_cft)
            {
               randomize_timer();
            }
         }
         else
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
      void validate_producer(producer_id producer, const Claim& claim)
      {
         auto expected0 = active_producers[0]->getClaim(producer);
         auto expected1 =
             active_producers[1] ? active_producers[1]->getClaim(producer) : decltype(expected0)();
         if (!expected0 && !expected1)
         {
            throw std::runtime_error(producer.str() + " is not an active producer");
         }
         else if (claim != *expected0 && claim != *expected1)
         {
            throw std::runtime_error("Wrong key for " + producer.str());
         }
      }

      void on_fork_switch(BlockHeader* new_head)
      {
         if (is_cft() && _state == producer_state::follower && new_head->term == current_term &&
             new_head->blockNum > chain().commit_index())
         {
            for_each_key(
                [&](const auto& k)
                {
                   network().sendto(
                       new_head->producer,
                       append_entries_response{current_term, self, new_head->blockNum, k});
                });
         }
         Base::on_fork_switch(new_head);
      }
      // ---------------- block production loop --------------------------

      void on_produce_block(const BlockHeaderState* state)
      {
         if (is_cft())
         {
            update_match_index(self, state->blockNum());
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
            set_producers(chain().getProducers());
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
               auto                   mid   = active_producers[group]->threshold() - 1;
               std::nth_element(match.begin(), match.begin() + mid, match.end());
               return match[mid];
            }
         }
         return std::numeric_limits<BlockNum>::max();
      }
      // This should always run first when handling any message
      void update_term(term_id term)
      {
         if (term > current_term)
         {
            if (_state == producer_state::leader)
            {
               match_index[0].clear();
               match_index[1].clear();
               stop_leader();
               randomize_timer();
            }
            votes_for_me[0].clear();
            votes_for_me[1].clear();
            current_term = term;
            voted_for    = null_producer;
            _state       = producer_state::follower;
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
         if (active_producers[0]->size() <= 1 && !active_producers[1])
         {
            if (_state == producer_state::follower)
            {
               request_vote();
            }
         }
         else if (!active_producers[1] ||
                  active_producers[1]->algorithm == ConsensusAlgorithm::cft ||
                  active_producers[0]->isProducer(self))
         {
            _election_timer.expires_after(_timeout, _timeout * 2);
            _election_timer.async_wait(
                [this](const std::error_code& ec)
                {
                   if (!ec && is_cft() &&
                       (_state == producer_state::follower || _state == producer_state::candidate))
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
         voted_for = self;
         votes_for_me[0].clear();
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
                network().multicast_producers(request_vote_request{
                    current_term, self, chain().get_head()->blockNum, chain().get_head()->term, k});
             });
         check_votes();
      }
      // ----------- handling of incoming messages -------------
      void recv(peer_id origin, const append_entries_request& request)
      {
         if (is_cft())
         {
            auto term = BlockNum{request.block->block()->header()->term()};
            update_term(term);
            if (term >= current_term)
            {
               _election_timer.restart();
            }
         }
         Base::recv(origin, request);
      }
      void recv(peer_id, const append_entries_response& response)
      {
         if (!is_cft())
         {
            return;
         }
         // TODO: validate against BlockHeaderState instead. Doing so would allow us to distinguish
         // out-dated messages from invalid messages.
         validate_producer(response.follower_id, response.claim);
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
      void recv(peer_id, const request_vote_request& request)
      {
         if (!is_cft())
         {
            return;
         }
         validate_producer(request.candidate_id, request.claim);
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
                   network().sendto(request.candidate_id,
                                    request_vote_response{.term         = current_term,
                                                          .candidate_id = request.candidate_id,
                                                          .voter_id     = self,
                                                          .vote_granted = vote_granted,
                                                          .claim        = k});
                });
         }
      }
      void recv(peer_id, const request_vote_response& response)
      {
         if (!is_cft())
         {
            return;
         }
         validate_producer(response.voter_id, response.claim);
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
   };

}  // namespace psibase::net
