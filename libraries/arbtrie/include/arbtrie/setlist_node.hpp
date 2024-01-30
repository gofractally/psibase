#pragma once
#include <arbtrie/debug.hpp>
#include <arbtrie/inner_node.hpp>

#undef NDEBUG
#include <assert.h>
namespace arbtrie
{

   /**
    *  Setlist Node - maintains a list of the set branches
    *
    *  - break even storage with full node is 206 elements
    *  - break even storage with a bitset node is 32 elements
    *  - always more effecient with storage than index node
    *
    *  - can hold up to 257 elements in a less effecient manner than
    *  full node
    *
    *  - log(n) time for get/update
    *  - log(n) time for lower bound 
    *
    *  notional data layout
    *  --------------------
    *  node_header head
    *  uint64_t    descendants:48  // total values under this one
    *  uint64_t    spare_capacity:8
    *  uint64_t    prefix_trunc:8
    *  uint8_t     prefix[_prefix_len]
    *  uint8_t     setlist[head.num_branches-head.has_eof]
    *  uint8_t     sparesetlist[spare_capacity]
    *  object_id   branches[head.num_branches]
    *  object_id   spareids[spare_capacity]
    */

   struct setlist_node : inner_node<setlist_node>
   {
      static const node_type type = node_type::setlist;

      // the data between tail() and end of prefix capacity
      uint16_t branch_data_cap() const
      {
         return (_nsize - sizeof(setlist_node) - prefix_capacity());
      }
      // the max number of branches
      uint8_t branch_capacity() const { return branch_data_cap() / (1 + sizeof(id_index)); }

      // uint8_t             prefix[prefix_capacity()]
      // uint8_t             setlist[num_branches() - has_eof_value() ]
      // uint8_t             setlist[branch_capacity() - num_branches() - has_eof_value()]
      // uint8_t             unused[varries]
      // id_index            branches[num_branches()-1]
      // id_index            branches[branch_capacity() - num_branches() - 1 ]

      uint32_t calculate_checksum() const
      {
         return XXH3_64bits(((const char*)this) + sizeof(checksum), _nsize - sizeof(checksum));
      }

      uint8_t*       get_setlist_ptr() { return end_prefix(); }
      const uint8_t* get_setlist_ptr() const { return end_prefix(); }
      int            get_setlist_size() const { return num_branches(); }
      key_view       get_setlist() const
      {
         return key_view((const char*)get_setlist_ptr(), get_setlist_size());
      }

      id_index*       get_branch_ptr() { return ((id_index*)tail()) - branch_capacity(); }
      const id_index* get_branch_ptr() const
      {
         return ((const id_index*)tail()) - branch_capacity();
      }
      const id_index* get_branch_end_ptr() const
      {
         return ((id_index*)tail()) - branch_capacity() + num_branches() - has_eof_value();
      }

      bool can_add_branch() const { return (num_branches() - has_eof_value()) < branch_capacity(); }
      void add_branch(branch_index_type br, fast_meta_address b);

      void set_index(int idx, uint8_t byte, fast_meta_address adr)
      {
         assert(idx < _num_branches);
         assert(adr.region == branch_region());
         assert( (char*)(get_branch_ptr()+idx) < tail() );
         get_branch_ptr()[idx]  = adr.index;
         get_setlist_ptr()[idx] = byte;
      }

      bool validate() const
      {
         auto sl = get_setlist();
         if (sl.size())
         {
            uint8_t last = sl.front();
            for (int i = 1; i < sl.size(); ++i)
            {
               if (uint8_t(sl[i]) <= last)
               {
                  assert(!"order invalid");
                  throw std::runtime_error("order invalid");
               }
               last = sl[i];
            }
         }
         return true;
      }

      // find the position of the first branch >= br
      int_fast16_t lower_bound_idx(uint_fast16_t br) const
      {
         assert(br > 0 and br <= 256);
         uint8_t br2 = br - 1;
         auto    sl  = get_setlist_ptr();
         auto    slp = sl;
         auto    sle = slp + num_branches() - has_eof_value();
         //        std::cerr << "sle - slp: " << sle-slp <<"\n";
         while (slp != sle)
         {
            if (uint8_t(*slp) >= uint8_t(br2))
            {
               return slp - sl;
            }
            ++slp;
         }
         //       std::cerr << "lsp- sl: " << slp-sl <<"\n";
         return slp - sl;
      }

      std::pair<branch_index_type, fast_meta_address> lower_bound(branch_index_type br) const
      {
         if (br >= max_branch_count) [[unlikely]]
            return std::pair<int_fast16_t, fast_meta_address>(max_branch_count, {});
         if (br == 0) 
         {
            if (_eof_value)
               return std::pair<int_fast16_t, fast_meta_address>(0, _eof_value);
            ++br;
         }

         uint8_t        b = br - 1;
         const uint8_t* s = get_setlist_ptr();
         const auto*    e = s + get_setlist_size();

         const uint8_t* p = s;
         while (p < e and b > *p)
            ++p;
         if (p == e)
            return std::pair<branch_index_type, fast_meta_address>(max_branch_count, {});
         return std::pair<branch_index_type, fast_meta_address>(
             char_to_branch(*p), {branch_region(), get_branch_ptr()[(p - s) + bool(_eof_value)]});
      }

      void set_branch(branch_index_type br, fast_meta_address b)
      {
         assert(br < 257);
         assert(not(br == 0 and not bool(_eof_value)));
         assert(b);
         assert(b.region == branch_region());

         if (br == 0) [[unlikely]]
            return set_eof(b);

         auto pos = get_setlist().find(br - 1);
         assert(pos != key_view::npos);
         get_branch_ptr()[pos].index = b.index;
      }

      fast_meta_address get_branch(uint_fast16_t br) const
      {
         assert(br < 257);

         if (br == 0) [[unlikely]]
            return _eof_value;

         auto pos = get_setlist().find(br - 1);
         if (pos == key_view::npos)
            return fast_meta_address();

         return {branch_region(), get_branch_ptr()[pos]};
      }

      inline void visit_branches( std::invocable<fast_meta_address> auto&& visitor) const
      {
         const bool has_eof = has_eof_value();

         if (has_eof)
            visitor(fast_meta_address(_eof_value));

         auto*             ptr = get_branch_ptr();
         const auto* const end = ptr + num_branches() - has_eof;
         while (ptr != end)
         {
            visitor(fast_meta_address{branch_region(), *ptr});
            ++ptr;
         }
      }

      inline void visit_branches_with_br(
          std::invocable<branch_index_type, fast_meta_address> auto&& visitor) const
      {
         const bool        has_eof = has_eof_value();
         const auto*       slp     = get_setlist_ptr();
         const auto*       start   = get_branch_ptr();
         const auto* const end     = start + num_branches() - has_eof;
         const auto*       ptr     = start;

         if (has_eof)
            visitor(0, fast_meta_address(_eof_value));

         while (ptr != end)
         {
            //visitor(int(slp[ptr - start]) + 1, fast_meta_address(branch_region(), *ptr));
            visitor(int(*slp) + 1, fast_meta_address(branch_region(), *ptr));
            ++ptr;
            ++slp;
         }
      }

      // @pre has_eof_value() == true
      // branch exists and is set
      void remove_branch(int_fast16_t br)
      {
         assert(num_branches() > 1);  // cannot remove the last branch
         assert(br < max_branch_count);
         assert(br >= 0);

         if (br == 0)
         {
            assert(has_eof_value());
            set_eof(id_address());
            return;
         }

         uint8_t ch  = uint8_t(br - 1);
         auto    sl  = get_setlist();
         auto    pos = sl.find(ch);

         assert(pos != key_view::npos);

         auto slp    = get_setlist_ptr();
         auto bptr   = get_branch_ptr();
         auto remain = sl.size() - pos - 1;
         auto pos1   = pos + 1;
         memmove(slp + pos, slp + pos1, remain);
         memmove(bptr + pos, bptr + pos1, remain * sizeof(id_index));
         --_num_branches;
      }

      inline static int_fast16_t alloc_size(const clone_config& cfg)
      {
         auto min_size =
             sizeof(setlist_node) + cfg.prefix_cap + (cfg.branch_cap) * (sizeof(id_index) + 1);
         return round_up_multiple<64>(min_size);
      }

      inline static int_fast16_t alloc_size(const setlist_node* src, const clone_config& cfg)
      {
         assert(cfg.data_cap == 0);
         assert(src != nullptr);
         assert(cfg.branch_cap < 192);

         auto pcap     = cfg.set_prefix ? cfg.set_prefix->size()
                                        : std::max<int>(cfg.prefix_cap, src->prefix_size());
         auto bcap     = std::max<int>(cfg.branch_cap, src->num_branches());
         auto min_size = sizeof(setlist_node) + pcap + (bcap) * (sizeof(id_index) + 1);

         auto asize = round_up_multiple<64>(min_size);

         assert(src->num_branches() <=
                (asize - sizeof(setlist_node) - cfg.prefix_cap) / (1 + sizeof(id_index)));

         return asize;
      }

      setlist_node(int_fast16_t asize, fast_meta_address nid, const clone_config& cfg)
          : inner_node(asize, nid, cfg, 0)
      {
      }

      setlist_node(int_fast16_t        asize,
                   fast_meta_address   nid,
                   const setlist_node* src,
                   const clone_config&        cfg)
          : inner_node(asize, nid, src, cfg)
      {
         assert(src->num_branches() <= branch_capacity());
         assert( (char*)get_branch_ptr() + src->num_branches()*sizeof(id_index) <= tail() );
         assert( (char*)get_setlist_ptr() + src->get_setlist_size() <= tail() );

         memcpy(get_setlist_ptr(), src->get_setlist_ptr(), src->get_setlist_size());
         memcpy(get_branch_ptr(), src->get_branch_ptr(), src->num_branches() * sizeof(id_index));

         assert(validate());
      }

   } __attribute((packed));
   static_assert(sizeof(setlist_node) ==
                 sizeof(node_header) + sizeof(uint64_t) + sizeof(id_address));

   inline void setlist_node::add_branch(branch_index_type br, fast_meta_address b)
   {
      assert(br < max_branch_count);
      assert(br >= 0);
      assert(not(br == 0 and _eof_value));
      assert(b.region == branch_region());

      id_index* branches = get_branch_ptr();
      if (br == 0) [[unlikely]]
      {
         set_eof(b);
         return;
      }
      assert(_num_branches < branch_capacity());

      auto pos = lower_bound_idx(br);

      auto slp = get_setlist_ptr();
      auto blp = get_branch_ptr();

      auto nbranch  = num_branches() - has_eof_value();
      auto sl_found = slp + pos;
      auto sl_end   = slp + nbranch;

      assert( (char*)sl_found+1 + (sl_end-sl_found) <= tail() );
      memmove(sl_found + 1, sl_found, sl_end - sl_found);

      *sl_found = br - 1;

      auto b_found = blp + pos;
      auto b_end   = blp + nbranch;

      assert( (char*)b_found+1 + ((char*)b_end-(char*)b_found) <= tail() );
      memmove(b_found + 1, b_found, (char*)b_end - (char*)b_found);

      b_found->index = b.index;

      ++_num_branches;
   }

}  // namespace arbtrie
