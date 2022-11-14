#pragma once

#include <psibase/ForkDb.hpp>
#include <psibase/net_base.hpp>
#include <psio/reflect.hpp>

#include <algorithm>
#include <cassert>
#include <chrono>
#include <cstdint>
#include <memory>
#include <vector>

namespace psibase::net
{
#ifndef PSIO_REFLECT_INLINE
#define PSIO_REFLECT_INLINE(name, ...)                      \
   PSIO_REFLECT(name, __VA_ARGS__)                          \
   friend reflect_impl_##name get_reflect_impl(const name&) \
   {                                                        \
      return {};                                            \
   }
#endif

   // round tp to the nearest multiple of d towards negative infinity
   template <typename Clock, typename Duration1, typename Duration2>
   std::chrono::time_point<Clock, Duration1> floor2(std::chrono::time_point<Clock, Duration1> tp,
                                                    Duration2                                 d)
   {
      Duration1 d1{d};
      auto      rem = tp.time_since_epoch() % d1;
      if (rem < Duration1{})
      {
         rem += d1;
      }
      return tp - rem;
   }

   // This class manages production and distribution of blocks
   // The consensus algorithm is provided by the derived class
   template <typename Derived, typename Timer>
   struct blocknet
   {
      using term_id = std::uint64_t;

      auto& network() { return static_cast<Derived*>(this)->network(); }
      auto& consensus() { return static_cast<Derived*>(this)->consensus(); }
      auto& chain() { return static_cast<Derived*>(this)->chain(); }

      enum class producer_state : std::uint8_t
      {
         unknown,
         follower,
         candidate,
         leader,
         nonvoting
      };

      template <typename ExecutionContext>
      explicit blocknet(ExecutionContext& ctx) : _block_timer(ctx)
      {
      }

      struct hello_request
      {
         static constexpr unsigned type = 32;
         ExtendedBlockId           xid;
         std::string               to_string() const
         {
            return "hello: id=" + loggers::to_string(xid.id()) +
                   " blocknum=" + std::to_string(xid.num());
         }
         PSIO_REFLECT_INLINE(hello_request, xid)
      };

      struct hello_response
      {
         static constexpr unsigned type  = 33;
         char                      dummy = 0;
         std::string               to_string() const { return "hello response"; }
         PSIO_REFLECT_INLINE(hello_response, dummy)
      };

      struct peer_connection
      {
         explicit peer_connection(peer_id id) : id(id) {}
         ~peer_connection() { std::memset(this, 0xCC, sizeof(*this)); }
         ExtendedBlockId last_sent;
         ExtendedBlockId last_received;
         bool            syncing = false;
         peer_id         id;
         bool            ready  = false;
         bool            closed = false;
         // True once we have received a hello_response from the peer
         bool peer_ready = false;
         // TODO: we may be able to save some space, because last_received is
         // not meaningful until we're finished with hello.
         // The most recent hello message sent or the next queued hello message
         hello_request hello;
         bool          hello_sent;
      };

      producer_id                  self = null_producer;
      std::shared_ptr<ProducerSet> active_producers[2];
      term_id                      current_term = 0;

      producer_state _state = producer_state::unknown;

      Timer                     _block_timer;
      std::chrono::milliseconds _timeout        = std::chrono::seconds(3);
      std::chrono::milliseconds _block_interval = std::chrono::seconds(1);

      std::vector<std::unique_ptr<peer_connection>> _peers;

      struct append_entries_request
      {
         static constexpr unsigned          type = 34;
         psio::shared_view_ptr<SignedBlock> block;
         PSIO_REFLECT_INLINE(append_entries_request, block)
         std::string to_string() const
         {
            BlockInfo info{*block->block()};
            return "append_entries: term=" +
                   std::to_string(term_id{block->block()->header()->term()}) +
                   " leader=" + AccountNumber{block->block()->header()->producer()}.str() +
                   " id=" + loggers::to_string(info.blockId) +
                   " blocknum=" + std::to_string(BlockNum{block->block()->header()->blockNum()}) +
                   " irreversible=" +
                   std::to_string(BlockNum{block->block()->header()->commitNum()});
         }
      };

      peer_connection& get_connection(peer_id id)
      {
         for (const auto& peer : _peers)
         {
            if (peer->id == id)
            {
               return *peer;
            }
         }
         assert(!"Unknown peer connection");
      }

      void disconnect(peer_id id)
      {
         auto pos =
             std::find_if(_peers.begin(), _peers.end(), [&](const auto& p) { return p->id == id; });
         assert(pos != _peers.end());
         if ((*pos)->syncing)
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
         connection.hello_sent       = false;
         connection.hello.xid        = chain().get_head_state()->xid();
         async_send_hello(connection);
      }
      void async_send_hello(peer_connection& connection)
      {
         if (connection.hello_sent)
         {
            auto b = chain().get(connection.hello.xid.id());
            if (!b)
            {
               return;
            }
            auto prev = chain().get(Checksum256(b->block()->header()->previous()));
            if (prev)
            {
               connection.hello = {Checksum256(b->block()->header()->previous()),
                                   BlockNum(b->block()->header()->blockNum()) - 1};
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
         network().async_send_block(connection.id, connection.hello,
                                    [this, &connection](const std::error_code& ec)
                                    {
                                       if (!connection.peer_ready)
                                       {
                                          // TODO: rate limit hellos, delay second hello until we have received the first peer hello
                                          async_send_hello(connection);
                                       }
                                    });
      }
      void recv(peer_id origin, const hello_request& request)
      {
         auto& connection = get_connection(origin);
         if (connection.ready)
         {
            return;
         }
         if (!connection.peer_ready &&
             connection.hello.xid.num() > request.xid.num() + connection.hello_sent)
         {
            // TODO: if the block num is not known, then we've failed to find a common ancestor
            // so bail (only possible with a truncated block log)
            connection.hello.xid  = {chain().get_block_id(request.xid.num()), request.xid.num()};
            connection.hello_sent = false;
         }
         if (request.xid.id() == Checksum256{})
         {
            // sync from genesis
            connection.last_received = {Checksum256{}, 1};
            connection.last_sent     = connection.last_received;
         }
         else
         {
            if (auto b = chain().get(request.xid.id()))
            {
               // Ensure that the block number is accurate.  I have not worked out
               // what happens if the peer lies, but at least this way we guarantee
               // that our local invariants hold.
               connection.last_received = {request.xid.id(),
                                           BlockNum(b->block()->header()->blockNum())};
            }
            else if (auto* b = chain().get_state(request.xid.id()))
            {
               connection.last_received = {request.xid.id(), b->blockNum()};
            }
            else
            {
               return;
            }
            connection.last_sent = chain().get_common_ancestor(connection.last_received);
         }
         // async_send_fork will reset syncing if there is nothing to sync
         connection.syncing = true;
         connection.ready   = true;
         //std::cout << "ready: received=" << to_string(connection.last_received.id())
         //          << " common=" << to_string(connection.last_sent.id()) << std::endl;
         // FIXME: blocks and hellos need to be sequenced correctly
         network().async_send_block(connection.id, hello_response{},
                                    [this, &connection](const std::error_code&)
                                    { async_send_fork(connection); });
      }
      void recv(peer_id origin, const hello_response&)
      {
         auto& connection      = get_connection(origin);
         connection.peer_ready = true;
      }

      void load_producers()
      {
         current_term = chain().get_head()->term;
         consensus().set_producers(chain().getProducers());
      }
      bool is_sole_producer() const
      {
         return ((active_producers[0]->size() == 0 && self != AccountNumber()) ||
                 (active_producers[0]->size() == 1 && active_producers[0]->isProducer(self))) &&
                !active_producers[1];
      }
      bool is_producer() const
      {
         // If there are no producers set on chain, then any
         // producer can produce a block
         return (active_producers[0]->size() == 0 && self != AccountNumber() &&
                 !active_producers[1]) ||
                active_producers[0]->isProducer(self) ||
                (active_producers[1] && active_producers[1]->isProducer(self));
      }
      producer_id producer_name() const { return self; }

      void set_producer_id(producer_id prod)
      {
         if (self != prod)
         {
            self = prod;
            // Re-evaluates producer state
            // This may leave the leader running even if it changed names.
            // I believe that this is safe because the fact that it's
            // still the same node guarantees that the hand-off is atomic.
            if (active_producers[0])
            {
               consensus().set_producers({active_producers[0], active_producers[1]});
            }
         }
      }
      template <typename F>
      void for_each_key(F&& f)
      {
         auto claim0 = active_producers[0]->getClaim(self);
         if (claim0)
         {
            f(*claim0);
         }
         if (active_producers[1])
         {
            auto claim1 = active_producers[1]->getClaim(self);
            if (claim1 && claim0 != claim1)
            {
               f(*claim1);
            }
         }
      }

      void start_leader()
      {
         assert(_state == producer_state::leader);
         auto head = chain().get_head();
         // The next block production time is the later of:
         // - The last block interval boundary before the current time
         // - The head block time + the block interval
         //
         auto head_time   = typename Timer::time_point{std::chrono::seconds(head->time.seconds)};
         auto block_start = std::max(head_time + _block_interval,
                                     floor2(Timer::clock_type::now(), _block_interval));
         _block_timer.expires_at(block_start + _block_interval);
         // TODO: consensus should be responsible for most of the block header
         auto commit_index = is_sole_producer() ? head->blockNum + 1 : chain().commit_index();
         chain().start_block(
             TimePointSec{static_cast<uint32_t>(
                 duration_cast<std::chrono::seconds>(block_start.time_since_epoch()).count())},
             self, current_term, commit_index);
         _block_timer.async_wait(
             [this](const std::error_code& ec)
             {
                if (ec)
                {
                   PSIBASE_LOG(consensus().logger, info) << "Stopping block production";
                   chain().abort_block();
                }
                else if (_state == producer_state::leader)
                {
                   if (auto* b = chain().finish_block())
                   {
                      consensus().on_produce_block(b);
                      consensus().on_fork_switch(&b->info.header);
                      chain().gc();
                   }
                   // finish_block might convert us to nonvoting
                   if (_state == producer_state::leader)
                   {
                      start_leader();
                   }
                }
             });
      }

      void stop_leader()
      {
         if (_state == producer_state::leader)
         {
            _block_timer.cancel();
         }
      }

      // The block broadcast algorithm is most independent of consensus.
      // The primary potential variation is whether a block is forwarded
      // before or after validation.

      // invariants: if the head block is not the last sent block, then
      //             exactly one instance of async_send_fork is active
      void async_send_fork(auto& peer)
      {
         if (peer.closed)
         {
            peer.syncing = false;
            disconnect(peer.id);
            return;
         }
         if (peer.last_sent.num() != chain().get_head()->blockNum)
         {
            auto next_block_id = chain().get_block_id(peer.last_sent.num() + 1);
            peer.last_sent     = {next_block_id, peer.last_sent.num() + 1};
            auto next_block    = chain().get(next_block_id);

            network().async_send_block(peer.id, append_entries_request{next_block},
                                       [this, &peer](const std::error_code& e)
                                       { async_send_fork(peer); });
            consensus().post_send_block(peer.id, peer.last_sent.id());
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
         // TODO: how do we handle a fork switch during connection startup?
         for (auto& peer : _peers)
         {
            // ---------- TODO: dispatch to peer connection strand -------------
            if (!peer->peer_ready)
            {
               auto new_id = chain().get_common_ancestor(peer->hello.xid);
               if (peer->hello.xid != new_id)
               {
                  peer->hello.xid  = new_id;
                  peer->hello_sent = false;
               }
            }
            // if last sent block is after committed, back it up to the nearest block in the chain
            if (peer->ready)
            {
               // Note: Checking best_received primarily prevents received blocks
               // from being echoed back to their origin.
               auto best_received = chain().get_common_ancestor(peer->last_received);
               auto best_sent     = chain().get_common_ancestor(peer->last_sent);
               peer->last_sent = best_received.num() > best_sent.num() ? best_received : best_sent;
               // if the peer is synced, start async_send_fork
               if (!peer->syncing)
               {
                  peer->syncing = true;
                  async_send_fork(*peer);
               }
            }
            // ------------------------------------------------------------------
         }
      }

      void update_last_received(auto& peer, const ExtendedBlockId& xid)
      {
         peer.last_received = xid;
         if (chain().in_best_chain(xid) && xid.num() > peer.last_sent.num())
         {
            peer.last_sent = xid;
         }
      }

      void recv(peer_id origin, const append_entries_request& request)
      {
         // TODO: should the leader ever accept a block from another source?
         if (chain().insert(request.block))
         {
            auto&           connection = get_connection(origin);
            BlockInfo       info{*request.block->block()};
            ExtendedBlockId xid = {info.blockId, info.header.blockNum};
            update_last_received(connection, xid);
            chain().async_switch_fork(
                [this](BlockHeader* h)
                {
                   if (chain().commit(h->commitNum))
                   {
                      consensus().set_producers(chain().getProducers());
                   }
                   consensus().on_fork_switch(h);
                   chain().gc();
                },
                [this](BlockHeaderState* state) { consensus().on_accept_block(state); });
         }
      }

      // Default implementation
      void on_accept_block(const BlockHeaderState*) {}
      void post_send_block(peer_id, const Checksum256&) {}
   };
}  // namespace psibase::net
