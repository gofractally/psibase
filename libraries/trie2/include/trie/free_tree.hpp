#pragma once
#include <trie/arena.hpp>

namespace trie
{
   struct free_node;

   /**
    *  Allocates positions in an array using a circular
    *  buffer that advances forward and then wraps around
    *  filling in gaps that have been freed since allocated. This
    *  strategy will tend to cluster writes around the cursor
    *  and tend to move infrequently freed objects to the front as
    *  the frequently reallocated objects tend to move toward
    *  cursor
    */
   class free_tree
   {
     public:
      uint64_t capacity() const { return _capacity; }
      uint64_t used() const { return _used; }
      uint64_t available() const { return _capacity - _used; }

      /* if cap < max alloced position, returns max alloced position
       * rounded up to the nearest multiple of 64
       */
      uint64_t reserve(uint64_t cap);

      /**
       *  alloc at next cursor position,
       *  if cursor abs_pos >= 2x use or capacity() then
       *  go back to the first free position
       *
       *  @return -1 if full
       */
      uint64_t alloc();
      void     free(uint64_t p);

     private:
      friend class arena;
      free_tree(uint64_t capacity = 64);
      free_tree(free_node&& mv);

      uint32_t              _cursor_height = 0;  // log64(capacity), (64-countl_zero(cap))/6?
      offset_ptr<free_node> _cursor_path[6];
      uint8_t               _cursor_branch[6];
      uint64_t              _cursor_abs_position = 0;

      uint64_t                     _capacity;
      uint64_t                     _used;
      arena::unique_ptr<free_node> _root;
   };
}  // namespace trie

#if 0
class free_tree
{
  public:
   static free_tree* make(arena& a, uint64_t max_bits);
   free_tree&        operator=(const free_tree& other);

   int64_t alloc()
   {
      if (use == capacity)
         return -1;
      ++use;
      return alloc(first_leaf + head_index, 1, 0);
   }

   void free(uint64_t pos)
   {
      free(pos, root, capacity);
      --use;
   }

  private:
   uint64_t empty_tail()
   {
      auto et = capacity;
      while (et)
      {
         auto n = et / 64;
         if (not n)
            return 64 - et % 64;
         et = n;
      }
   }

   free_tree(uint64_t max_bits)
   {
      capacity             = max_bits;
      use                  = 0;
      uint64_t num_leafs   = (max_bits + 63 / 64);
      auto     num_parents = (num_leafs + 63) / 64;
   }

   int64_t alloc(uint64_t* row, uint32_t row_size, uint32_t row_pos, bool& full)
   {
      auto ap = std::countl_one(row[row_pos]);
      if (row == first_leaf)
      {
         row[row_pos] |= (1ull << ap);
         full = (row[row_pos] == -1ull);
         return 64 * row_pos + ap;
      }
      bool child_full = false;
      auto result     = alloc(row - row_size * 64, row_size * 64, row_pos * 64 + ap, child_full)
          row[row_pos] |= (uint64_t(child_full) << ap);
      return result;
   }

   void free(uint64_t pos, uint64_t* row, uint32_t row_size, uint32_t et)
   {
      const auto leaf_idx   = pos / 64;
      const auto bit        = leaf % 64;
      auto&      leaf       = row[leaf_idx];
      const bool first_free = leaf == -1ull;
      row[leaf] &= ~(1ull << bit);
      if (first_free and row_size > 1)
         free(leaf_idx, row + row_size - et, row_size / 64, et / 64);
   }

   constexpr static uint64_t tree_size(uint64_t max_bits)
   {
      uint64_t leafs = max_bits / 64;
      return leafs ? leafs + tree_size(leafs) : 0;
   }
   uint64_t* free_cursor = nullptr;
   uint64_t  capacity    = 0;
   uint64_t  use         = 0;
   uint64_t  head_index  = 0;
   uint32_t  level_sizes[7];
   uint32_t  level_positions[7];
   uint64_t  bits[1];
};
}
;  // namespace trie
#endif
