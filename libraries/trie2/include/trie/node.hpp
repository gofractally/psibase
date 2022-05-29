#pragma once
#include <trie/ring_alloc.hpp>
#include <trie/debug.hpp>

namespace trie
{
   using object_id = ring_allocator::id;

   class node
   {
     public:
      using string_view = std::string_view;

      bool is_value_node() const { return ((*reinterpret_cast<const uint32_t*>(this)) >> 7) & 1; }
      inline uint8_t key_size() const
      {
         return ((*reinterpret_cast<const uint32_t*>(this)) & 0x7f);
      }
   };

   class value_node : public node
   {
     public:
      inline char*       key_ptr() { return ((char*)this) + sizeof(value_node); }
      inline const char* key_ptr() const { return ((const char*)this) + sizeof(value_node); }
      inline uint32_t    data_size() const { return sizes >> 8; }
      inline char*       data_ptr() { return ((char*)this) + sizeof(value_node) + key_size(); }
      inline const char* data_ptr() const
      {
         return ((const char*)this) + sizeof(value_node) + key_size();
      }

      inline string_view data() const { return string_view(data_ptr(), data_size()); }
      inline string_view key() const { return string_view(key_ptr(), key_size()); }

      inline static std::pair<object_id, value_node*> make(ring_allocator& a,
                                                           string_view   key,
                                                           string_view   val)
      {
         assert(key.size() < 0x7f);
         assert(val.size() < 0xffffff);
         uint32_t alloc_size = sizeof(value_node) + key.size() + val.size();
         auto     r          = a.alloc(alloc_size);
         return std::make_pair(r.first, new (r.second) value_node(key, val));
      }

     private:
      value_node(string_view key, string_view val)
      {
         sizes = (val.size() << 8) + (key.size() & 0x7f);
         sizes |= 0x80;

         memcpy(key_ptr(), key.data(), key_size());
         memcpy(data_ptr(), val.data(), val.size());
         assert(is_value_node());
      }
      uint32_t sizes;
   };

   class inner_node : public node
   {
     public:
      inline object_id&       branch(uint8_t b);
      inline const object_id& branch(uint8_t b) const;
      inline object_id        value() const { return _value; }
      inline void             set_value(object_id i) { _value = i; }

      inline uint32_t num_children() const { return num_branches() + (_value.id != 0); }
      inline uint32_t num_branches() const { return std::popcount(_present_bits); }
      inline uint64_t branches()const{ return _present_bits; }

      template<typename... Ts>
      inline static uint64_t branches( Ts... bit_num ) {
         return  ((1ull << bit_num)|...);
      }

      inline uint8_t lower_bound(uint8_t b) const;
      inline int8_t  reverse_lower_bound(uint8_t b) const;
      inline uint8_t upper_bound(uint8_t b) const;

      inline static std::pair<object_id, inner_node*> make(ring_allocator&     a,
                                                           const inner_node& in,
                                                           string_view       prefix,
                                                           object_id         val,
                                                           uint64_t          branches,
                                                           uint32_t          version);

      inline static std::pair<object_id, inner_node*> make(ring_allocator& a,
                                                           string_view   prefix,
                                                           object_id     val,
                                                           uint64_t      branches,
                                                           uint32_t      version);

      inline bool has_branch(uint32_t b) const { return _present_bits & (1ull << b); }

      inline string_view key() const { return string_view(key_ptr(), key_size()); }

      inline int32_t     branch_index(uint32_t branch);
      object_id*         children() { return reinterpret_cast<object_id*>(this + 1); }
      const object_id*   children() const { return reinterpret_cast<const object_id*>(this + 1); }
      inline char*       key_ptr() { return reinterpret_cast<char*>(children() + num_branches()); }
      inline const char* key_ptr() const
      {
         return reinterpret_cast<const char*>(children() + num_branches());
      }

      uint32_t version()const{ return _version; }

     private:
      inner_node(const inner_node& in, string_view prefix, object_id val, uint64_t branches, uint32_t version);
      inner_node(string_view prefix, object_id val, uint64_t branches, uint32_t version);

      uint8_t   _prefix_length = 0;
      uint8_t   _padding2      = 0;  // use to be max branches, to cache popcount
      uint8_t   _padding       = 0;  // use to be max branches, to cache popcount
      object_id _value;
      uint64_t  _present_bits = 0;
      uint32_t  _version      = 0;
   } __attribute__((packed));
   static_assert(sizeof(inner_node) == 8 + 4 + 5 + 3, "unexpected padding");

   inline std::pair<object_id, inner_node*> inner_node::make(ring_allocator&     a,
                                                             const inner_node& in,
                                                             string_view       prefix,
                                                             object_id         val,
                                                             uint64_t          branches,
                                                             uint32_t          version)
   {
      uint32_t alloc_size =
          sizeof(inner_node) + prefix.size() + std::popcount(branches) * sizeof(object_id);
      auto p = a.alloc(alloc_size);
      return std::make_pair(p.first, new (p.second) inner_node(in, prefix, val, branches, version));
   }

   inline std::pair<object_id, inner_node*> inner_node::make(ring_allocator&     a,
                                                             string_view       prefix,
                                                             object_id         val,
                                                             uint64_t          branches,
                                                             uint32_t          version)
   {
      uint32_t alloc_size =
          sizeof(inner_node) + prefix.size() + std::popcount(branches) * sizeof(object_id);
      auto p = a.alloc(alloc_size);
      return std::make_pair(p.first, new (p.second) inner_node( prefix, val, branches, version));
   }


   inline inner_node::inner_node(string_view prefix, object_id val, uint64_t branches, uint32_t version)
      :_value(val), _present_bits(branches), _version(version)
   {
      assert( std::popcount(branches) < 3 );
      (*reinterpret_cast<char*>(this)) = prefix.size();
      memset(children(), 0, sizeof(object_id) * num_branches());
      memcpy( key_ptr(), prefix.data(), prefix.size() );
      assert(not is_value_node());
   }
   /*
    *  Constructs a copy of in with the branches selected by 'branches'
    */
   inline inner_node::inner_node(const inner_node& in,
                                 string_view       prefix,
                                 object_id         val,
                                 uint64_t          branches,
                                 uint32_t          version)
       : _value(val), _present_bits(branches), _version(version)
   {
      assert(prefix.size() <= 0x7f);
      (*reinterpret_cast<char*>(this)) = prefix.size();

      // TODO: this could be optimized by only zeroing the branches
      // that are not set, this currently sets everything to zero then
      // over writes the ones in common
      memset(children(), 0, sizeof(object_id) * num_branches());


      
      auto common_branches = in._present_bits & branches;
      auto fb              = std::countr_zero(common_branches);
      while (fb < 64)
      {
         branch(fb) = in.branch(fb);
         common_branches ^= 1ull << fb;
         fb = std::countr_zero(common_branches);
      }
      memcpy( key_ptr(), prefix.data(), prefix.size() );

      assert(not is_value_node());
   }

   inline object_id& inner_node::branch(uint8_t b)
   {
      assert(branch_index(b) >= 0);
      return reinterpret_cast<object_id*>((char*)this + sizeof(inner_node))[branch_index(b)];
   }
   inline const object_id& inner_node::branch(uint8_t b) const
   {
      return const_cast<inner_node*>(this)->branch(b);
   }

   // @return num_children if not found
   inline int32_t inner_node::branch_index(uint32_t branch)
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

}  // namespace trie
