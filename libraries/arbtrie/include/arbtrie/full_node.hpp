#pragma once
#include <arbtrie/node_header.hpp>

namespace arbtrie
{
   /**
    *  Full Node - has one branch for all possible branches and eof,
    *  lower_bound does a linear search of the branches that can only
    *  be optimized slightly if object_id is a multiple 8 bytes.
    *
    *  - constant time "get" / "set"
    */
   struct full_node : node_header
   {
      static const int_fast16_t branch_count = 257;
      static const node_type    type         = node_type::full;

      static int_fast16_t alloc_size(clone_config cfg)
      {
         return sizeof(full_node) + cfg.prefix_capacity();
      }
      static int_fast16_t alloc_size(const full_node* src, clone_config cfg)
      {
         assert(src != nullptr);
         if (cfg.update_prefix)
         {
            return sizeof(full_node) + cfg.prefix_capacity();
         }
         return sizeof(full_node) +
                std::max<int_fast16_t>(src->get_prefix().size(), cfg.prefix_capacity());
      }

      full_node(int_fast16_t asize, object_id nid, const full_node* src, clone_config cfg)
          : node_header(asize, nid, node_type::full)
      {
         assert(src != nullptr);
         assert(asize == alloc_size(src, cfg));
         _prefix_trunc = cfg.spare_prefix;
         _prefix_capacity = cfg.spare_prefix;
         if (cfg.update_prefix) {
            _prefix_capacity = cfg.update_prefix->size();
            set_prefix(*cfg.update_prefix);
         } else {
            _prefix_capacity = src->prefix_size();
            set_prefix(src->get_prefix());
         }

         _descendants = src->_descendants;
         memcpy(_branches, src->_branches, sizeof(_branches));
      }

      full_node(int_fast16_t asize, object_id nid, clone_config cfg)
          : node_header(asize, nid, node_type::full), _prefix_trunc(cfg.spare_prefix)
      {
         assert(asize == alloc_size(cfg));

         _prefix_trunc = cfg.spare_prefix;
         _prefix_capacity = cfg.spare_prefix;
         if (cfg.update_prefix) {
            _prefix_capacity = cfg.update_prefix->size();
            set_prefix(*cfg.update_prefix);
         }
         _descendants = 0;
         memset(_branches, 0, sizeof(_branches));
      }

      bool can_add_branch() const { return _num_branches < branch_count; }

      std::pair<int_fast16_t,object_id> lower_bound( int_fast16_t br )const {
         while( br < max_branch_count and not _branches[br] )
            ++br;
         if( br == max_branch_count )
            return {br, {}};
         return {br, _branches[br]};
      }

      void add_branch(int_fast16_t br, object_id b)
      {
         assert(br < max_branch_count);
         assert(br >= 0);
         assert(not _branches[br]);
         ++_num_branches;
         assert(_num_branches <= max_branch_count);
         _branches[br] = b;

         // this info is redundant and no one should determine eof_branch
         // for full node by reading this, so don't bother updating it
         //_eof_branch |= br == 0;
      }
      void remove_branch(int_fast16_t br)
      {
         assert(br < max_branch_count);
         assert(br >= 0);
         assert(_branches[br]);
         assert(_num_branches > 0);
         --_num_branches;
         _branches[br] = {};

         // this info is redundant and no one should determine eof_branch
         // for full node by reading this, so don't bother updating it
         //_eof_branch &= br != 0;
      }
      void set_branch(int_fast16_t br, object_id b)
      {
         assert(br < max_branch_count);
         assert(br >= 0);
         assert(_branches[br]);
         _branches[br] = b;
      }

      bool has_eof_value()const { return bool(_branches[0]); }

      object_id get_branch(int_fast16_t br)const
      {
         assert(br < max_branch_count);
         assert(br >= 0);
         return _branches[br];
      }

      inline int_fast32_t prefix_size() const { return prefix_capacity() - _prefix_trunc; }
      inline key_view     get_prefix() const { return key_view(_prefix, prefix_capacity()); }
      inline void         set_prefix(key_view pre)
      {
         assert(pre.size() <= prefix_capacity());
         _prefix_trunc = prefix_capacity() - pre.size();
         memcpy(_prefix, pre.data(), pre.size());
      }

      inline void visit_branches(auto visitor) const
      {
         for (auto& x : _branches)
            if (x)
               visitor(x);
      }

      uint64_t _descendants : 54  = 0;
      uint64_t _prefix_trunc : 10 = 0;

      object_id _branches[max_branch_count];
      char      _prefix[];

      uint32_t calculate_checksum()const {
         return XXH3_64bits( ((const char*)this)+sizeof(checksum), 
                      _nsize - sizeof(checksum) );
      }

   } __attribute((packed));

}  // namespace arbtrie
