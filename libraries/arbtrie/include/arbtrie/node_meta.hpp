#pragma once
#include <cassert>
#include <iostream>
#include <optional>
#include <string_view>

namespace arbtrie
{

   // must be a power of 2
   // size of the data segments data is allocated in
   // the smaller this value, the more overhead there is in
   // searching for segments to manage and the free list
   // each thread will have a segment this size, so larger values
   // may use more memory than necessary for idle threads
   // max value: 4 GB due to type of segment_offset
   static const uint64_t segment_size = 1024 * 1024 * 64;  // 256mb

   /// object pointers can only address 48 bits
   /// 128 TB limit on database size with 47 bits, this saves us
   /// 8MB of memory relative to 48 bits in cases with less than 128 TB
   static const uint64_t max_segment_count = (1ull << 47) / segment_size;

   static const uint64_t binary_refactor_threshold = 4096;
   static const uint64_t binary_node_max_size  = 4096;

   // the number of branches at which an inner node is automatically
   // upgraded to a full node
   static const int full_node_threshold = 128;

   static const int max_branch_count = 257;

   struct node_header;
   struct binary_node;
   struct setlist_node;

   using key_view       = std::string_view;
   using value_view     = std::string_view;
   using segment_offset = uint32_t;
   using segment_number = uint64_t;

   enum node_type : uint8_t
   {
      freelist  = 0,  // not initialized/invalid, must be first enum
      binary    = 1,  // binary search
      value     = 2,  // just the data, no key
      setlist   = 3,  // list of branches
      roots     = 4,  // contains pointers to other root nodes
      full      = 5,  // 256 full id_type
      undefined = 6,  // no type has been defined yet

      // future, requires taking a bit
      index    = 7,  // 256 index buffer to id_type
      bitfield = 8,
      merge    = 9,  // delta applied to existing node
   };
   static const char* node_type_names[] = {
       "freelist",  // must be first
       "binary",   "setlist", "value", "roots", "merge", "undefined",
   };

   struct clone_config
   {
      int spare_branches = 0;  // inner nodes other than full
      int spare_space    = 0;  // value nodes, binary nodes
      int spare_prefix   = 0;  //
      std::optional<key_view> update_prefix;
      friend auto             operator<=>(const clone_config&, const clone_config&) = default;

      int_fast16_t prefix_capacity() const
      {
         if (update_prefix)
            return update_prefix->size() + spare_prefix;
         return spare_prefix;
      }
   };

   struct upsert_mode
   {
      enum type : int
      {
         shared        = 0,
         unique        = 1,  // ref count of all parent nodes and this is 1
         insert        = 2,  // fail if key does exist
         update        = 4,  // fail if key doesn't exist
         upsert        = insert | update,
         unique_upsert = unique | upsert,
         unique_insert = unique | insert,
         unique_update = unique | update,
         shared_upsert = shared | upsert,
         shared_insert = shared | insert,
         shared_update = shared | update
      };

      constexpr upsert_mode(upsert_mode::type t) : flags(t){};

      constexpr bool        is_unique() const { return flags & unique; }
      constexpr bool        is_shared() const { return not is_unique(); }
      constexpr upsert_mode make_shared() const { return {flags & ~unique}; }
      constexpr upsert_mode make_unique() const { return {flags | unique}; }
      constexpr bool        may_insert() const { return flags & insert; }
      constexpr bool        may_update() const { return flags & insert; }
      constexpr bool        must_insert() const { return not may_update(); }
      constexpr bool        must_update() const { return not may_insert(); }

     // private: structural types cannot have private members,
     // but the flags field is not meant to be used directly
      constexpr upsert_mode( int f ):flags(f){}
      int flags;
   };

   /**
    *  An offset/8 from object_db_header::alloc_segments encoded
    *  as 5 bytes. This allows addressing of 8TB worth of object IDs which
    *  is way beyond what will fit in RAM of most computers, 32 bits would
    *  have only supported 32GB of object IDs which clearly fits within the
    *  RAM of many laptops. 
    */
   struct object_id
   {
      uint64_t             id : 40 = 0;  // obj id
      explicit             operator bool() const { return id != 0; }
      friend bool          operator==(object_id a, object_id b) = default;
      friend std::ostream& operator<<(std::ostream& out, const object_id& oid)
      {
         return out << uint64_t(oid.id);
      }
   } __attribute__((packed)) __attribute__((aligned(1)));
   static_assert(sizeof(object_id) == 5, "unexpected padding");
   static_assert(alignof(object_id) == 1, "unexpected alignment");

   /**
    * Used to identify where an object can be found
    */
   struct object_location
   {
      uint32_t segment() const { return _offset / segment_size; }
      uint32_t index() const { return _offset & (segment_size - 1); }

      friend bool operator==(const object_location&, const object_location&) = default;

      uint64_t _offset;  // : 48; only 48 bits can be used/stored in object_meta
   };

#define ARBTRIE_REF_BITS 12
#define ARBTRIE_TYPE_BITS 3

   /**
    * This impacts the number of reference count bits that are reserved in case
    * all threads attempt to increment one atomic variable at the same time and
    * overshoot.  This would mean 32 cores all increment the same atomic at
    * the same instant before any core can realize the overshoot and subtract out.
    */
   static const uint32_t max_threads = 32;

   /**
    *  Tracks high-level information for each object in an atomic manner
    *  that can be pinned in RAM. This prevents unnecessary page loads when
    *  all you want to know is the type or to increment/decrment a reference count. 
    *
    *  Additionally, the real location of the object can be moved at any time to
    *  provide better cache locality without interfering with readers.
    *
    *  ## Locking Protocol
    *  For any given object it can be modified by exactly one writer thread or
    *  moved by exactly one compactor thread. The compactor thread needs to prove
    *  that the data was not modified while being copied and the modify thread 
    *  doesn't want to ever wait on the compactor to move an object. 
    *
    *  The compactor sets the copy flag to 1 when it starts the copy and only
    *  updates the location at the end of the copy if the bit is still 1.
    *
    *  The modify thread will clear the copy flag when it starts to modify and
    *  also set the modify_flag to 1. If anything other than the reference count
    *  has changed (provided ref count is still greater than 0) then the compactor
    *  thread will invalidate its copy and try again (assuming location hasn't changed).
    *  
    *  Cases:
    *     Idle case: modify flag = 1, aka m1 while copy flag = 0, aka c0,
    *     the modify flag is "inverted" so that 1 means not modifying and 0 means 
    *     modifying so that flags can be set/cleared in one atomic operation without
    *     compare and exchange.
    *
    *
    *     A)                                    B)                  
    *     start modify (m0,c0) acquire         start copy  (c1)       acquire
    *     end modify (m1) release              start modify (m0,c0)   acquire
    *     start copy (c1) acquire              end modify (m1)        release 
    *     end copy (c0) c&e success_release    end copy               c&e fail_relaxed 
    *     success                              try copy again        
    *                                    
    *                                    
    *     C)                                      D)
    *     start copy   (c1)                       start modify (m0,c0)
    *     start modify (m0,c0)                    compactor waits (c1)
    *     end copy & wait (c1) c&e fail_relaxed   end modify & notify (m1)
    *     end modify & notify (m1)                compactor try again
    *     try again                                        
    *
    *  The modify thread only wants to notify if the copy thread is waiting,
    *  the modify thread knows the copy thread is waiting because the copy thread
    *  set both bits and the modify thread saw the "prior value" when it reset those
    *  bits and knows something changed.
    *
    *  The copy thread waits with memory_order_acquire and the modify thread ends
    *  with memory_order_release.
    *
    *  This synchronization process is an alternative to a pool of mutex indexed by
    *  object id which must be locked during copy/modify operations. The mutex approach causes
    *  write threads to conflict with eachother and allows the compactor (backround)
    *  to block the modifer (forground). While the mutex pool is transient and automatically
    *  reset on crash, the lock state of these bits is stored on the memory mapped file
    *  and will need to be cleared if the program crashes leaving the bits set. A side 
    *  effect of these bits is that it is possible to detect if a crash occurred in the
    *  middle of a modify operation! Since reference counts must be reset on a crash,
    *  resetting these locks shouldn't be an issue and only takes a second or two.
    */
   struct object_meta
   {
     private:
      struct bitfield
      {
         uint64_t ref : ARBTRIE_REF_BITS;
         uint64_t type : ARBTRIE_TYPE_BITS;
         uint64_t copy_flag : 1;    // set this bit on start of copy, clear it on start of modify
         uint64_t modify_flag : 1;  // 0 when modifying, 1 when not
         uint64_t location : 46;    // the location divided by 16, 1024 TB addressable
      };

      // temporary impl that relies on the UB that writing to one and reading
      // from another is safe and assumptions about the bitpacking order. To be
      // replaced with functions that do explicit bit operations. This representation
      // is convienent for lldb/gdb understanding.
      union
      {
         uint64_t              iv = 0;
         bitfield              bf;
         std::atomic<uint64_t> av;
      } _value;
      static_assert(sizeof(_value) == sizeof(uint64_t));

     public:
      static const uint64_t ref_mask = (1ull << ARBTRIE_REF_BITS) - 1;
      static const uint64_t max_ref_count =
          ref_mask - max_threads;  // allow some overflow bits for retain
      static const uint64_t type_mask        = 7 << ARBTRIE_REF_BITS;
      static const uint64_t copy_flag_bit    = ARBTRIE_REF_BITS + ARBTRIE_TYPE_BITS;
      static const uint64_t modify_flag_bit  = copy_flag_bit + 1;
      static const uint64_t copy_flag_mask   = (uint64_t(1) << copy_flag_bit);
      static const uint64_t modify_flag_mask = (uint64_t(1) << modify_flag_bit);
      static const uint64_t location_mask =
          ~(type_mask | ref_mask | copy_flag_mask | modify_flag_mask);

      object_meta(const object_meta& c) { _value.iv = c._value.iv; }
      object_meta& operator=(const object_meta& in)
      {
         _value.iv = in._value.iv;
         return *this;
      }

      explicit object_meta(uint64_t v = 0) { _value.iv = v; };
      explicit object_meta(node_type t)
      {
         _value.bf.type        = int(t);
         _value.bf.location    = 0;
         _value.bf.ref         = 0;
         _value.bf.modify_flag = 1;
      }

      // does not divide loc by 16
      explicit object_meta(node_type t, uint64_t loc)
      {
         _value.bf.type        = int(t);
         _value.bf.location    = loc;
         _value.bf.ref         = 0;
         _value.bf.modify_flag = 1;
      }
      explicit object_meta(node_type t, object_location loc)
      {
         assert(not(loc._offset & 15));
         _value.bf.type        = int(t);
         _value.bf.location    = loc._offset >> 4;
         _value.bf.ref         = 0;
         _value.bf.modify_flag = 1;
      }
      explicit object_meta(node_type t, object_location loc, int r)
      {
         assert(not(loc._offset & 15));
         _value.bf.type        = int(t);
         _value.bf.location    = loc._offset >> 4;
         _value.bf.ref         = r;
         _value.bf.modify_flag = 1;
      }

      object_meta& set_ref(uint16_t ref)
      {
         static_assert(max_ref_count < (1 << ARBTRIE_REF_BITS));
         assert(int64_t(ref) < max_ref_count);
         _value.bf.ref = ref;
         return *this;
      }
      object_meta& set_location(object_location loc)
      {
         assert(not(loc._offset & 15));
         assert((loc._offset >> 4) == (loc._offset / 16));
         _value.bf.location = loc._offset >> 4;
         /*
            _value.bf.location = loc >> 4;
            loc << (location_rshift-3);
            value = (value & ~location_mask) | loc;
            */
         return *this;
      }
      object_meta& set_type(node_type type)
      {
         _value.bf.type = int(type);
         return *this;
         //   value = (value & ~type_mask ) | (uint64_t(type) << type_lshift);
      }
      uint64_t     ref() const { return _value.bf.ref; }  //_value & ref_mask; }
      node_type    type() const { return node_type(_value.bf.type); }
      bool         modify_flag() const { return _value.bf.modify_flag; }
      bool         copy_flag() const { return _value.bf.copy_flag; }
      object_meta& clear_copy_flag()
      {
         _value.bf.copy_flag = 0;
         return *this;
      }

      bool is_changing() const { return not modify_flag(); }
      bool is_copying() const { return _value.bf.copy_flag; }

      object_location loc() const { return {uint64_t(_value.bf.location) << 4}; }

      // return the loc without mult by 16
      uint64_t raw_loc() const { return _value.bf.location; }
      void     set_raw_loc(uint64_t l) { _value.bf.location = l; }

      uint64_t&       data() { return _value.iv; }
      const uint64_t& data() const { return _value.iv; }
      uint64_t        to_int() const { return _value.iv; }
   };
   static_assert(sizeof(object_meta) == sizeof(uint64_t));

}  // namespace arbtrie
