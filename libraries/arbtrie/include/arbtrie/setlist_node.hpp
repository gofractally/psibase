#pragma once
#include <arbtrie/debug.hpp>
#include <arbtrie/node_header.hpp>

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

   struct setlist_node : node_header
   {
      static const node_type type = node_type::setlist;
      uint64_t               _descendants : 45;
      uint64_t               _prefix_trunc : 10;
      uint64_t               _spare_capacity : 9;
      uint8_t                _prefix[];
      // uint8_t             setlist[_num_branches - _has_eof_value ]
      // uint8_t             setlist[_spare_capacity]
      // object_id           branches[_num_branches]
      // object_id           branches[_spare_capacity]

      uint32_t calculate_checksum() const
      {
         return XXH3_64bits(((const char*)this) + sizeof(checksum), _nsize - sizeof(checksum));
      }

      uint32_t        prefix_size() const { return prefix_capacity() - _prefix_trunc; }
      inline key_view get_prefix() const { return key_view((char*)_prefix, prefix_size()); }
      inline void     set_prefix(key_view pre)
      {
        // assert(_spare_capacity == 0);
         assert(pre.size() <= prefix_capacity());
         _prefix_trunc = prefix_capacity() - pre.size();
         memcpy(_prefix, pre.data(), pre.size());
      }

      uint8_t*       get_setlist_ptr() { return _prefix + prefix_capacity(); }
      const uint8_t* get_setlist_ptr() const { return _prefix + prefix_capacity(); }
      auto           get_setlist_size() const { return num_branches() - _eof_branch; }
      key_view       get_setlist() const
      {
         return key_view((const char*)get_setlist_ptr(), get_setlist_size());
      }

      object_id* get_branch_ptr()
      {
         return ((object_id*)tail()) - (_num_branches + _spare_capacity);
      }
      const object_id* get_branch_ptr() const
      {
         return ((const object_id*)tail()) - (_num_branches + _spare_capacity);
      }
      const object_id* get_branch_end_ptr() const { return ((object_id*)tail()) - _spare_capacity; }

      bool can_add_branch() const { return _spare_capacity > 0; }
      void add_branch(uint_fast16_t br, object_id b);

      void set_eof(object_id e)
      {
         _eof_branch         = true;
         get_branch_ptr()[0] = e;
      }
      bool has_eof_value() const { return _eof_branch; }
      void set_index(int idx, uint8_t byte, object_id c)
      {
         assert(idx < _num_branches);
         get_branch_ptr()[int(idx) + _eof_branch] = c;
         get_setlist_ptr()[idx]                   = byte;
        // if( idx+1 < _num_branches )
        //    assert( uint8_t(get_setlist_ptr()[idx+1]) > byte );
         if( idx > 0 ) 
            assert( uint8_t(get_setlist_ptr()[idx-1]) < byte );
      }

      bool validate()const {
         auto sl = get_setlist();
         if( sl.size() ) {
            uint8_t last = sl.front();
            for( int i = 1; i < sl.size(); ++i ) {
               if( uint8_t(sl[i]) <= last ) {
                  assert( !"order invalid" );
                  throw std::runtime_error( "order invalid" );
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
         uint8_t br2 = br-1;
         auto    sl  = get_setlist_ptr();
         auto    slp = sl;
         auto    sle = slp + num_branches() - _eof_branch;
 //        std::cerr << "sle - slp: " << sle-slp <<"\n";
         while (slp != sle)
         {
            if (uint8_t(*slp) >= uint8_t(br2) ) {
               return slp - sl;
            }
            ++slp;
         }
  //       std::cerr << "lsp- sl: " << slp-sl <<"\n";
         return slp - sl;
      }

      void set_branch(uint_fast16_t br, object_id b)
      {
         assert(br < 257);
         assert(not(br == 0 and not _eof_branch));
         assert(b);

         auto bp = get_branch_ptr();
         if (br == 0) [[unlikely]]
         {
            bp[0] = b;
            return;
         }
         auto pos = get_setlist().find(br - 1);
         assert(pos != key_view::npos);

         bp[pos + _eof_branch] = b;
      }

      object_id get_branch(uint_fast16_t br) const
      {
         assert(br < 257);

         if (br == 0) [[unlikely]]
         {
            assert(_eof_branch);
            return get_branch_ptr()[0];
         }

         auto pos = get_setlist().find(br - 1);
         if( pos == key_view::npos ) 
            return object_id();
      //   assert(pos != key_view::npos);
         return get_branch_ptr()[pos + _eof_branch];
      }

      inline void visit_branches(auto visitor) const
      {
         auto*             ptr = get_branch_ptr();
         const auto* const end = ptr + num_branches();
         while (ptr != end)
         {
            visitor(*ptr);
            ++ptr;
         }
      }
      inline void visit_branches_with_br(auto visitor) const
      {
         auto              slp   = get_setlist_ptr();
         auto*             start = get_branch_ptr();
         const auto* const end   = start + num_branches();
         auto* ptr = start;

         if (_eof_branch)
         {
            visitor(0, *start);
            ++ptr;
            ++start;
         }

         while (ptr != end)
         {
            visitor(int(slp[ptr - start])+1, *ptr);
            ++ptr;
         }
      }

      void remove_branch(int_fast16_t br, object_id b)
      {
         assert(num_branches() > 1);  // cannot remove the last branch
         assert(br < max_branch_count);
         assert(br >= 0);
         assert(not(br == 0 and not _eof_branch));
         // TODO

         _eof_branch &= br != 0;
         TRIEDENT_WARN("not implemented yet");
         abort();
      }

      inline static int_fast16_t alloc_size(const setlist_node* src, const clone_config& cfg)
      {
         assert(cfg.spare_space == 0);
         assert(src != nullptr);

         auto psize = std::max<int>(src->get_prefix().size(), cfg.prefix_capacity());

         int_fast32_t branch_capacity =
             std::min<int_fast16_t>(257, src->num_branches() + cfg.spare_branches);

         return sizeof(setlist_node) + psize + branch_capacity * (sizeof(object_id) + 1);
      }

      inline static int_fast16_t alloc_size(clone_config cfg)
      {
         assert(cfg.spare_space == 0);
         return sizeof(setlist_node) + cfg.prefix_capacity() +
                cfg.spare_branches * (1 + sizeof(object_id));
      }

      setlist_node(int_fast16_t asize, object_id nid, clone_config cfg)
          : node_header(asize, nid, node_type::setlist), _descendants(0)
      {
         _prefix_trunc = cfg.spare_prefix;
         _prefix_capacity = cfg.spare_prefix;
         if (cfg.update_prefix) {
            _prefix_capacity = std::max<int>(cfg.spare_prefix, cfg.update_prefix->size());
            set_prefix(*cfg.update_prefix);
         }

         _num_branches   = 0;
         _spare_capacity = cfg.spare_branches;
         _eof_branch     = 0;
      }

      setlist_node(int_fast16_t asize, object_id nid, const setlist_node* src, clone_config cfg)
          : node_header(asize, nid, node_type::setlist), _descendants(src->_descendants)
      {
         _prefix_trunc = cfg.spare_prefix;
         _prefix_capacity = cfg.spare_prefix;
         if (cfg.update_prefix) {
            _prefix_capacity = cfg.update_prefix->size();
            set_prefix(*cfg.update_prefix);
         }
         else {
            _prefix_capacity = src->prefix_size();
            set_prefix(src->get_prefix());
         }

         _num_branches = src->_num_branches;
         _eof_branch = src->_eof_branch;

         _spare_capacity = std::min<int_fast16_t>(257, src->num_branches() + cfg.spare_branches) -
                           src->_num_branches;

         memcpy(get_setlist_ptr(), src->get_setlist_ptr(), src->get_setlist_size());
         memcpy(get_branch_ptr(), src->get_branch_ptr(), src->num_branches() * sizeof(object_id));
         assert( validate() );
      }

   } __attribute((packed));

   static_assert(sizeof(setlist_node) == sizeof(node_header) + sizeof(uint64_t));

   inline void setlist_node::add_branch(uint_fast16_t br, object_id b)
   {
      assert( validate() );
      assert(br < max_branch_count);
      assert(br >= 0);
      assert(not(br == 0 and _eof_branch));

      object_id* branches = get_branch_ptr();
      if (br == 0) [[unlikely]]
      {
         memmove(branches + 1, branches, sizeof(object_id) * num_branches());
         *branches = b;
         ++_num_branches;
         --_spare_capacity;
         _eof_branch = true;
         return;
      }

      auto pos = lower_bound_idx(br);

      //std::cerr << "lb of " <<br <<" = " << pos <<"\n";

      auto slp = get_setlist_ptr();
      auto blp = get_branch_ptr();

      auto sl_found = slp + pos;
      auto sl_end   = slp + num_branches();
      memmove(sl_found + 1, sl_found, sl_end - sl_found);
      *sl_found = br - 1;

      auto b_found = blp + pos + _eof_branch;
      auto b_end   = blp + num_branches();
      memmove(b_found + 1, b_found, (char*)b_end - (char*)b_found);
      *b_found = b;

      ++_num_branches;
      --_spare_capacity;

      assert( validate() );
   }

}  // namespace arbtrie
