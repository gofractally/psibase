#pragma once
#include <triedent/debug.hpp>
#include <triedent/seg_allocator.hpp>

#include <cstring>

namespace triedent
{
   inline constexpr bool debug_nodes = false;

   using key_view   = std::string_view;
   using value_view = std::string_view;
   using key_type   = std::string;
   using value_type = key_type;

   using session_rlock = seg_allocator::session::read_lock;
   template <typename T = char>
   using object_ref = session_rlock::object_ref<T>;

   object_id bump_refcount_or_copy(session_rlock& state, object_id id);

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

      inline static object_ref<value_node> make(session_rlock& state,
                                                key_view       key,
                                                value_view     val,
                                                node_type      type)
      {
         assert(val.size() < 0xffffff - key.size() - sizeof(value_node));
         uint32_t alloc_size = sizeof(value_node) + key.size() + val.size();
         auto     r          = state.alloc(alloc_size, type);
         if constexpr (debug_nodes)
            std::cout << r.id().id << ": construct value_node: type=" << (int)type << 
                    " ref = " <<r.ref_count() << std::endl;
         new (r.data()) value_node(key, val);
         return r;
      }

      // If id is non-null, it must refer to a source object that is being copied
      // Otherwise, key and value must be pointers to external memory
      inline static object_ref<value_node> clone(session_rlock& state,
                                                 object_id      id,
                                                 key_view       key,
                                                 std::uint32_t  key_offset,
                                                 value_view     val,
                                                 node_type      type)
      {
         if (id && type == node_type::roots)
         {
            return clone_roots(state, id, key, key_offset, val, type);
         }
         else
         {
            return clone_bytes(state, id, key, key_offset, val, type);
         }
      }

      inline static object_ref<value_node> clone_bytes(session_rlock& state,
                                                       object_id    id,
                                                       key_view       key,
                                                       std::uint32_t  key_offset,
                                                       value_view     val,
                                                       node_type      type)
      {
         if (key_offset != std::uint32_t(-1))
            key = key.substr(key_offset);
         assert(val.size() < 0xffffff - key.size() - sizeof(value_node));
         uint32_t alloc_size = sizeof(value_node) + key.size() + val.size();
         // alloc invalidates key and val
         auto r = state.alloc(alloc_size, type);
         if (id)
         {
            auto ptr = state.get(id).as<value_node>();
            if (key_offset != std::uint32_t(-1))
            {
               key = ptr->key().substr(key_offset);
            }
            val = ptr->data();
         }
         if constexpr (debug_nodes)
            std::cout << r.id().id << ": construct value_node: type=" << (int)type << std::endl;
         new (r.data()) value_node(key, val);
         return r;
      }

      // TODO: all clone functions should take object_ref instead of id to avoid
      // having to look up the object twice!
      inline static object_ref<value_node> clone_roots(session_rlock& state,
                                                       object_id      id,
                                                       key_view       key,
                                                       std::uint32_t  key_offset,
                                                       value_view     val,
                                                       node_type      type)
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
            roots[i] = bump_refcount_or_copy(state, roots[i]);
         }
         auto r = state.alloc(alloc_size, type);
         {
            if (key_offset != std::uint32_t(-1))
            {
               auto& in = state.get(id).as_value_node();
               key     = in.key().substr(key_offset);
            }
            val = {reinterpret_cast<const char*>(&roots[0]), value_size};
         }
         if constexpr (debug_nodes)
            std::cout << r.id().id << ": construct value_node: type=" << (int)type << std::endl;
         return r;
      }

     private:
#if 0  // this shouldn't be needed any more
      static value_node* get(session_rlock& state, object_id id)
      {
         //auto [ptr, type, ref] = a.get_cache<false>(session, id);
         auto val = state.get(id, false /* NO COPY */);
         return reinterpret_cast<value_node*>(val.obj());
      }
#endif
      value_node(key_view key, value_view val)
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

      inline static object_ref<inner_node> clone(session_rlock&    state,
                                                 object_id         id,
                                                 const inner_node* in,
                                                 key_view          key,
                                                 std::uint32_t     key_offset,
                                                 object_id         value,
                                                 std::uint64_t     branches);

      inline static object_ref<inner_node> make(session_rlock& state,
                                                key_view       prefix,
                                                object_id      val,
                                                uint64_t       branches);

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
#if 0
      static inner_node* get(session_rlock& state, object_id id)
      {
         auto ptr = a.get(id, false);  // TODO: why not copy here?
         return reinterpret_cast<inner_node*>(ptr.obj());
      }
#endif

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

   inline object_ref<inner_node> inner_node::clone(session_rlock&    state,
                                                   object_id         id,
                                                   const inner_node* in,
                                                   key_view          key,
                                                   std::uint32_t     key_offset,
                                                   object_id         value,
                                                   std::uint64_t     branches)
   {
      if (key_offset != std::uint32_t(-1))
         key = key.substr(key_offset);
      const std::size_t n          = std::popcount(branches);
      uint32_t          alloc_size = sizeof(inner_node) + key.size() + n * sizeof(object_id);
      object_id         children[n + 1];
      if (in->_present_bits == branches)
      {
         std::memcpy(&children[0], in->children(), n*sizeof(object_id));
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
      value = bump_refcount_or_copy(state, value);
      for (std::size_t i = 0; i < n; ++i)
      {
         children[i] = bump_refcount_or_copy(state, children[i]);
      }
      auto p = state.alloc(alloc_size, node_type::inner);
      if (key_offset != std::uint32_t(-1))
      {
         in  = state.get(id, false).as<inner_node>();
         key = in->key().substr(key_offset);
      }

      auto newid = p.id();
      if constexpr (debug_nodes)
         std::cout << newid.id << ": construct inner_node " << std::endl;

      new (p.data()) inner_node(newid, key, value, branches, children);
      return p;
   }

   inline object_ref<inner_node> inner_node::make(session_rlock& state,
                                                  key_view       prefix,
                                                  object_id      val,
                                                  uint64_t       branches)
   {
      uint32_t alloc_size =
          sizeof(inner_node) + prefix.size() + std::popcount(branches) * sizeof(object_id);
      auto p  = state.alloc(alloc_size, node_type::inner);
      auto id = p.id();
      if constexpr (debug_nodes)
         std::cout << p.id().id << ": construct inner_node val="<<val.id<< " ref: " << p.ref_count()<<std::endl;

      new (p.data()) inner_node(id, prefix, val, branches);
      return p;
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

   inline void release_node(session_rlock& state, object_id obj)
   {
      if (!obj)
         return;
      auto oref = state.get(obj, false);  // don't try to cache, we are releasing!
      auto ctype = oref.type();

//      std::cerr << "before release node: " << obj.id <<" type: " << (int)oref.type() <<" loc: " << oref.location()._offset <<" ref: " << oref.ref_count()<<"\n";

      auto& in = oref.as_inner_node();
      if (oref.release())
      {
         if (ctype == node_type::inner)
         {
      //      auto& in =
      //          oref.as_inner_node(); 
            if constexpr (debug_nodes)
               std::cout << obj.id << ": destroying; release value " << in.value().id << std::endl;
            release_node(state, in.value());
            auto nb  = in.num_branches();
            auto pos = in.children();
            auto end = pos + nb;
            while (pos != end)
            {
               assert(*pos);
               if constexpr (debug_nodes)
                  std::cout << obj.id << ": destroying; release child " << pos->id << std::endl;
               release_node(state, *pos);
               ++pos;
            }
         }
         else if (ctype == node_type::roots)
         {
            auto& vn = reinterpret_cast<const value_node&>(in);//oref.as_value_node();  
            auto  n  = vn.num_roots();
            auto  roots = vn.roots();
            while (n--)
            {
               if constexpr (debug_nodes)
                  std::cout << obj.id << ": destroying; release root " << roots->id << std::endl;
               release_node(state, *roots++);
            }
         }
      }
   }

   inline object_ref<> copy_node(session_rlock& state, object_ref<> oref)
   {
      if (oref.type() != node_type::inner)  // value or roots
      {
         auto& src = oref.as_value_node();  
         return value_node::clone(state, oref.id(), src.key(), 0, src.data(), oref.type());
      }
      else
      {
         auto& src = oref.as_inner_node(); 
         return inner_node::clone(state, oref.id(), &src, src.key(), 0, src.value(),
                                  src.branches());
      }
   }

   inline object_id bump_refcount_or_copy(session_rlock& state, object_id id)
   {
      if (!id)
         return id;
      if constexpr (debug_nodes)
         std::cout << id.id << ": bump_refcount_or_copy" << std::endl;
      auto oref = state.get(id, false);
      if (oref.retain())
         return oref.id();
      return copy_node(state, oref).id();
   }
}  // namespace triedent
