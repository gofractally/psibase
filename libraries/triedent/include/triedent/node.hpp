#pragma once
#include <triedent/cache_allocator.hpp>
#include <triedent/debug.hpp>

#include <cstring>

namespace triedent
{
   inline constexpr bool debug_nodes = false;

   using key_view   = std::string_view;
   using value_view = std::string_view;
   using key_type   = std::string;
   using value_type = key_type;

   object_id bump_refcount_or_copy(cache_allocator& ra,
                                   std::unique_lock<gc_session>&,
                                   object_id id);

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

      inline object_id*       roots() { return reinterpret_cast<object_id*>(data_ptr()); }
      inline const object_id* roots() const
      {
         return reinterpret_cast<const object_id*>(data_ptr());
      }
      auto num_roots() const { return data_size() / sizeof(object_id); }

      inline value_view data() const { return value_view(data_ptr(), data_size()); }
      inline key_view   key() const { return key_view(key_ptr(), key_size()); }

      inline static std::pair<location_lock, value_node*> make(
          cache_allocator&              a,
          std::unique_lock<gc_session>& session,
          key_view                      key,
          value_view                    val,
          node_type                     type)
      {
         assert(val.size() < 0xffffff - key.size() - sizeof(value_node));
         uint32_t alloc_size = sizeof(value_node) + key.size() + val.size();
         auto     r          = a.alloc(session, alloc_size, type);
         if constexpr (debug_nodes)
            std::cout << r.first.get_id().id << ": construct value_node: type=" << (int)type
                      << std::endl;
         return std::make_pair(std::move(r.first), new (r.second) value_node(a, key, val));
      }

      // If id is non-null, it must refer to a source object that is being copied
      // Otherwise, key and value must be pointers to external memory
      inline static std::pair<location_lock, value_node*> clone(
          cache_allocator&              a,
          std::unique_lock<gc_session>& session,
          object_id                     id,
          key_view                      key,
          std::uint32_t                 key_offset,
          value_view                    val,
          node_type                     type)
      {
         if (id && type == node_type::roots)
         {
            return clone_roots(a, session, id, key, key_offset, val, type);
         }
         else
         {
            return clone_bytes(a, session, id, key, key_offset, val, type);
         }
      }

      inline static std::pair<location_lock, value_node*> clone_bytes(
          cache_allocator&              a,
          std::unique_lock<gc_session>& session,
          object_id                     id,
          key_view                      key,
          std::uint32_t                 key_offset,
          value_view                    val,
          node_type                     type)
      {
         if (key_offset != std::uint32_t(-1))
            key = key.substr(key_offset);
         assert(val.size() < 0xffffff - key.size() - sizeof(value_node));
         uint32_t alloc_size = sizeof(value_node) + key.size() + val.size();
         // alloc invalidates key and val
         auto r = a.alloc(session, alloc_size, type);
         if (id)
         {
            auto ptr = get(a, session, id);
            if (key_offset != std::uint32_t(-1))
            {
               key = ptr->key().substr(key_offset);
            }
            val = ptr->data();
         }
         if constexpr (debug_nodes)
            std::cout << r.first.get_id().id << ": construct value_node: type=" << (int)type
                      << std::endl;
         return std::make_pair(std::move(r.first), new (r.second) value_node(a, key, val));
      }
      inline static std::pair<location_lock, value_node*> clone_roots(
          cache_allocator&              a,
          std::unique_lock<gc_session>& session,
          object_id                     id,
          key_view                      key,
          std::uint32_t                 key_offset,
          value_view                    val,
          node_type                     type)
      {
         const std::size_t value_size = val.size();
         if (key_offset != std::uint32_t(-1))
            key = key.substr(key_offset);
         assert(value_size <= 0xffffff - key.size() - sizeof(value_node));
         uint32_t          alloc_size = sizeof(value_node) + key.size() + value_size;
         const std::size_t n          = val.size() / sizeof(object_id);
         object_id         roots[n + 1];  // add 1 to avoid zero-size VLA
         std::memcpy(&roots, val.data(), val.size());
         // copy_node or alloc invalidates key and val
         for (std::size_t i = 0; i < n; ++i)
         {
            roots[i] = bump_refcount_or_copy(a, session, roots[i]);
         }
         auto r = a.alloc(session, alloc_size, type);
         {
            if (key_offset != std::uint32_t(-1))
            {
               auto ptr = get(a, session, id);
               key      = ptr->key().substr(key_offset);
            }
            val = {reinterpret_cast<const char*>(&roots[0]), value_size};
         }
         if constexpr (debug_nodes)
            std::cout << r.first.get_id().id << ": construct value_node: type=" << (int)type
                      << std::endl;
         return std::make_pair(std::move(r.first), new (r.second) value_node(a, key, val));
      }

     private:
      static value_node* get(cache_allocator& a, session_lock_ref<> session, object_id id)
      {
         auto [ptr, type, ref] = a.get_cache<false>(session, id);
         return reinterpret_cast<value_node*>(ptr);
      }
      value_node(cache_allocator& ra, key_view key, value_view val)
      {
         _key_size = key.size();
         if (!key.empty())
            std::memcpy(key_ptr(), key.data(), key_size());
         if (!val.empty())
            std::memcpy(data_ptr(), val.data(), val.size());
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

      inline static std::pair<location_lock, inner_node*> clone(
          cache_allocator&              a,
          std::unique_lock<gc_session>& session,
          object_id                     id,
          const inner_node*             in,
          key_view                      key,
          std::uint32_t                 key_offset,
          object_id                     value,
          std::uint64_t                 branches);

      inline static std::pair<location_lock, inner_node*> make(
          cache_allocator&              a,
          std::unique_lock<gc_session>& session,
          key_view                      prefix,
          object_id                     val,
          uint64_t                      branches);

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
      static inner_node* get(cache_allocator& a, session_lock_ref<> session, object_id id)
      {
         auto [ptr, type, ref] = a.get_cache<false>(session, id);
         return reinterpret_cast<inner_node*>(ptr);
      }
      inner_node(object_id  id,
                 key_view   prefix,
                 object_id  val,
                 uint64_t   branches,
                 object_id* children);
      inner_node(object_id id, key_view prefix, object_id val, uint64_t branches);

      uint8_t   _prefix_length = 0;  // mirrors value nodes to signal type and prefix length
      uint8_t   _reserved_a    = 0;  // future use
      uint8_t   _reserved_b    = 0;  // future use
      object_id _value;              // this is 5 bytes
      uint64_t  _present_bits = 0;   // keep this 8 byte aligned for popcount instructions
   } __attribute__((packed));
   static_assert(sizeof(inner_node) == 3 + 5 + 8, "unexpected padding");

   inline std::pair<location_lock, inner_node*> inner_node::clone(
       cache_allocator&              a,
       std::unique_lock<gc_session>& session,
       object_id                     id,
       const inner_node*             in,
       key_view                      key,
       std::uint32_t                 key_offset,
       object_id                     value,
       std::uint64_t                 branches)
   {
      if (key_offset != std::uint32_t(-1))
         key = key.substr(key_offset);
      const std::size_t n          = std::popcount(branches);
      uint32_t          alloc_size = sizeof(inner_node) + key.size() + n * sizeof(object_id);
      object_id         children[n + 1];
      if (in->_present_bits == branches)
      {
         std::memcpy(&children[0], in->children(), sizeof(children));
      }
      else
      {
         auto       remaining_branches = branches;
         auto       in_branches        = in->_present_bits;
         object_id* child_iter         = children;
         while (remaining_branches)
         {
            auto fb     = std::countr_zero(remaining_branches);
            auto mask   = (1ull << fb);
            *child_iter = (in_branches & mask) ? in->branch(fb) : object_id{};
            ++child_iter;
            remaining_branches ^= mask;
         }
      }
      // invalidates in and prefix
      value = bump_refcount_or_copy(a, session, value);
      for (std::size_t i = 0; i < n; ++i)
      {
         children[i] = bump_refcount_or_copy(a, session, children[i]);
      }
      auto p = a.alloc(session, alloc_size, node_type::inner);
      if (key_offset != std::uint32_t(-1))
      {
         in  = get(a, session, id);
         key = in->key().substr(key_offset);
      }

      auto newid = p.first.get_id();
      if constexpr (debug_nodes)
         std::cout << newid.id << ": construct inner_node" << std::endl;
      return std::make_pair(std::move(p.first),
                            new (p.second) inner_node(newid, key, value, branches, children));
   }

   inline std::pair<location_lock, inner_node*> inner_node::make(
       cache_allocator&              a,
       std::unique_lock<gc_session>& session,
       key_view                      prefix,
       object_id                     val,
       uint64_t                      branches)
   {
      uint32_t alloc_size =
          sizeof(inner_node) + prefix.size() + std::popcount(branches) * sizeof(object_id);
      auto p  = a.alloc(session, alloc_size, node_type::inner);
      auto id = p.first.get_id();
      if constexpr (debug_nodes)
         std::cout << id.id << ": construct inner_node" << std::endl;
      return std::make_pair(std::move(p.first),
                            new (p.second) inner_node(id, prefix, val, branches));
   }

   inline inner_node::inner_node(object_id id, key_view prefix, object_id val, uint64_t branches)
       : _prefix_length(prefix.size()),
         _reserved_a(0),
         _reserved_b(0),
         _value(val),
         _present_bits(branches)
   {
      if constexpr (debug_nodes)
         std::cout << id.id << ": inner_node(): value=" << val.id << std::endl;
      std::memset(children(), 0, sizeof(object_id) * num_branches());
      std::memcpy(key_ptr(), prefix.data(), prefix.size());
   }
   /*
    *  Constructs a copy of in with the branches selected by 'branches'
    */
   inline inner_node::inner_node(object_id  id,
                                 key_view   prefix,
                                 object_id  val,
                                 uint64_t   branches,
                                 object_id* new_children)
       : _prefix_length(prefix.size()),
         _reserved_a(0),
         _reserved_b(0),
         _value(val),
         _present_bits(branches)
   {
      if constexpr (debug_nodes)
         std::cout << id.id << ": inner_node(): value=" << val.id << std::endl;
      std::memcpy(children(), new_children, num_branches() * sizeof(object_id));
      std::memcpy(key_ptr(), prefix.data(), prefix.size());

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

   // last branch <= b
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

   inline void release_node(session_lock_ref<> l, cache_allocator& ra, object_id obj)
   {
      if (!obj)
         return;
      auto [ptr, type] = ra.release(l, obj);
      if (ptr && type == node_type::inner)
      {
         auto& in = *reinterpret_cast<inner_node*>(ptr);
         if constexpr (debug_nodes)
            std::cout << obj.id << ": destroying; release value " << in.value().id << std::endl;
         release_node(l, ra, in.value());
         auto nb  = in.num_branches();
         auto pos = in.children();
         auto end = pos + nb;
         while (pos != end)
         {
            assert(*pos);
            if constexpr (debug_nodes)
               std::cout << obj.id << ": destroying; release child " << pos->id << std::endl;
            release_node(l, ra, *pos);
            ++pos;
         }
      }
      if (ptr && type == node_type::roots)
      {
         auto& vn    = *reinterpret_cast<value_node*>(ptr);
         auto  n     = vn.num_roots();
         auto  roots = vn.roots();
         while (n--)
         {
            if constexpr (debug_nodes)
               std::cout << obj.id << ": destroying; release root " << roots->id << std::endl;
            release_node(l, ra, *roots++);
         }
      }
   }

   inline location_lock copy_node(cache_allocator&              ra,
                                  std::unique_lock<gc_session>& session,
                                  object_id                     id,
                                  void*                         ptr,
                                  node_type                     type)
   {
      if (type != node_type::inner)
      {
         auto src          = reinterpret_cast<value_node*>(ptr);
         auto [lock, dest] = value_node::clone(ra, session, id, src->key(), 0, src->data(), type);
         return std::move(lock);
      }
      else
      {
         auto src = reinterpret_cast<inner_node*>(ptr);
         auto [lock, dest] =
             inner_node::clone(ra, session, id, src, src->key(), 0, src->value(), src->branches());
         return std::move(lock);
      }
   }

   inline object_id bump_refcount_or_copy(cache_allocator&              ra,
                                          std::unique_lock<gc_session>& session,
                                          object_id                     id)
   {
      if (!id)
         return id;
      if constexpr (debug_nodes)
         std::cout << id.id << ": bump_refcount_or_copy" << std::endl;
      if (ra.bump_count(id))
         return id;
      auto [ptr, type, ref] = ra.get_cache<false>(session, id);
      return copy_node(ra, session, id, ptr, type).get_id();
   }
}  // namespace triedent
