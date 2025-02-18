#pragma once
#include <arbtrie/concepts.hpp>
#include <arbtrie/debug.hpp>
#include <arbtrie/inner_node.hpp>
#include <concepts>

namespace arbtrie
{

   /**
    *  Setlist Node - A node implementation that stores branches in a sorted list.
    *  This type must satisfy inner_node_concept to ensure it provides all required
    *  functionality for inner nodes in the tree.
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
    *  uint64_t    descendants:48 :e // total values under this one
    *  uint64_t    spare_capacity:8
    *  uint64_t    prefix_trunc:8
    *  uint8_t     prefix[_prefix_len]
    *  uint8_t     setlist[head.num_branches-head.has_eof]
    *  uint8_t     sparesetlist[spare_capacity]
    *  id_address   branches[head.num_branches]
    *  id_address   spareids[spare_capacity]
    */

   struct setlist_node : inner_node<setlist_node>
   {
      static const node_type type = node_type::setlist;
      using node_header::get_type;

      // the data between tail() and end of prefix capacity
      uint16_t branch_data_cap() const
      {
         return (_nsize - sizeof(setlist_node) - prefix_capacity());
      }
      // the max number of branches
      uint8_t        branch_capacity() const { return branch_data_cap() / (1 + sizeof(id_index)); }
      uint8_t*       get_setlist_ptr() { return end_prefix(); }
      const uint8_t* get_setlist_ptr() const { return end_prefix(); }
      int            get_setlist_size() const { return num_branches(); }
      key_view       get_setlist() const { return to_key(get_setlist_ptr(), get_setlist_size()); }

      id_index*       get_branch_ptr() { return ((id_index*)tail()) - branch_capacity(); }
      const id_index* get_branch_ptr() const
      {
         return ((const id_index*)tail()) - branch_capacity();
      }
      const id_index* get_branch_end_ptr() const
      {
         return ((id_index*)tail()) - branch_capacity() + num_branches();
      }

      // node concept
      ///@{
      //key_view      get_prefix() const { return to_key(key_ptr(), _ksize); }
      search_result get_branch(key_view k) const
      {
         throw std::runtime_error("setlist_node::get_branch: not implemented");
         return search_result::end();
      }
      search_result lower_bound(key_view k) const
      {
         throw std::runtime_error("setlist_node::get_branch: not implemented");
         return search_result::end();
      }

      // Required functions for is_node_header_derived concept
      local_index next_index(local_index index) const
      {
         assert(index >= begin_index() or index < end_index());
         return ++index;
      }

      local_index prev_index(local_index index) const
      {
         assert(index <= end_index() or index > begin_index());
         return --index;
      }

      key_view get_branch_key(local_index index) const
      {
         assert(index <= end_index() or index > begin_index());

         // key_size is 1 when:
         // 1. index > 0 (not the EOF value)
         // 2. OR when index == 0 but there is no EOF value
         // In other words, key_size is 1 for all branch indices except EOF value
         const bool key_size = !(bool(index.to_int() == 0) and has_eof_value());
         return key_view((const char*)get_setlist_ptr() + index.to_int() - has_eof_value(),
                         key_size);
      }

      constexpr local_index begin_index() const { return local_index(-1); }
      constexpr local_index end_index() const
      {
         return local_index(num_branches() + has_eof_value());
      }

      local_index get_branch_index(key_view k) const
      {
         if (k.empty())
         {
            if (has_eof_value())
               return local_index(0);
            return end_index();
         }
         auto pos = get_setlist().find(k.front());
         if (pos == key_view::npos)
            return end_index();
         return local_index(pos + has_eof_value());
      }

      // TODO impliment thse on inner_node instead of setlist and full
      bool              has_value() const { return has_eof_value(); }
      value_type        value() const { return get_eof_value(); }
      value_type::types get_value_type() const
      {
         if (is_eof_subtree())
            return value_type::types::subtree;
         return value_type::types::value_node;
      }
      value_type::types get_type(local_index index) const
      {
         if (has_eof_value() and index == local_index(0))
            return get_value_type();
         return value_type::types::value_node;
      }
      value_type get_value(local_index index) const
      {
         //std::cerr << "setlist_node::get_value: index: " << index.to_int() << std::endl;
         if (has_eof_value() and index == local_index(0)) [[unlikely]]
            return value();
         auto branch_idx = get_branch_ptr()[index.to_int() - has_eof_value()];
         return value_type::make_value_node(id_address(branch_region(), branch_idx));
      }
      ///@}

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

      bool          can_add_branch() const { return num_branches() < branch_capacity(); }
      setlist_node& add_branch(branch_index_type br, id_address b);

      void set_index(int idx, uint8_t byte, id_address adr)
      {
         assert(idx < _num_branches);
         assert(adr.region() == branch_region());
         assert((char*)(get_branch_ptr() + idx) < tail());
         get_branch_ptr()[idx]  = id_index(adr.index().to_int());
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
               //TRIEDENT_DEBUG( "last: ", int(last), " < ", int(uint8_t(sl[i])) );
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
         auto    sle = slp + num_branches();

         while (slp != sle)
         {
            if (uint8_t(*slp) >= uint8_t(br2))
               return slp - sl;
            ++slp;
         }
         return slp - sl;
      }
      // find the position of the first branch <= br
      int_fast16_t reverse_lower_bound_idx(uint_fast16_t br) const
      {
         assert(br > 0 and br <= 256);
         uint8_t    br2 = br - 1;
         const auto sl  = get_setlist_ptr();
         const auto sle = sl + num_branches();
         auto       slp = sle - 1;

         while (slp >= sl)
         {
            if (uint8_t(*slp) <= uint8_t(br2))
            {
               return slp - sl;
            }
            --slp;
         }
         return slp - sl;
      }

      std::pair<branch_index_type, id_address> lower_bound(branch_index_type br) const
      {
         if (br >= max_branch_count) [[unlikely]]
            return std::pair<int_fast16_t, id_address>(max_branch_count, {});
         if (br == 0)
         {
            if (_eof_value)
               return std::pair<int_fast16_t, id_address>(0, _eof_value);
            ++br;
         }

         uint8_t        b = br - 1;
         const uint8_t* s = (uint8_t*)get_setlist_ptr();
         const auto*    e = s + get_setlist_size();

         const uint8_t* p = s;
         while (p < e and b > *p)
            ++p;
         if (p == e)
            return std::pair<branch_index_type, id_address>(max_branch_count, {});
         return std::pair<branch_index_type, id_address>(
             char_to_branch(*p), {branch_region(), get_branch_ptr()[(p - s)]});
      }

      std::pair<branch_index_type, id_address> reverse_lower_bound(branch_index_type br) const
      {
         if (br == 0)
         {
            if (_eof_value)
               return std::pair<int_fast16_t, id_address>(0, _eof_value);
            return std::pair<int_fast16_t, id_address>(-1, {});
         }

         uint8_t        b = br - 1;
         const uint8_t* s = (uint8_t*)get_setlist_ptr();
         const auto*    e = s + get_setlist_size() - 1;

         const uint8_t* p = e;
         while (p >= s and b < *p)
         {
            --p;
         }
         if (p < s)
         {
            if (_eof_value)
               return std::pair<int_fast16_t, id_address>(0, _eof_value);
            else
               return std::pair<branch_index_type, id_address>(-1, {});
         }
         return std::pair<branch_index_type, id_address>(
             char_to_branch(*p), {branch_region(), get_branch_ptr()[(p - s)]});
      }

      auto& set_branch(branch_index_type br, id_address b)
      {
         assert(br < 257);
         assert(br > 0);
         assert(b);
         assert(b.region() == branch_region());

         auto pos = get_setlist().find(br - 1);
         assert(pos != key_view::npos);
         get_branch_ptr()[pos] = id_index(b.index().to_int());
         return *this;
      }

      id_address get_branch(uint_fast16_t br) const
      {
         assert(br < 257);
         assert(br > 0);

         auto pos = get_setlist().find(br - 1);
         if (pos == key_view::npos)
            return id_address();

         return {branch_region(), get_branch_ptr()[pos]};
      }

      id_address find_branch(uint_fast16_t br) const
      {
         assert(br < 257);
         assert(br > 0);

         auto pos = get_setlist().find(br - 1);
         if (pos == key_view::npos)
            return id_address();

         return {branch_region(), get_branch_ptr()[pos]};
      }

      template <typename Visitor>
         requires requires(Visitor v, id_address addr) { v(addr); }
      inline void visit_branches(Visitor&& visitor) const
      {
         if (has_eof_value())
            visitor(id_address(_eof_value));

         auto*             ptr = get_branch_ptr();
         const auto* const end = ptr + num_branches();
         while (ptr != end)
         {
            visitor(id_address{branch_region(), *ptr});
            ++ptr;
         }
      }

      template <typename Visitor>
         requires requires(Visitor v, branch_index_type br, id_address addr) { v(br, addr); }
      inline void visit_branches_with_br(Visitor&& visitor) const
      {
         const auto*       slp   = get_setlist_ptr();
         const auto*       start = get_branch_ptr();
         const auto* const end   = start + num_branches();
         const auto*       ptr   = start;

         if (has_eof_value())
            visitor(0, id_address(_eof_value));

         while (ptr != end)
         {
            visitor(int(*slp) + 1, id_address(branch_region(), *ptr));
            ++ptr;
            ++slp;
         }
      }

      // @pre has_eof_value() == true
      // branch exists and is set
      auto& remove_branch(int_fast16_t br)
      {
         assert(br > 0);
         assert(num_branches() > 0);
         assert(br < max_branch_count);

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
         return *this;
      }

      inline static int_fast16_t alloc_size(const clone_config& cfg)
      {
         auto min_size = sizeof(setlist_node) + cfg.prefix_capacity() +
                         (cfg.branch_cap) * (sizeof(id_index) + 1);
         return round_up_multiple<64>(min_size);
      }

      inline static int_fast16_t alloc_size(const setlist_node* src, const clone_config& cfg)
      {
         assert(cfg.data_cap == 0);
         assert(src != nullptr);
         assert(cfg.branch_cap < 192);

         auto pcap     = cfg.set_prefix ? cfg.set_prefix->size()
                                        : std::max<int>(cfg.prefix_capacity(), src->prefix_size());
         auto bcap     = std::max<int>(cfg.branch_cap, src->num_branches());
         auto min_size = sizeof(setlist_node) + pcap + (bcap) * (sizeof(id_index) + 1);

         auto asize = round_up_multiple<64>(min_size);

         assert(src->num_branches() <=
                (asize - sizeof(setlist_node) - cfg.prefix_cap) / (1 + sizeof(id_index)));

         return asize;
      }

      setlist_node(int_fast16_t asize, id_address nid, const clone_config& cfg)
          : inner_node(asize, nid, cfg, 0)
      {
      }

      setlist_node(int_fast16_t        asize,
                   id_address          nid,
                   const setlist_node* src,
                   const clone_config& cfg)
          : inner_node(asize, nid, src, cfg)
      {
         assert(src->num_branches() <= branch_capacity());
         assert((char*)get_branch_ptr() + src->num_branches() * sizeof(id_index) <= tail());
         assert((char*)get_setlist_ptr() + src->get_setlist_size() <= tail());

         memcpy(get_setlist_ptr(), src->get_setlist_ptr(), src->get_setlist_size());
         memcpy(get_branch_ptr(), src->get_branch_ptr(), src->num_branches() * sizeof(id_index));

         assert(validate());
      }

   } __attribute((packed));
   static_assert(sizeof(setlist_node) ==
                 sizeof(node_header) + sizeof(uint64_t) + sizeof(id_address));

   inline setlist_node& setlist_node::add_branch(branch_index_type br, id_address b)
   {
      assert(br < max_branch_count);
      assert(br > 0);
      assert(b.region() == branch_region());

      id_index* branches = get_branch_ptr();
      assert(_num_branches <= branch_capacity());

      auto pos = lower_bound_idx(br);

      auto slp = get_setlist_ptr();
      auto blp = get_branch_ptr();

      auto nbranch  = num_branches();
      auto sl_found = slp + pos;
      auto sl_end   = slp + nbranch;

      assert((char*)sl_found + 1 + (sl_end - sl_found) <= tail());
      memmove(sl_found + 1, sl_found, sl_end - sl_found);

      *sl_found = br - 1;

      auto b_found = blp + pos;
      auto b_end   = blp + nbranch;

      assert((char*)b_found + 1 + ((char*)b_end - (char*)b_found) <= tail());
      memmove(b_found + 1, b_found, (char*)b_end - (char*)b_found);

      *b_found = id_index(b.index().to_int());

      ++_num_branches;
      return *this;
   }

}  // namespace arbtrie
