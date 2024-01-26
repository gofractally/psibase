#pragma once
#include <arbtrie/config.hpp>

namespace arbtrie {

   class node_location
   {
      uint64_t loc_div_align:46 = 0;

      // made private to force use of static from_aligned and from_absolute
      constexpr node_location(uint64_t v = 0) : loc_div_align(v) {}

      public:
      static constexpr uint32_t alignment = 16;

      uint32_t segment() const { return loc_div_align / (segment_size / alignment); }
      // index() into array of objects of size alignment
      uint32_t aligned_index() const { return loc_div_align & ((segment_size / alignment) - 1); }
      // index() * alignment gets the byte offset
      uint32_t abs_index() const { return alignment * aligned_index(); }

      uint64_t to_aligned()const { return loc_div_align; }
      uint64_t to_abs()const { return loc_div_align * alignment; }
      static constexpr node_location from_aligned(uint64_t abs) {
         return node_location(abs);
      }
      static constexpr node_location from_absolute(uint64_t abs) {
         return node_location( abs / alignment );
      }

      friend bool operator==(node_location a, node_location b)
      {
         return a.loc_div_align == b.loc_div_align;
      }
      friend bool operator!=(node_location a, node_location b)
      {
         return a.loc_div_align != b.loc_div_align;
      }
   };
#ifdef __clang__
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wbitfield-constant-conversion"
#endif
   static constexpr const node_location end_of_freelist = node_location::from_aligned(-1);
   // initial location before seg_allocator assigns it
   static constexpr const node_location null_node = node_location::from_aligned(-2); 
#ifdef __clang__
#pragma clang diagnostic pop
#endif

} // namespace arbtrie
