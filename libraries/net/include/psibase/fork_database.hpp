#pragma once

#include <cassert>
#include <optional>
#include <deque>
#include <ranges>

namespace psibase
{
   enum class insert_result {
       success,
       buffered,
       duplicate,
       rejected
   };
   // Key questions:
   // - does the block include a block number
   //   If it does not, then we can only maintain bounded or time limited storage for buffering unlinked blocks
   //   More generally, unlinked blocks can be supported provided there is a reliable way to detect
   //   that an unlinked block is incompatible with the last irreversible block.
   template<typename Block, typename BlockState, typename Storage>
   struct fork_database
   {
      using id_type = decltype(Block::id);
      using BlockBuilder = BlockState::builder_type;
      // index id -> block (primary)
      //
      // index id -> header state
      // index by block order (complete chains only)
      // index by predecessor (uncommitted blocks only)
      // index by block_num (current chain only)

      fork_database()
      {
         _states.emplace();
         _head = &_states.begin()->second;
         _by_blocknum_idx.insert({_head->num, _head->id});
      }
 
      // returns true if the best block might have changed
      // four possible outcomes:
      // - duplicate
      // - rejected
      // - added
      // - buffered
      // A truncated block log cannot necessarily distinguish between duplicate and rejected.
      insert_result insert(const Block& b)
      {
         // TODO: abstract this test
         if(b.num <= _commit_index)
         {
            // temporarily disabled for testing only
            //return insert_result::rejected;
         }
         if(!_blocks.try_emplace(b.id, b).second)
         {
            return insert_result::duplicate;
         }
         if(auto* prev = get_state(b.prev))
         {
            auto [pos, inserted] = _states.try_emplace(b.id, *prev, b);
            assert(inserted);
            _by_order_idx.insert({pos->second.order(), b.id});
            link_successors(pos);
            return insert_result::success;
         }
         else
         {
            auto [pos, inserted] = _by_predecessor_idx.emplace(std::tie(b.prev, b.id), b.id);
            return insert_result::buffered;
         }
      }
      void link_successors(auto pos)
      {
         std::deque queue = {pos};
         while(!queue.empty())
         {
            for(auto [_, id] : successors(queue.front()->first))
            {
               auto block = _blocks.find(id);
               auto [next, inserted] = _states.try_emplace(id, queue.front()->second, block->second);
               _by_order_idx.emplace(next->second.order(), id);
               queue.push_back(next);
            }
            queue.pop_front();
         }
      }
      Block* get_head() const
      {
         return _head;
      }
      const BlockState* get_head_state() const
      {
         return _head;
      }
      const Block* get(const id_type& id) const
      {
         auto pos = _blocks.find(id);
         if(pos != _blocks.end())
         {
            return &pos->second;
         }
         else
         {
            return nullptr;
         }
      }
      const Block* get_block_by_num(decltype(Block::num) num) const
      {
         auto iter = _by_blocknum_idx.find(num);
         if(iter != _by_blocknum_idx.end())
         {
            return get(iter->second);
         }
         else
         {
            return nullptr;
         }
      }
      // \pre id does not refer to a complete chain
      id_type get_missing_ancestor(id_type id) const
      {
         while(true)
         {
            auto pos = _blocks.find(id);
            if(pos == _blocks.end())
            {
               return id;
            }
            else
            {
               id = pos->second.prev;
            }
         }
      }
      template<typename F>
      void async_switch_fork(F&& callback)
      {
         // Don't switch if we are currently building a block...
         if(_current_block) return;
         auto pos = _by_order_idx.end();
         --pos;
         auto new_head = get_state(pos->second);
         if(_head != new_head)
         {
            for(auto i = new_head->num + 1; i <= _head->num; ++i)
            {
               // TODO: this should not be an assert, because it depends on other nodes behaving correctly
               assert(i > _commit_index);
               _by_blocknum_idx.erase(i);
            }
            auto id = new_head->id;
            for(auto i = new_head->num; i > _head->num; --i)
            {
               _by_blocknum_idx.insert({i, id});
               id = get_prev_id(id);
            }
            for(auto iter = _by_blocknum_idx.upper_bound(std::min(new_head->num, _head->num)), begin = _by_blocknum_idx.begin(); iter != begin;)
            {
               --iter;
               if(iter->second == id)
               {
                  break;
               }
               assert(iter->first > _commit_index);
               iter->second = id;
               id = get_prev_id(id);
            }
            _head = new_head;
            callback(_head);
         }
      }
      BlockState* get_state(const id_type& id)
      {
         auto pos = _states.find(id);
         if(pos != _states.end())
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
      template<typename... A>
      void start_block(A&&... a)
      {
         _current_block = _head->next(std::forward<A>(a)...);
      }
      template<typename T>
      void push_transaction(const T&) {}
      void abort_block()
      {
         _current_block = std::nullopt;
      }
      BlockState* finish_block()
      {
         auto block = std::move(*_current_block).finish();
         assert(_head->id == block.prev);
         _current_block = std::nullopt;
         auto [iter, _] = _blocks.try_emplace(block.id, block);
         auto [state_iter, ins2] = _states.try_emplace(iter->first, *_head, iter->second);
         _by_order_idx.insert({state_iter->second.order(), state_iter->second.id});
         link_successors(state_iter);
         _head = &state_iter->second;
         _by_blocknum_idx.insert({_head->num, _head->id});
         return _head;
      }
      // Removes a block and all successors
      void remove(const id_type& id);
      //
      void commit(decltype(Block::num) num)
      {
         _commit_index = std::max(std::min(num, _head->num), _commit_index);
      }
#if 0
      void commit(const id_type& id)
      {
         // The block must be a complete chain
         // look up block by id
         // find previous id
         // erase complete chain index
         // add to block number index
         if(auto header = get(id))
         {
            _commit_index = header->num;
         }
      }
#endif
      auto get_prev_id(const id_type& id)
      {
         return get(id)->prev;
      }
      template<typename T>
      T get_prev_id(const T& t)
      {
         return T{get(t.id())->prev, t.num() - 1};
      }
      auto commit_index() const
      {
         return _commit_index;
      }
      auto successors(const id_type& id)
      {
         auto [b,e] =  _by_predecessor_idx.equal_range(id);
         return std::ranges::subrange(b, e);
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
         auto iter = _by_blocknum_idx.find(t.num());
         auto id = t.id();
         if(iter == _by_blocknum_idx.end())
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
               if(iter == _by_blocknum_idx.begin())
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
         auto iter = _by_blocknum_idx.find(t.num());
         return iter != _by_blocknum_idx.end() && iter->second == t.id();
      }
      typename Storage::template index<id_type, Block> _blocks;
      typename Storage::template index<id_type, BlockState> _states;
      typename Storage::template index<decltype(std::declval<BlockState>().order()), id_type> _by_order_idx;
      typename Storage::template index<std::tuple<id_type, id_type>, id_type> _by_predecessor_idx;
      // invariant: the keys are contiguous integers
      typename Storage::template index<decltype(BlockState::num), id_type> _by_blocknum_idx;
      BlockState* _head = nullptr;
      decltype(Block::num) _commit_index = 0;
      // TODO: this doesn't belong here
      std::optional<BlockBuilder> _current_block;
   };
}
