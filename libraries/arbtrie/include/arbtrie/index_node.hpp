#pragma once
#include <arbtrie/debug.hpp>
#if 0

namespace arbtrie
{

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
      static const node_type     type = node_type::index;
      inline static int_fast16_t alloc_size(int_fast16_t num_branches,
                                            key_view     prefix,
                                            uint_fast8_t spare_branches = 0);

      inline index_node(int_fast16_t asize,
                        int_fast16_t num_branches,
                        key_view     prefix,
                        uint_fast8_t spare_branches = 0);

      int_fast32_t    prefix_size() const;
      inline key_view get_prefix() const;
      inline void     set_prefix(key_view pre);

      const object_id* get_branch(int_fast16_t branch) const;
      void             add_branch(int_fast16_t branch, object_id bid);
      void             set_branch(int_fast16_t branch, object_id bid);
      void             remove_branch(int_fast16_t branch);

      int_fast16_t branch_capacity()const { return num_branches() + _spare_capacity; }
      const object_id* branches() const { return ((const object_id*)tail()) - branch_capacity(); }

      void visit_branches(auto visitor) const;


      //private:
      /**
       * If not null, the value pointed at can be changed to modify the branch
       *
       * returns null if no branch is present
       * returns pointer to valid object_id if branch exists
       */
      object_id* get_branch(int_fast16_t branch);

      object_id* get_branch_ptr(int_fast16_t branch);
      object_id* get_branch_by_offset(int_fast16_t off);
      uint8_t    _offsets[257];  // possitioned to be 16 byte aligned
      uint8_t    _spare_capacity  = 0;
      uint8_t    _prefix_truncate = 0;
      uint8_t    _tombstones      = 0;  // branch indicies that store object_id(0)
      uint32_t   _children        = 0;  // the total number of nodes below this point
      char       _prefix[];

      // notional data layout
      // --------------------
      // uint8_t offset[257];        // most likely to access
      // char    prefix[prefix_len]; // first so that it is in first cacheline
      // id_type branches[N];        // least likely to access
   } __attribute((packed));

   inline int_fast16_t index_node::alloc_size(int_fast16_t num_branches,
                                              key_view     prefix,
                                              uint_fast8_t spare_branches)
   {
      return sizeof(index_node) + prefix.size() +
             (num_branches + spare_branches) * sizeof(object_id);
   }
   inline index_node::index_node(int_fast16_t asize,
                                 int_fast16_t num_branches,
                                 key_view     prefix,
                                 uint_fast8_t spare_branches)
       : node_header(asize, index_node::type, num_branches, 0)
   {
      assert( num_branches + spare_branches < 255 );
      assert(num_branches > 1);
      assert(spare_branches <= 255);

      // all empty spaces need to be 0
      memset(&_offsets, 0, _nsize - sizeof(node_header));

      _prefix_len     = prefix.size();
      _spare_capacity = spare_branches;
      _children       = 0;

      memcpy(_prefix, prefix.data(), prefix.size());
         assert( (char*)get_branch_by_offset(_spare_capacity+_num_branches-1) >= _prefix + prefix_capacity() );
   }

   // offset of 0 means no node set (invalid)
   // otherwise offset is the number of ids from the tail
   // 0 is effectively "end" because it equals the tail
   // Since there are 257 possible branches, an offset of 258
   // equals the first branch when num_branches == 257,
   // 
   // However, an index node can never reach a full 257 branches
   // because each index position is a uint8 and offset 0 
   // signals "not present"
   //
   // Must upgrade to a full node before this happens.
   //
   inline object_id* index_node::get_branch_by_offset(int_fast16_t off)
   {
      assert( off >= 0 );
      assert( off <= 255 );
      if( off == 0 ) 
         return nullptr;

      const auto t      = (object_id*)tail();
      auto       id_pos = t - off;
      return (object_id*)id_pos;
   }

   inline object_id* index_node::get_branch_ptr(int_fast16_t branch)
   {
      assert(branch < 257);
      assert(branch >= 0);
      return get_branch_by_offset(_offsets[branch]);
   }

   // returns null pointer if tombstone so that invariant that
   // num branches equals actually set branches.
   inline object_id* index_node::get_branch(int_fast16_t branch)
   {
      assert(branch < 257);
      assert(branch >= 0);
      auto ptr = get_branch_ptr(branch);
      if (not ptr)
         return nullptr;
      if (not ptr->id)
         return nullptr;
      return ptr;
   }

   inline const object_id* index_node::get_branch(int_fast16_t branch) const
   {
      assert(branch < 257);
      assert(branch >= 0);
      auto ptr = const_cast<index_node*>(this)->get_branch_ptr(branch);
      if (not ptr)
         return nullptr;
      if (not ptr->id)
         return nullptr;
      return ptr;
   }

   inline void index_node::set_branch(int_fast16_t branch, object_id bid)
   {
      if( bid.id == 3 ) {
         std::cerr << "break\n";
      }
      auto br = get_branch_by_offset(_offsets[branch]);
      assert(br);
      *br = bid;
   }

   inline void index_node::add_branch(int_fast16_t branch, object_id bid)
   {
      std::cerr<<std::dec;
      int x = bid.id;
      const int test = 103;
      ARBTRIE_WARN( test, "a. add_branch( ", branch, ", ", bid, " ", bid.id,  " ", uint64_t(bid.id)," ", x,")");
      if( bid.id == 259 ) {
         std::cerr << "break  "<<__LINE__<<"\n ";
      }
      ARBTRIE_WARN( "b. add_branch( ", branch, ", ", bid, " ", bid.id, ")");
      assert(bid);
      assert(not get_branch(branch));
      assert(_num_branches < 257);
      assert(_spare_capacity > 0);


      // optimistically assume we are growing/inserting
      auto existing = get_branch_by_offset(_num_branches);
      assert(existing);  // this should always point to a valid id
      if (not *existing)
      {
         _offsets[branch] = _num_branches;
         *existing        = bid;
         return;
      }
      _num_branches++;
      _spare_capacity--;

      // pestimistic case we must find an empty slot by searching
      // TODO: once "full nodes" are implimented we can search the
      // index for the first tombstone because _num_children will
      // never reach 255 for index nodes, this will be much faster

      object_id*             start = ((object_id*)tail());
      object_id*             pos   = start - 1;
      const object_id* const end   = branches();//((const object_id*)tail()) - _num_branches;

      while (pos >= end)
      {
         assert( (char*)pos >= _prefix + prefix_capacity() );
         if (not *pos)
         {
            _offsets[branch] = start - pos;
            *pos             = bid;
            return;
         }
         --pos;
      }
      assert(!"invaraint broken, _num_branches/_spare_capacity lied");
      throw std::runtime_error("index_node::add_branch invariant broken or data corruption");
   }
   inline void index_node::visit_branches(auto visitor) const
   {
      object_id*             start = ((object_id*)tail());
      object_id*             pos   = start - 1;
      const object_id* const end   = branches(); //((const object_id*)tail()) - _num_branches;

      while (pos >= end)
      {
         assert( (char*)pos >= _prefix + prefix_capacity() );
         if (*pos)
         {
            visitor(*pos);
         }
         --pos;
      }
   }

   inline void index_node::remove_branch(int_fast16_t branch)
   {
      assert(_num_branches > 0);
      --_num_branches;
      ++_spare_capacity;
      if (auto ptr = get_branch(branch)) [[likely]]
      {
         *ptr             = object_id();
         _offsets[branch] = 0;
         return;
      }
      assert(!"invariant broken, attempting to remove null branch");
      throw std::runtime_error("index_node::remove_branch invariant broken or data corruption");
   }

   inline int_fast32_t index_node::prefix_size() const
   {
      return prefix_capacity() - _prefix_truncate;
   }
   inline key_view index_node::get_prefix() const
   {
      return key_view(_prefix, prefix_capacity());
   }
   inline void index_node::set_prefix(key_view pre)
   {
      assert(pre.size() <= prefix_capacity());
      _prefix_truncate = prefix_capacity() - pre.size();
      memcpy(_prefix, pre.data(), pre.size());
   }
}  // namespace arbtrie
#endif
