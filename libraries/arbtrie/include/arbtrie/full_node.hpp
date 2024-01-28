#pragma once
#include <arbtrie/inner_node.hpp>

namespace arbtrie
{
   /**
    *  Full Node - has one branch for all possible branches and eof stored
    *  as a 3 byte index under a common region
    */
   struct full_node : inner_node<full_node>
   {
      static constexpr const int_fast16_t branch_count = 256;
      static const node_type    type         = node_type::full;

      static int_fast16_t alloc_size(const clone_config& cfg)
      {
         return round_up_multiple<64>(sizeof(full_node) + cfg.prefix_capacity() + (branch_count*sizeof(id_index)));
      }
      static int_fast16_t alloc_size(const full_node* src, const clone_config& cfg)
      {
         auto min_pre  = cfg.set_prefix ? cfg.set_prefix->size() : src->prefix_size();
         min_pre       = std::max<int>(min_pre, cfg.prefix_cap);
         auto min_size = sizeof(setlist_node) + min_pre + (branch_count* sizeof(id_index));
         return round_up_multiple<64>(min_size);
      }

      full_node(int_fast16_t asize, fast_meta_address nid, const full_node* src, const clone_config& cfg)
          : inner_node<full_node>(asize, nid, src, cfg)
      {
         _prefix_capacity = asize - sizeof(inner_node<full_node>) - branch_count* sizeof(id_index);
         memcpy(branches(), src->branches(), branch_count* sizeof(id_index));
      }

      full_node(int_fast16_t asize, fast_meta_address nid, const clone_config& cfg)
          : inner_node<full_node>(asize, nid, cfg, 0)
      {
         _prefix_capacity = asize - sizeof(inner_node<full_node>) - branch_count* sizeof(id_index);
         memset(branches(), 0, branch_count* sizeof(id_index));
      }

      bool can_add_branch() const { return num_branches() < max_branch_count; }

      std::pair<branch_index_type, fast_meta_address> lower_bound(branch_index_type br) const
      {
         if (br == 0)
         {
            if (has_eof_value())
               return {0, _eof_value};
            ++br;
         }

         auto       beg = branches();
         auto       ptr = beg + br - 1;
         const auto end = beg + branch_count;
         assert( (const uint8_t*)end == tail() );

         while (ptr < end)
         {
            if (*ptr) {
               return {1 + (ptr - beg), fast_meta_address(branch_region(), *ptr)};
            }
            ++ptr;
         }
         return {max_branch_count, {}};
      }

      void add_branch(branch_index_type br, fast_meta_address b)
      {
         assert(br < max_branch_count);
         assert(br > 0);
         assert(not branches()[br-1]);
         assert(b.region == branch_region());
         assert(_num_branches < max_branch_count);

         ++_num_branches;
         auto& idx = branches()[br - 1];
         idx.index = b.index;
      }

      void remove_branch(branch_index_type br)
      {
         assert(br < max_branch_count);
         assert(br > 0);
         assert(get_branch(br));
         assert(_num_branches > 0);

         --_num_branches;
         branches()[br - 1] = {};
      }

      void set_branch(branch_index_type br, fast_meta_address b)
      {
         assert(br < max_branch_count);
         assert(br > 0);
         assert(get_branch(br));
         assert(b.region == branch_region());

         auto& idx = branches()[br - 1];
         idx.index = b.index;
      }

      fast_meta_address get_branch(branch_index_type br) const
      {
         assert(br < max_branch_count);
         assert(br > 0);

         //if (br == 0) return _eof_value;
         return fast_meta_address(branch_region(), branch(br - 1));
      }

      inline void visit_branches( std::invocable<fast_meta_address> auto&& visitor) const
      {
         if (has_eof_value())
            visitor(_eof_value);

         const auto region = branch_region();
         for (int i = 0; i < branch_count; ++i)
         {
            if (auto b = branch(i))
               visitor(fast_meta_address(region, b));
         }
      }

      inline void visit_branches_with_br(
          std::invocable<branch_index_type, fast_meta_address> auto&& visitor) const
      {
         if (has_eof_value())
            visitor(0, _eof_value);

         const auto region = branch_region();
         for (branch_index_type i = 0; i < branch_count;)
         {
            if (auto b = branch(i))
               visitor(++i, fast_meta_address(region, b));
            else ++i;
         }
      }

      uint32_t calculate_checksum() const
      {
         return XXH3_64bits(((const char*)this) + sizeof(checksum), _nsize - sizeof(checksum));
      }

     //private:
      id_index*       branches() { return ((id_index*)tail()) - branch_count; }
      const id_index* branches()const { return ((const id_index*)tail()) - branch_count; }
      id_index        branch(int i) const { return branches()[i]; }

   } __attribute((packed));

}  // namespace arbtrie
