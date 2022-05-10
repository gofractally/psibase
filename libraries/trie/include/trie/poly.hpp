
   struct inner
   {
      node_ptr* branch(uint8_t i)
      {
         return visit([&](auto ptr) { return ptr->branch(i); });
      }
      inline const node_ptr* branch(uint8_t b) const
      {
         return std::as_const(const_cast<node_ptr*>(this)->branch(b));
      }
      uint32_t num_branches() const { return uint32_t(max_index) + 1; }

      string_view prefix() const
      {
         return visit([&](auto ptr) { return string_view(ptr->prefix, ptr->prefix_length); });
      }

#define TRIE_INNER_MAKE(z, n, unused) \
   case n:                            \
      return new (a.alloc(sizeof(inner_impl<n>) + prefix.size())) inner_impl<n>(prefix);

      inline static inner* make_inner(arena& a, uint32_t size, const string_view& prefix)
      {
         switch (uint8_t(size - 1))
         {
            BOOST_PP_REPEAT_FROM_TO(0, 255, TRIE_INNER_MAKE, unused);
         }
      }

     protected:
#define TRIE_INNER_CAST(z, n, MAYBE_CONST) \
   case n:                                 \
      return reinterpret_cast<MAYBE_CONST inner_impl<n>*>(this)

      inline auto visit(auto lamb)
      {
         switch (max_index)
         {
            BOOST_PP_REPEAT_FROM_TO(0, 255, TRIE_INNER_CAST, );
         }
      }
      inline auto visit(auto lamb) const
      {
         switch (max_index)
         {
            BOOST_PP_REPEAT_FROM_TO(0, 255, TRIE_INNER_CAST, const);
         }
      }

      inner(uint8_t max_index);
      uint64_t max_index : 8;
      uint64_t num_children : 8;
      uint64_t prefix_length : 8;
      uint64_t total_children : 40;  /// maximum number of elements in database

      enum inner_types
      {
         full,          /// all children are present
         mostly_empty,  ///< less than 32 present
         average,       /// all other cases
         mostly_full;   ///< less than 32 empty
      };

      static constexpr inner_types calc_inner_type(uint8_t size)
      {
         if (size < 32)
            return mostly_empty;
         if (size > 256 - 32)
            return mostly_full;
         if (size == 256)
            return full;
         return average;
      }

      template <uint8_t MaxIndex, inner_types = calc_inner_type(MaxIndex)>
      struct inner_impl;

      template <>
      struct inner_impl<255, full> : public inner
      {
         node_ptr*       branch(uint8_t b) { return &children[b]; }
         const node_ptr* branch(uint8_t b) const { return &children[b]; }

         inner_impl(const string_view& pre) : inner(255, pre) {}
         node_ptr[256] children;
         char prefix[];
      };
      template <uint8_t MaxIndex>
      struct inner_impl<MaxIndex, mostly_empty> : public inner
      {
         inner_impl(const string_view& pre) : inner(MaxIndex, pre) {}

         inline node_ptr* branch(uint8_t b)
         {
            auto end = present_list + num_children;
            auto pos = std::find(present_list, end, b);
            if (pos == end)
               return nullptr;
            return &children[pos - present_list];
         }
         inline const node_ptr* branch(uint8_t b) const
         {
            return std::as_const(const_cast<node_ptr*>(this)->branch(b));
         }

         uint8_t present_list[MaxIndex];
         node_ptr[MaxIndex + 1] children;
         char prefix[];
      };
      template <uint8_t MaxIndex>
      struct inner_impl<MaxIndex, average> : public inner
      {
         inner_impl(const string_view& pre) : inner(MaxIndex, pre) {}
         inline node_ptr* branch(uint8_t b)
         {
            uint16_t  index    = 0;
            const int maskbits = branch % 64;
            const int mask     = -1ull >> (63 - maskbits);
            int       n        = branch / 64;

            index += std::popcount(present_bits[3]) * (n > 64 * 3);
            index += std::popcount(present_bits[2]) * (n > 64 * 2);
            index += std::popcount(present_bits[1]) * (n > 64 * 1);
            index += std::popcount(present_bits[n] & mask) - 1;

            // return null ptr if index >= num children without using if
            return (node_ptr*)(uint64_t((&children[index])) and -uint64_t(index < num_children));
         }
         inline const node_ptr* branch(uint8_t b) const
         {
            return std::as_const(const_cast<node_ptr*>(this)->branch(b));
         }

         uint64_t present_bits[256 / 64];
         node_ptr[MaxIndex + 1] children;
         char prefix[];
      };
      template <uint8_t MaxIndex>
      struct inner_impl<MaxIndex, mostly_full> : public inner
      {
         inner_impl(const string_view& pre) : inner(MaxIndex, pre) {}
         uint8_t absent_list[256 - MaxIndex];
         node_ptr[MaxIndex + 1] children;
         char prefix[];
      };
   };
