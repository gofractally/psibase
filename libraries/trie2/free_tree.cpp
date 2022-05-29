#include <trie/free_tree.hpp>

namespace trie
{
   struct free_node
   {
      enum state : uint64_t
      {
         all_full  = 0,
         all_empty = 1,
         mixed     = 2
      };

      uint32_t first_free(uint32_t after)
      {
         assert(after < 62);

         auto has_free = mixed_bits | empty_bits;

         has_free &= ~((1ull << (after + 1)) - 1);
         return std::countr_zero(has_free);
      }

      state get(uint32_t pos)
      {
         uint64_t bit = (1ull) << pos;
         if (bit & mixed_bits)
            return state::mixed;
         if (bit & empty_bits)
            return state::all_empty;
         return state::all_full;
      }

      void set_branch(uint32_t pos, arena::unique_ptr<free_node>&& n)
      {
         assert(pos < 64);
         uint64_t bit = (1ull) << pos;
         assert(mixed_bits & bit);
         branches()[branch_index(pos)] = std::move(n);
      }

      auto& branch(uint32_t pos) { return branches()[branch_index(pos)]; }

      static free_node* make(arena&                         a,
                             uint32_t                       pos   = 0,
                             state                          s     = state::all_empty,
                             arena::unique_ptr<free_node>&& child = nullptr);

      static free_node* make(arena&      a,
                             free_node&& mv,
                             uint32_t    pos,
                             state       s,
                             arena::unique_ptr<free_node>&& child = nullptr);

      ~free_node()
      {
         auto nb = std::popcount(mixed_bits);
         auto b  = branches();
         auto e  = b + nb;
         while (b != e)
         {
            b->arena::unique_ptr<free_node>::~unique_ptr();
            ++b;
         }
      }

     private:
      arena::unique_ptr<free_node>* branches()
      {
         return reinterpret_cast<arena::unique_ptr<free_node>*>((&mixed_bits) + 1);
      }
      uint64_t empty_bits;
      uint64_t mixed_bits;

      int branch_index(uint32_t pos)
      {
         assert(pos < 64);
         uint64_t       bit  = (1ull) << pos;
         const uint64_t mask = bit - 1;
         return std::popcount(mixed_bits & mask);
      }

      void set(uint32_t pos, state s)
      {
         uint64_t bit = (1ull) << pos;
         switch (s)
         {
            case state::mixed:
               mixed_bits |= bit;
               empty_bits |= bit;
               break;
            case state::all_empty:
               mixed_bits &= ~bit;
               empty_bits |= bit;
               break;
            case state::all_full:
               mixed_bits &= ~bit;
               empty_bits &= ~bit;
         }
      }
   };

   free_tree::free_tree(uint64_t capacity) : _capacity(capacity), _used(0)
   {
      _root = arena::get_arena(this).construct_unique<free_node>();
   }

   uint64_t free_tree::reserve(uint64_t cap) {
      return 0;
   }

}  // namespace trie
