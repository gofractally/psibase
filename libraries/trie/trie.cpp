#include <palloc/page_header.hpp>
#include <trie/trie.hpp>

namespace trie
{
   namespace raw
   {
      using palloc::page_header;

      //============================================
      //  raw::leaf
      //============================================
      leaf::leaf(uint32_t size) : base(leaf_type)
      {
         auto alloc_size = size + sizeof(leaf);
         spare_space     = page_header::round_up_size(alloc_size) - alloc_size;
         spare_space &= uint64_t(page_header::max_bucket_element_size() < alloc_size) - 1;
      }
      leaf::leaf(const string_view& v) : base(leaf_type)
      {
         auto alloc_size = v.size() + sizeof(leaf);
         spare_space     = page_header::round_up_size(alloc_size) - alloc_size;
         spare_space &= uint64_t(page_header::max_bucket_element_size() < alloc_size) - 1;

         memcpy(data(), v.data(), v.size());
      }

      leaf_ptr leaf::make(palloc::arena& a, uint32_t size)
      {
         return new (a.alloc(size + sizeof(leaf))) leaf(size);
      }
      leaf_ptr leaf::make(palloc::arena& a, const string_view& val)
      {
         return new (a.alloc(val.size() + sizeof(leaf))) leaf(val);
      }

      bool leaf::resize(uint32_t nsize)
      {
         uint32_t old_size = size() + sizeof(leaf);
         uint32_t new_size = nsize + sizeof(leaf);
         bool     can_resize =
             page_header::round_up_size(old_size) == page_header::round_up_size(new_size);

         uint8_t new_spare_space = page_header::round_up_size(new_size) - old_size;
         new_spare_space &= uint64_t(page_header::max_bucket_element_size() < new_size) - 1;

         spare_space *= not can_resize;
         spare_space |= new_spare_space * not can_resize;
         return can_resize;
      }

      const char* leaf::data() const { return ((const char*)&spare_space) + 1; }
      char*       leaf::data() { return ((char*)&spare_space) + 1; }

      /**
       *  Size is calculated using the size of objects defined by the page header
       *  adjusted by an offset for rounding errors as the alloc only works in
       *  increments of 8 bytes
       */
      uint32_t leaf::size() const
      {
         auto ph = (page_header*)(uint64_t(this) & (-1ull << page_header::lower_bits));
         return ph->obj_size - spare_space - sizeof(leaf);
      }

      /**
       * The maximum the string can be resized in place without realloc
       */
      uint32_t leaf::capacity() const
      {
         auto obj_res    = palloc::object_resolution;
         auto cur_size   = size();
         auto alloc_size = cur_size + sizeof(leaf);
         if (alloc_size > page_header::max_bucket_element_size())
            return cur_size;
         return obj_res * ((alloc_size + (obj_res - 1)) / obj_res) - sizeof(leaf);
      }

      string_view leaf::value() const { return string_view(data(), size()); }

      //============================================
      //  raw::inner
      //============================================

      string_view        inner::prefix() const { return string_view(key_pos(), _key_size); }
      inline const char* inner::key_pos() const { return ((const char*)&_num_children) + 1; }
      inline char*       inner::key_pos() { return ((char*)&_num_children) + 1; }

      inline const uint8_t* inner::present_list_pos() const
      {
         return (const uint8_t*)key_pos() + _key_size;
      }
      inline uint8_t* inner::present_list_pos() { return (uint8_t*)key_pos() + _key_size; }

      inline const uint64_t* inner::present_bits() const
      {
         const char* pos = key_pos() + _key_size;
         pos += 8 - (int64_t(pos) % 8);  // padding to align on 64bit
         return reinterpret_cast<const uint64_t*>(pos);
      }
      inline uint64_t* inner::present_bits()
      {
         char* pos = key_pos() + _key_size;
         std::cout << "padding: " << 8 - (int64_t(pos)%8) <<"\n";
         pos += 8 - (int64_t(pos) % 8);  // padding to align on 64bit
         return reinterpret_cast<uint64_t*>(pos);
      }

      inline uint32_t inner::alloc_size(uint8_t prefix_size, uint8_t max_children)
      {
         uint32_t pos = sizeof(inner) + prefix_size + sizeof(base_ptr) * max_children;

         int pad = 8 - (int64_t(pos) % 8);

         const int      bits = sizeof(uint64_t) * 4;
         const uint64_t uba  = -int64_t(inner::using_bit_array(max_children));

         pos += (pad + bits) & uba;
         pos += (max_children) & ~uba;
         return pos;
      }

      const base_ptr& inner::child_pos(uint8_t num) const
      {
         const char* pos = key_pos() + _key_size + sizeof(base_ptr) * num;

         int pad = 8 - (int64_t(pos) % 8);

         const int      bits = sizeof(uint64_t) * 4;
         const uint64_t uba  = -int64_t(using_bit_array());

         pos += (pad + bits) & uba;
         pos += (_max_children) & ~uba;

         return *((const base_ptr*)pos);
      }
      base_ptr& inner::child_pos(uint8_t num)
      {
         const base_ptr& b = const_cast<const inner*>(this)->child_pos(num);
         return const_cast<base_ptr&>(b);
      }

      /**
       * in bit presense mode, returns the index in children() array
       * for the given branch, return _num_children if no child was 
       * found.
       */
      inline int16_t inner::child_index(uint8_t branch) const
      {
         if (using_bit_array())
         {
            uint16_t        index    = 0;
            const int       maskbits = branch % 64;
            const int       mask     = -1ull >> (63 - maskbits);
            int             n        = branch / 64;
            const uint64_t* pb       = present_bits();

            // hack to get only one branch
            n += 4 * not(pb[n] & (1ull << maskbits));

            /// TODO: can elimate the switch by
            /// anding the pop count with 0...
            /// 3 extra pop counts vs 1 branch

            switch (n)
            {
               case 8:
               case 7:
               case 6:
               case 5:
               case 4:
                  return _num_children; /// TODO: what happens when index 0 to 255 are all valid and there are 256 children which don't fit in _num_children
               case 3:
                  index += std::popcount(pb[3]);
               case 2:
                  index += std::popcount(pb[2]);
               case 1:
                  index += std::popcount(pb[1]);
            }
            index += std::popcount(pb[n] & mask) - 1;

            return index;
         }
         else
         {
            auto begin = present_list_pos();
            auto pos   = begin;
            auto end   = begin + _num_children;
            while (pos != end)
            {
               if (*pos == branch)
                  return pos - begin;
               ++pos;
            }
            return _num_children;
         }
      }

      const base_ptr* inner::child(uint8_t branch) const
      {
         if (using_bit_array())
         {
            auto idx = child_index(branch);
            if (idx == _num_children)
               return nullptr;
            return &child_pos(idx);
         }
         else
         {
            auto pc = present_list_pos();
            for (uint8_t c = 0; c < _num_children; ++c)
               if (branch == pc[c])
               {
                  return &child_pos(c);
               }
            return nullptr;
         }
      }
      base_ptr* inner::child(uint8_t branch)
      {
         return const_cast<base_ptr*>(const_cast<const inner*>(this)->child(branch));
      }

      bool inner::set_child(uint8_t branch, base_ptr b)
      {
         std::cout << "setting: " << char(branch) << " to: " << b->as_leaf()->value() << "\n";
         auto idx = child_index(branch);
         std::cout << "idx : " << idx << "\n";

         if (idx < _num_children)
         {
            child_pos(idx) = std::move(b);
            return true;
         }

         if (_num_children == _max_children)
            return false;

         if (using_bit_array())
         {
            std::cout << "using bit array\n";
            const int n        = branch / 64;
            const int maskbits = branch % 64;
            present_bits()[n] |= 1ull << maskbits;

            // get new index... everyone else must move down one
            int ni = child_index(branch);

            base_ptr* first   = &child_pos(0);
            base_ptr* new_pos = first + ni;
            base_ptr* end_pos = first + _num_children;
            while (end_pos != new_pos)
               *end_pos = *(end_pos - 1);
            --end_pos;
            *new_pos = std::move(b);
         }
         else
         {
            std::cout << "using list \n";
            present_list_pos()[_num_children] = branch;
            child_pos(_num_children)          = std::move(b);
         }
         ++_num_children;
         return true;
      }

      bool inner::remove_child(uint8_t branch) { return false; }

      void inner::init_children() { memset(children(), 0, _max_children * sizeof(base_ptr)); }

      inner::inner(const string_view& prefix, uint8_t max_children) : base(inner_type)
      {
         _key_size     = prefix.size();
         _max_children = max_children;
         _num_children = 0;

         memcpy(key_pos(), prefix.data(), _key_size);

         init_children();
      }

      inner::inner(inner& cpy, const string_view& prefix, uint8_t max_children) : base(inner_type)
      {
         _key_size     = prefix.size();
         _max_children = max_children;
         _num_children = cpy._num_children;

         memcpy(key_pos(), prefix.data(), _key_size);

         init_children();

         auto this_pos = children();
         auto cpy_pos  = cpy.children();
         auto cpy_end  = cpy_pos + cpy.num_children();
         while (cpy_pos != cpy_end)
         {
            std::cout << present_bits() << "...\n";
            *this_pos        = *cpy_pos;
            ++cpy_pos;
            ++this_pos;
         }

         if (using_bit_array() == cpy.using_bit_array())
         {
            if( not using_bit_array() ) 
               memcpy(present_list_pos(), cpy.present_list_pos(), _num_children);
            else 
               memcpy(present_bits(), cpy.present_bits(), sizeof(uint64_t[4]));
         }
         else 
         {
            if( using_bit_array() and not cpy.using_bit_array() ) {
               auto pl = cpy.present_list_pos();
               auto ple = pl + _num_children;
               while( pl != ple ) {
                  uint8_t branch = *pl;

                  const int n        = branch / 64;
                  const int maskbits = branch % 64;
                  present_bits()[n] |= 1ull << maskbits;

                  /// set bit *cur;
                  ++pl;
               }
            }
            else // not using_bit_array() and cpy.using_bit_array()
            {
               auto pb = cpy.present_bits();
               /*
               for( int n = 0; n < 4; ++n ) {
                  pb[n]
                  
               }
               */
            }
         }
      }

      inner_ptr inner::make(palloc::arena& a, const string_view& prefix, uint8_t max_children)
      {
         int size = alloc_size(prefix.size(), max_children);
         return new (a.alloc(size)) inner(prefix, max_children);
      }

      // cpy is passed by ref because it increments ref counts
      inner_ptr inner::make(palloc::arena& a, inner& cpy, int delta_max_child)
      {
         auto    pre = cpy.prefix();
         uint8_t new_max =
             std::max<uint8_t>(cpy.num_children(), cpy.max_children() + delta_max_child);
         int size = alloc_size(pre.size(), new_max);
         return new (a.alloc(size)) inner(cpy, cpy.prefix(), new_max);
      }

      inner::~inner()
      {
         auto c = children();
         auto e = c + _num_children;
         while (c != e)
         {
            c->~base_ptr();
            ++c;
         }
      }

#if 0
      inner& inner::clone(arena& a, const string_view& new_prefix, int delta_max_child) const
      {
         assert(_max_children + delta_max_child >= _num_children ||
                !"delta would not leave enough space for cloned children");

         auto c = make(a, new_prefix, _max_children + delta_max_child);

         if (using_bit_array() and not c->using_bit_array())
         {
            for_each_child(
                [&](uint8_t branch, const base_ptr& child)
                {
                   //   c->set_child( branch, child.get() );
                });
         }
         else if (using_bit_array() == c->using_bit_array())
         {
            /*
            memcpy(c->present_bits(), present_bits(), sizeof(uint64_t[4]));
            for (int i = 0; i < _num_children; ++i)
               c->child_pos(i) = child_pos(i);
            c->_num_children = _num_children;
            */
         }
         else
         {
            /*
            memcpy(c->present_list_pos(), present_list_pos(), _num_children);
            for (int i = 0; i < _num_children; ++i)
               c->child_pos(i) = child_pos(i);
            c->_num_children = _num_children;
            */
         }
         return *c;
      }
#endif
      /* TODO

      // base is not const because its retain count may need to be modified
      inner& add_child(arena& a, inner& in, const string_view& path, base* val)
      {
         char branch = path.front();
         // TODO if in.prefix is not what path begins with, then we must
         // shrink the prefix and then insert the balance.. that would require
         // moving in lower in the tree and returning a new node..
         // so add_child can return the replacement root rather than true/false

         // path size is 1, which means this is the end of the line
         // for path and its value must go at the branch location
         if (path.size() == 1)
            return in.set_child(branch, val);

         auto current_child = in.child(branch);
         // recurse
         if (current_child and current_child->is_inner())
         {
            auto inc = current_child->as_in();

            /// TODO: add child may return
            /// TODO: deal with child's prefix if any
            if (not add_child(a, inc, path.substr(1), val))
            {  // then current child doesn't have enough space and must grow
               auto grown_child = inc->clone(a, 1);
               auto success     = add_child(a, grown_child, path.substr(1), val);
               assert(success || !"adding should succeed after making space");
               return in.set_child(branch, grown_child);
            }
         }

         // else current child is a leaf and we need to create some new
         // inner nodes
         auto new_child = inner::make(a, string_view(), 2);
         new_child->set_child(0, current_child);

         if (path.size() == 2)
         {  // the new child is the end of the line for val too
            return new_child->set_child(path[1], val);
         }
         else  // we need an inner node to hold the prefix
         {
            auto sub_child = inner::make(a, path.substr(2), 1);
            new_child->set_child(path[1], sub_child);
            return sub_child->set_child(0, val);
         }
         return false;
      }
      */

   };  // namespace raw

   // return true if inserted, false if updated
   bool trie::upsert(const string_view& key, const string_view& val)
   {
      if (not _root)
      {
         _root = raw::inner::make(_arena, key.substr(0, key.size() - 1), 4);
         _root->set_child(key.back(), raw::leaf::make(_arena, val));
         return true;
      }
      _root = add_child(_root, key, val);
      return false;
   }
   raw::inner_ptr trie::add_child(raw::inner_ptr&    in,
                                  const string_view& key,
                                  const string_view& val)
   {
      char branch = key.front();

      if (key.size() == 1)
      {
         if (in->set_child(branch, raw::leaf::make(_arena, val)))
            return in;
         else  // not enough space in the in
         {
            auto clone  = raw::inner::make(_arena, *in, 1);
            bool result = clone->set_child(branch, raw::leaf::make(_arena, val));
            assert(result || !"unable to set child after clone, what happened");
            return clone;
         }
      }

      return in;
   }

}  // namespace trie
