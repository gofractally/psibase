#pragma once
#include <arbtrie/concepts.hpp>
#include <arbtrie/inner_node.hpp>

namespace arbtrie
{
   /**
    *  Full Node - has one branch for all possible branches and eof stored
    *  as a 3 byte index under a common region.
    *  This type must satisfy inner_node_concept to ensure it provides all required
    *  functionality for inner nodes in the tree.
    */
   class full_node : public inner_node<full_node>
   {
     public:
      static constexpr const int_fast16_t branch_count = 256;
      static const node_type              type         = node_type::full;

      using node_header::get_type;

      local_index lower_bound_index(key_view k) const
      {
         if (k.empty())
            return next_index(begin_index());
         return next_index(local_index(uint8_t(k.front())));
      }

      // idx 0 = eof_value
      // idx 1..255 = branches
      constexpr local_index next_index(local_index idx) const
      {
         if (idx == begin_index() and has_eof_value())
            return local_index(0);

         const auto* br  = branches();
         const auto* bre = br + branch_count;
         const auto* b   = br + idx.to_int();  // this is next when you factor in the eof_value
         while (b < bre and not *b)
            ++b;
         return local_index(b - br + 1);
      }
      constexpr local_index prev_index(local_index idx) const
      {
         if (idx == local_index(1))
            return local_index(-not has_eof_value());

         const auto* br  = branches();
         const auto* bre = br + branch_count;
         const auto* b   = br + idx.to_int() - 2;
         while (b >= br and not *b)
            --b;
         return local_index(b - br + 1);
      }

      constexpr local_index begin_index() const { return local_index(-1); }
      constexpr local_index end_index() const { return local_index(branch_count + 1); }

      value_type::types get_type(local_index index) const
      {
         if (index == local_index(0))
         {
            if (!has_eof_value())
               throw std::runtime_error("No EOF value exists at index 0");
            return is_eof_subtree() ? value_type::types::subtree : value_type::types::value_node;
         }
         return value_type::types::value_node;
      }
      value_type get_value(local_index index) const
      {
         assert(index != begin_index());
         assert(index != end_index());
         if (index == local_index(0))
            return get_eof_value();
         assert(get_branch(index.to_int()));
         return value_type::make_value_node(get_branch(index.to_int()));
      }
      /*
      value_type get_branch_value(uint8_t branch) const
      {
         assert(branch < branch_count);
         return value_type::make_value_node(get_branch(branch + 1));
      }
      */
      key_view get_branch_key(local_index index) const
      {
         assert(index != begin_index());
         assert(index != end_index());

         if (index == local_index(0))
            return key_view();
         return key_view(&branch_chars[index.to_int() - 1], 1);
      }

      static int_fast16_t alloc_size(const clone_config& cfg)
      {
         return round_up_multiple<64>(sizeof(full_node) + cfg.prefix_capacity() +
                                      (branch_count * sizeof(id_index)));
      }
      static int_fast16_t alloc_size(const full_node* src, const clone_config& cfg)
      {
         auto min_pre  = cfg.set_prefix ? cfg.set_prefix->size() : src->prefix_size();
         min_pre       = std::max<int>(min_pre, cfg.prefix_cap);
         auto min_size = sizeof(full_node) + min_pre + (branch_count * sizeof(id_index));
         return round_up_multiple<64>(min_size);
      }

      full_node(int_fast16_t asize, id_address nid, const full_node* src, const clone_config& cfg)
          : inner_node<full_node>(asize, nid, src, cfg)
      {
         _prefix_capacity = asize - sizeof(inner_node<full_node>) - branch_count * sizeof(id_index);
         assert((char*)branches() + branch_count * sizeof(id_index) <= tail());
         memcpy(branches(), src->branches(), branch_count * sizeof(id_index));
      }

      full_node(int_fast16_t asize, id_address nid, const clone_config& cfg)
          : inner_node<full_node>(asize, nid, cfg, 0)
      {
         _prefix_capacity = asize - sizeof(inner_node<full_node>) - branch_count * sizeof(id_index);
         assert((char*)branches() + branch_count * sizeof(id_index) <= tail());
         memset(branches(), 0, branch_count * sizeof(id_index));
      }

      bool can_add_branch() const { return num_branches() < max_branch_count; }

      std::pair<branch_index_type, id_address> lower_bound(branch_index_type br) const
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
         assert((const uint8_t*)end == tail());

         while (ptr < end)
         {
            if (*ptr)
            {
               return {1 + (ptr - beg), id_address(branch_region(), *ptr)};
            }
            ++ptr;
         }
         return {max_branch_count, {}};
      }
      std::pair<branch_index_type, id_address> reverse_lower_bound(branch_index_type br) const
      {
         auto beg = branches();
         auto ptr = beg + br - 1;

         while (ptr >= beg)
         {
            if (*ptr)
            {
               return {1 + (ptr - beg), id_address(branch_region(), *ptr)};
            }
            --ptr;
         }
         if (has_eof_value())
            return {0, _eof_value};
         return {-1, {}};
      }

      auto& add_branch(branch_index_type br, id_address b)
      {
         assert(br < max_branch_count);
         assert(br > 0);
         assert(not branches()[br - 1]);
         assert(b.region() == branch_region());
         assert(_num_branches < max_branch_count);

         ++_num_branches;
         auto& idx = branches()[br - 1];
         idx       = id_index(b.index().to_int());
         return *this;
      }

      auto& remove_branch(branch_index_type br)
      {
         assert(br < max_branch_count);
         assert(br > 0);
         assert(get_branch(br));
         assert(_num_branches > 0);

         --_num_branches;
         branches()[br - 1] = {};
         return *this;
      }

      auto& set_branch(branch_index_type br, id_address b)
      {
         assert(br < max_branch_count);
         assert(br > 0);
         assert(get_branch(br));
         assert(b.region() == branch_region());

         auto& idx = branches()[br - 1];
         idx       = id_index(b.index().to_int());

         return *this;
      }

      id_address get_branch(branch_index_type br) const
      {
         assert(br < max_branch_count);
         assert(br > 0);

         //if (br == 0) return _eof_value;
         return id_address(branch_region(), branch(br - 1));
      }

      inline void visit_branches(std::invocable<id_address> auto&& visitor) const
      {
         if (has_eof_value())
            visitor(_eof_value);

         const auto region = branch_region();
         for (int i = 0; i < branch_count; ++i)
         {
            if (auto b = branch(i))
               visitor(id_address(region, b));
         }
      }

      inline void visit_branches_with_br(
          std::invocable<branch_index_type, id_address> auto&& visitor) const
      {
         if (has_eof_value())
            visitor(0, _eof_value);

         const auto region = branch_region();
         for (branch_index_type i = 0; i < branch_count;)
         {
            if (auto b = branch(i))
               visitor(++i, id_address(region, b));
            else
               ++i;
         }
      }

      uint32_t calculate_checksum() const
      {
         return XXH3_64bits(((const char*)this) + sizeof(checksum), _nsize - sizeof(checksum));
      }

      /**
       * Returns the value at the given key and modifies the key to contain only the trailing portion.
       * If no value is found, returns a remove value_type.
       * @param key - The key to look up, will be modified to contain only the trailing portion if a match is found
       * @return value_type - The value if found, or remove type if not found
       */
      value_type get_value_and_trailing_key(key_view& key) const
      {
         // First check if key matches the common prefix
         key_view prefix = get_prefix();
         if (key.size() < prefix.size() || memcmp(key.data(), prefix.data(), prefix.size()) != 0)
            return value_type();  // Returns remove type

         // Advance past the prefix
         key = key.substr(prefix.size());

         // If we've consumed the entire key, check for EOF value
         if (key.empty())
         {
            if (has_eof_value())
               return get_eof_value();
            return value_type();  // Returns remove type
         }

         // Look up the branch for the first character
         uint8_t    first_char  = key.front();
         id_address branch_addr = get_branch(first_char + 1);
         if (!branch_addr)
            return value_type();  // Returns remove type

         // Advance past the matched character
         key = key.substr(1);
         return value_type::make_value_node(branch_addr);
      }

      //private:
      id_index*       branches() { return ((id_index*)tail()) - branch_count; }
      const id_index* branches() const { return ((const id_index*)tail()) - branch_count; }
      id_index        branch(int i) const { return branches()[i]; }

   } __attribute((packed));

}  // namespace arbtrie
