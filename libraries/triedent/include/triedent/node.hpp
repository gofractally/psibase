#pragma once
#include <triedent/debug.hpp>
#include <triedent/ring_alloc.hpp>

namespace triedent
{
   using key_view   = std::string_view;
   using value_view = std::string_view;
   using key_type   = std::string;
   using value_type = key_type;

   object_id bump_refcount_or_copy(ring_allocator& ra, object_id id);

   class node
   {
     public:
      inline uint8_t key_size() const { return (*reinterpret_cast<const uint8_t*>(this)); }
   };

   class value_node : public node
   {
     public:
      inline uint32_t    key_size() const { return _key_size; }
      inline char*       key_ptr() { return ((char*)this) + sizeof(value_node); }
      inline const char* key_ptr() const { return ((const char*)this) + sizeof(value_node); }
      inline uint32_t    data_size() const
      {
         return (reinterpret_cast<const object_header*>(this) - 1)->size - key_size() -
                sizeof(value_node);
         //return sizes >> 8;
      }
      inline char*       data_ptr() { return ((char*)this) + sizeof(value_node) + key_size(); }
      inline const char* data_ptr() const
      {
         return ((const char*)this) + sizeof(value_node) + key_size();
      }

      inline value_view data() const { return value_view(data_ptr(), data_size()); }
      inline key_view   key() const { return key_view(key_ptr(), key_size()); }

      inline static std::pair<location_lock, value_node*> make(ring_allocator& a,
                                                               key_view        key,
                                                               value_view      val)
      {
         assert(val.size() < 0xffffff - key.size() - sizeof(value_node));
         uint32_t alloc_size = sizeof(value_node) + key.size() + val.size();
         auto     r          = a.alloc(alloc_size, true);
         return std::make_pair(std::move(r.first), new (r.second) value_node(key, val));
      }

     private:
      value_node(key_view key, value_view val)
      {
         _key_size = key.size();  // | 0x80;
         /*
         sizes = (val.size() << 8) + (key.size() & 0x7f);
         key_size |= 0x80;
         */

         memcpy(key_ptr(), key.data(), key_size());
         memcpy(data_ptr(), val.data(), val.size());
      }
      //  uint32_t sizes;
      uint8_t _key_size;
   };
   static_assert(sizeof(value_node) == 1, "unexpected padding");

   class inner_node : public node
   {
     public:
      inline object_id&       branch(uint8_t b);
      inline const object_id& branch(uint8_t b) const;
      inline object_id        value() const { return _value; }
      inline object_id&       value() { return _value; }
      inline void             set_value(object_id i) { _value = i; }

      inline uint32_t num_children() const { return num_branches() + (_value.id != 0); }
      inline uint32_t num_branches() const { return std::popcount(_present_bits); }
      inline uint64_t branches() const { return _present_bits; }

      template <typename... Ts>
      inline static uint64_t branches(Ts... bit_num)
      {
         return ((1ull << bit_num) | ...);
      }

      inline uint8_t lower_bound(uint8_t b) const;
      inline int8_t  reverse_lower_bound(uint8_t b) const;
      inline uint8_t upper_bound(uint8_t b) const;

      inline static std::pair<location_lock, inner_node*> make(ring_allocator&   a,
                                                               const inner_node& in,
                                                               key_view          prefix,
                                                               object_id         val,
                                                               uint64_t          branches);

      inline static std::pair<location_lock, inner_node*> make(ring_allocator& a,
                                                               key_view        prefix,
                                                               object_id       val,
                                                               uint64_t        branches);

      inline bool has_branch(uint32_t b) const { return _present_bits & (1ull << b); }

      inline key_view key() const { return key_view(key_ptr(), key_size()); }

      inline int32_t     branch_index(uint32_t branch) const;
      object_id*         children() { return reinterpret_cast<object_id*>(this + 1); }
      const object_id*   children() const { return reinterpret_cast<const object_id*>(this + 1); }
      inline char*       key_ptr() { return reinterpret_cast<char*>(children() + num_branches()); }
      inline const char* key_ptr() const
      {
         return reinterpret_cast<const char*>(children() + num_branches());
      }

     private:
      inner_node(ring_allocator&   a,
                 const inner_node& in,
                 key_view          prefix,
                 object_id         val,
                 uint64_t          branches);
      inner_node(key_view prefix, object_id val, uint64_t branches);

      uint8_t   _prefix_length = 0;  // mirrors value nodes to signal type and prefix length
      uint8_t   _reserved_a    = 0;  // future use
      uint8_t   _reserved_b    = 0;  // future use
      object_id _value;              // this is 5 bytes
      uint64_t  _present_bits = 0;   // keep this 8 byte aligned for popcount instructions
   } __attribute__((packed));
   static_assert(sizeof(inner_node) == 3 + 5 + 8, "unexpected padding");

   inline std::pair<location_lock, inner_node*> inner_node::make(ring_allocator&   a,
                                                                 const inner_node& in,
                                                                 key_view          prefix,
                                                                 object_id         val,
                                                                 uint64_t          branches)
   {
      uint32_t alloc_size =
          sizeof(inner_node) + prefix.size() + std::popcount(branches) * sizeof(object_id);
      auto p = a.alloc(alloc_size, false);
      return std::make_pair(std::move(p.first),
                            new (p.second) inner_node(a, in, prefix, val, branches));
   }

   inline std::pair<location_lock, inner_node*> inner_node::make(ring_allocator& a,
                                                                 key_view        prefix,
                                                                 object_id       val,
                                                                 uint64_t        branches)
   {
      uint32_t alloc_size =
          sizeof(inner_node) + prefix.size() + std::popcount(branches) * sizeof(object_id);
      auto p = a.alloc(alloc_size, false);
      return std::make_pair(std::move(p.first), new (p.second) inner_node(prefix, val, branches));
   }

   inline inner_node::inner_node(key_view prefix, object_id val, uint64_t branches)
       : _prefix_length(prefix.size()),
         _reserved_a(0),
         _reserved_b(0),
         _value(val),
         _present_bits(branches)
   {
      memset(children(), 0, sizeof(object_id) * num_branches());
      memcpy(key_ptr(), prefix.data(), prefix.size());
   }
   /*
    *  Constructs a copy of in with the branches selected by 'branches'
    */
   inline inner_node::inner_node(ring_allocator&   a,
                                 const inner_node& in,
                                 key_view          prefix,
                                 object_id         val,
                                 uint64_t          branches)
       : _prefix_length(prefix.size()),
         _reserved_a(0),
         _reserved_b(0),
         _value(val),
         _present_bits(branches)
   {
      if (in._present_bits == branches)
      {
         // memcpy( (char*)children(), (char*)in.children(), num_branches()*sizeof(object_id) );
         auto c  = children();
         auto ic = in.children();
         auto e  = c + num_branches();
         while (c != e)
         {
            *c = bump_refcount_or_copy(a, *ic);
            ++c;
            ++ic;
         }
      }
      else
      {
         auto common_branches = in._present_bits & _present_bits;
         auto fb              = std::countr_zero(common_branches);
         while (fb < 64)
         {
            branch(fb) = bump_refcount_or_copy(a, in.branch(fb));
            common_branches ^= 1ull << fb;
            fb = std::countr_zero(common_branches);
         }

         auto null_branches = (in._present_bits & branches) ^ branches;
         fb                 = std::countr_zero(null_branches);
         while (fb < 64)
         {
            branch(fb).id = 0;
            null_branches ^= 1ull << fb;
            fb = std::countr_zero(null_branches);
         }
      }
      memcpy(key_ptr(), prefix.data(), prefix.size());

      //assert(not is_value_node());
   }

   inline object_id& inner_node::branch(uint8_t b)
   {
      assert(branch_index(b) >= 0);
      if (branch_index(b) < 0) [[unlikely]]
         throw std::runtime_error("branch(b) <= 0, b: " + std::to_string(int(b)));
      return reinterpret_cast<object_id*>((char*)this + sizeof(inner_node))[branch_index(b)];
   }
   inline const object_id& inner_node::branch(uint8_t b) const
   {
      return const_cast<inner_node*>(this)->branch(b);
   }

   // @return num_children if not found
   inline int32_t inner_node::branch_index(uint32_t branch) const
   {
      assert(branch < 64);
      const uint32_t maskbits = branch % 64;
      const uint64_t mask     = -1ull >> (63 - maskbits);

      return std::popcount(_present_bits & mask) - 1;
   }

   // @return the first branch >= b
   inline uint8_t inner_node::lower_bound(uint8_t b) const
   {
      const uint64_t mask = (-1ull << (b & 63));
      return b >= 64 ? 64 : std::countr_zero(_present_bits & mask);
   }
   inline int8_t inner_node::reverse_lower_bound(uint8_t b) const
   {
      const uint64_t mask = b == 63 ? -1ull : ~(-1ull << ((b + 1) & 63));
      return 63 - std::countl_zero(_present_bits & mask);
   }

   // @return the first branch > b, if b == 63 then
   // this will return 64
   inline uint8_t inner_node::upper_bound(uint8_t b) const
   {
      const uint64_t mask = (-1ull << ((b + 1) & 63));
      return b >= 63 ? 64 : std::countr_zero(_present_bits & mask);
   }

   inline void release_node(ring_allocator& ra, object_id obj)
   {
      if (!obj)
         return;
      if (auto [ptr, is_value] = ra.release(obj); ptr && !is_value)
      {
         auto& in = *reinterpret_cast<inner_node*>(ptr);
         release_node(ra, in.value());
         auto nb  = in.num_branches();
         auto pos = in.children();
         auto end = pos + nb;
         while (pos != end)
         {
            assert(*pos);
            release_node(ra, *pos);
            ++pos;
         }
      }
   }

   inline location_lock copy_node(ring_allocator& ra, object_id id, char* ptr, bool is_value)
   {
      if (is_value)
      {
         auto src          = reinterpret_cast<value_node*>(ptr);
         auto [lock, dest] = value_node::make(ra, src->key(), src->data());
         return std::move(lock);
      }
      else
      {
         auto src          = reinterpret_cast<inner_node*>(ptr);
         auto [lock, dest] = inner_node::make(
             ra, *src, src->key(), bump_refcount_or_copy(ra, src->value()), src->branches());
         return std::move(lock);
      }
   }

   inline object_id bump_refcount_or_copy(ring_allocator& ra, object_id id)
   {
      if (!id)
         return id;
      if (ra.bump_count(id))
         return id;
      auto [ptr, is_value, ref] = ra.get_cache<false>(id);
      return copy_node(ra, id, ptr, is_value).into_unlock_unchecked();
   }
}  // namespace triedent
