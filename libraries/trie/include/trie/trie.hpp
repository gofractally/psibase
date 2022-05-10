#pragma once
#include <optional>
#include <string>
#include <trie/offset_ptr.hpp>
#include <trie/palloc.hpp>

namespace trie
{
   using std::string_view;
   ///
   //  node  offset_ptr<shared_offset_ptr<leaf|inner>>[]
   //  inner is templated on N (size) to eliminate crazy member access
   //  leaf / inner no longer inherit from base
   //
   //  node child ptrs use lowest bit (below 8 byte resolution) to
   //   indicate, offset must be greater than 6 so values between 1 and
   //   5 can be used as flags.  0 = null, 1 = inner, 2 = big refcount leaf,
   //   3 = leaf of size 5 (stored in this pointer), 4 = leaf of size
   //   4 or less stored in this pointer with size in last byte. What about
   //   alignment garuantees on small values given offstptr is algined on
   //   a 2 byte boundary instead of 8 byte boundary. 

   /**
    *  The data on disk, assumed to be allocated by palloc
    */
   namespace raw
   {
      using palloc::arena;

      struct inner;
      struct leaf;
      struct base;

      using inner_ptr = shared_offset_ptr<inner>;
      using leaf_ptr  = shared_offset_ptr<leaf>;
      using base_ptr  = shared_offset_ptr<base>;

      using oleaf_ptr = std::optional<leaf_ptr>;
      using obase_ptr = std::optional<base_ptr>;

      /* provides intrusive reference counting and polymorphism for
       * leaf and nodes.
       */
      struct base
      {
         static int& global_base_count() { static int c = 0; return c; }
         enum types
         {
            inner_type,
            leaf_type
         };

         inline void retain();
         inline void release();

         uint16_t reference_count() const { return _ref_count; }

         types type() const { return (types)_type; }
         bool  is_inner() const { return _type == inner_type; }
         bool  is_leaf() const { return _type == leaf_type; }

         inline const inner* as_in() const;
         inline inner*       as_in();
         inline const leaf*  as_leaf() const;
         inline leaf*        as_leaf();

        protected:
         base() = delete;
         base(types t = inner_type) : _type(t), _ref_count(0) { ++global_base_count(); }
         ~base() { assert(_ref_count == 0); --global_base_count(); }

        private:
         uint16_t _type : 1;
         uint16_t _ref_count : 15;

      } __attribute__((packed));
      static_assert(sizeof(base) == 2, "unexpected padding");

      /**
       * A reference counted bucket of bytes with size
       */
      struct leaf : public base
      {
         /* return true if resize in place successful, otherwise false */
         bool resize(uint32_t size);

         const char* data() const;
         char*       data();
         uint32_t    size() const;
         uint32_t    capacity() const;
         string_view value() const;

         // these serve as the factory consturctors for leaf, they return a
         // reference counted object which will automatically free them when no
         // longer required.
         static leaf_ptr make(palloc::arena& a, uint32_t size);
         static leaf_ptr make(palloc::arena& a, const string_view& val);

        private:
         friend class base;
         leaf(uint32_t size);
         leaf(const string_view& v);
         leaf() = delete;

         uint8_t spare_space = 0;  /// extra space provided by allocator

      } __attribute__((packed));
      static_assert(sizeof(leaf) == 3, "unexpected padding");

      /**
       *  The value stored at inner comes between prefix() and child(0);
       */
      struct inner : public base
      {
         string_view prefix() const;

         // return nullptr if not found
         const base_ptr* child(uint8_t branch) const;
         base_ptr*       child(uint8_t branch);

         uint32_t num_children() const { return _num_children; }
         uint32_t max_children() const { return _max_children; }

         bool set_child(uint8_t branch, base_ptr b);
         bool remove_child(uint8_t branch);

         // these serve as the factory consturctors for leaf, they return a
         // reference counted object which will automatically free them when no
         // longer required.
         static inner_ptr make(palloc::arena&     a,
                               const string_view& prefix       = {},
                               uint8_t            max_children = 1);

         static inner_ptr make(palloc::arena& a, inner& cpy, int delta_max = 0);

         static inner_ptr make(palloc::arena&     a,
                               const inner&       cpy,
                               const string_view& new_prefix      = string_view(),
                               int                delta_max_child = 0
                               );

         inline void for_each_child(auto lamb) const;

        private:
         friend class base;
         inner()                     = delete;
         void operator delete(void*) = delete;
         void init_children();

         inner(const string_view& prefix, uint8_t max_children);
         inner(inner& cpy, const string_view& prefix, uint8_t max_children);
         ~inner();

         inline static uint32_t alloc_size(uint8_t prefix_size, uint8_t max_children);

         uint8_t _key_size : 8 = 0;  ///< max key size without subnode is 128

         uint16_t _max_children = 0;  ///< space reserved for child pointers
         uint8_t _num_children = 0;  ///< number of child pointers in use

         // char key[_key_size]
         // if not bit mode
         //     uint8_t pres[_max_children]
         //     int48_t child[_max_children]
         // else bit mode
         //     uint8_t  char[pad]
         //     uint64_t pbits[N]

         const base_ptr& child_pos(uint8_t num) const;
         base_ptr&       child_pos(uint8_t num);
         base_ptr*       children() { return &child_pos(0); }
         const base_ptr* children() const { return &child_pos(0); }
         const uint8_t*  present_list_pos() const;
         uint8_t*        present_list_pos();
         const uint64_t* present_bits() const;
         uint64_t*       present_bits();
         const char*     key_pos() const;
         char*           key_pos();
         inline int16_t  child_index(uint8_t branch) const;

         inline static bool using_bit_array(uint16_t maxc) { return maxc > 34; }
         inline bool        using_bit_array() const { return using_bit_array(_max_children); }

      } __attribute__((packed));
      static_assert(sizeof(inner) == sizeof(base) + 4, "unexpected padding");
      static_assert(sizeof(inner) == 6, "unexpected padding");


      inline void inner::for_each_child(auto lamb) const {}


      //============================================
      // raw::base impl
      //============================================

      inline const inner* base::as_in() const
      {
         assert(is_inner());
         return reinterpret_cast<const inner*>(this);
      }
      inline inner* base::as_in()
      {
         assert(is_inner());
         return reinterpret_cast<inner*>(this);
      }
      inline const leaf* base::as_leaf() const
      {
         assert(is_leaf());
         return reinterpret_cast<const leaf*>(this);
      }
      inline leaf* base::as_leaf()
      {
         assert(is_leaf());
         return reinterpret_cast<leaf*>(this);
      }

      inline void base::retain()
      {
         ++_ref_count;
         assert(_ref_count > 0);
      }
      inline void base::release()
      {
         if (not --_ref_count)
         {
            if (is_leaf())
               as_leaf()->~leaf();
            else
               as_in()->~inner();
            arena::free(this);
         }
      }

   }  // namespace raw

   struct trie {
      public:
         using string_view = std::string_view;
         using ostring_view = std::optional<string_view>;
         trie( palloc::arena& a ):_arena(a){}

         bool upsert( const string_view& key, const string_view& value );
         bool remove( const string_view& key );
         ostring_view get( const string_view& key );

      private:
         raw::inner_ptr add_child( raw::inner_ptr& in, const string_view& key, const string_view& value );
         raw::inner_ptr  _root;
         palloc::arena&  _arena;
   };

};  // namespace trie
