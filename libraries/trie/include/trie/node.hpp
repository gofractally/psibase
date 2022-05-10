#pragma once
#include <iostream>
#include <trie/palloc.hpp>

namespace trie
{
   using std::string_view;

   /* a leaf which fits in the offset ptr space */
   struct small_leaf
   {
      inline const char* data() const { return (const char*)this; }
      inline char*       data() { return (char*)this; }
      inline uint32_t    capacity() const { return 4; }
      inline uint32_t    size() { return data()[4]; }
      inline bool        resize(uint32_t s)
      {
         if (s > 4)
            return false;
         data()[4] = s;
         return true;
      }
   };

   /* a leaf whose size is the size of the alloc page */
   struct full_leaf
   {
      inline full_leaf(string_view d)
      {
         assert(size() == d.size());
         memcpy(data(), d.data(), d.size());
      }
      inline const char* data() const { return (const char*)this; }
      inline char*       data() { return (char*)this; }

      inline uint32_t size() const
      {
         auto ph = (page_header*)(uint64_t(this) & (-1ull << page_header::lower_bits));
         return ph->obj_size;
      }
      inline uint32_t capacity() const { return size(); }
      inline bool     resize(uint32_t s) { return false; }
   };

   /* a leaf whose size isn't a multiple of 8 */
   struct leaf
   {
      inline leaf(string_view d)
      {
         auto c    = capacity();
         data()[c] = 7 - d.size() % 8;
         memcpy(data(), d.data(), d.size());
         assert(size() == d.size() or !"unexpected size");
      }

      inline const char* data() const { return (const char*)this; }
      inline char*       data() { return (char*)this; }

      inline uint32_t size() const
      {
         auto    ph          = (page_header*)(uint64_t(this) & (-1ull << page_header::lower_bits));
         uint8_t spare_space = data()[ph->obj_size - 1];
         return ph->obj_size - spare_space - 1;
      }
      inline uint32_t capacity() const
      {
         auto ph = (page_header*)(uint64_t(this) & (-1ull << page_header::lower_bits));
         return ph->obj_size - 1;
      }
      inline bool resize(uint32_t s)
      {
         uint32_t c = capacity();
         if (s > c || c / 8 != s / 8)
            return false;
         data()[c] = 8 - s % 8;
         assert(size() == s || !"unexpected size");
         return true;
      }
   };
   struct inner;

   /**
    *  Points to a reference counted leaf or node and encoded
    *  small leafs into the pointer itself.  
    */
   struct node_ptr
   {
      node_ptr() : offset(0) {}
      node_ptr(string_view d, arena& a);
      node_ptr(inner* obj, arena& a);
      node_ptr(const node_ptr& cpy);
      node_ptr(node_ptr&& mv);

      template <typename T>
      const T& as() const
      {
         assert(not is_null());
         return *reinterpret_cast<const node_ptr_impl<T>*>(get_shared<T>())->get();
      }

      template <typename T>
      T& as()
      {
         assert(not is_null());
         return *(reinterpret_cast<node_ptr_impl<T>*>(get_shared<T>())->get());
      }

      inline const char* data() const;
      inline uint32_t    size() const;
      inline char*       data() { return const_cast<char*>(std::as_const(*this).data()); }
      inline uint32_t    ref_count() const { return get_shared<char>()->ref_count(); }

      /**
       * Returns the maximum number of bytes that the value
       * can be grow without requiring a realloc
       */
      inline uint32_t    capacity() const;
      inline string_view value() const { return string_view(data(), size()); }

      node_ptr& operator=(const node_ptr& p);
      node_ptr& operator=(node_ptr&& p);

      inline inner& as_inner()
      {
         assert(is_inner());
         return *get_shared<inner>()->get();
      }
      inline inner& as_inner() const
      {
         assert(is_inner());
         return *get_shared<inner>()->get();
      }
      inline bool is_value() const { return not is_null() and not is_inner(); }
      inline bool is_inner() const { return type() == inner_type; }
      inline bool is_null() const { return offset == 0; }

      ~node_ptr();

      friend bool operator == ( const node_ptr& a, const node_ptr& b ) {
         return a.get_shared<char>() == b.get_shared<char>();
      }
      friend bool operator != ( const node_ptr& a, const node_ptr& b ) {
         return a.get_shared<char>() != b.get_shared<char>();
      }

     private:
      enum types
      {
         null_type       = 0,
         inner_type      = 1,
         leaf_type       = 2,  // leaf has some spare capacity, determined by last byte
         small_leaf_type = 3,  // leaf stored in this->offset (size less than 4)
         full_leaf_type  = 4   // size of leaf is size of memalloc
      };
      static constexpr const uint64_t type_mask = 0x07;
      /// a leaf whose data size is 0 to 4 and stored within the offset
      inline bool is_small_leaf() const { return type() == small_leaf_type; }
      inline bool is_full_leaf() const { return type() == full_leaf_type; }
      inline bool is_leaf() const { return type() == leaf_type; }

      inline types type() const { return types((uint64_t(this) + offset) & type_mask); }

      /*
       * Stores a reference counted offset pointer to T and deletes/frees it when
       * the reference count gets to 0
       */
      template <typename T>
      struct node_ptr_impl
      {
         node_ptr_impl() : offset(0), refcount(0) {}
         node_ptr_impl(T* v) : offset((char*)v - (char*)this), refcount(1) {}

         inline void retain()const { ++refcount; }
         inline void release()
         {
            assert(refcount > 0);
            if (--refcount == 0)
            {
               //std::cerr << "release: " <<typeid(T).name()<<"\n";
               //   std::cerr << "release() and free obj:  " << obj <<"\n";
               //   std::cerr << "release() and free this: " << this <<"\n";

               if constexpr (not std::is_same_v<char, T>)
               {
                  auto obj = get();
                  obj->~T();
                  arena::free(obj);
               }
               arena::free(this);
            }
         }

         inline T* get() const { return reinterpret_cast<T*>(((char*)this) + offset); }
         inline T*       get() { return reinterpret_cast<T*>(((char*)this) + offset); }

         inline uint32_t ref_count() const { return refcount; }

         char* offset_pos() const { return (char*)this; }

        private:
         int64_t offset : 48;
         mutable int64_t refcount : 16;

         ~node_ptr_impl() { assert(refcount == 0); }
      };  //__attribute__((packed));

      static_assert(sizeof(node_ptr_impl<char>) == 8, "unexpeced padding");

      template <typename T>
      node_ptr_impl<T>* get_shared()
      {
         char* pos = (char*)((int64_t(this) + offset) & ~type_mask);
         return reinterpret_cast<node_ptr_impl<T>*>(pos);
      }

      template <typename T>
      const node_ptr_impl<T>* get_shared() const
      {
         const char* pos = (const char*)((int64_t(this) + offset) & ~type_mask);
         return reinterpret_cast<const node_ptr_impl<T>*>(pos);
      }

      int64_t offset : 48;  /// offset to node_ptr_impl<T>
      friend struct inner;

   } __attribute__((packed));
   static_assert(sizeof(node_ptr) == 6, "unexpeced padding");
   static_assert(sizeof(node_ptr[2]) == 12, "unexpeced padding");

   /**
    *  An inner node of the tree
    */
   struct inner
   {
      static inline inner* make(arena& a, uint8_t max_size, const string_view pre, uint32_t ver = 0);
      static inline inner* make(arena& a, uint8_t max_size, const string_view pre, const inner& cpy, uint32_t ver = 0);
      static inline inner* make(arena& a, const string_view pre, uint64_t branches, const inner& cpy, uint32_t ver = 0);

      inline node_ptr*       branch(uint8_t b);
      inline const node_ptr* branch(uint8_t b) const;

      // TODO: pass value by reference?
      inline bool set_branch(uint8_t branch, node_ptr value);
      inline void set_value(node_ptr v)
      {
         assert(not v.is_inner());
         value_ptr = std::move(v);
      }
      inline node_ptr&       value() { return value_ptr; }
      inline const node_ptr& value() const { return value_ptr; }

      inline uint64_t branches() const { return present_bits; }

      uint8_t lower_bound(uint8_t b) const;
      int8_t  reverse_lower_bound(uint8_t b) const;
      uint8_t upper_bound(uint8_t b) const;

      /* num branches + any value stored on this node*/
      inline uint32_t    num_children() const { return num_branches() + not value_ptr.is_null(); }
      inline uint8_t     num_branches() const { return std::popcount(present_bits); }
      inline uint8_t     max_branches() const { return _max_branches; }
      inline string_view prefix() const { return string_view(prefix_pos(), prefix_length); }
      inline bool        set_prefix(string_view pre)
      {
         if (pre.size() <= prefix_length)
         {
            memcpy(prefix_pos(), pre.data(), pre.size());
            prefix_length = pre.size();
            return true;
         }
         return false;
      }

      uint32_t version()const { return _version; }
     protected:
      inner(const inner& cpy) = delete;
      inner(uint8_t max_size, string_view pre = string_view(), uint32_t ver = 0);
      inner(uint8_t max_size, const inner& cpy, string_view pre = string_view(), uint32_t ver = 0);
      inner(const inner& cpy, uint64_t branches, string_view pre = string_view(), uint32_t ver = 0);
      friend struct node_ptr;
      ~inner();

      inline int32_t branch_index(uint8_t branch);

      uint8_t  _max_branches = 0;
      uint8_t  prefix_length = 0;
      node_ptr value_ptr;
      uint64_t present_bits = 0;
      uint32_t _version      = 0;

      node_ptr* children()
      {
         return reinterpret_cast<node_ptr*>((char*)&_version+ sizeof(_version));
      }
      const node_ptr* children()const
      {
         return reinterpret_cast<const node_ptr*>((char*)&_version+ sizeof(_version));
      }
      const char* prefix_pos() const { return const_cast<inner*>(this)->prefix_pos(); }
      char*       prefix_pos()
      {
         return ((char*)children()) + _max_branches * sizeof(node_ptr);
      }
   };

   static_assert(sizeof(inner) == (8 * 2)+8, "unexpected padding");

   //=========================================
   // node_ptr function implmentation
   //========================================

   inline node_ptr::node_ptr(string_view d, arena& a)
   {
      if (false)  //d.size() < 5)  // small leaf
      {
         auto ptr = new (a.alloc(sizeof(node_ptr_impl<char>))) node_ptr_impl<char>();
         offset   = (const char*)ptr - (const char*)this;
         offset += small_leaf_type;
         memcpy(ptr, d.data(), d.size());
         ptr->offset_pos()[4] = d.size();
      }
      else if (d.size() % 8)  // leaf
      {
         auto val = new (a.alloc(d.size())) leaf(d);
         auto ptr = new (a.alloc(sizeof(node_ptr_impl<leaf>))) node_ptr_impl<leaf>(val);
         offset   = (const char*)ptr - (const char*)this;
         offset += leaf_type;
      }
      else  // full leaf
      {
         auto val = new (a.alloc(d.size())) full_leaf(d);
         auto ptr = new (a.alloc(sizeof(node_ptr_impl<full_leaf>))) node_ptr_impl<full_leaf>(val);
         offset   = (const char*)ptr - (const char*)this;
         offset += full_leaf_type;
      }
   }

   inline node_ptr::node_ptr(inner* obj, arena& a)
   {
      auto ptr = new (a.alloc(sizeof(node_ptr_impl<inner>))) node_ptr_impl<inner>(obj);
      offset   = (const char*)ptr - (const char*)this;
      offset += inner_type;
   }

   inline node_ptr::node_ptr(const node_ptr& cpy)
      :offset(0)
   {
      if (not cpy.is_null())
      {
         auto s = cpy.get_shared<char>();
         s->retain();
         offset = (char*)s - (char*)this;
         offset += cpy.type();
      }
   }

   inline node_ptr::node_ptr(node_ptr&& mv)
      :offset(0)
   {
      if (not mv.is_null())
      {
         auto s = (char*)mv.get_shared<char>();
         offset = s - (char*)this;
         offset += mv.type();
         mv.offset = 0;
      }
   }
   inline node_ptr& node_ptr::operator=(const node_ptr& p)
   {
      if (&p == this)
         return *this;

      if (not is_null())
         this->~node_ptr();

      if (p.is_null())
      {
         offset = 0;
         return *this;
      }

      auto s = p.get_shared<char>();
      s->retain();
      offset = (char*)s - (char*)this;
      offset += p.type();
      return *this;
   }
   inline node_ptr& node_ptr::operator=(node_ptr&& p)
   {
      if (&p == this)
         return *this;
      if (not is_null())
         this->~node_ptr();
      if (p.is_null())
         offset = 0;
      else
      {
         offset = (char*)p.get_shared<char>() - (char*)this;
         offset += p.type();

         p.offset = 0;
      }
      return *this;
   }

   inline node_ptr::~node_ptr()
   {
      if (offset)
      {
         switch (type())
         {
            case inner_type:
               get_shared<inner>()->release();
               break;
            case leaf_type:
               get_shared<leaf>()->release();
               break;
            case full_leaf_type:
               get_shared<full_leaf>()->release();
               break;
            case small_leaf_type:
               get_shared<char>()->release();
               break;
            default:
               return;
         }
      }
   }

   inline const char* node_ptr::data() const
   {
      switch (type())
      {
         case leaf_type:
            return get_shared<leaf>()->get()->data();
         case full_leaf_type:
            return get_shared<full_leaf>()->get()->data();
         case small_leaf_type:
            return (char*)get_shared<full_leaf>();
         case null_type:
         case inner_type:
         default:
            return nullptr;
      }
   }

   inline uint32_t node_ptr::size() const
   {
      switch (type())
      {
         case leaf_type:
            return as<leaf>().size();
         case full_leaf_type:
            return as<full_leaf>().size();
         case small_leaf_type:
            return ((char*)get_shared<small_leaf>())[4];
         case null_type:
         case inner_type:
         default:
            return 0;
      }
   }
   inline uint32_t node_ptr::capacity() const
   {
      switch (type())
      {
         case small_leaf_type:
            return 4;
         case leaf_type:
            return as<leaf>().capacity();
         case full_leaf_type:
            return as<full_leaf>().capacity();

         case inner_type:
         case null_type:
         default:
            return 0;
      }
   }

   //===========================
   // inner impl
   //===========================
   inline inner* inner::make(arena& a, const string_view pre, uint64_t branches, const inner& cpy, uint32_t ver )
   {
      auto     max_size   = std::popcount(branches);
      uint32_t alloc_size = sizeof(inner) + max_size * sizeof(node_ptr) + pre.size();
      return new (a.alloc(alloc_size)) inner(cpy, branches, pre, ver);
   }
   inline inner* inner::make(arena& a, uint8_t max_size, const string_view pre, uint32_t ver )
   {
      assert(max_size <= 64);
      assert(pre.size() <= 256);
      uint32_t alloc_size = sizeof(inner) + max_size * sizeof(node_ptr) + pre.size();
      return new (a.alloc(alloc_size)) inner(max_size, pre, ver);
   }

   inline inner* inner::make(arena& a, uint8_t max_size, const string_view pre, const inner& cpy, uint32_t ver)
   {
      assert(max_size <= 64);
      assert(pre.size() <= 256);
      assert(max_size >= cpy.num_branches());

      uint32_t alloc_size = sizeof(inner) + max_size * sizeof(node_ptr) + pre.size();
      return new (a.alloc(alloc_size)) inner(max_size, cpy, pre, ver);
   }

   inline inner::inner(uint8_t max_size, const string_view pre, uint32_t ver )
      :_version(ver)
   {
      assert(pre.size() <= 255);
      assert(max_size <= 64);
      _max_branches = max_size;
      prefix_length = pre.size();
      present_bits  = 0;

      memset(children(), 0, sizeof(node_ptr) * (_max_branches));
      memcpy(prefix_pos(), pre.data(), pre.size());
   }

   inline inner::inner(const inner& cpy, uint64_t branches, const string_view pre, uint32_t ver)
      :_version(ver)
   {
      assert(_max_branches <= cpy._max_branches);

      _max_branches = std::popcount(branches);
      prefix_length = pre.size();
      memcpy(prefix_pos(), pre.data(), pre.size());

      memset(children(), 0, sizeof(node_ptr) * (_max_branches));
      value_ptr    = cpy.value_ptr;
      present_bits = branches;

      auto c  = children();
      auto cc = cpy.children();
      auto ce = cc + cpy.num_branches();

      auto nb = present_bits;
      auto ob = cpy.present_bits;
      while (cc != ce)
      {
         int nr = std::countr_zero(nb);
         int cr = std::countr_zero(ob);
         if (nr == cr)
         {
            *c = *cc;
            ++c;
            nb >>= nr + 1;
            ob >>= nr + 1;
         }
         else
         {
            nb >>= cr + 1;
            ob >>= cr + 1;
         }
         ++cc;
      }
   }

   inline inner::inner(uint8_t max_size, const inner& cpy, const string_view pre, uint32_t ver)
      :_version(ver)
   {
      assert(pre.size() <= 255);
      assert(_max_branches <= 64);

      _max_branches = max_size;
      prefix_length = pre.size();
      value_ptr     = cpy.value_ptr;
      present_bits  = cpy.present_bits;

      memset(children(), 0, sizeof(node_ptr) * (_max_branches));

      auto c  = children();
      auto cc = cpy.children();
      auto nb = cpy.num_branches();
#if 0
      auto ce = c + cpy.num_branches();
      if( c != ce ) {
         *c = *cc;
         int64_t delta = int64_t(cc->offset) - int64_t(c->offset);
         ++c;
         ++cc;
      //   memcpy( c, cc, (char*)ce - (char*)c );
      //   --nb;

         while( c != ce ) {
            c->offset = cc->offset - delta;
            c->get_shared<char>()->retain();
            ++c;
            ++cc;
         }



         /*
         for( int i = 0; i < nb; ++i )
            c[i].offset = cc[i].offset - delta;

         for( int i = 0; i < nb; ++i )
            c[i].get_shared<char>()->retain();
            */
      }
#else 
      auto ce = cc + cpy.num_branches();
      while (cc != ce)
      {
         *c = *cc;
      //   std::cout << int64_t(c->offset - cc->offset) <<"\n";
         ++cc;
         ++c;
      }
#endif
      memcpy(prefix_pos(), pre.data(), pre.size());
   }
   inline inner::~inner()
   {
      auto c  = children();
      auto ce = c + num_branches();
      while (c != ce)
      {
         c->~node_ptr();
         ++c;
      }
   }
   inline std::string tobin(uint64_t x)
   {
      std::string out;
      for (uint32_t i = 0; i < 64; ++i)
      {
         out += char('0' + (x & 1ull));
         x >>= 1;
      }
      return out;
   }

   // @return the first branch >= b
   inline uint8_t inner::lower_bound(uint8_t b) const
   {
      const uint64_t mask = (-1ull << (b & 63));
      return b >= 64 ? 64 : std::countr_zero(present_bits & mask);
   }
   inline int8_t inner::reverse_lower_bound(uint8_t b) const
   {
      //const uint64_t mask = ~(-1ull << (b & 63));
      const uint64_t mask = b == 63 ? -1ull : ~(-1ull << ((b+1) & 63));
      return 63 - std::countl_zero(present_bits & mask);
   }

   // @return the first branch > b, if b == 63 then
   // this will return 64
   inline uint8_t inner::upper_bound(uint8_t b) const
   {
      const uint64_t mask = (-1ull << ((b + 1) & 63));
      return b >= 63 ? 64 : std::countr_zero(present_bits & mask);
   }

   // @return num_children if not found
   inline int32_t inner::branch_index(uint8_t branch)
   {
      assert(branch < 64);
      const int      maskbits = branch % 64;
      const uint64_t mask     = -1ull >> (63 - maskbits);

      bool found = present_bits & 1ull << maskbits;
      if (not found)
         return -1;

      return std::popcount(present_bits & mask) - 1;
   }

   // @return nullptr if no branch found
   inline node_ptr* inner::branch(uint8_t b)
   {
      assert(b < 64);
      auto idx   = branch_index(b);
      auto found = idx >= 0;
      if (not found)
         return nullptr;
      return children() + idx;
   }

   inline const node_ptr* inner::branch(uint8_t b) const
   {
      return const_cast<const node_ptr*>(const_cast<inner*>(this)->branch(b));
   }
   inline bool inner::set_branch(uint8_t b, node_ptr value)
   {
      assert(b < 64);
      auto current = branch(b);
      if (current)
      {
         *current = std::move(value);
      }
      else
      {
         auto num_child = num_branches();

         if (num_child == max_branches())
            return false;

         const uint64_t maskbits = b % 64;
         present_bits |= (1ull << maskbits);

         int ni = branch_index(b);

         node_ptr* first   = children();
         node_ptr* new_pos = first + ni;
         node_ptr* end_pos = first + num_child;
         while (end_pos != new_pos)
         {
            *end_pos = std::move(*(end_pos - 1));
            --end_pos;
         }
         *new_pos = std::move(value);

         assert(new_pos == branch(b));
      }
      return true;
   }

}  // namespace trie
