#pragma once

#include "test_util.hpp"

template <typename Network, typename Derived>
struct basic_fuzz_routing : psibase::net::message_serializer<Derived>
{
   explicit basic_fuzz_routing(boost::asio::io_context& ctx) : ctx(ctx)
   {
      logger.add_attribute("Channel", boost::log::attributes::constant(std::string("p2p")));
   }
   void send(const auto& message)
   {
      PSIBASE_LOG(logger, debug) << "Send message: " << message.to_string() << std::endl;
      _network->recv(message);
   }
   template <typename Msg, typename F>
   void async_send_block(psibase::net::peer_id id, const Msg& msg, F&& f)
   {
      if (peer != id)
      {
         throw std::runtime_error("unknown peer");
      }
      send(msg);
      ctx.post([f]() { f(std::error_code()); });
   }
   template <typename Msg>
   void multicast_producers(const Msg& msg)
   {
      send(msg);
   }
   template <typename Msg>
   void multicast(const Msg& msg)
   {
      send(msg);
   }
   template <typename Msg>
   void sendto(psibase::AccountNumber producer, const Msg& msg)
   {
      send(msg);
   }
   // make a copy of the argument in case it gets invalidated by
   // vector reallocation.
   void recv(auto message)
   {
      PSIBASE_LOG(logger, debug) << "Receive message: " << message.to_string() << std::endl;
      try
      {
         if constexpr (psibase::net::has_recv<SignedMessage<decltype(message)>, Derived>)
         {
            static_cast<Derived*>(this)->consensus().recv(peer, this->sign_message(message));
         }
         else
         {
            static_cast<Derived*>(this)->consensus().recv(peer, message);
         }
      }
      catch (std::exception& e)
      {
         PSIBASE_LOG(logger, warning) << e.what();
      }
   }
   void recv(const psio::shared_view_ptr<psibase::SignedBlock>& message)
   {
      recv(psibase::net::BlockMessage{message});
   }
   void init(Network* network)
   {
      _network = network;
      static_cast<Derived*>(this)->consensus().connect(peer);
   }
   boost::asio::io_context&               ctx;
   static constexpr psibase::net::peer_id peer     = 0;
   Network*                               _network = nullptr;
   psibase::loggers::common_logger        logger;
};

struct end_of_test
{
};

struct bufrng
{
   using result_type = unsigned short;
   static constexpr unsigned short min() { return 0; }
   static constexpr unsigned short max() { return 255; }
   unsigned short                  operator()()
   {
      unsigned short result;
      if (end - ptr < 1)
         throw end_of_test();
      std::memcpy(&result, ptr, 1);
      ptr += 1;
      return result;
   }
   unsigned char* ptr;
   unsigned char* end;
};

void expire_one_timer(bufrng& rng);
void reset_mock_time(psibase::test::mock_clock::time_point);

template <typename Node>
struct FuzzNode
{
   template <typename Network>
   explicit FuzzNode(Network*                network,
                     psibase::SystemContext* sysContext,
                     psibase::AccountNumber  name)
       : node(ctx, sysContext)
   {
      auto attr = boost::log::attributes::constant(name.str());
      node.chain().getBlockLogger().add_attribute("Host", attr);
      node.chain().getLogger().add_attribute("Host", attr);
      node.consensus().logger.add_attribute("Host", attr);
      node.network().logger.add_attribute("Host", attr);
      node.network()._network = network;
      node.set_producer_id(name);
      node.load_producers();
      node.network().init(network);
      ctx.post(
          [this]()
          {
             node.network().recv(psibase::net::HelloRequest{});
             node.network().recv(psibase::net::HelloResponse{});
          });
      ctx.poll();
   }
   boost::asio::io_context ctx;
   Node                    node;
   auto                    poll_one() { return ctx.poll_one(); }
};

template <typename Node>
struct NetworkBase
{
   explicit NetworkBase(psibase::SystemContext* ctx) : systemContext(ctx)
   {
      logger.add_attribute("Host", boost::log::attributes::constant(std::string{"main"}));
   }

   void forward_message(auto& rng, const auto& node)
   {
      switch (rng() % 4)
      {
         case 0:
            forward_message(rng, node, blocks);
            break;
         case 1:
            forward_message(rng, node, prepares);
            break;
         case 2:
            forward_message(rng, node, commits);
            break;
         case 3:
            forward_message(rng, node, view_changes);
            break;
      }
   }

   void forward_message(auto& rng, const auto& node, const auto& messages)
   {
      if (!messages.empty())
         node->node.network().recv(messages[messages.size() - rng() % messages.size() - 1]);
   }

   std::size_t choose_block(auto& rng)
   {
      if (blocks.empty())
         return 0;
      // Building blocks is relatively expensive.  256 blocks
      // should be enough to generate any interesting chain topology
      if (blocks.size() > 255)
         throw end_of_test();
      return blocks.size() - rng() % blocks.size() - 1;
   }

   void add_prepare(std::size_t idx)
   {
      if (blocks.empty())
         return;
      if (prepared_blocks.size() < idx + 1)
      {
         prepared_blocks.resize(idx + 1);
      }
      if (!prepared_blocks[idx])
      {
         psibase::BlockInfo info(blocks[idx]->block());
         prepared_blocks[idx] = true;
         prepares.push_back(SignedMessage<PrepareMessage>{PrepareMessage{info.blockId, producer}});
      }
   }

   void add_commit(std::size_t idx)
   {
      if (blocks.empty())
         return;
      if (commited_blocks.size() < idx + 1)
      {
         commited_blocks.resize(idx + 1);
      }
      if (!commited_blocks[idx])
      {
         psibase::BlockInfo info(blocks[idx]->block());
         commited_blocks[idx] = true;
         commits.push_back(SignedMessage<CommitMessage>{CommitMessage{info.blockId, producer}});
      }
   }

   void add_view_change(auto& rng)
   {
      // TODO: make view random
      view_changes.push_back(ViewChangeMessage{++view, producer});
   }

   void build_block(std::size_t idx)
   {
      if (blocks.empty())
         return;
      auto                 block = blocks[idx];
      psibase::BlockInfo   info{block->block()};
      psibase::SignedBlock newBlock;
      newBlock.block.header.previous     = info.blockId;
      newBlock.block.header.blockNum     = info.header.blockNum + 1;
      newBlock.block.header.time.seconds = std::chrono::duration_cast<std::chrono::seconds>(
                                               psibase::test::mock_clock::now().time_since_epoch())
                                               .count();
      newBlock.block.header.producer  = producer;
      newBlock.block.header.term      = view;
      newBlock.block.header.commitNum = info.header.commitNum;
      recv(BlockMessage{newBlock});
   }

   void recv(const psibase::net::BlockMessage& message)
   {
      psibase::BlockInfo info(message.block->block());
      if (blockIds.insert(info.blockId).second)
      {
         blocks.push_back(message.block);
      }
   }

   void recv(const psibase::net::SignedMessage<psibase::net::PrepareMessage>& message)
   {
      if (!has_message(message, prepares))
         prepares.push_back(message);
   }

   void recv(const psibase::net::SignedMessage<psibase::net::CommitMessage>& message)
   {
      if (!has_message(message, commits))
         commits.push_back(message);
   }

   void recv(const psibase::net::ViewChangeMessage& message)
   {
      if (!has_message(message, view_changes))
         view_changes.push_back(message);
   }
   void recv(const psibase::net::SignedMessage<psibase::net::ViewChangeMessage>& message)
   {
      recv(message.data.unpack());
   }

   void recv(const psibase::net::HelloRequest&) {}
   void recv(const psibase::net::HelloResponse&) {}

   template <typename T>
   static bool has_message(const psibase::net::SignedMessage<T>&              message,
                           const std::vector<psibase::net::SignedMessage<T>>& vec)
   {
      for (const auto& m : vec)
      {
         if (message.data.size() == m.data.size() &&
             std::memcmp(m.data.data(), message.data.data(), m.data.size()) == 0)
            return true;
      }
      return false;
   }
   static bool has_message(const psibase::net::ViewChangeMessage&              message,
                           const std::vector<psibase::net::ViewChangeMessage>& vec)
   {
      return std::find(vec.begin(), vec.end(), message) != vec.end();
   }

   void add_node(std::string_view name)
   {
      nodes.push_back(std::make_unique<FuzzNode<Node>>(
          static_cast<std::remove_cvref_t<decltype(std::declval<Node&>().network()._network)>>(
              this),
          systemContext, psibase::AccountNumber(name)));
   }

   void assert_consistent_commit()
   {
      for (const auto& node1 : nodes)
      {
         auto commit1 = node1->node.chain().commit_index();
         for (const auto& node2 : nodes)
         {
            auto commit2    = node2->node.chain().commit_index();
            auto min_commit = std::min(commit1, commit2);
            if (min_commit > 1)
            {
               assert(node1->node.chain().get_block_id(min_commit) ==
                      node1->node.chain().get_block_id(min_commit));
            }
         }
      }
   }

   void deliver_all()
   {
      auto broadcast = [this](const auto& vec)
      {
         for (std::size_t i = 0; i < vec.size(); ++i)
         {
            for (const auto& node : nodes)
            {
               node->node.network().recv(vec[i]);
               node->ctx.poll();
            }
         }
      };
      for (const auto& node : nodes)
      {
         node->ctx.poll();
      }
      broadcast(blocks);
      broadcast(prepares);
      broadcast(commits);
      broadcast(view_changes);
   }

   void assert_matching_head()
   {
      auto expected = nodes[0]->node.chain().get_head_state()->blockId();
      for (const auto& node : nodes)
      {
         auto state = node->node.chain().get_head_state();
         PSIBASE_LOG_CONTEXT_BLOCK(state->info.header, state->blockId());
         PSIBASE_LOG(node->node.chain().getLogger(), debug) << "final head block";
         assert(node->node.chain().get_head_state()->blockId() == expected);
      }
   }

   std::vector<psio::shared_view_ptr<psibase::SignedBlock>>               blocks;
   std::set<psibase::Checksum256>                                         blockIds;
   std::vector<psibase::net::SignedMessage<psibase::net::PrepareMessage>> prepares;
   std::vector<psibase::net::SignedMessage<psibase::net::CommitMessage>>  commits;
   std::vector<bool>                                                      prepared_blocks;
   std::vector<bool>                                                      commited_blocks;
   std::vector<psibase::net::ViewChangeMessage>                           view_changes;
   std::vector<std::unique_ptr<FuzzNode<Node>>>                           nodes;
   psibase::AccountNumber                                                 producer{"mallory"};
   psibase::TermNum                                                       view = 0;
   psibase::SystemContext*                                                systemContext;
   psibase::loggers::common_logger                                        logger;
};

struct StaticDatabase
{
   explicit StaticDatabase(const psibase::Consensus& init);
   ~StaticDatabase();
   operator psibase::SystemContext*();
};

#ifndef __AFL_FUZZ_TESTCASE_LEN
#include <iostream>

#define __AFL_FUZZ_INIT()              \
   namespace                           \
   {                                   \
      std::size_t   fuzz_len;          \
      unsigned char fuzz_buf[1024000]; \
   }  // namespace
#define __AFL_FUZZ_TESTCASE_LEN ::fuzz_len
#define __AFL_FUZZ_TESTCASE_BUF ::fuzz_buf
#define __AFL_LOOP(x) \
   (fuzz_len = (std::cin.read((char*)::fuzz_buf, sizeof(::fuzz_buf)), std::cin.gcount()))
#endif

void handleArgs(int argc, const char** argv);
