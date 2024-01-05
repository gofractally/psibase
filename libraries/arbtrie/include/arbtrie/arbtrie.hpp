#pragma once
#include <arbtrie/node_header.hpp>
#include <cassert>


namespace arbtrie
{
   using id_type = object_id;

   void print(const node_header* nh, int depth = 0);

   struct value_node : public node_header
   {
      static const node_type type = node_type::value;

      /*
      static value_node* make(value_view v)
      {
         auto vn = node_header::make<value_node>(sizeof(node_header) + v.size(), 0);
         memcpy(vn->body(), v.data(), v.size());
         return vn;
      }
      */
   };

   /**
    *  Full Node - has one branch for all possible branches and eof,
    *  lower_bound does a linear search of the branches that can only
    *  be optimized slightly if id_type is a multiple 8 bytes.
    *
    *  - constant time "get" / "set"
    *  - linear lower bound
    */
   struct full_node : node_header
   {
      static const uint16_t  num_branches = 257;
      static const node_type type         = node_type::full;

      inline static full_node* make(key_view prefix);

      key_view get_prefix() { return key_view(prefix, prefix_capacity()); }
      void     set_branch(uint16_t br, id_type b);
      id_type  get_branch(uint16_t br);

      id_type branches[num_branches];
      char    prefix[];
   } __attribute((packed));

   /**
    *  Index Node - has one byte that provides the offset into
    *  a list of ids that are present.
    *
    *  - can hold up to 256 elements out of 257 because index is 8 bit, should
    *  switch to full node before it gets that full.
    *
    *  - constant time "get" / "update" 
    *  - linear lower bound, but may be able to use REPNE/REPNZ or REPE/REPZ asm
    *    or potentially other SSE instructions to compare multiple offsets at once
    *    to find lower bound quicker.  Depends upon offsets being 16 byte aligned.
    */
   struct index_node : node_header
   {
      static const node_type type = node_type::index;
      inline static uint16_t alloc_size(uint16_t num_branches, key_view prefix);

      inline key_view get_prefix() { return key_view(prefix, prefix_capacity()); }
      inline void     set_branch(uint16_t br, id_type b);
      inline id_type  get_branch(uint16_t br) const;

      void add_branch(uint16_t br, id_type);
      void remove_branch(uint16_t br);

     private:
      uint8_t  offsets[257];  // possitioned to be 16 byte aligned
      char     prefix[];
      id_type* branches() { return (id_type*)(prefix + prefix_capacity()); }

      // notional data layout
      // --------------------
      // uint8_t offset[257];        // most likely to access
      // char    prefix[prefix_len]; // first so that it is in first cacheline
      // id_type branches[N];        // least likely to access
   } __attribute((packed));

   /**
    *  Setlist Node - maintains a list of the set branches
    *
    *  - can hold up to 257 elements in a less effecient manner than
    *  full node
    *
    *  - log(n) time for get/update
    *  - log(n) time for lower bound 
    */
   struct setlist_node : node_header
   {
      static const node_type type = node_type::setlist;

      setlist_node* clone_add(char key, id_type val) const;
      setlist_node* clone_add_eof(id_type val) const;

      uint32_t prefix_size()const { return prefix_capacity() - _prefix_truncate; }

      inline key_view get_prefix() const
      {
         return key_view((char*)prefix, prefix_capacity() - _prefix_truncate);
      }

      inline void set_prefix(key_view pre)
      {
         assert( _spare_capacity == 0 );
         assert(pre.size() <= prefix_capacity());
         _prefix_truncate = prefix_capacity() - pre.size();
         memcpy(prefix, pre.data(), pre.size());
      }

      inline bool has_eof_value() const { return _has_eof_value; }

      //@param br - the radix that goes to branch, use get_node_value() for the eof branch
      inline void set_branch(uint8_t br, id_type branch)
      {
         auto pos = get_setlist().find(br);
         assert(pos != key_view::npos);
         branches()[pos + _has_eof_value] = branch;
      }
      inline id_type get_branch(uint8_t br) const
      {
         assert( _spare_capacity == 0 );
         auto pos = get_setlist().find(br);
         if (pos != key_view::npos)
         {
            return branches()[pos + _has_eof_value];
         }
         return {};
      }

      std::pair<uint8_t, object_id> get_by_index(int index) const
      {
         assert( _spare_capacity == 0 );
         return std::pair<uint8_t, object_id>(setlist()[index], branches()[index + _has_eof_value]);
      }

      // @param index is the index in the setlist, exclusive of the eof byte
      // @param byte is the radix of the branch that child is associated with
      // @param byte is the value
      inline void set_index(int index, int8_t byte, id_type child)
      {
         assert( _spare_capacity == 0 );
         assert(index < num_branches());
         setlist()[index]                   = byte;
         branches()[index + _has_eof_value] = child;
      }

      // @pre has_value() == true
      inline void set_eof_branch(id_type child)
      {
         assert( _spare_capacity == 0 );
         assert(_has_eof_value);
         branches()[0] = child;
      }
      // @return null if not has_value()
      inline id_type*       get_eof_branch() { return _has_eof_value ? branches() : nullptr; }
      inline const id_type* get_eof_branch() const { return _has_eof_value ? branches() : nullptr; }

      uint8_t*       setlist() { return prefix + prefix_capacity(); }
      const uint8_t* setlist() const { return prefix + prefix_capacity(); }

      // the eof branch isn't in the set list, so we sub 1 from num_branches
      id_type* branches()
      {
         assert( _spare_capacity == 0 );
         assert(_has_eof_value + num_branches() > 0);
         return (id_type*)(setlist() + num_branches()-has_eof_value()+_spare_capacity);
      }
      const id_type* branches() const
      {
         assert( _spare_capacity == 0 );
         assert(_has_eof_value + num_branches() > 0);
         return (id_type*)(setlist() + num_branches()-has_eof_value()+_spare_capacity);
      }

      inline std::string_view get_setlist() const
      {
         assert( _spare_capacity == 0 );
         return std::string_view((char*)setlist(), num_branches() - has_eof_value());
      }

     //private:
      uint8_t _spare_capacity = 0;
      uint8_t _has_eof_value : 1;
      uint8_t _prefix_truncate : 7;
      uint8_t prefix[];


      static constexpr uint32_t calc_expected_size( uint32_t prefix_len,
                                               uint32_t branches,
                                               bool     has_eof,
                                               int spare = 0 ) {
        assert( branches + spare < 258 );
        return sizeof(node_header) + 2 + prefix_len + (branches-has_eof+spare) + (spare+branches)*sizeof(object_id); 
      }

      uint32_t expected_size()const {
         assert( _spare_capacity == 0 );
         return sizeof(node_header) + 2 + _prefix_len + 
            (_num_branches - _has_eof_value + _spare_capacity) + ((_spare_capacity+_num_branches) * sizeof(object_id));
      }
      bool check_size()const { 
         assert( _spare_capacity == 0 );
         return expected_size() == _nsize; 
      }

      // notional data layout
      // --------------------
      // uint8_t spare_capacity
      // uint8_t has_value:1;  // because there are 257 possible branches and uint8 only suppors 256
      // uint8_t prefix_trunc:7;  // bytes subtracted from prefix_capacity to get prefix size
      // char    prefix[prefix_capacity];
      // uint8_t setlist[ num_branches-_has_eof_value + _spare_capacity ];
      // id_type branches[ num_branches + _spare_capacity ];
   } __attribute((packed));

   struct bitfield_node : node_header
   {
      static const node_type type = node_type::bitfield;
      uint64_t               present[4];
      uint8_t                has_value;  // because there are 257 possible branches
      //id_type                branches[N];
      //char                   prefix[];
   } __attribute((packed));

   inline void retain(id_type node) {}

   inline bool release(id_type node)
   {
      return true;
      /*
      if( node ) {
         switch( node->get_type() ) {
            case binary_node:
               return ((binary_node*)node)->release();
            case value_node:
               return ((value_node*)node)->release();
         }
      }
      */
   }

   // This always returns a view into the first argument
   inline std::string_view common_prefix(std::string_view a, std::string_view b)
   {
      return {a.begin(), std::mismatch(a.begin(), a.end(), b.begin(), b.end()).first};
   }

   using node_ptr = std::shared_ptr<node_header>;

   /*
   setlist_node* setlist_node::clone_add_eof(id_type val) const
   {
      assert(not _has_eof_value);

      auto asize = size() + sizeof(id_type) - _prefix_truncate;
      auto sln   = node_header::make<setlist_node>(asize, num_branches() + 1, get_prefix().size());
      sln->_has_eof_value   = true;
      sln->_prefix_truncate = 0;

      memcpy(sln->prefix, prefix, sln->prefix_capacity());
      memcpy(sln->setlist(), setlist(), num_branches());
      sln->branches()[0] = val;
      memcpy(sln->branches() + 1, branches(), num_branches() * sizeof(id_type));

      for (int i = 0; i < num_branches(); ++i)
      {
         assert(sln->get_branch(i) == get_branch(i));
      }
      assert(sln->get_prefix() == get_prefix());
      assert(sln->get_setlist() == get_setlist());

      return sln;
   }
*/

   /*
   setlist_node* setlist_node::clone_add(char br, id_type val) const
   {
      assert(get_branch(br) == nullptr);
      auto asize = size() + 1 + sizeof(id_type) - _prefix_truncate;
      assert(num_branches() < 256);
      auto sln = node_header::make<setlist_node>(asize, num_branches() + 1, get_prefix().size());
      sln->_has_eof_value   = _has_eof_value;
      sln->_prefix_truncate = 0;

      // TODO: remove redundant get_prefix()
      memcpy(sln->prefix, get_prefix().data(), get_prefix().size());

      if (_has_eof_value)
         sln->branches()[0] = branches()[0];

      auto*       new_setlp = sln->setlist();
      const auto* setlp     = setlist();
      const auto* setle     = setlp + num_branches() - has_eof_value();
      while (setlp < setle)
      {
         if (*setlp > br)
            break;
         ++setlp;
      }
      auto offset = setlp - setlist();
      memcpy(new_setlp, setlist(), offset);
      new_setlp += offset;
      *new_setlp++ = br;
      memcpy(new_setlp, setlist() + offset, num_branches() - offset);
      memcpy(sln->branches() + _has_eof_value, branches() + _has_eof_value,
             offset * sizeof(id_type));
      sln->branches()[_has_eof_value + offset] = val;

      memcpy(sln->branches() + _has_eof_value + offset + 1, branches() + _has_eof_value + offset,
             (num_branches() - offset) * sizeof(id_type));

      assert(sln->get_branch(br) and sln->get_branch(br) == val);
      return sln;
   }
   */
};  // namespace arbtrie

#include <arbtrie/arbtrie_impl.hpp>
//#include <arbtrie/binary_node.hpp>
//#include <arbtrie/upsert_impl.hpp>

#if 0 
TREE TRANSFORM BY EXAMPLE

initial condition:
   nullptr

upsert("larimer", "larimer");
   binary_node
        larimer = larimer

upsert("larimer1..250", "larimer1");
   binary_node
        larimer    = larimer
        larimer1   = larimer1
        ...
        larimer250 = larimer250

refactor because binary node is too big
   radix_node w/ prefix 'larimer'
        ''  = larimer
        '1' -> binary_node
              ''   = larimer1
              '0'  = larimer10
              '1'  = larimer11
              '00' = larimer100
        '2' -> binary_node
              ''   = larimer2
              ...
              '49' = larimer249
              '50' = larimer250

insert lary
    radix_node w/ prefix 'lar;
       'i' -> radix_node w/ prefix 'mer'
            ... samve as above
       'y' = lary

remove lary  - radix node has one child, combine prefix back to larimer
       

Assume initial condition
   binary_node
        daniel     = daniel
        larimer    = larimer
        larimer1   = larimer1
        ...
        larimer250 = larimer250

refactor to..
    radix_node w/prefix ''
        'd' -> binary_node
             aniel = "daniel"
        'l' -> binary_node
             arimer    = larimer
             arimer1   = larimer1
             ...
             arimer250 = larimer250


Rules:
   binary nodes don't have prefixes 
   binary nodes don't have other inner nodes as children
      - this is logical because binary search assumes equally dividing the
        available key space, but if one branch has a million keys under it
        then the searc is giving too much weight to the leaves near the
        top of the tree. 
      - therefore, a sparse tree with a dense branch can have may
        smaller radix nodes like a traditional radix tree.

   refactor a subtree into a binary node when total nested children are less than 125

#endif
