#pragma once

#include <psibase/ForkDb.hpp>
#include <psibase/Socket.hpp>
#include <psibase/net_base.hpp>
#include <psio/finally.hpp>
#include <psio/reflect.hpp>
#include <psio/to_hex.hpp>

#include <algorithm>
#include <cassert>
#include <chrono>
#include <cstdint>
#include <memory>
#include <variant>
#include <vector>

#include <boost/asio/io_context.hpp>
#include <boost/asio/post.hpp>

namespace psibase::net
{
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

   template <typename F>
   struct print_function
   {
      F                    f;
      friend std::ostream& operator<<(std::ostream& os, const print_function& f)
      {
         f.f(os);
         return os;
      }
   };

   struct HelloRequest
   {
      static constexpr unsigned type = 32;
      ExtendedBlockId           xid;
      bool                      committed;
      std::string               to_string() const
      {
         return "hello: id=" + loggers::to_string(xid.id()) +
                " blocknum=" + std::to_string(xid.num());
      }
   };
   PSIO_REFLECT(HelloRequest, xid, committed)

   struct BlockMessage
   {
      static constexpr unsigned          type = 34;
      psio::shared_view_ptr<SignedBlock> block;
      std::string                        to_string() const
      {
         BlockInfo info{block->block()};
         return "block: term=" + std::to_string(TermNum{block->block().header().term()}) +
                " leader=" + AccountNumber{block->block().header().producer()}.str() +
                " id=" + loggers::to_string(info.blockId) +
                " blocknum=" + std::to_string(BlockNum{block->block().header().blockNum()}) +
                " irreversible=" + std::to_string(BlockNum{block->block().header().commitNum()}) +
                (block->auxConsensusData() ? " auxConsensusData" : "");
      }
   };
   PSIO_REFLECT(BlockMessage, block)

   struct StateChecksumMessage
   {
      static const unsigned    type = 42;
      Checksum256              blockId;
      snapshot::StateChecksum  state;
      snapshot::StateSignature signature;
      std::string              to_string() const
      {
         return "state checksum: id=" + loggers::to_string(blockId) +
                " producer=" + signature.account.str() +
                " service=" + loggers::to_string(state.serviceRoot) +
                " native=" + loggers::to_string(state.nativeRoot);
      }
   };
   PSIO_REFLECT(StateChecksumMessage, blockId, state, signature)

   struct BlockHeaderMessage
   {
      static constexpr unsigned          type = 44;
      psio::shared_view_ptr<SignedBlock> block;
      std::string                        to_string() const
      {
         BlockInfo info{block->block()};
         return "block header: term=" + std::to_string(TermNum{block->block().header().term()}) +
                " leader=" + AccountNumber{block->block().header().producer()}.str() +
                " id=" + loggers::to_string(info.blockId) +
                " blocknum=" + std::to_string(BlockNum{block->block().header().blockNum()}) +
                " irreversible=" + std::to_string(BlockNum{block->block().header().commitNum()}) +
                (block->auxConsensusData() ? " auxConsensusData" : "");
      }
   };
   PSIO_REFLECT(BlockHeaderMessage, block)

   // snapshot protocol
   //
   // A->B offer snapshot
   // B->A request snapshot
   // A->B signed block headers
   // A->B snapshot data
   struct SnapshotPartMessage
   {
      static const unsigned     type = 43;
      Checksum256               blockId;
      DbId                      db;
      std::vector<char>         lowKey;
      std::vector<char>         highKey;
      std::vector<SnapshotItem> rows;
      std::string               to_string() const
      {
         return "snapshot part: blockid=" + loggers::to_string(blockId) +
                " nrows=" + std::to_string(rows.size()) +
                " db=" + std::to_string(static_cast<unsigned>(db)) + " [" + psio::to_hex(lowKey) +
                "," + psio::to_hex(highKey) + ")";
      }
   };
   PSIO_REFLECT(SnapshotPartMessage, blockId, db, lowKey, highKey, rows)

   struct SnapshotVerifyMessage
   {
      static const unsigned                 type = 45;
      Checksum256                           blockId;
      snapshot::StateChecksum               hash;
      std::vector<snapshot::StateSignature> signatures;
      std::string                           to_string() const
      {
         return "snapshot verify: block=" + loggers::to_string(blockId) +
                " nsig=" + std::to_string(signatures.size());
      }
   };
   PSIO_REFLECT(SnapshotVerifyMessage, blockId, hash, signatures)

   // A producer-to-producer message with contents completely defined by services.
   struct WasmProducerMessage
   {
      static constexpr unsigned type = 64;
      std::vector<char>         data;
      AccountNumber             producer;
      Claim                     signer;

      std::string to_string() const { return "wasm prod: producer=" + producer.str(); }
   };
   PSIO_REFLECT(WasmProducerMessage, data, producer, signer)

   struct ConnectionStateStart
   {
      // The most recent hello message sent or the next queued hello message
      HelloRequest                   hello;
      bool                           hello_sent;
      std::optional<ExtendedBlockId> common;
   };

   struct ConnectionStateSendFastForward
   {
      BlockNum blockNum;
   };

   struct ConnectionStateReceiveFastForward
   {
      std::unique_ptr<LightHeaderState> state;
   };

   struct ConnectionStateSendSnapshot
   {
      Checksum256                     blockId;
      std::unique_ptr<SnapshotSender> sender;
   };

   struct ConnectionStateReceiveSnapshot
   {
      std::unique_ptr<SnapshotLoader> loader;
   };

   struct ConnectionStateReady
   {
      ExtendedBlockId last_sent;
      ExtendedBlockId last_received;
   };

   using ConnectionState = std::variant<ConnectionStateStart,
                                        ConnectionStateSendFastForward,
                                        ConnectionStateReceiveFastForward,
                                        ConnectionStateSendSnapshot,
                                        ConnectionStateReceiveSnapshot,
                                        ConnectionStateReady>;

   // This class manages production and distribution of blocks
   // The consensus algorithm is provided by the derived class
   template <typename Derived, typename Timer>
   struct blocknet
   {
      auto& network() { return static_cast<Derived*>(this)->network(); }
      auto& consensus() { return static_cast<Derived*>(this)->consensus(); }
      auto& chain() { return static_cast<Derived*>(this)->chain(); }

      enum class producer_state : std::uint8_t
      {
         unknown,
         follower,
         candidate,
         leader,
         nonvoting,
         shutdown,
      };

      template <typename ExecutionContext>
      explicit blocknet(ExecutionContext& ctx)
          : _ioctx(ctx),
            _trx_timer(ctx),
            _block_timer(ctx),
            prods_socket(std::make_shared<ProducerMulticastSocket>(this))
      {
         logger.add_attribute("Channel",
                              boost::log::attributes::constant(std::string("consensus")));
      }

      struct peer_connection
      {
         explicit peer_connection(peer_id id) : id(id) {}
         ~peer_connection() {}
         peer_id id;
         bool    closed  = false;
         bool    sending = false;

         ConnectionState state;
      };

      struct ProducerMulticastSocket : Socket
      {
         ProducerMulticastSocket(blocknet* self) : self(self) {}
         blocknet* self;
         void      send(std::span<const char> data)
         {
            boost::asio::post(
                self->_ioctx,
                [this, data = std::vector(data.begin(), data.end())]
                {
                   auto state = self->_state;
                   if (state == producer_state::leader || state == producer_state::follower ||
                       state == producer_state::candidate)
                   {
                      self->for_each_key(
                          [&](const Claim& key)
                          {
                             self->network().multicast_producers(WasmProducerMessage{
                                 .data = data, .producer = self->self, .signer = key});
                          });
                   }
                });
         }
      };

      producer_id                  self = null_producer;
      std::shared_ptr<ProducerSet> active_producers[2];
      TermNum                      current_term = 0;

      producer_state _state = producer_state::unknown;
      // Counts the total number of times block production has been stopped.
      // This is used to allow the timer callback to know when the block
      // that it is trying to produce has been aborted.
      std::uint64_t _leader_cancel = 0;

      boost::asio::io_context&  _ioctx;
      Timer                     _trx_timer;
      Timer                     _block_timer;
      std::chrono::milliseconds _timeout        = std::chrono::seconds(3);
      std::chrono::milliseconds _block_interval = std::chrono::seconds(1);

      bool _trx_loop_running = false;

      std::vector<std::unique_ptr<peer_connection>> _peers;

      std::shared_ptr<ProducerMulticastSocket> prods_socket;

      loggers::common_logger logger;

      using message_type = std::variant<HelloRequest,
                                        BlockMessage,
                                        StateChecksumMessage,
                                        BlockHeaderMessage,
                                        SnapshotPartMessage,
                                        SnapshotVerifyMessage,
                                        WasmProducerMessage>;

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
         __builtin_unreachable();
      }

      void disconnect(peer_id id)
      {
         auto pos =
             std::find_if(_peers.begin(), _peers.end(), [&](const auto& p) { return p->id == id; });
         assert(pos != _peers.end());
         if ((*pos)->sending)
         {
            (*pos)->closed = true;
         }
         else
         {
            _peers.erase(pos);
         }
      }

      // This should be called by any async callback that is part of a send loop.
      // If the connection has been cancelled, it will destroy it and return true.
      bool check_cancel(peer_connection& connection)
      {
         assert(connection.sending);
         connection.sending = false;
         if (connection.closed)
         {
            auto pos =
                std::ranges::find_if(_peers, [&](const auto& p) { return p.get() == &connection; });
            assert(pos != _peers.end());
            _peers.erase(pos);
            return true;
         }
         else
         {
            return false;
         }
      }

      void connect(peer_id id)
      {
         _peers.push_back(std::make_unique<peer_connection>(id));
         peer_connection& connection = get_connection(id);
         connection.state =
             ConnectionStateStart{.hello = chain().get_head_state()->xid(), .hello_sent = false};
         async_send_next(connection);
      }
      auto send_handler(peer_connection& connection)
      {
         return [&](const std::error_code& ec)
         {
            if (check_cancel(connection) || ec)
               return;
            async_send_next(connection);
         };
      }
      void async_send_next(peer_connection& connection)
      {
         assert(!connection.sending);
         std::visit(
             [&](auto& state)
             {
                if constexpr (requires { async_send_next(connection, state); })
                {
                   async_send_next(connection, state);
                }
             },
             connection.state);
      }
      void async_send_next(peer_connection& connection, ConnectionStateStart& state)
      {
         if (state.hello.committed)
         {
            if (state.common)
            {
               if (auto* b = chain().get_state(state.common->id()))
               {
                  state.common = chain().get_common_ancestor(b->xid());
               }
               else if (state.common->num() > chain().commit_index())
               {
                  // The peer gave us a future block. It is impossible for both peers
                  // to reach this state.
                  return;
               }
               connection.state = make_connection_ready(state);
               async_send_next(connection);
            }
            return;
         }
         if (state.hello_sent)
         {
            auto b = chain().get_state(state.hello.xid.id());
            if (b)
               b = chain().get_state(b->info.header.previous);
            if (!b)
            {
               // If the state is missing, it means that irreversibility advanced
               // Just reset to the committed block.
               b = chain().get_state(chain().get_block_id(chain().commit_index()));
            }
            state.hello = {b->xid()};
         }
         state.hello_sent      = true;
         state.hello.committed = state.hello.xid.num() <= chain().commit_index();
         network().async_send(connection.id, state.hello, send_handler(connection));
         connection.sending = true;
      }

      ConnectionStateReady make_connection_ready(const ConnectionStateStart& state)
      {
         return ConnectionStateReady{.last_sent = *state.common, .last_received = *state.common};
      }

      void recv(peer_id origin, const HelloRequest& request)
      {
         auto& connection = get_connection(origin);
         auto* state      = std::get_if<ConnectionStateStart>(&connection.state);
         if (!state || state->common)
         {
            // If we've already found a common block, we can ignore the
            // rest of the peer's hello messages.
            return;
         }
         if (request.committed && request.xid.num() < chain().getLogStart())
         {
            if (std::holds_alternative<ConnectionStateStart>(connection.state))
            {
               PSIBASE_LOG(logger, info) << "Sending snapshot because the block log is truncated "
                                            "and the peer is too far behind";
               connection.state = ConnectionStateSendFastForward{request.xid.num()};
               if (!connection.sending)
               {
                  async_send_next(connection);
               }
            }
            return;
         }
         // Skip blocks that we know the peer doesn't have.
         if (!state->hello.committed &&
             state->hello.xid.num() > request.xid.num() + state->hello_sent)
         {
            state->hello.xid  = {chain().get_block_id(request.xid.num()), request.xid.num()};
            state->hello_sent = false;
         }
         if (request.xid.id() == Checksum256{})
         {
            // sync from genesis
            state->common = {Checksum256{}, 1};
         }
         else
         {
            if (auto* b = chain().get_state(request.xid.id()))
            {
               state->common = chain().get_common_ancestor(b->xid());
            }
            else if (chain().get_block_id(request.xid.num()) == request.xid.id())
            {
               state->common = request.xid;
            }
            else if (request.committed && request.xid.num() <= chain().commit_index())
            {
               // The peer sent a block id that it claims is committed, but it doesn't
               // match the block id that we have for that block number
               throw std::runtime_error("No common block found");
            }
            else if (request.committed)
            {
               // Do NOT ready the connection. If we've already sent
               // our committed block ID, then we know that the peer is
               // definitely ahead of us, and we need to wait.
               // If we have not yet sent our committed block ID, then
               // we'll re-evaluate when we do.
               state->common = request.xid;
               return;
            }
            else
            {
               // We don't know the block. Wait for one that we do know.
               return;
            }
         }
         if (state->hello.committed)
         {
            connection.state = make_connection_ready(*state);
            if (!connection.sending)
            {
               async_send_next(connection);
            }
         }
      }

      void async_send_next(peer_connection& connection, ConnectionStateSendFastForward& state)
      {
         auto snapshotId = chain().get_last_snapshot_id();
         PSIBASE_LOG(logger, debug) << "Last snapshot: " << loggers::to_string(snapshotId);
         if (auto headerNum = chain().get_next_light_header_num(state.blockNum, snapshotId);
             headerNum && *headerNum <= getBlockNum(snapshotId))
         {
            // Lookup block and discard transactions
            auto blockptr = chain().get_block_by_num(*headerNum);
            if (!blockptr)
            {
               throw std::runtime_error("Missing block header " + std::to_string(*headerNum));
            }
            auto header           = blockptr->block().header().unpack();
            auto signature        = blockptr->signature().unpack();
            auto auxConsensusData = blockptr->auxConsensusData().unpack();
            auto headerptr        = psio::shared_view_ptr<SignedBlock>(SignedBlock{
                Block{std::move(header)}, std::move(signature), std::move(auxConsensusData)});
            state.blockNum        = *headerNum;
            network().async_send(connection.id, BlockHeaderMessage{std::move(headerptr)},
                                 send_handler(connection));
            connection.sending = true;
         }
         else
         {
            connection.state = ConnectionStateSendSnapshot{
                snapshotId, std::unique_ptr<SnapshotSender>{
                                new SnapshotSender(chain().send_snapshot(snapshotId))}};
            async_send_next(connection);
         }
      }

      void async_send_next(peer_connection& connection, ConnectionStateSendSnapshot& state)
      {
         SnapshotPartMessage msg;
         if (state.sender->next(msg.db, msg.lowKey, msg.highKey, msg.rows))
         {
            msg.blockId = state.blockId;
            network().async_send(connection.id, std::move(msg), send_handler(connection));
            connection.sending = true;
         }
         else
         {
            auto row         = chain().get_snapshot_info(state.blockId);
            auto id          = ExtendedBlockId{state.blockId, getBlockNum(state.blockId)};
            connection.state = ConnectionStateReady{id, id};
            network().async_send(
                connection.id,
                SnapshotVerifyMessage{row.id, row.state->state, row.state->signatures},
                send_handler(connection));
            connection.sending = true;
         }
      }

      // TODO: rename this function to a more generic init routine
      void load_producers()
      {
         chain().addSocket(prods_socket);
         chain().onCommit(
             [this](BlockHeaderState* state)
             {
                if (chain().should_make_snapshot(state))
                {
                   auto fn       = chain().snapshot_builder(state);
                   auto checksum = fn();
                   if (auto sig = chain().on_state_checksum(state->blockId(), checksum, self))
                   {
                      network().multicast(
                          StateChecksumMessage{state->blockId(), checksum, std::move(*sig)});
                   }
                }
             });
         current_term = chain().get_head()->term;
         consensus().set_producers(chain().getProducers());
      }
      bool is_sole_producer() const
      {
         if (self == AccountNumber())
         {
            return false;
         }
         if (active_producers[1])
         {
            if (active_producers[1]->size() != 1 || !active_producers[1]->isProducer(self))
               return false;
            if (active_producers[0]->size() == 0)
               return true;
         }
         return (active_producers[0]->size() == 1 && active_producers[0]->isProducer(self));
      }
      bool is_producer() const
      {
         return active_producers[0]->isProducer(self) ||
                (active_producers[1] && active_producers[1]->isProducer(self));
      }
      bool is_producer(AccountNumber account) const
      {
         return active_producers[0]->isProducer(account) ||
                (active_producers[1] && active_producers[1]->isProducer(account));
      }
      producer_id producer_name() const { return self; }

      void set_producer_id(producer_id prod)
      {
         if (self != prod)
         {
            self = prod;
            // If set_producer_id is called before load_producers, active_producers
            // may not be initialized yet.
            if (active_producers[0])
            {
               // Re-evaluates producer state
               // This may leave the leader running even if it changed names.
               // I believe that this is safe because the fact that it's
               // still the same node guarantees that the hand-off is atomic.
               consensus().set_producers({active_producers[0], active_producers[1]});
               network().on_producer_change();
               // set_producers may abort the current block,
               // if we are no longer an active producer
               switch_fork();
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
      template <typename F>
      void for_each_key(const BlockHeaderState* state, F&& f)
      {
         auto claim0 = state->producers->getClaim(self);
         if (claim0)
         {
            f(*claim0);
         }
         if (state->nextProducers)
         {
            auto claim1 = state->nextProducers->getClaim(self);
            if (claim1 && claim0 != claim1)
            {
               f(*claim1);
            }
         }
      }

      void validate_producer(BlockHeaderState* state, AccountNumber producer, const Claim& claim)
      {
         bool found = false;
         if (auto claim0 = state->producers->getClaim(producer))
         {
            found = true;
            if (claim == *claim0)
            {
               return;
            }
         }
         if (state->nextProducers)
         {
            if (auto claim1 = state->nextProducers->getClaim(producer))
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

      // \pre _state == leader
      // \pre no pending block
      // \post pending block
      void start_leader()
      {
         assert(_state == producer_state::leader);
         auto head = chain().get_head();
         // The next block production time is the later of:
         // - The last block interval boundary before the current time
         // - The head block time + the block interval
         //
         auto head_time = typename Timer::time_point{
             std::chrono::duration_cast<std::chrono::seconds>(head->time.time_since_epoch())};
         auto block_start = std::max(head_time + _block_interval,
                                     floor2(Timer::clock_type::now(), _block_interval));
         _block_timer.expires_at(block_start + _block_interval);
         auto commit_index = chain().commit_index();
         chain().start_block(TimePointSec{duration_cast<Seconds>(block_start.time_since_epoch())},
                             self, current_term, commit_index);
         _block_timer.async_wait(
             [this, saved_leader_cancel = _leader_cancel](const std::error_code& ec)
             {
                if (_leader_cancel == saved_leader_cancel)
                {
                   if (auto* b = chain().finish_block([this](const BlockHeaderState* state)
                                                      { return consensus().makeBlockData(state); }))
                   {
                      // Calling start_leader first allows the other functions
                      // to rely on the invariant that there is an active block
                      // iff _state == leader.
                      start_leader();
                      bool updatedProducers = false;
                      // If a new consensus was set while building this block,
                      // our current producers might be out-dated
                      if (b->info.header.newConsensus)
                      {
                         consensus().set_producers({b->producers, b->nextProducers});
                         updatedProducers = true;
                      }
                      // on_produce_block and on_fork_switch should both run
                      // before set_producers, because they should see the
                      // producers of this of this block.
                      consensus().on_produce_block(b);
                      consensus().on_fork_switch(&b->info.header);
                      // Set tentative producers for the next block
                      if (b->endsJointConsensus())
                      {
                         consensus().set_producers({b->nextProducers, nullptr});
                         updatedProducers = true;
                      }
                      if (updatedProducers)
                      {
                         network().on_producer_change();
                      }
                      // do_gc needs to run after on_fork_switch, because
                      // on_fork_switch is responsible for cleaning up any
                      // pointers that will become dangling.
                      do_gc();
                   }
                   else
                   {
                      start_leader();
                   }
                }
             });
         schedule_process_transactions();
      }

      // \pre common invariants
      // \post no pending block
      void stop_leader(const char* log_message = "Stopping block production")
      {
         if (_state == producer_state::leader)
         {
            ++_leader_cancel;
            _block_timer.cancel();
            PSIBASE_LOG(consensus().logger, info) << log_message;
            chain().abort_block();
         }
      }

      bool push_boot(std::vector<SignedTransaction>&& transactions, TransactionTrace& trace)
      {
         bool result = false;
         if (chain().getBlockContext())
         {
            trace.error = "chain is already booted";
            return result;
         }
         try
         {
            auto block_start  = floor2(Timer::clock_type::now(), _block_interval);
            auto commit_index = chain().commit_index();
            chain().start_block(
                TimePointSec{duration_cast<Seconds>(block_start.time_since_epoch())}, self,
                current_term, commit_index);
            auto  cleanup = psio::finally{[&]
                                         {
                                            if (!result)
                                            {
                                               chain().abort_block();
                                            }
                                         }};
            auto& bc      = *chain().getBlockContext();
            if (!bc.needGenesisAction)
            {
               trace.error = "chain is already booted";
            }
            else
            {
               for (auto& trx : transactions)
               {
                  if (!trx.proofs.empty())
                     // Proofs execute as of the state at the beginning of a block.
                     // That state is empty, so there are no proof services installed.
                     trace.error = "Transactions in boot block may not have proofs";
                  else
                     bc.pushTransaction(std::move(trx), trace, std::nullopt);
               }
               if (auto* b = chain().finish_block([this](const BlockHeaderState* state)
                                                  { return consensus().makeBlockData(state); }))
               {
                  result = true;
                  consensus().set_producers({b->producers, b->nextProducers});
                  consensus().on_accept_block(b);
                  consensus().on_fork_switch(&b->info.header);
                  consensus().set_producers({b->nextProducers, nullptr});
                  network().on_producer_change();
                  // do_gc needs to run after on_fork_switch, because
                  // on_fork_switch is responsible for cleaning up any
                  // pointers that will become dangling.
                  do_gc();
               }
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
         return result;
      }

      // This async loop is active when running as the leader and
      // there is at least one pending transaction
      void process_transactions()
      {
         if (_state == producer_state::leader)
         {
            if (auto trx = chain().nextTransaction())
            {
               chain().pushTransaction(std::move(*trx));
               _trx_timer.expires_after(std::chrono::microseconds{0});
            }
            else
            {
               _trx_timer.expires_after(std::chrono::milliseconds{100});
            }
            _trx_timer.async_wait([this](const std::error_code&) { process_transactions(); });
         }
         else
         {
            _trx_loop_running = false;
         }
      }

      void schedule_process_transactions()
      {
         if (!_trx_loop_running && _state == producer_state::leader)
         {
            _trx_loop_running = true;
            _trx_timer.expires_after(std::chrono::microseconds{0});
            _trx_timer.async_wait([this](const std::error_code&) { process_transactions(); });
         }
      }

      // \pre common invariants
      void async_shutdown()
      {
         // TODO: if we are the current leader, finish the
         // current block and try to hand off leadership before
         // shutting down.
         stop_leader();
         _state = producer_state::shutdown;
      }

      // The block broadcast algorithm is mostly independent of consensus.
      // The primary potential variation is whether a block is forwarded
      // before or after validation.

      // invariants: if the head block is not the last sent block, then
      //             exactly one instance of async_send_fork is active
      void async_send_next(peer_connection& peer, ConnectionStateReady& state)
      {
         if (state.last_sent.num() != chain().get_head()->blockNum)
         {
            auto next_block_id = chain().get_block_id(state.last_sent.num() + 1);
            assert(next_block_id != Checksum256());
            state.last_sent = {next_block_id, state.last_sent.num() + 1};
            auto next_block = chain().get(next_block_id);

            network().async_send(peer.id, BlockMessage{next_block}, send_handler(peer));
            peer.sending = true;
            consensus().post_send_block(peer.id, state.last_sent.id());
         }
      }
      // This should be run whenever there is a new head block on the local chain
      // Note: this needs to run before orphaned blocks in the old fork
      // are pruned.  It must remove references to blocks that are not
      // part of the new best fork.
      void on_fork_switch(const BlockHeader* new_head)
      {
         // TODO: how do we handle a fork switch during connection startup?
         for (auto& peer : _peers)
         {
            // ---------- TODO: dispatch to peer connection strand -------------
            if (auto* state = std::get_if<ConnectionStateStart>(&peer->state))
            {
               auto new_id = chain().get_common_ancestor(state->hello.xid);
               if (state->hello.xid != new_id)
               {
                  state->hello.xid  = new_id;
                  state->hello_sent = false;
               }
               if (state->common)
               {
                  if (auto common_state = chain().get_state(state->common->id()))
                  {
                     state->common = chain().get_common_ancestor(common_state->xid());
                  }
               }
            }
            // if last sent block is after committed, back it up to the nearest block in the chain
            if (auto* state = std::get_if<ConnectionStateReady>(&peer->state))
            {
               // Note: Checking best_received primarily prevents received blocks
               // from being echoed back to their origin.
               state->last_sent = chain().get_common_ancestor(state->last_sent);
               if (chain().get_state(state->last_received.id()))
               {
                  auto best_received = chain().get_common_ancestor(state->last_received);
                  if (best_received.num() > state->last_sent.num())
                  {
                     state->last_sent = best_received;
                  }
               }
               // if the peer is synced, start async_send_next
               if (!peer->sending)
               {
                  async_send_next(*peer);
               }
            }
            else
            {
               PSIBASE_LOG(logger, debug) << "Peer " << peer->id << " not ready";
            }
            // ------------------------------------------------------------------
         }
      }

      void update_last_received(auto& peer, const ExtendedBlockId& xid)
      {
         if (std::holds_alternative<ConnectionStateStart>(peer.state))
         {
            peer.state = ConnectionStateReady{.last_sent     = chain().get_common_ancestor(xid),
                                              .last_received = xid};
         }
         else if (auto* state = std::get_if<ConnectionStateReady>(&peer.state))
         {
            state->last_received = xid;
            if (chain().in_best_chain(xid) && xid.num() > state->last_sent.num())
            {
               state->last_sent = xid;
            }
         }
         consensus().post_send_block(peer.id, xid.id());
      }

      void recv(peer_id origin, const BlockMessage& request)
      {
         if (auto [state, inserted] = chain().insert(request.block); inserted)
         {
            try
            {
               consensus().on_accept_block_header(state);
            }
            catch (...)
            {
               chain().erase(state);
               throw;
            }
            auto& connection = get_connection(origin);
            update_last_received(connection, state->xid());
            switch_fork();
         }
         else if (state)
         {
            auto& connection = get_connection(origin);
            update_last_received(connection, state->xid());
         }
      }

      // This should be called after the head block is updated
      void reset_producers(const BlockInfo& head)
      {
         auto producers = chain().getProducers();
         if (producers.first != active_producers[0] || producers.second != active_producers[1])
         {
            consensus().set_producers(std::move(producers));
            network().on_producer_change();
         }
         if (_state == producer_state::leader &&
             chain().getBlockContext()->current.header.previous != head.blockId)
         {
            stop_leader("Pending block aborted because the head block changed");
            start_leader();
         }
      }

      // This should be called after any operation that might change the head block.
      void switch_fork()
      {
         chain().async_switch_fork(
             [this](const BlockInfo& head)
             {
                {
                   PSIBASE_LOG_CONTEXT_BLOCK(logger, head.header, head.blockId);
                   PSIBASE_LOG(logger, debug) << "New head block";
                }
                reset_producers(head);
                consensus().on_fork_switch(&head.header);
                do_gc();
             },
             [this](BlockHeaderState* state) { consensus().on_accept_block(state); });
      }

      void do_gc()
      {
         chain().gc([this](const auto& b) { consensus().on_erase_block(b); });
      }

      bool peer_has_block(peer_id peer, const Checksum256& id)
      {
         // If peer_has_block returns true, then the peer's receipt of the block
         // happens before its receipt of any message sent after peer_has_block returns.
         //
         // If peer_has_block returns false, then one of the following will eventually happen:
         // - The block is not in the best chain
         // - post_send_block(peer, id)
         //
         // FIXME: Make sure that state is properly cleaned up

         auto& connection = get_connection(peer);
         if (auto* state = std::get_if<ConnectionStateReady>(&connection.state))
         {
            if (chain().in_best_chain(id) && getBlockNum(id) <= state->last_sent.num())
            {
               return true;
            }
            return chain().is_ancestor(id, state->last_received);
         }
         return false;
      }

      std::optional<Checksum256> validate_message(const StateChecksumMessage& msg)
      {
         // TODO: actual validation
         return msg.blockId;
      }

      void recv(peer_id origin, const StateChecksumMessage& msg)
      {
         if (chain().on_state_signature(msg.blockId, msg.state, msg.signature))
         {
            network().multicast(msg);
         }
      }

      void start_receive_fast_forward(peer_connection& connection, BlockNum num)
      {
         if (auto* state = std::get_if<ConnectionStateReceiveSnapshot>(&connection.state))
         {
            if (num > getBlockNum(state->loader->blockId))
            {
               PSIBASE_LOG(logger, info) << "Receiving snapshot from peer";
               connection.state =
                   ConnectionStateReceiveFastForward{std::move(state->loader->validator)};
            }
         }
         else if (!std::holds_alternative<ConnectionStateReceiveFastForward>(connection.state) &&
                  num > chain().commit_index())
         {
            PSIBASE_LOG(logger, info) << "Receiving snapshot from peer";
            connection.state = ConnectionStateReceiveFastForward{
                std::unique_ptr<LightHeaderState>(new LightHeaderState(chain().light_validate()))};
         }
      }

      void start_receive_snapshot(peer_connection& connection, const Checksum256& blockId)
      {
         // Note: there might not be any block headers if the block producers
         // haven't changed, so we might receive a SnapshotPartMessage immediately.
         start_receive_fast_forward(connection, getBlockNum(blockId));
         if (auto* state = std::get_if<ConnectionStateReceiveFastForward>(&connection.state))
         {
            connection.state = ConnectionStateReceiveSnapshot{std::unique_ptr<SnapshotLoader>(
                new SnapshotLoader(chain().start_snapshot(std::move(state->state), blockId)))};
         }
      }

      void recv(peer_id origin, const BlockHeaderMessage& msg)
      {
         auto& connection = get_connection(origin);
         start_receive_fast_forward(connection, msg.block->block().header().blockNum());
         if (auto* state = std::get_if<ConnectionStateReceiveFastForward>(&connection.state))
         {
            chain().push_light_header(*state->state, msg.block, consensus());
         }
      }

      void recv(peer_id origin, const SnapshotPartMessage& msg)
      {
         auto& connection = get_connection(origin);
         start_receive_snapshot(connection, msg.blockId);
         if (auto* state = std::get_if<ConnectionStateReceiveSnapshot>(&connection.state))
         {
            check(msg.blockId == state->loader->blockId, "Unexpected snapshot blockId");
            chain().add_to_snapshot(*state->loader, msg.db, msg.lowKey, msg.highKey, msg.rows);
         }
      }

      void adjust_peer_for_snapshot(peer_connection&      connection,
                                    ConnectionStateStart& state,
                                    const ExtendedBlockId&,
                                    const ExtendedBlockId& to)
      {
         if (!state.hello.committed)
         {
            state.hello.xid = to;
         }
      }

      void adjust_peer_for_snapshot(peer_connection&                connection,
                                    ConnectionStateSendFastForward& state,
                                    const ExtendedBlockId&,
                                    const ExtendedBlockId&)
      {
         // Nothing to do. We'll just keep sending headers until we reach the new snapshot.
      }

      void adjust_peer_for_snapshot(peer_connection&             connection,
                                    ConnectionStateSendSnapshot& state,
                                    const ExtendedBlockId&,
                                    const ExtendedBlockId& to)
      {
         // If we're sending a snapshot that is behind the one we loaded, switch back
         // to sending block headers.
         if (to.num() > getBlockNum(state.blockId))
         {
            connection.state = ConnectionStateSendFastForward{getBlockNum(state.blockId)};
         }
      }

      void adjust_peer_for_snapshot(peer_connection&                   connection,
                                    ConnectionStateReceiveFastForward& state,
                                    const ExtendedBlockId&             from,
                                    const ExtendedBlockId&             to)
      {
         if (state.state->prevBlockNum < to.num())
         {
            connection.state = ConnectionStateSendFastForward{state.state->prevBlockNum};
            if (!connection.sending)
               async_send_next(connection);
         }
      }

      void adjust_peer_for_snapshot(peer_connection&                connection,
                                    ConnectionStateReceiveSnapshot& state,
                                    const ExtendedBlockId&          from,
                                    const ExtendedBlockId&          to)
      {
         if (to.num() > getBlockNum(state.loader->blockId))
         {
            connection.state = ConnectionStateSendFastForward{getBlockNum(state.loader->blockId)};
            if (!connection.sending)
               async_send_next(connection);
         }
      }

      void adjust_peer_for_snapshot(peer_connection&       connection,
                                    ConnectionStateReady&  state,
                                    const ExtendedBlockId& from,
                                    const ExtendedBlockId& to)
      {
         if (state.last_sent != to)
         {
            connection.state = ConnectionStateSendFastForward{from.num()};
            if (!connection.sending)
               async_send_next(connection);
         }
      }

      void recv(peer_id origin, const SnapshotVerifyMessage& msg)
      {
         auto& connection = get_connection(origin);
         if (auto* state = std::get_if<ConnectionStateReceiveSnapshot>(&connection.state))
         {
            check(msg.blockId == state->loader->blockId, "Unexpected snapshot blockId");
            // Check whether the snapshot should be loaded
            if (getBlockNum(msg.blockId) <= chain().commit_index())
            {
               PSIBASE_LOG(logger, info) << "Ignoring snapshot because it is in the past";
               auto id          = ExtendedBlockId{msg.blockId, getBlockNum(msg.blockId)};
               connection.state = ConnectionStateReady{.last_sent = id, .last_received = id};
               if (!connection.sending)
                  async_send_next(connection);
               return;
            }
            else if (auto existing = chain().get_state(msg.blockId))
            {
               // We already have an existing state for the snapshot
               PSIBASE_LOG(logger, info) << "Ignoring snapshot because its state is already known";
               connection.state =
                   ConnectionStateReady{.last_sent = chain().get_common_ancestor(existing->xid()),
                                        .last_received = existing->xid()};
               if (!connection.sending)
                  async_send_next(connection);
               return;
            }

            auto oldCommit = chain().get_state(chain().get_block_id(chain().commit_index()))->xid();

            if (auto* head =
                    chain().apply_snapshot(std::move(*state->loader), msg.hash, msg.signatures))
            {
               auto id          = head->xid();
               connection.state = ConnectionStateReady{.last_sent = id, .last_received = id};

               {
                  PSIBASE_LOG_CONTEXT_BLOCK(logger, head->info.header, head->info.blockId);
                  PSIBASE_LOG(logger, debug) << "New head block";
               }
               reset_producers(head->info);

               // Propagate the snapshot to all peers
               for (auto& peer : _peers)
               {
                  std::visit([&](auto& state)
                             { adjust_peer_for_snapshot(*peer, state, oldCommit, id); },
                             peer->state);
               }
               //
               do_gc();
               switch_fork();
            }
            else
            {
               PSIBASE_LOG(logger, info) << "Snapshot ignored";
            }
         }
         else
         {
            if (getBlockNum(msg.blockId) > chain().commit_index())
            {
               PSIBASE_LOG(logger, warning) << "Unexpected snapshot ignored";
            }
            else
            {
               PSIBASE_LOG(logger, info) << "Ignoring snapshot because it is in the past";
            }
         }
      }

      void recv(peer_id origin, const WasmProducerMessage& msg)
      {
         chain().recvMessage(*prods_socket, msg.data);
      }

      // Default implementations
      std::optional<std::vector<char>> makeBlockData(const BlockHeaderState*) { return {}; }
      void                             on_accept_block_header(const BlockHeaderState*) {}
      void                             on_produce_block(const BlockHeaderState*) {}
      void                             on_accept_block(const BlockHeaderState*) {}
      void                             post_send_block(peer_id peer, const Checksum256& id)
      {
         network().on_peer_block(peer, id);
      }
      void on_erase_block(const Checksum256&) {}
      void set_producers(auto prods)
      {
         if (prods.first->size() != 0)
            throw std::runtime_error("Consensus algorithm not available");
         active_producers[0] = std::move(prods.first);
         active_producers[1] = std::move(prods.second);
      }
      void     cancel() {}
      void     validate_message() {}
      BlockNum light_verify(const LightHeaderState&                   state,
                            const BlockInfo&                          info,
                            const psio::shared_view_ptr<SignedBlock>& block)
      {
         throw std::runtime_error("light verify: Unknown consensus algorithm");
      }
   };
}  // namespace psibase::net
