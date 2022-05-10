#pragma once
#include <iostream>

namespace trie
{
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
         data()[c - 1] = 8 - c % 8;
         assert(size() == s, "unexpected size");
         return true;
      }
   };

   /**
    *  Points to a reference counted leaf or node and encoded
    *  small leafs into the pointer itself.  
    */
   struct node_ptr
   {
      node_ptr() : offset(0) {}
      node_ptr(const string_view& d);
      template <typename T>
      node_ptr(const T* obj, arena* a = nullptr);
      node_ptr(const node_ptr& cpy);
      node_ptr(node_ptr&& mv);

      enum types
      {
         null_type       = 0,
         inner_type      = 1,
         leaf_type       = 2,  // leaf has some spare capacity, determined by last byte
         small_leaf_type = 3,  // leaf stored in this->offset (size less than 4)
         full_leaf_type  = 4   // size of leaf is size of memalloc
      };
      static constexpr const uint64_t type_mask = 0x07;

      template <typename T>
      const T& as() const
      {
         assert(not is_null());
         return *reinterpret_cast<const T*>(get<T>());
      }

      template <typename T>
      T& as()
      {
         assert(not is_null());
         return *reinterpret_cast<T*>(get<T>());
      }

      const char* data() const;
      uint32_t    size() const;
      char*       data() { return const_cast<char*>(std::as_const<this>->data()); }
      uint32_t    ref_count() const { return get_shared()->ref_count(); }

      /**
       * Returns the maximum number of bytes that the value
       * can be grow without requiring a realloc
       */
      uint32_t    capacity() const;
      string_view value() const { return string_view(data(), data() + size()); }

      /// a leaf whose data size is 0 to 4 and stored within the offset
      bool is_small_leaf() const { return (offset & type_mask) == small_leaf_type; }
      bool is_full_leaf() const { return (offset & type_mask) == full_leaf_type; }
      bool is_leaf() const { return (offset & type_mask) == leaf_type; }
      bool is_inner() const { return (offset & type_mask) == inner_type; }
      bool is_null() const { return offset == null_type; }

      node_ptr& operator=(const node_ptr& p);
      node_ptr& operator=(node_ptr&& p);

     private:
      /**
    * Stores a reference counted offset pointer to T and deletes/frees it when
    * the reference count gets to 0
    */
      template <typename T>
      struct node_ptr_impl
      {
         node_ptr_impl() : offset(0), refcount(0) {}
         node_ptr_impl(T* v) : offset((char*)v - (char*)this), refcount(1), {}

         inline void retain() { ++refcount; }
         inline void release()
         {
            assert(refcount > 0);
            if (--refcount == 0)
            {
               offset   = 0;
               auto obj = get();
               obj->~T();
               arena::free(obj);
               arena::free(this);
            }
         }

         inline const T* get() const { return reinterpret_cast<const T*>(((char*)this) + offset); }
         inline T*       get() { return reinterpret_cast<T*>(((char*)this) + offset); }

         inline uint32_t ref_count() const { return refcount; }

        private:
         int64_t offset : 48;
         int64_t refcount : 16;

         ~node_ptr_impl() { assert(refcount == 0); }
      }  //__attribute__((packed));

      static_assert(sizeof(node_ptr_impl<char>) == 8, "unexpeced padding");

      template <typename T>
      node_ptr_impl<T>* get_shared()
      {
         return reinterpret_cast<node_ptr_impl<T>*>(((char*)this) + uint64_t(offset) &
                                                    ~uint64_t(type_mask));
      }

      template <typename T>
      const node_ptr_impl<T>* get_shared() const
      {
         return reinterpret_cast<const node_ptr_impl<T>*>(((const char*)this) + uint64_t(offset) &
                                                          ~uint64_t(type_mask));
      }

      template <typename T>
      T* get()
      {
         return get_shared<T>()->get();
      }

      template <typename T>
      const T* get() const
      {
         return get_shared<T>()->get();
      }

      ~node_ptr();
      int64_t offset : 48;  /// offset to node_ptr_impl<T>
   };
   static_assert(sizeof(node_ptr<char>) == 6, "unexpeced padding");
   static_assert(sizeof(node_ptr<char>[2]) == 12, "unexpeced padding");

   /**
    *  An inner node of the tree
    */
   struct inner
   {
      inner(uint8_t max_index, const string_view& pre = string_view());
      inner(uint8_t max_index, const inner& cpy, const string_view& pre = string_view());

      inline node_ptr*       branch(uint8_t b);
      inline const node_ptr* branch(uint8_t b) const;

      bool set_branch(uint8_t branch, node_ptr value);

      inline uint32_t    num_branches() const { return uint32_t(max_index) + 1; }
      inline string_view prefix() const { return string_view(prefix_pos, prefix_length); }

     protected:
      uint64_t max_index : 8;
      uint64_t num_children : 8;
      uint64_t prefix_length : 8;
      uint64_t total_children : 40;  /// maximum number of elements in database

      uint64_t  present_bits[256 / 64];
      node_ptr* children() { return (char*)&present_bits + sizeof(present_bits); }
      char*     prefix_pos()
      {
         return (char*)&present_bits + sizeof(present_bits) + (max_index + 1) * sizeof(node_ptr);
      }
      template <uint8_t MaxIndex>
      struct inner_impl<MaxIndex, average> : public inner
      {
         inner_impl(const string_view& pre) : inner(MaxIndex, pre) {}
         inline node_ptr*       branch(uint8_t b) {}
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

   //=========================================
   // node_ptr function implmentation
   //========================================

   node_ptr::node_ptr(const string_view& d)
   {
      static_assert(
          []()
          {
             node_ptr p;
             p.offset = 3;
             return 3 == *((char*)&p)
          }(),
          "unexpected byte order");
      offset = 3;
      assert(d.size() <= 4);
      char* data = (char*)this;
      data[1]    = d.size();
      memcpy(data + 2, d.data(), std::min<uint8_t>(d.size(), 4));
   }

   template <typename T>
   node_ptr::node_ptr(const T* obj, arena* a)
   {
      static_assert(
          std::is_same_v<T, leaf> or std::is_same_v<T, full_leaf> or std::is_same_v<T, inner>,
          "invalid type");

      auto ptr = new (a ? *a : arena::get_arena(obj)) node_ptr_impl<T>(obj);

      offset = (const char*)ptr - (const char*)this;
      offset += std::is_same_v<T, raw::leaf> * 2;
      offset += std::is_same_v<T, raw::inner>;
   }

   node_ptr::node_ptr(const node_ptr& cpy)
   {
      switch (cpy.offset & type_mask)
      {
         case small_leaf_type:
            offset = cpy.offset;
            return;
         case null_type:
            offset = null_type offset = 0;
            return;
         default:
      }
      auto s = cpy.get_shared<char>();
      s->retain();
      offset = s - (char*)this;
      offset += cpy & type_mask;
   }

   node_ptr::node_ptr(node_ptr&& mv)
   {
      switch (cpy.offset & type_mask)
      {
         case small_leaf_type:
            offset = cpy.offset;
            return;
         case null_type:
            offset = null_type offset = 0;
            return;
         default:
      }
      auto s = cpy.get_shared<char>();
      offset = s - (char*)this;
      offset += cpy & type_mask;
      mv.offset = null_type;
   }

   node_ptr::~node_ptr()
   {
      switch ((types)(cpy.offset & type_mask))
      {
         case small_leaf_type:
         case null_type:
            return;
         case leaf_type:
            get_shared<raw::leaf>()->release();
            return;
         case inner_type:
            get_shared<raw::inner>()->release();
         default:
            assert(!"unknown type");
      }
   }

   const char* node_ptr::data() const
   {
      switch (offset & type_mask)
      {
         case small_leaf_type:
            return ((char*)this) + 2;
         case leaf_type:
            return as<leaf>().data();
         default:
            return nullptr;
      }
   }

   uint32_t node_ptr::size() const
   {
      switch (offset & type_mask)
      {
         case small_leaf_type:
            return ((char*)this)[1];
         case leaf_type:
            return as<leaf>().size();
         default:
            return 0;
      }
   }
   uint32_t node_ptr::capacity() const
   {
      switch (offset & type_mask)
      {
         case small_leaf_type:
            return 4;
         case leaf_type:
            return as<leaf>().capacity();
         default:
            return 0;
      }
   }

   //===========================
   // inner impl
   //===========================
   inner::inner(uint8_t max_index, const string_view& pre = string_view()) {}

   inner::inner(uint8_t max_index, const inner& cpy, const string_view& pre = string_view()) {}

   // @return num_children if not found
   inline uint8_t branch_index(uint8_t branch)
   {
      uint32_t      index    = 0;
      const int     maskbits = branch % 64;
      const int     mask     = -1ull >> (63 - maskbits);
      const uint8_t n        = branch / 64;

      index += std::popcount(present_bits[3]) * (n > (64 * 3));
      index += std::popcount(present_bits[2]) * (n > (64 * 2));
      index += std::popcount(present_bits[1]) * (n > (64 * 1));
      index += std::popcount(present_bits[n] & mask) - 1;

      // the invariant is that bits can never be greater than number
      return index;  // int(index and -uint32_t(index < num_children)) - 1;
   }

   // @return nullptr if no branch found
   inline node_ptr* inner::branch(uint8_t b)
   {
      auto idx = branch_index(b);
      // return null ptr if index == num children without using if
      return (node_ptr*)(uint64_t((&children[idx])) and -uint64_t(idx != num_children));
   }

   inline const node_ptr* inner::branch(uint8_t b) const
   {
      return std::as_const(const_cast<node_ptr*>(this)->branch(b));
   }
   inline bool inner::set_branch(uint8_t b, node_ptr value)
   {
      auto current = branch(b);
      if (current)
      {
         current = std::move(value);
      }
      else
      {
         if (num_children == max_index + 1)
            return false;

         const int n        = branch / 64;
         const int maskbits = branch % 64;
         present_bits()[n] |= 1ull << maskbits;

         int ni = child_index(b);

         node_ptr* first   = children();
         node_ptr* new_pos = first + ni;
         node_ptr* end_pos = first + _num_children;
         while (end_pos != new_pos)
         {
            *end_pos = std::move(*(end_pos - 1));
            --end_pos;
         }
         *new_pos = std::move(value);

         ++num_branches;
      }
      return true;
   }

}  // namespace trie
