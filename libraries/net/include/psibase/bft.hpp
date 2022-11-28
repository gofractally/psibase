#pragma once

#include <psibase/ForkDb.hpp>
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
      using typename Base::term_id;
      enum class confirm_type
      {
         prepare,
         commit
      };

      struct PrepareMessage
      {
         static constexpr unsigned type = 38;
         Checksum256               block_id;
         AccountNumber             producer;
         Claim                     claim;

         auto signer() const { return claim; }
         PSIO_REFLECT_INLINE(PrepareMessage, block_id, producer, claim)
         std::string to_string() const
         {
            return "prepare: id=" + loggers::to_string(block_id) + " producer=" + producer.str();
         }
      };

      struct CommitMessage
      {
         static constexpr unsigned type = 39;
         Checksum256               block_id;
         AccountNumber             producer;
         Claim                     claim;

         auto signer() const { return claim; }
         PSIO_REFLECT_INLINE(CommitMessage, block_id, producer, claim)
         std::string to_string() const
         {
            return "commit: id=" + loggers::to_string(block_id) + " producer=" + producer.str();
         }
      };

      struct ViewChangeMessage
      {
         static constexpr unsigned type = 40;
         term_id                   term;
         AccountNumber             producer;
         Claim                     claim;

         auto signer() const { return claim; }
         PSIO_REFLECT_INLINE(ViewChangeMessage, term, producer, claim)
         std::string to_string() const
         {
            return "view change: term=" + std::to_string(term) + " producer=" + producer.str();
         }
      };

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
         confirm_result confirmed(confirm_type type, std::size_t threshold)
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
         block_confirm_data           confirmations[2];
         std::shared_ptr<ProducerSet> producers[2];
         std::vector<PrepareMessage>  prepares;
         std::vector<CommitMessage>   commits;
         void        add_message(const PrepareMessage& msg) { prepares.push_back(msg); }
         void        add_message(const CommitMessage& msg) { commits.push_back(msg); }
         static void get_type(const PrepareMessage&) { return confirm_type::prepare; }
         static void get_type(const CommitMessage&) { return confirm_type::commit; }
         bool        confirm(const std::optional<std::size_t>& idx0,
                             const std::optional<std::size_t>& idx1,
                             confirm_type                      type)
         {
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
      };

      std::map<Checksum256, block_info> confirmations;

      using BlockOrder = decltype(std::declval<BlockHeaderState>().order());

      BlockOrder best_prepared = {};
      BlockOrder best_prepare  = {};
      BlockOrder alt_prepare   = {};

      // Stores a record of the last view change seen for each producer
      std::vector<term_id> producer_views;

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

      bool confirm(const BlockHeaderState* state, AccountNumber producer, confirm_type type)
      {
         const auto& [p0, p1] = get_producers(state);
         if (p0->size() == 0)
         {
            return true;
         }
         // TODO: also match key
         auto idx0 = p0->getIndex(producer);
         auto idx1 = p1 ? p1->getIndex(producer) : std::optional<std::size_t>();
         if (idx0 || idx1)
         {
            auto [iter, inserted] =
                confirmations.try_emplace(state->blockId(), std::move(p0), std::move(p1));
            return iter->second.confirm(idx0, idx1, type);
         }
         else
         {
            // TODO: This shouldn't be possible, because we've already
            // validated the producer.
            throw std::runtime_error("Wrong signer for block");
         }
      }

      bool prepare(const BlockHeaderState* state, AccountNumber producer)
      {
         return confirm(state, producer, confirm_type::prepare);
      }

      bool commit(const BlockHeaderState* state, AccountNumber producer)
      {
         return confirm(state, producer, confirm_type::commit);
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

      void cancel()
      {
         _new_term_timer.cancel();
         Base::cancel();
      }
      void set_producers(
          std::pair<std::shared_ptr<ProducerSet>, std::shared_ptr<ProducerSet>> prods)
      {
         bool start_bft = false;
         if (prods.first->algorithm != ConsensusAlgorithm::bft)
         {
            _new_term_timer.cancel();
            return Base::set_producers(std::move(prods));
         }
         if (active_producers[0] && active_producers[0]->algorithm != ConsensusAlgorithm::bft)
         {
            PSIBASE_LOG(logger, info) << "Switching consensus: BFT";
            Base::cancel();
            start_bft = true;
         }
         if ((_state == producer_state::leader || _state == producer_state::follower) &&
             (start_bft || *active_producers[0] != *prods.first))
         {
            producer_views.clear();
            producer_views.resize(prods.first->size());
         }
         if (!active_producers[0] || *active_producers[0] != *prods.first)
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
            if (_state == producer_state::follower && is_leader())
            {
               _state = producer_state::leader;
               start_leader();
            }
            else if (_state == producer_state::leader && !is_leader())
            {
               stop_leader();
               _state = producer_state::follower;
            }
         }
         else
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

      void increase_view()
      {
         auto threshold = producer_views.size() * 2 / 3 + 1;
         if (std::count_if(producer_views.begin(), producer_views.end(),
                           [current_term = current_term](auto v)
                           { return v >= current_term || v == 0; }) >= threshold)
         {
            set_view(current_term + 1);
         }
         else
         {
            // Periodically resend view changes if we're stuck
            for_each_key(
                [&](const auto& k)
                {
                   network().multicast_producers(
                       ViewChangeMessage{.term = current_term, .producer = self, .claim = k});
                });
         }
      }

      void set_view(term_id term)
      {
         if (term > current_term)
         {
            bool was_leader = is_leader();
            current_term    = term;
            if (is_leader())
            {
               if (_state == producer_state::follower)
               {
                  _state = producer_state::leader;
                  start_leader();
               }
            }
            else
            {
               if (_state == producer_state::leader)
               {
                  stop_leader();
               }
            }
            for_each_key(
                [&](const auto& k)
                {
                   network().multicast_producers(
                       ViewChangeMessage{.term = current_term, .producer = self, .claim = k});
                });
            if (auto idx = active_producers[0]->getIndex(self))
            {
               producer_views[*idx] = term;
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
      void on_prepare(const BlockHeaderState* state, AccountNumber producer)
      {
         const auto& id = state->blockId();
         if (prepare(state, producer))
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
         on_prepare(state, self);
         for_each_key(
             [&](const auto& key)
             {
                auto message = PrepareMessage{.block_id = id, .producer = self, .claim = key};
                network().multicast_producers(message);
                if (auto iter = confirmations.find(state->blockId()); iter != confirmations.end())
                {
                   iter->second.add_message(message);
                }
             });
      }
      void on_commit(const BlockHeaderState* state, AccountNumber producer)
      {
         const auto& id = state->blockId();
         if (commit(state, producer))
         {
            if (!chain().in_best_chain(state->xid()))
            {
               if (state->order() < best_prepared)
               {
                  PSIBASE_LOG(logger, critical)
                      << "consensus failure: committing a block that that is not in the best "
                         "chain. This means that either there is a severe bug in the software, or "
                         "the maximum number of byzantine faults was exceeded.";
               }
               // This is possible if we receive the commits before the corresponding prepares
               chain().set_subtree(state);
            }
            if (chain().commit(state->blockNum()))
            {
               start_timer();
            }
            set_producers(chain().getProducers());
         }
      }
      void do_commit(const BlockHeaderState* state, AccountNumber producer)
      {
         const auto& id = state->blockId();
         on_commit(state, self);
         for_each_key(
             [&](const auto& key)
             {
                auto message = CommitMessage{.block_id = id, .producer = self, .claim = key};
                network().multicast_producers(message);
                if (auto iter = confirmations.find(state->blockId()); iter != confirmations.end())
                {
                   iter->second.add_message(message);
                }
             });
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
      void recv(peer_id peer, const PrepareMessage& msg)
      {
         auto* state = chain().get_state(msg.block_id);
         if (!state)
         {
            return;
         }
         validate_producer(state, msg.producer, msg.claim);
         // TODO: should we update the sender's view here? same for commit.
         on_prepare(state, msg.producer);
      }
      void recv(peer_id peer, const CommitMessage& msg)
      {
         auto* state = chain().get_state(msg.block_id);
         if (!state)
         {
            return;
         }
         validate_producer(state, msg.producer, msg.claim);
         on_commit(state, msg.producer);
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
            if (*expected == msg.claim)
            {
               auto idx             = active_producers[0]->getIndex(msg.producer);
               producer_views[*idx] = std::max(producer_views[*idx], msg.term);
               auto view_copy       = producer_views;
               auto offset          = active_producers[0]->size() * 2 / 3;
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
