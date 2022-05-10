#pragma once
#include <boost/interprocess/offset_ptr.hpp>
#include <compare>
#include <optional>
#include <palloc/arena.hpp>
#include <palloc/int48.hpp>
#include <vector>

namespace palloc
{
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

   using reference_count_type = uint16_t;
   using key_type             = std::string_view;
   using value_type           = std::string_view;

   namespace raw
   {
      struct value;
      struct node;

      struct base
      {
         enum types
         {
            node_obj,
            value_obj
         };
         base(types t = node_obj) : _type(t), _ref_count(1) {}

         inline void retain() { ++_ref_count; }
         inline bool release() { return 0 == --_ref_count; }
         uint16_t    reference_count() const { return _ref_count; }

         types type() { return (types)_type; }
         bool  is_node() const { return _type == node_obj; }
         bool  is_value() const { return _type == value_obj; }

         const node*  as_n() const { return reinterpret_cast<const node*>(this); }
         node*        as_n() { return reinterpret_cast<node*>(this); }
         const value* as_v() const { return reinterpret_cast<const value*>(this); }
         value*       as_v() { return reinterpret_cast<value*>(this); }

        protected:
         reference_count_type _type : 1;
         reference_count_type _ref_count : 15 = 0;
      } __attribute__((packed));

      /// must be allocated in page_header
      class value : public base
      {
        public:
         inline static uint32_t alloc_size(uint8_t value_size)
         {
            static_assert(sizeof(value) == 3);
            return value_size + sizeof(value);
         }

         value() : base(value_obj) {}

         std::string_view get() { return std::string_view(data(), size()); }
         uint8_t          spare_space = 0;  /// extra space provided by allocator
         inline char*     data() { return ((char*)&spare_space) + 1; }

         inline void set_value(const key_type& v)
         {
            memcpy(data(), v.data(), v.size());
            auto asize = alloc_size(v.size());

            spare_space = page_header::round_up_size(v.size()) - v.size();
            spare_space &= uint64_t(page_header::max_bucket_element_size() < v.size()) - 1;
         }

         uint32_t size() const
         {
            auto ph = (page_header*)(uint64_t(this) & (-1ull << lower_bits));
            return ph->obj_size - spare_space;
         }
      } __attribute__((packed));

      // 32 bytes + 6 bytes per child node
      class node : public base
      {
        public:
         static_assert(sizeof(int48_t) == 6, "unexpected struct size");
         static_assert(sizeof(int48_t[3]) == 18, "unexpected struct size");
         static_assert(sizeof(std::bitset<3>) == 8, "unexpected size");

         void print_children()
         {
            std::cout << "max children: " << max_children() << "\n";
            std::cout << "num children: " << num_children() << "\n";
         }
         uint32_t num_children() { return _num_children; }
         uint32_t max_children() { return _max_children; }

         /**
         *  the value at node[byte] gets set to new_val  with size 
         *  @return 2 for add value
         *  @return 1 for replace value
         *  @return 0 for no op (adding nothing when nothing is there)
         *  @return -1 for failure
         */
         int set_child_value(uint8_t byte, int48_t& old_val, int48_t new_val = 0ll)
         {
            std::cout << "set value: '" << char(byte) << "' \n";
            const int n        = byte / 64;
            const int maskbits = byte % 64;

            // lookup if we currently have a value at byte
            int ci = child_index(byte);

            std::cout << "ci: " << ci << "\n";

            // if child_index didn't return num_children,
            // then we already have it and can simply replace it
            // TODO: caller needs to decrement refcount and delete it
            if (ci != _num_children)
            {
               auto& cp = *child_pos(ci);
               old_val  = cp;
               cp       = new_val;
               _num_children -= (new_val == 0ll);
               return 1;  /// simple replacement, easy-peasy
            }

            // the value doesn't currently exist and the new value is 0 so
            // return no op, nothing to do
            if (new_val == 0ll)
               return 0;

            // we cannot add a new one if the num is already greater than what
            // has been reserved
            if (_num_children >= _max_children)
               return -1;

            if (using_bit_array())
            {
               present_bits()[n] |= 1ull << maskbits;
               int ni = child_index(byte);

               auto* first_child = child_pos(0);
               auto* new_loc     = first_child + ni;
               auto* end_loc     = first_child + _num_children;
               memmove(new_loc + 1, new_loc, end_loc - new_loc);
               *new_loc = new_val;
               std::cout << "bit insert\n";
            }
            else
            {
               std::cout << "list insert\n";
               present_list_pos()[_num_children] = byte;
               *child_pos(_num_children)         = new_val;
            }
            ++_num_children;
            return 2;
         }

         bool set_value(int48_t new_val, int48_t& old_value)
         {
            if (not _has_value_space)
            {
               std::cout << "node doesn't have space for value\n";
               return false;  // no space
            }
            auto cp = child_pos(max_children());
            if (not cp)
               std::cout << "what happened to my space?\n";
            old_value = *cp;
            *cp       = new_val;
            std::cout << "new_val: " << *cp << "\n";
            return true;
         }

         /* manual construction
          */
         node* init(key_type k, uint8_t max_children = 0, bool has_value_space = 0)
         {
            _type            = node_obj;
            _ref_count       = 1;
            _has_value_space = has_value_space;
            _max_children    = max_children;
            _key_size        = k.size();
            _num_children    = 0;

            memcpy(key_pos(), k.data(), k.size());
            if (using_bit_array())
            {
               memset(present_list_pos(), 0, _max_children + has_value_space);
            }
            else
            {
               memset(present_bits(), 0, sizeof(uint64_t) * 4);
            }
            return this;
         }

         /**
       * Calculates the amount of space required to allocate a type.
       */
         static uint32_t alloc_size(uint8_t key_size, uint8_t max_children, bool has_val)
         {
            uint32_t pos = sizeof(node) + key_size + sizeof(int48_t) * max_children;

            int pad = 8 - (int64_t(pos) % 8);

            const int      bits = sizeof(uint64_t) * 4;
            const uint64_t uba  = -int64_t(node::using_bit_array(max_children));

            pos += (pad + bits) & uba;
            pos += (max_children) & ~uba;
            pos += sizeof(int48_t) * has_val;
            return pos;
         }

         std::string_view key() { return key_type(key_pos(), _key_size); }

         uint8_t num_children() const { return _num_children; }

         /**
       *  @param byte - the next byte in key after prefix
       *  @return the offset to the child node or value, (an offset of 0 means key with no value??)
       *  @return nullptr if no child found
       */
         inline int48_t* child(uint8_t byte)
         {
            if (using_bit_array())
            {
               auto idx = child_index(byte);
               auto c   = child_pos(idx);
               return (int48_t*)(uint64_t(c) & -(idx >= 0));
            }
            else
            {
               std::cout << "looking up: '" << char(byte) << "'\n";
               std::cout << "  num_child: '" << num_children() << "'\n";
               auto pc = present_list_pos();
               for (uint8_t c = 0; c < _num_children; ++c)
                  if (byte == pc[c])
                     return child_pos(c);
               return nullptr;
            }
         }

         inline int48_t* value()
         {
            if (not _has_value_space)
               return nullptr;
            return child_pos(max_children());
         }

         static constexpr uint32_t max_key_prefix = 255;

        private:
         inline static bool using_bit_array(uint8_t maxc) { return maxc > 35; }
         inline bool        using_bit_array() { return using_bit_array(_max_children); }
         inline char*       key_pos() { return ((char*)&_num_children) + 1; }

         inline uint8_t*  present_list_pos() { return (uint8_t*)(key_pos() + _key_size); }
         inline uint64_t* present_bits()
         {
            char* pos = key_pos() + _key_size;
            pos += 8 - (int64_t(pos) % 8);  // padding to align on 64bit
            return reinterpret_cast<uint64_t*>(pos);
         }

         /* @param num - the nth child that is present, */
         inline int48_t* child_pos(uint8_t num)
         {
            char* pos = key_pos() + _key_size + sizeof(int48_t) * num;

            int pad = 8 - (int64_t(pos) % 8);

            const int      bits = sizeof(uint64_t) * 4;
            const uint64_t uba  = -int64_t(using_bit_array());

            pos += (pad + bits) & uba;
            pos += (_max_children) & ~uba;

            return (int48_t*)pos;
         }

         /* given a byte, find the child node assuming present_bits*/
         int16_t child_index(uint8_t byte)
         {
            uint16_t  index    = 0;
            const int maskbits = byte % 64;
            const int mask     = -1ull >> (63 - maskbits);
            int       n        = byte / 64;
            uint64_t* pb       = present_bits();

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
                  return _num_children;
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

         // a node that has the final byte of a key with a value has size: 4+2+6+1 = 13
         // the node adds 5 bytes per child value or sub node

         uint8_t _key_size : 7        = 0;  ///< max key size without subnode is 127
         uint8_t _has_value_space : 1 = 0;  ///< max key size without subnode is 127

         uint8_t _max_children = 0;  ///< space reserved for child pointers
         uint8_t _num_children = 0;  ///< number of child pointers in use

         // This is the variable memory layout of the node using extra space
         // reserved at allocation.
         //
         //
         // char key[_key_size]
         // if not bit mode
         //     uint8_t pres[_max_children]
         //     int48_t child[_max_children]
         // else bit mode
         //     uint8_t  char[pad]
         //     uint64_t pbits[pad]
         //     int48_t  child[_max_children]

      } __attribute__((packed));
      static_assert(sizeof(node) == sizeof(base) + 3, "unexpected padding");
   }  // namespace raw

   struct trie
   {
     public:
      trie(arena_header& m) : storage(m), root(nullptr){};

      using string_view  = std::string_view;
      using ostring_view = std::optional<string_view>;

      struct node
      {
         using onode = std::optional<node>;

         /// if no key is present, there will always be a key prefix
         string_view prefix() const
         {
            if (_rn and _rn->is_node())
               return as_n()->key();
            return string_view();
         }

         /**
          * Not all nodes are keys that map to values (even empty values),
          * so the key is optional, use prefix() to get the path in the tree
          *
          * @return the key if there is a value at this node
          */
         ostring_view key() const
         {
            if (not _rn)
               return std::nullopt;

            if (_rn->is_value())
               return string_view();

            // this node only has a key if the value is set, even if open...
            // otherwise it has a prefix.
            int48_t* ptr = as_n()->value();

            if (not ptr)
               return std::nullopt;

            return prefix();
         }

         /**
          *  If there is a key and the value is set the optional will be set
          */
         ostring_view value() const
         {
            if (not _rn)
               return std::nullopt;

            if (_rn->is_value())
               return as_v()->get();

            int48_t* ptr = as_n()->value();

            if (not ptr)
               return std::nullopt;

            if (*ptr == 0ll)
               return std::nullopt;

            if (*ptr == 1ll)
               return std::string_view();

            return _owner._v(*ptr)->get();
         }

         /**
          * Traverse the tree to the node with the subprefix and only return nodes
          * that have a key or prefix that exactly matches the sub prefix
          */
         onode child(const string_view& subprefix) const
         {
            if (not _rn)
               return std::nullopt;  // this is a null obj
            if (subprefix.empty())
               return std::nullopt;  // not a child
            if (_rn->is_value())
               return std::nullopt;  // no children from values

            if (_rn->is_node())
            {  // there may be children under a node

               raw::node* cur       = as_n();
               auto       next_byte = subprefix.begin();
               auto       end       = subprefix.end();

               while (next_byte != end)
               {
                  auto ptr = cur->child(*next_byte);
                  if (not ptr or (int64_t(*ptr) <= 1ll))
                  {
                     return std::nullopt;
                  }

                  auto cb = _owner._b(*ptr);
                  if (cb->is_value())
                  {
                     if (subprefix.size() == 1)
                        return node(_owner, cb);
                     else
                        return std::nullopt;
                  }
                  cur = cb->as_n();
                  ++next_byte;

                  if (next_byte == end)
                     return node(_owner, cur);

                  auto cur_prefix = cur->key();
                  for (auto p = cur_prefix.begin(); next_byte != end and p != cur_prefix.end(); ++p)
                  {
                     if (*next_byte != *p)
                        return std::nullopt;
                     ++next_byte;
                  }
               }
            }
            return std::nullopt;
         }

         size_t data_size() const
         {
            if (not _rn)
               return 0;
            if (_rn->is_value())
            {
               return as_v()->size();
            }

            int48_t* val = as_n()->value();
            if (not val or *val <= 1ll)
               return 0;

            return _owner._v(*val)->size();
         }

         char* data()
         {
            if (not _rn)
               return nullptr;

            if (_rn->is_value())
            {
               return as_v()->data();
            }

            int48_t* val = as_n()->value();
            if (not val or int64_t(*val) <= 1ll)
               return nullptr;

            return _owner._v(*val)->data();
         }

         void set_value( const node& val_node ) {
            if( _rn->is_value() ) {
               _rn = val_node._rn;
               return;
            }
            if( _rn->is_node() ) {
            //   auto b = _trie.clone( as_n(), 0/* no new child*/, 1 /*with value*/ );
               /// TODO: release _rn 
            //   _rn = b;
            //   as_n()->set_value( val_node.as_v() );
               // if not have space for value
               //    clone to new node with space
               // remove existing value
               // add new value
            }
         }
        private:
         node(trie& o, raw::base* rn = nullptr) : _owner(o), _rn(rn) {}

         raw::value* as_v() const
         {
            assert(_rn->is_value());
            return reinterpret_cast<raw::value*>(_rn);
         }
         raw::node* as_n() const
         {
            assert(_rn->is_node());
            return reinterpret_cast<raw::node*>(_rn);
         }

         friend class trie;
         trie&      _owner;
         raw::base* _rn;  // node or value?
      };

      /**
       *  Always points at a key/value pair 
       */
      struct cursor
      {
         cursor( trie& t ):_trie(t){}

         cursor( trie& t, node n ):path( { branch{ .next = n } } ),_trie(t)
         {
            auto okey = n.key();
            if( okey )
               prefix = *okey;
         }

         void set_value( ostring_view val ) {
            if( val ) {
              auto val_node = _trie.make_value( *val );
              if( _path.empty() ) {
                 path.push_back( branch{ .next = val_node }  );
              }
              else {
                 auto ritr = _path.rbegin();

                 ritr->set_value( val_node );

                 
              }
            }
         }

         string_view key() const { return prefix; }

         string_view value() const
         {
            return {};
            /*
            if (not parents.size())
               return string_view();
            assert(parents.back().value());
            return *parents.back().value();
            */
         }
         char* data()
         {
            /*
            if (not parents.size())
               return nullptr;
            return parents.back().data();
            */
            return nullptr;
         }

         cursor lower_bound(const string_view& key) {
            return *this;
         }

         private:

            struct branch
            {
               std::optional<char> c;
               node                next;
            };
            std::vector<branch> _path;
            std::string         _prefix;
            trie&               _trie;
      };
      friend class cursor;

      /*
      cursor find(const string_view& k)
      {
         cursor c;

         if (not root)
         {
            std::cout << "NO ROOT\n";
            return c;
         }
         auto root_key = root->key();
         if (not k.starts_with(root_key))
         {
            std::cout << "KEY DOES NOT START WITH ROOT KEY";
            return c;
         }

         c.prefix += root_key;

         if (root_key == k)
         {
            c.parents.push_back(node(*this, root));
            return c;
         }

         auto subkey = k.substr(root_key.size());

         return c;
      }
      */

      // TODO: make utility function
      static inline string_view common_prefx(const string_view& a, const string_view& b)
      {
         if (a.size() > b.size())
            return common_prefx(b, a);

         auto itr = b.begin();
         for (auto& c : a)
         {
            if (c != *itr)
               return string_view(b.begin(), itr - b.begin());
            ++itr;
         }
         return a;
      }

      cursor begin() {
         return cursor( *this, node(*this,root) );
      }

      ostring_view get(const string_view& key)
      {
         auto cnode = node(*this, root).child(key);
         if (cnode)
            return cnode->value();
         return std::nullopt;
      }

      cursor put(const string_view& k, const ostring_view& new_value)
      {
      /*
         if (not root)
         {
            root = create(k, new_value);
            return cursor(k, {node(*this, root)});
         }
         else  /// traverse the tree to find place to insert k/v
         {
            cursor pcur;

            auto cur_node = root;

            string_view parsed_prefix = cur_node->key();
            std::cout << "parsed prefix: " << parsed_prefix << "\n";

            string_view common_key = common_prefx(parsed_prefix, k);

            std::cout << "common prefix: " << common_key << "\n";
            if (parsed_prefix == k)
            {
               std::cout << "value goes at current cur possition!!!      :) \n";
               cur_node = _set_node_value(cur_node, new_value);
            }
            else if (common_key.size() < parsed_prefix.size())
            {
               std::cout << k << " goes above " << parsed_prefix << "\n";
               raw::node* new_parent = nullptr;

               if (common_key == k)
               {  // then new node is root with value on it
                  std::cout << "new key is root\n";
                  new_parent = create(k, new_value, 1);

                  // either the common key or 0
                  int  prune_length = (common_key.size() - 1) * (common_key.size() > 0);
                  auto child_prefix = parsed_prefix.substr(prune_length);

                  assert(child_prefix.size());
                  new_parent->set_child_value(child_prefix.front(), child_prefix.substr(1),
                                              _p(cur_node))

                      return pcur;
               }

               // case 1: the new node will hold the value
               else if (common_key.size() < parsed_prefix.size())
               {
                  new_parent     = create(common_key, new_value, 2);
                  auto next_byte = parsed_prefix.substr(common_key.size() - 1).back();
                  std::cout << "next_byte: " << next_byte << "\n";
               }

               // case 2: the new node will hold no value directly and have 2 children
            }
            else
            {
               std::cout << k << " goes below " << parsed_prefix << "\n";
            }

         }
      */
         return cursor(*this);
      }

     private:
      raw::node* _remove_node_value(raw::node* n, bool is_empty_str = false)
      {
         int48_t* cur_val = n->value();
         if (cur_val)
         {
            if (*cur_val > 1)
            {
               auto v = _v(*cur_val);
               if (v->release())
                  storage.free(v);
               *cur_val = int64_t(!is_empty_str);
            }
         }
         return n;
      }
      /*
       * In order to set the value I might have to reallocate a node
       */
      raw::node* _set_node_value(raw::node* n, const ostring_view& new_val)
      {
         int48_t* cur_val = n->value();
         if (cur_val)  // does the node have space for a value
         {
            if (not new_val or not new_val->size())
            {  /// remove the current val, if any
               return _remove_node_value(n, new_val and not new_val->size());
            }

            auto vp = _v(*cur_val);

            /// TODO: allow for expanding to overalloc padding
            /// TODO: allow for shrinking in same bucket
            /// TODO: what about modifying something retained by others?
            if (vp->size() == new_val->size())
            {
               if (vp->get() == *new_val)  /// they are the same
                  return n;
               memcpy(vp->data(), new_val->data(), new_val->size());
            }
            else
            {
               int48_t old_val;
               n->set_value(_p(create_value(*new_val)), old_val);
               if (old_val > 1)
               {
                  auto ov = _v(old_val);
                  if (ov->release())
                     storage.free(ov);
               }
            }
            return n;
         }
         return nullptr;  /// TODO: allocate new node with space for value
      }

      friend class value;
      inline size_t get_size(int48_t p) { return storage.get_max_realloc_size(p); }

      inline int48_t    _p(raw::node* n) { return storage.get_offset(n); }
      inline int48_t    _p(raw::value* n) { return storage.get_offset(n); }
      inline int48_t    _p(raw::base* n) { return storage.get_offset(n); }
      inline raw::base* _b(int48_t p) { return storage.get<raw::base>(p); }
      inline raw::node* _n(int48_t p)
      {
         assert(_b(p)->is_node());
         return storage.get<raw::node>(p);
      }
      inline raw::value* _v(int48_t p)
      {
         assert(_b(p)->is_value());
         return storage.get<raw::value>(p);
      }

      template <typename T>
      inline T* get_data(int48_t p)
      {
         return static_cast<T*>(storage.get(p));
      }

      raw::value* create_value(const string_view& val)
      {
         auto rv = new (storage.alloc(raw::value::alloc_size(val.size()))) raw::value();
         rv->set_value(val);
         assert(rv->reference_count() == 1);
         return rv;
      }

      node make_value( const string_view& v ) {
         return node( *this, create_value(val) );
      }
      node make_node(const key_type& k, const std::optional<key_type>& v, uint8_t reserve = 0) {
         return node( *this, create( k, v, reserve ) );
      }

      raw::node* create(const key_type& k, const std::optional<key_type>& v, uint8_t reserve = 0)
      {
         auto n = std::launder(reinterpret_cast<raw::node*>(
             storage.alloc(raw::node::alloc_size(k.size() - 1, reserve, bool(v)))));
         n->init(k, reserve, bool(v));

         if (v)
         {
            auto rv = new (storage.alloc(raw::value::alloc_size(v->size()))) raw::value();
            rv->set_value(*v);
            int48_t old_val;
            n->set_value(storage.get_offset(rv), old_val);
         }

         assert(n->reference_count() == 1);
         return n;
      }

      arena_header& storage;
      raw::node*    root = nullptr;
   };

}  // namespace palloc
