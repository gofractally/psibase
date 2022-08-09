#pragma once

#include <psibase/block.hpp>
#include <psibase/db.hpp>
#include <psibase/BlockContext.hpp>
#include <iostream>

namespace psibase
{

   struct ExtendedBlockId
   {
      Checksum256 _id;
      BlockNum _num;
      Checksum256 id() const { return _id; }
      BlockNum num() const { return _num; }
      friend bool operator==(const ExtendedBlockId&, const ExtendedBlockId&) = default;
   };
   PSIO_REFLECT(ExtendedBlockId, _id, _num)

   struct BlockHeaderState
   {
      BlockInfo info;
      ConstRevisionPtr revision;
      BlockHeaderState() : info() { info.header.blockNum = 1; }
      BlockHeaderState(const BlockHeaderState& prev, const BlockInfo& info, ConstRevisionPtr revision = nullptr) : info(info), revision(revision) {}
      auto order() const { return std::tuple(info.header.term, info.header.blockNum, info.blockId); }
      BlockNum blockNum() const { return info.header.blockNum; }
      const Checksum256& blockId() const { return info.blockId; }
      ExtendedBlockId xid() const { return ExtendedBlockId{blockId(), blockNum()}; }
   };

   class ForkDb
   {
   public:
      using id_type = Checksum256;
      ForkDb()
      {
         states.emplace();
         head = &states.begin()->second;
         byBlocknumIndex.insert({head->blockNum(), head->blockId()});
      }
      bool insert(const SignedBlock& b)
      {
         BlockInfo info(b.block);
         if(b.block.header.blockNum <= commitIndex)
         {
            return false;
         }
         if(!blocks.try_emplace(info.blockId, b).second)
         {
            return false;
         }
         if(auto* prev = get_state(b.block.header.previous))
         {
            auto [pos, inserted] = states.try_emplace(info.blockId, *prev, info);
            assert(inserted);
            byOrderIndex.insert({pos->second.order(), info.blockId});
            return true;
         }
         return false;
      }
      BlockHeader* get_head() const
      {
         return &head->info.header;
      }
      const BlockHeaderState* get_head_state() const
      {
         return head;
      }
      const SignedBlock* get(const id_type& id) const
      {
         auto pos = blocks.find(id);
         if(pos != blocks.end())
         {
            return &pos->second;
         }
         else
         {
            return nullptr;
         }
      }
      Checksum256 get_block_id(BlockNum num) const
      {
         auto iter = byBlocknumIndex.find(num);
         if(iter != byBlocknumIndex.end())
         {
            return iter->second;
         }
         else
         {
            return {};
         }
      }
      const SignedBlock* get_block_by_num(BlockNum num) const
      {
         auto iter = byBlocknumIndex.find(num);
         if(iter != byBlocknumIndex.end())
         {
            return get(iter->second);
         }
         else
         {
            return nullptr;
         }
      }
      template<typename F>
      void async_switch_fork(F&& callback)
      {
         // Don't switch if we are currently building a block...
         // FIXME: This means that we need to switch if a block is aborted
         if(blockContext) return;
         auto pos = byOrderIndex.end();
         --pos;
         auto new_head = get_state(pos->second);
         if(head != new_head)
         {
            for(auto i = new_head->blockNum() + 1; i <= head->blockNum(); ++i)
            {
               // TODO: this should not be an assert, because it depends on other nodes behaving correctly
               assert(i > commitIndex);
               byBlocknumIndex.erase(i);
            }
            auto id = new_head->blockId();
            for(auto i = new_head->blockNum(); i > head->blockNum(); --i)
            {
               byBlocknumIndex.insert({i, id});
               id = get_prev_id(id);
            }
            for(auto iter = byBlocknumIndex.upper_bound(std::min(new_head->blockNum(), head->blockNum())), begin = byBlocknumIndex.begin(); iter != begin;)
            {
               --iter;
               if(iter->second == id)
               {
                  execute_fork(iter, byBlocknumIndex.end());
                  break;
               }
               assert(iter->first > commitIndex);
               iter->second = id;
               id = get_prev_id(id);
            }
            head = new_head;
            callback(&head->info.header);
         }
      }
      void execute_fork(auto iter, auto end)
      {
         if(iter != end)
         {
            auto* state = get_state(iter->second);
            assert(state->revision);
            ++iter;
            for(; iter != end; ++iter)
            {
               auto* block = get(iter->second);
               auto* next_state = get_state(iter->second);
               if(!next_state->revision)
               {
                  BlockContext ctx(*systemContext, state->revision, writer, true);
                  ctx.start(Block{get(next_state->blockId())->block});
                  ctx.execAllInBlock();
                  auto [newRevision,id] = ctx.writeRevision();
                  // TODO: verify block id here?
                  // TODO: handle other errors and blacklist the block and its descendants
                  next_state->revision = newRevision;
               }
               state = next_state;
            }
         }
      }
      BlockHeaderState* get_state(const id_type& id)
      {
         auto pos = states.find(id);
         if(pos != states.end())
         {
            return &pos->second;
         }
         else
         {
            return nullptr;
         }
      }
      bool is_complete_chain(const id_type& id)
      {
         return get_state(id) != nullptr;
      }
      void commit(BlockNum num)
      {
         commitIndex = std::max(std::min(num, head->blockNum()), commitIndex);
         systemContext->sharedDatabase.removeRevisions(*writer, byBlocknumIndex.find(num)->second);
      }

      auto get_prev_id(const id_type& id)
      {
         return get(id)->block.header.previous;
      }
      template<typename T>
      T get_prev_id(const T& t)
      {
         return T{get_prev_id(t.id()), t.num() - 1};
      }
      auto commit_index() const
      {
         return commitIndex;
      }
      id_type get_ancestor(id_type id, auto n)
      {
         for(; n > 0; --n)
         {
            id = get_prev_id(id);
         }
         return id;
      }
      template<typename T>
      T get_common_ancestor(const T& t)
      {
         auto iter = byBlocknumIndex.find(t.num());
         auto id = t.id();
         if(iter == byBlocknumIndex.end())
         {
            --iter;
            if(iter->first < t.num())
            {
               id = get_ancestor(id, t.num() - iter->first);
            }
            else
            {
               throw std::runtime_error("unknown block number");
            }
         }
         while(true)
         {
            if(iter->second == id)
            {
               return {iter->second, iter->first};
            }
            else
            {
               if(iter == byBlocknumIndex.begin())
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
      template<typename T>
      bool in_best_chain(const T& t)
      {
         auto iter = byBlocknumIndex.find(t.num());
         return iter != byBlocknumIndex.end() && iter->second == t.id();
      }

      // Block production:
      template<typename... A>
      void start_block(A&&... a)
      {
         //assert(!blockContext);
         blockContext.emplace(*systemContext, head->revision, writer, true);
         blockContext->start(std::forward<A>(a)...);
         blockContext->callStartBlock();
      }
      void abort_block()
      {
         assert(!!blockContext);
         blockContext.reset();
      }
      BlockHeaderState* finish_block()
      {
         assert(!!blockContext);
         if(blockContext->needGenesisAction)
         {
            abort_block();
            return nullptr;
         }
         auto block = blockContext->current;
         auto [revision, id] = blockContext->writeRevision();
         systemContext->sharedDatabase.setHead(*writer, revision);
         assert(head->blockId() == block.header.previous);
         auto [iter, _] = blocks.try_emplace(id, SignedBlock{block});
         // TODO: don't recompute sha
         BlockInfo info{iter->second.block};
         auto [state_iter, ins2] = states.try_emplace(iter->first, *head, info, revision);
         byOrderIndex.insert({state_iter->second.order(), id});
         head = &state_iter->second;
         byBlocknumIndex.insert({head->blockNum(), head->blockId()});
         std::cout << psio::convert_to_json(blockContext->current.header) << "\n";
         return head;
      }

      bool isProducing() const { return !!blockContext; }

      void setBlockContext(SystemContext* sc, WriterPtr writer)
      {
         systemContext = sc;
         this->writer = std::move(writer);
         head->revision = systemContext->sharedDatabase.getHead();
         // TODO: set up initial state
      }
      BlockContext* getBlockContext()
      {
         if(blockContext)
         {
            return &*blockContext;
         }
         else
         {
            return nullptr;
         }
      }
      ConstRevisionPtr getHeadRevision()
      {
         return head->revision;
      }

   private:
      std::optional<BlockContext> blockContext;
      SystemContext* systemContext = nullptr;
      WriterPtr writer;
      BlockNum commitIndex = 1;
      BlockHeaderState* head = nullptr;
      std::map<Checksum256, SignedBlock> blocks;
      std::map<Checksum256, BlockHeaderState> states;

      std::map<decltype(std::declval<BlockHeaderState>().order()), Checksum256> byOrderIndex;
      std::map<BlockNum, Checksum256> byBlocknumIndex;
   };
}
