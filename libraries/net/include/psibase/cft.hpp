#pragma once

#include <psibase/net_base.hpp>
#include <psibase/random_timer.hpp>
#include <psibase/ForkDb.hpp>
#include <psio/reflect.hpp>

#include <cassert>
#include <algorithm>
#include <chrono>
#include <memory>
#include <vector>
#include <cstdint>
#include <cstring>
#include <variant>

#include <iostream>

namespace psibase::net
{
#ifndef PSIO_REFLECT_INLINE
#define PSIO_REFLECT_INLINE(name, ...)\
   PSIO_REFLECT(name, __VA_ARGS__) \
   friend reflect_impl_ ## name get_reflect_impl(const name&) { return {}; }
#endif

   // round tp to the nearest multiple of d towards negative infinity
   template<typename Clock, typename Duration1, typename Duration2>
   std::chrono::time_point<Clock, Duration1> floor2(std::chrono::time_point<Clock, Duration1> tp, Duration2 d)
   {
      Duration1 d1{d};
      auto rem = tp.time_since_epoch() % d1;
      if (rem < Duration1{})
      {
         rem += d1;
      }
      return tp - d1;
   }

   std::string to_string(const Checksum256& c)
   {
      std::string result;
      for(auto ch : c)
      {
         static const char xdigits[] = "0123456789ABCDEF";
         result += xdigits[(ch >> 4) & 0xF];
         result += xdigits[ch & 0xF];
      }
      return result;
   }

   // This protocol is based on RAFT, with some simplifications.
   // i.e. the blockchain structure is sufficient to guarantee log matching.
   template<typename Derived, typename Timer>
   struct basic_cft_consensus
   {
      using term_id = std::uint64_t;
      using block_num = std::uint32_t;
      using id_type = int;
      static constexpr producer_id null_producer = {};

      auto& network()
      {
         return static_cast<Derived*>(this)->network();
      }
      auto& chain()
      {
         return static_cast<Derived*>(this)->chain();
      }

      enum class producer_state : std::uint8_t {
         follower,
         candidate,
         leader,
         nonvoting
      };

      struct hello_request
      {
         ExtendedBlockId xid;
         std::string to_string() const { return "hello: id=" + net::to_string(xid.id()) + " num=" + std::to_string(xid.num()); }
         PSIO_REFLECT_INLINE(hello_request, xid)
      };

      struct hello_response
      {
         char dummy = 0;
         std::string to_string() const { return "hello response"; }
         PSIO_REFLECT_INLINE(hello_response, dummy)
      };

      struct peer_connection
      {
         explicit peer_connection(peer_id id) : id(id) {}
         ~peer_connection() { std::memset(this, 0xCC, sizeof(*this)); }
         ExtendedBlockId last_sent;
         ExtendedBlockId last_received;
         bool syncing = false;
         peer_id id;
         bool ready = false;
         bool closed = false;
         // True once we have received a hello_response from the peer
         bool peer_ready = false;
         // TODO: we may be able to save some space, because last_received is
         // not meaningful until we're finished with hello.
         // The most recent hello message sent or the next queued hello message
         hello_request hello;
         bool hello_sent;
      };

      template<typename ExecutionContext>
      explicit basic_cft_consensus(ExecutionContext& ctx) : _election_timer(ctx), _block_timer(ctx) {}

      producer_id self = null_producer;
      std::vector<producer_id> active_producers;
      term_id current_term = 0;
      producer_id voted_for = null_producer;
      std::vector<producer_id> votes_for_me;

      block_num last_applied = 0;

      producer_state _state = producer_state::nonvoting;
      basic_random_timer<Timer> _election_timer;
      Timer _block_timer;
      std::chrono::milliseconds _timeout = std::chrono::seconds(3);
      std::chrono::milliseconds _block_interval = std::chrono::seconds(1);

      std::vector<block_num> match_index;
      std::vector<std::unique_ptr<peer_connection>> _peers;

      struct append_entries_request
      {
         term_id term;
         producer_id leader_id;
         BlockNum leader_commit;
         SignedBlock block;
         PSIO_REFLECT_INLINE(append_entries_request, term, leader_id, leader_commit, block)
         std::string to_string() const
         {
            BlockInfo info{block.block};
            return "append_entries: term=" + std::to_string(term) + " leader=" + leader_id.str() + " id=" + net::to_string(info.blockId) + " blocknum=" + std::to_string(block.block.header.blockNum) + " irreversible=" + std::to_string(leader_commit);
         }
      };

      struct append_entries_response
      {
         term_id term;
         producer_id follower_id;
         BlockNum head_num;
         PSIO_REFLECT_INLINE(append_entries_response, term, follower_id, head_num);
         std::string to_string() const
         {
            return "append_entries response: term=" + std::to_string(term) + " follower=" + follower_id.str() + " blocknum=" + std::to_string(head_num);
         }
      };

      struct request_vote_request
      {
         term_id term;
         producer_id candidate_id;
         block_num last_log_index;
         term_id last_log_term;
         PSIO_REFLECT_INLINE(request_vote_request, term, candidate_id, last_log_index, last_log_term)
         std::string to_string() const
         {
            return "request_vote: term=" + std::to_string(term) + " candidate=" + candidate_id.str();
         }
      };
      struct request_vote_response
      {
         term_id term;
         producer_id candidate_id;
         producer_id voter_id;
         bool vote_granted;
         PSIO_REFLECT_INLINE(request_vote_response, term, candidate_id, voter_id, vote_granted)
         std::string to_string() const
         {
            return "vote: term=" + std::to_string(term) + " candidate=" + candidate_id.str() + " voter=" + voter_id.str() + " vote granted=" + std::to_string(vote_granted);
         }
      };

      using message_type = std::variant<hello_request, hello_response, append_entries_request, append_entries_response, request_vote_request, request_vote_response>;

      peer_connection& get_connection(peer_id id)
      {
         for(const auto& peer : _peers)
         {
            if(peer->id == id)
            {
               return *peer;
            }
         }
         assert(!"Unknown peer connection");
      }

      void disconnect(peer_id id)
      {
         auto pos = std::find_if(_peers.begin(), _peers.end(), [&](const auto& p){ return p->id == id; });
         assert(pos != _peers.end());
         if((*pos)->syncing)
         {
            (*pos)->closed = true;
         }
         else
         {
            _peers.erase(pos);
         }
      }

      void connect(peer_id id)
      {
         _peers.push_back(std::make_unique<peer_connection>(id));
         peer_connection& connection = get_connection(id);
         connection.hello_sent = false;
         connection.hello.xid = chain().get_head_state()->xid();
         async_send_hello(connection);
      }
      void async_send_hello(peer_connection& connection)
      {
         if(connection.hello_sent)
         {
            auto* b = chain().get(connection.hello.xid.id());
            if(!b)
            {
               return;
            }
            auto prev = chain().get(b->block.header.previous);
            if(prev)
            {
               connection.hello = {b->block.header.previous, b->block.header.blockNum - 1};
            }
            else
            {
               // TODO: detect the case where the two nodes have no blocks in common
               // This could happen when an out-dated node tries to sync with a node
               // with a trimmed block log, for instance.
               return;
            }
         }
         connection.hello_sent = true;
         network().async_send_block(connection.id, connection.hello, [this, &connection](const std::error_code& ec){
            if(!connection.peer_ready)
            {
               // TODO: rate limit hellos, delay second hello until we have received the first peer hello
               async_send_hello(connection);
            }
         });
      }
      void recv(peer_id origin, const hello_request& request)
      {
         auto& connection = get_connection(origin);
         if(connection.ready)
         {
            return;
         }
         if(!connection.peer_ready && connection.hello.xid.num() > request.xid.num() + connection.hello_sent)
         {
            // TODO: if the block num is not known, then we've failed to find a common ancestor
            // so bail (only possible with a truncated block log)
            connection.hello.xid = {chain().get_block_id(request.xid.num()), request.xid.num()};
            connection.hello_sent = false;
         }
         if(auto* b = chain().get(request.xid.id()))
         {
            // Ensure that the block number is accurate.  I have not worked out
            // what happens if the peer lies, but at least this way we guarantee
            // that our local invariants hold.
            connection.last_received = {request.xid.id(), b->block.header.blockNum};
         }
         else if(auto* b = chain().get_state(request.xid.id()))
         {
            connection.last_received = {request.xid.id(), b->blockNum()};
         }
         else
         {
            return;
         }
         connection.last_sent = chain().get_common_ancestor(connection.last_received);
         // async_send_fork will reset syncing if there is nothing to sync
         connection.syncing = true;
         connection.ready = true;
         std::cout << "ready: received=" << to_string(connection.last_received.id()) << " common=" << to_string(connection.last_sent.id()) << std::endl;
         // FIXME: blocks and hellos need to be sequenced correctly
         network().async_send_block(connection.id, hello_response{}, [this, &connection](const std::error_code&){
            async_send_fork(connection);
         });
      }
      void recv(peer_id origin, const hello_response&)
      {
         auto& connection = get_connection(origin);
         connection.peer_ready = true;
      }
      void set_producer_id(producer_id prod) {
         self = prod;
      }
      void set_producers(std::vector<producer_id> prods)
      {
         active_producers = prods;
         if(_state == producer_state::leader)
         {
            // fix match_index
         }
         if(is_producer())
         {
            if(_state == producer_state::nonvoting)
            {
               _state = producer_state::follower;
               randomize_timer();
            }
         }
         else
         {
            if(_state != producer_state::nonvoting)
            {
               _election_timer.cancel();
               stop_leader();
            }
            _state = producer_state::nonvoting;
         }
      }
      bool is_producer() const
      {
         return std::find(active_producers.begin(), active_producers.end(), self) != active_producers.end();
      }
      producer_id producer_name() const { return self; }

      // ---------------- block production loop --------------------------

      void start_leader()
      {
         // The next block production time is the later of:
         // - The last block interval boundary before the current time
         // - The head block time + the block interval
         //
         auto head_time = typename Timer::time_point{std::chrono::seconds(chain().get_head()->time.seconds)};
         auto block_start = std::max(head_time + _block_interval,
                                     floor2(Timer::clock_type::now(), _block_interval));
         _block_timer.expires_at(block_start + _block_interval);
         // TODO: consensus should be responsible for most of the block header
         chain().start_block(TimePointSec{static_cast<uint32_t>(duration_cast<std::chrono::seconds>(block_start.time_since_epoch()).count())}, self, current_term);
         _block_timer.async_wait([this](const std::error_code& ec){
            if(ec)
            {
               chain().abort_block();
            }
            else if(_state == producer_state::leader)
            {
               if(auto* b = chain().finish_block())
               {
                  update_match_index(self, b->blockNum());
                  update_committed();
                  on_fork_switch(&b->info.header);
               }
               start_leader();
            }
         });
      }

      void stop_leader()
      {
         if(_state == producer_state::leader)
         {
            _block_timer.cancel();
         }
      }

      // The block broadcast algorithm is most independent of consensus.
      // The primary potential variation is whether a block is forwarded
      // before or after validation.

      // These methods should be called by the producer
      template<typename Block>
      void broadcast_block(const Block& b)
      {
         append_entries_request args;
         args.term = current_term;
         args.leader_id = self;
         args.leader_commit = chain().commit_index();
         args.block = b;
         update_match_index(self, b.num);
         update_committed();
         network().broadcast(args);
      }
      // This should probably NOT be part of the consensus class, because
      // it's mostly invariant across consensus algorithms.
      // invariants: if the head block is not the last sent block, then
      //             exactly one instance of async_send_fork is active
      void async_send_fork(auto& peer)
      {
         if(peer.closed)
         {
            peer.syncing = false;
            disconnect(peer.id);
            return;
         }
         if(peer.last_sent.num() != chain().get_head()->blockNum)
         {
            auto next_block_id = chain().get_block_id(peer.last_sent.num() + 1);
            peer.last_sent = {next_block_id, peer.last_sent.num() + 1};
            auto next_block = chain().get(next_block_id);

            network().async_send_block(
                peer.id,
                // TODO: This should probably use the current term/leader not the
                // term leader associated with the block.
                append_entries_request{next_block->block.header.term, next_block->block.header.producer, chain().commit_index(), *next_block},
                [this, &peer](const std::error_code& e){
                   async_send_fork(peer);
                });
         }
         else
         {
            peer.syncing = false;
         }
      }
      // This should be run whenever there is a new head block on the local chain
      // Note: this needs to run before orphaned blocks in the old fork
      // are pruned.  It must remove references to blocks that are not
      // part of the new best fork.
      void on_fork_switch(BlockHeader* new_head)
      {
         if(_state == producer_state::follower && new_head->term == current_term && new_head->blockNum > chain().commit_index())
         {
            network().sendto(new_head->producer, append_entries_response{current_term, self, new_head->blockNum});
         }
         // TODO: how do we handle a fork switch during connection startup?
         for (auto& peer : _peers)
         {
            // ---------- TODO: dispatch to peer connection strand -------------
            if(!peer->peer_ready)
            {
               auto new_id = chain().get_common_ancestor(peer->hello.xid);
               if(peer->hello.xid != new_id)
               {
                  peer->hello.xid = new_id;
                  peer->hello_sent = false;
               }
            }
            // if last sent block is after committed, back it up to the nearest block in the chain
            if(peer->ready)
            {
               // Note: Checking best_received primarily prevents received blocks
               // from being echoed back to their origin.
               auto best_received = chain().get_common_ancestor(peer->last_received);
               auto best_sent = chain().get_common_ancestor(peer->last_sent);
               peer->last_sent = best_received.num() > best_sent.num()? best_received : best_sent;
               // if the peer is synced, start async_send_fork
               if(!peer->syncing)
               {
                  peer->syncing = true;
                  async_send_fork(*peer);
               }
            }
            // ------------------------------------------------------------------
         }
      }

      void on_recv_block(auto& peer, const ExtendedBlockId& xid)
      {
         peer.last_received = xid;
         if(chain().in_best_chain(xid) && xid.num() > peer.last_sent.num())
         {
            peer.last_sent = xid;
         }
      }

      // ------------------- Implementation utilities ----- -----------
      void update_match_index(producer_id producer, block_num match)
      {
         auto pos = std::find(active_producers.begin(), active_producers.end(), producer);
         if(pos != active_producers.end())
         {
            auto idx = pos - active_producers.begin();
            match_index[idx] = std::max(match_index[idx], match);
         }
      }
      void update_committed()
      {
         std::vector<block_num> match = match_index;
         auto mid = match.size()/2;
         std::nth_element(match.begin(), match.begin() + mid, match.end());
         chain().commit(match[mid]);
      }
      // This should always run first when handling any message
      void update_term(term_id term)
      {
         if(term > current_term)
         {
            if(_state == producer_state::leader)
            {
               match_index.clear();
               stop_leader();
               randomize_timer();
            }
            votes_for_me.clear();
            current_term = term;
            voted_for = null_producer;
            _state = producer_state::follower;
         }
      }
      void check_votes()
      {
         if(votes_for_me.size() > active_producers.size()/2)
         {
            _state = producer_state::leader;
            match_index.clear();
            match_index.resize(active_producers.size());
            start_leader();
         }
      }
      // -------------- The timer loop --------------------
      void randomize_timer()
      {
         _election_timer.expires_after(_timeout, _timeout * 2);
         _election_timer.async_wait([this](const std::error_code& ec){
            if(!ec && (_state == producer_state::follower || _state == producer_state::candidate))
            {
               request_vote();
            }
         });
      }
      void request_vote()
      {
         ++current_term;
         voted_for = self;
         votes_for_me.push_back(self);
         randomize_timer();
         _state = producer_state::candidate;
         network().multicast_producers(request_vote_request{current_term, self, chain().get_head()->blockNum, chain().get_head()->term});
         check_votes();
      }
      // ----------- handling of incoming messages -------------
      void recv(peer_id origin, const append_entries_request& request)
      {
         auto& connection = get_connection(origin);
         update_term(request.term);
         if(request.term >= current_term)
         {
            _election_timer.restart();
         }
         auto max_commit = std::min(request.leader_commit, request.block.block.header.blockNum);
         // TODO: should the leader ever accept a block from another source?
         if(chain().insert(request.block))
         {
            BlockInfo info{request.block.block};
            ExtendedBlockId xid = {info.blockId, info.header.blockNum};
            on_recv_block(connection, xid);
            std::cout << "recv node=" << self.str() << " id=" << to_string(xid.id()) << std::endl;
            chain().async_switch_fork([this, max_commit](BlockHeader* h){
               chain().commit(max_commit);
               on_fork_switch(h);
            });
         }
      }
      void recv(peer_id, const append_entries_response& response)
      {
         update_term(response.term);
         if(response.term == current_term)
         {
            if(_state == producer_state::leader)
            {
               update_match_index(response.follower_id, response.head_num);
               update_committed();
            }
         }
         // otherwise ignore out-dated response
      }
      void recv(peer_id, const request_vote_request& request)
      {
         update_term(request.term);
         bool vote_granted = false;
         // Can we vote for this candidate?
         if(_state == producer_state::follower) {
            if(request.term >= current_term && (voted_for == null_producer || voted_for == request.candidate_id))
            {
               // Is the candidate up-to-date?
               auto head = chain().get_head();
               if(request.last_log_term > head->term || (request.last_log_term == head->term && request.last_log_index >= head->blockNum))
               {
                  _election_timer.restart();
                  vote_granted = true;
                  voted_for = request.candidate_id;
               }
            }
            network().sendto(request.candidate_id, request_vote_response{.term = current_term, .candidate_id = request.candidate_id, .voter_id = self, .vote_granted = vote_granted});
         }
      }
      void recv(peer_id, const request_vote_response& response)
      {
         update_term(response.term);
         if(response.candidate_id == self && response.term == current_term && response.vote_granted && _state == producer_state::candidate)
         {
            if(std::find(votes_for_me.begin(), votes_for_me.end(), response.voter_id) == votes_for_me.end())
            {
               votes_for_me.push_back(response.voter_id);
               check_votes();
            }
         }
      }
   };

}
