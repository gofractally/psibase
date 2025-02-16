#include <arbtrie/inner_node.hpp>
namespace arbtrie
{

   /**
    * Bitset Node - A node implementation that uses a bitset to track which branches are present.
    * This type must satisfy inner_node_concept to ensure it provides all required
    * functionality for inner nodes in the tree.
    */
   struct bitset_node : inner_node<bitset_node>
   {
      static const node_type type = node_type::bitset;
      uint64_t               bits[4];

      id_index*       get_branch_ptr() { return ((id_index*)tail()) - branch_capacity(); }
      const id_index* get_branch_ptr() const { return ((id_index*)tail()) - branch_capacity(); }
      uint8_t         branch_capacity() const { return branch_data_cap() / (sizeof(id_index)); }
      uint16_t branch_data_cap() const { return _nsize - sizeof(bitset_node) - prefix_capacity(); }

      static int alloc_size(const clone_config& cfg)
      {
         return round_up_multiple<64>(sizeof(bitset_node) + cfg.prefix_capacity() +
                                      cfg.branch_cap * sizeof(id_index));
      }
      inline static int_fast16_t alloc_size(const setlist_node* src, const clone_config& cfg)
      {
         assert(cfg.data_cap == 0);
         assert(src != nullptr);
         assert(cfg.branch_cap < 192);

         auto pcap     = cfg.set_prefix ? cfg.set_prefix->size()
                                        : std::max<int>(cfg.prefix_cap, src->prefix_size());
         auto bcap     = std::max<int>(cfg.branch_cap, src->num_branches());
         auto min_size = sizeof(setlist_node) + pcap + (bcap) * (sizeof(id_index));

         auto asize = round_up_multiple<64>(min_size);

         assert(src->num_branches() <=
                (asize - sizeof(setlist_node) - cfg.prefix_cap) / (sizeof(id_index)));

         return asize;
      }

      void set_branch(branch_index_type br, id_address adr)
      {
         assert(br > 0);
         /*
         if (br == 0) [[unlikely]]
         {
            assert(has_eof_value());
            return set_eof(adr);
         }
         */

         auto b = br - 1;
         assert(bits[b / 64] & (1ull << (b % 64)));
         assert(adr.region == branch_region());

         auto idx              = get_branch_index(b);
         get_branch_ptr()[idx] = adr.index;
      }

      void add_branch(branch_index_type br, id_address adr)
      {
         assert(br > 0);
         /*
         if (br == 0) [[unlikely]]
         {
            assert(not has_eof_value());
            set_eof(adr);
            ++_num_branches;
            return;
         }
         */

         auto b = br - 1;
         assert(not(bits[b / 64] & (1ull << (b % 64))));
         assert(branch_capacity() > num_branches());

         auto idx  = get_branch_index(br - 1);
         auto bptr = get_branch_ptr();
         memmove(&bptr[idx], &bptr[idx + 1], num_branches() - idx);
         bptr[idx] = adr.index;
         bits[b / 64] |= 1ull << (b % 64);

         ++_num_branches;
      }

      void remove_branch(branch_index_type br)
      {
         assert(br > 0);
         /*
         if (br == 0) [[unlikely]]
         {
            assert(has_eof_value());
            _num_branches -= has_eof_value();
            return set_eof({});
         }
         */

         auto b = br - 1;
         assert(bits[b / 64] & (1ull << (b % 64)));

         auto idx = get_branch_index(br - 1);
         memmove(&bits[idx], &bits[idx + 1], num_branches() - idx - 1);
         bits[b / 64] &= ~(1ull << (b % 64));

         --_num_branches;
      }

      id_address get_branch(branch_index_type br) const
      {
         assert(br < 257);
         assert(br > 0);
         /*
         if (br == 0) [[unlikely]]
            return _eof_value;
            */

         auto b = br - 1;
         if (bits[b / 64] & (1ull << (b % 64)))
            return id_address(branch_region(), get_branch_ptr()[get_branch_index(b)]);
         return {};
      }

      inline void visit_branches(std::invocable<id_address> auto&& visitor) const
      {
         const bool has_eof = has_eof_value();

         if (has_eof)
            visitor(id_address(_eof_value));

         auto*             ptr = get_branch_ptr();
         const auto* const end = ptr + num_branches() - has_eof;
         while (ptr != end)
         {
            visitor(id_address{branch_region(), *ptr});
            ++ptr;
         }
      }
      inline void visit_branches_with_br(
          std::invocable<branch_index_type, id_address> auto&& visitor) const
      {
         const bool        has_eof = has_eof_value();
         const auto*       start   = get_branch_ptr();
         const auto* const end     = start + num_branches() - has_eof;
         const auto*       ptr     = start;

         if (has_eof)
            visitor(0, id_address(_eof_value));

         for (int lb = 0; lb < 256; lb = lower_bound_bit(lb + 1))
         {
            assert(ptr < end);
            visitor(branch_index_type(lb) + 1, id_address(branch_region(), *ptr));
            ++ptr;
         }
      }

      // returns a number between 0 and 255
      int get_branch_index(int b) const
      {
         int count    = 0;
         int case_num = (b + 63) / 64;

         assert((64 * case_num - b) >= 0);  // no UB
         assert((64 * case_num - b) < 64);

         const uint64_t mask = (-1ull >> (64 * case_num - b));

         // clang-format off
         switch (case_num)
         {
            case 0: return 0;
            case 1: return std::popcount(bits[0] & mask);
            case 2: return std::popcount(bits[1] & mask) + 
                           std::popcount(bits[0]);
            case 3: return std::popcount(bits[2] & mask) + 
                           std::popcount(bits[1]) +
                           std::popcount(bits[0]);
            case 4: return std::popcount(bits[3] & mask) + 
                           std::popcount(bits[2]) +
                           std::popcount(bits[1]) + 
                           std::popcount(bits[0]);
            default: throw std::runtime_error("invalid branch index");
         }
         // clang-format on
      }

      std::pair<branch_index_type, id_address> lower_bound(branch_index_type br) const
      {
         if (br >= max_branch_count) [[unlikely]]
            return std::pair<branch_index_type, id_address>(max_branch_count, {});
         if (br == 0)
         {
            if (_eof_value)
               return std::pair<branch_index_type, id_address>(0, _eof_value);
            ++br;
         }

         auto lbb  = lower_bound_bit(br - 1);
         auto lbbr = lbb + 1;
         return std::pair<branch_index_type, id_address>(lbbr, get_branch(lbbr));
      }

      std::pair<branch_index_type, id_address> reverse_lower_bound(branch_index_type br) const
      {
         auto lbb  = reverse_lower_bound_bit(br - 1);
         auto lbbr = lbb + 1;

         if (lbbr == 0)
         {
            if (_eof_value)
               return std::pair<branch_index_type, id_address>(0, _eof_value);
            return std::pair<branch_index_type, id_address>(-1, {});
         }

         return std::pair<branch_index_type, id_address>(lbbr, get_branch(lbbr));
      }

      int lower_bound_bit(int b) const
      {
         switch (b / 64)
         {
            case 0:
            {
               const uint64_t mask = b == 0 ? 0 : -1ull >> (64 - b);
               auto           temp = std::countr_zero(bits[0] & ~mask);
               temp += std::countr_zero(bits[1]) & -uint64_t(temp == 64 * 1);
               temp += std::countr_zero(bits[2]) & -uint64_t(temp == 64 * 2);
               temp += std::countr_zero(bits[3]) & -uint64_t(temp == 64 * 3);
               return temp;
            }
            case 1:
            {
               const uint64_t mask = b == 64 ? 0 : -1ull >> (64 * 2 - b);
               auto           temp = 64 + std::countr_zero(bits[1] & ~mask);
               temp += std::countr_zero(bits[2]) & -uint64_t(temp == 64 * 2);
               temp += std::countr_zero(bits[3]) & -uint64_t(temp == 64 * 3);
               return temp;
            }
            case 2:
            {
               const uint64_t mask = b == 64 * 2 ? 0 : -1ull >> (64 * 3 - b);
               auto           temp = 64 * 2 + std::countr_zero(bits[2] & ~mask);
               return temp + std::countr_zero(bits[3]) & -uint64_t(temp == 64 * 3);
            }
            case 3:
            {
               const uint64_t mask = b == 64 * 3 ? 0 : -1ull >> (256 - b);
               return 64 * 3 + std::countr_zero(bits[3] & ~mask);
            }
            default:
               return 256;
         }
      }

      int reverse_lower_bound_bit(int b) const
      {
         switch (b / 64)
         {
            case 0:
            {
               const uint64_t mask = b == 64 ? 0 : -1ull >> (b & 63);
               return 255 - 3 * 64 + std::countl_zero(bits[0] & mask);
            }
            case 1:
            {
               const uint64_t mask = b == 2 * 64 ? 0 : -1ull >> (b & 63);
               auto           temp = 2 * 64 + std::countl_zero(bits[1] & mask);
               temp += std::countl_zero(bits[0]) & -uint64_t(temp == 64 * 3);
               return 255 - temp;
            }
            case 2:
            {
               const uint64_t mask = b == 3 * 64 ? 0 : -1ull >> (b & 63);
               auto           temp = 1 * 64 + std::countl_zero(bits[2] & mask);
               temp += std::countl_zero(bits[1]) & -uint64_t(temp == 64 * 2);
               temp += std::countl_zero(bits[0]) & -uint64_t(temp == 64 * 3);
               return 255 - temp;
            }
            case 3:
            {
               const uint64_t mask = b == 4 * 64 ? 0 : -1ull >> (b & 63);
               auto           temp = std::countl_zero(bits[3] & mask);
               temp += std::countl_zero(bits[2]) & -uint64_t(temp == 64 * 1);
               temp += std::countl_zero(bits[1]) & -uint64_t(temp == 64 * 2);
               temp += std::countl_zero(bits[0]) & -uint64_t(temp == 64 * 3);
               return 255 - temp;
            }
            default:
               return -1;
         }
      }
   };

}  // namespace arbtrie
