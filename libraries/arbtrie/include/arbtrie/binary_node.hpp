#pragma once
#include <arbtrie/node_header.hpp>
#include <arbtrie/value_type.hpp>


namespace arbtrie
{

   /**
    *  Binary Node uses a binary search to find the leaf values
    *  in the tree. The goal is to minimize memory page misses
    *  by putting as much of the final tree lookup on one page
    *  as possible. This means we want binary_node to scale to
    *  4096 bytes and to get as many key/value pairs as possible.
    *  
    *  A competing goal is to make updates/inserts effecient and
    *  copying and/or moving a lot of other keys to make room for
    *  a new key is counter productive. 
    *
    *  Furthermore, we want sparse nodes that are not full to be
    *  light-weight to clone.
    *
    *  ## Checksum Calculation
    *  A further goal is to make updating the checksum of an object
    *  after inplace modification as effecient as possible. If changing
    *  a single inline value (<62 bytes) forces a re-hash of 4096 bytes,
    *  then modifications could be unreasonably expensive. Further more,
    *  in the event of data corruption, a single byte error could cause
    *  all the keys/values in the binary node to be corrupted.
    *
    *  We can kill multiple birds with a single stone by storing 
    *  a 8 bit hash of each key in a linear array. This allows asembly
    *  optimized, branch-prediction friendly, searching for the
    *  desired key while providing a 99.6% probability of detecting 
    *  data corruption in the key. This should make finding the
    *  final branch alsmost as fast as a single setlist node.
    *
    *  We can use another 8 bit hash of each value (<62) bytes
    *  and store this hash in another parallel/linear array. Updating
    *  the 32 bit hash over the entire binary node only requires
    *  calculating the key hash, the value hash, and a hash of the
    *  hashes. One bit of the value hash can signal whether the value
    *  is bytes or an object_id and therefore make scanning for
    *  object_id's to retain/release much faster.
    *
    *  Because the hash algorithm produces a full 8 byte hash and 
    *  we are only using 1 byte, we can use any padding that rounds
    *  the key/value pair to 16 byte alignment to store additional
    *  checksum bytes for the key and value for no extra storage
    *  cost and minimal CPU cost. Assuming a random distribution
    *  of key/value sizes the there is an average of 7 additional
    *  hash bytes per key/value pair while 1 in 16 keys would have
    *  only the 8 bit hash giving just 99.6% error diection rate.
    *
    *  Because the key offsets are 8 bits and the key_val alignment
    *  is 16 bytes (so that the full 4096 bytes is addressable), there
    *  is a maximum of 214 key/value per binary node. The hash of hashes 
    *  would require hashing 450 bytes or about 15% of the data in the
    *  page, an 85% savings. Nodes that are not full and/or have
    *  larger keys and inline values would be even more effecient.
    *
    *  ## Inline Storage of Values
    *  Values less than 63 bytes are stored inline with the binary node
    *  directly after the key. This small value optimization prevents
    *  a lookup of the value in another page and eliminates the need
    *  to do extra reference counting on small values. 
    *
    *     Note: the storage overhead of a non-inlined value is:
    *       object_id(5) + node_meta(8) + object_header(16), or 29 bytes,
    *
    *  so for values less than 29 bytes this is a more compact solution. It also reduces
    *  the demand on the object_id database which must be pinned to memory.
    *
    *  ## Storage Locations / Insertion Order
    *  keys and values are appened backwards from the end of the node in the order
    *  they were inserted. They are not ordered so new insertions don't require moving
    *  this data around. Deletion and/or resizing is more expensive because it
    *  requires moving all data before the deletion down and updating their index
    *
    *  key offsets and key/value hashes are inserted in key-sort-order 
    *  after the header. This gives us log(n) indexing to perform a
    *  binary search to locate the insertion position and/or upper/lower bounds and
    *  the hashes give us an accelerated point lookup for queries 
    *  and update-only (non-inserts).
    *
    *  Then the key hashes are after the header, followed by  offsets so that key 
    *  hashes/offsets are more likely to be on the same cache line,
    *  then value hashes are stored after that so that they are only accessed when
    *  doing an insert/update/checksum/clone/move but not when doing a read-only query.
    *
    *  # Key Offsets
    *  The maximum binary node size is 4096, therefore only 12 bits of the key offset
    *  are required to identify where the key_val_pair is.  The top 4 bits of each
    *  offset is reserved for metadata that indicates the type of value stored.
    *
    *       Value Types stored in top 4 bits:
    *       0    - inline bytes
    *       1    - object_id
    *       2-15 - reserved
    *
    *
    *  notional layout
    *  ------------------------
    *  uint16_t     alloc_pos     - tail()-16*alloc_pos = start of allocated key_vals
    *  uint16_t     branch_cap    - the reserved bytes for adding new keys
    *  uint8_t      key_hashes    [num_branches]  - 8 bit hash of the keys faster lookups / data integ 
    *  uint16_t     key_offsets   [num_branches]  - offsets are measured in bytes from tail
    *  uint8_t      value_hashes  [num_branches]  - 8 bit hash of value, detect data corruption
    *  uint8_t      padding       [0-15]          - to align the free space at 16 byte boundary
    *  uint128_t    free_space    [reserved]      - to enable insert without realloc entire node
    *  key_val      keys_vals     [num_branches+] - aligned on 16 byte boundaries 
    * 
    *  Where a key_val has the layout:
    *    uint16_t _key_size:10;  - up to 1024 bytes
    *    uint16_t _val_size:6;   - up to 62 bytes, because value 63 signals a 5 byte object_id 
    *    uint8_t key [_key_size]
    *    int8_t  val [_val_size] - sign bit indicates value is object id, 7 bits of hash data
    *    uint8_t pad [bytes_to_next_16 byte align] - stores up to 8 extra hash bytes of key/val
    */
   struct binary_node : node_header
   {
      static const uint8_t      max_inline_value_size = 63;
      static const int_fast16_t key_not_found         = -1;
      static const node_type    type                  = node_type::binary;

      uint16_t _alloc_pos;   // mult by 16 to get bytes from tail of first key_val_pair
      uint16_t _branch_cap;  // space reserved for branchs, must be <= num_branches()
      uint8_t  _key_hashes[];

      struct clone_update
      {
         uint16_t   idx;  // the index to update
         value_type val;
      };

      struct clone_insert
      {
         uint16_t   lb_idx;  // the lower bound to insert before
         key_view   key;
         value_type val;
      };

      /**
       * Always a multiple of 64, aka the typical cache line size
       */
      inline static int alloc_size(const clone_config& cfg);
      inline static int alloc_size(const binary_node* src, const clone_config& cfg);
      inline static int alloc_size(const binary_node*  src,
                                   const clone_config& cfg,
                                   const clone_insert& ins);
      inline static int alloc_size(const binary_node*  src,
                                   const clone_config& cfg,
                                   const clone_update& upv);

      //                     int lb_idx,
      //                    key_view           key,
      //                   is_value_type auto val);

      // make empty
      binary_node(int_fast16_t asize, fast_meta_address nid, const clone_config& cfg);
      // clone
      binary_node(int_fast16_t        asize,
                  fast_meta_address nid,
                  const binary_node*  src,
                  const clone_config& cfg);
      // clone + insert
      binary_node(int_fast16_t        asize,
                  fast_meta_address nid,
                  const binary_node*  src,
                  const clone_config& cfg,
                  const clone_insert& ins);

      binary_node(int_fast16_t        asize,
                  fast_meta_address nid,
                  const binary_node*  src,
                  const clone_config& cfg,
                  const clone_update& upv);

      //            int lb_idx,
      //            key_view           key,
      //            is_value_type auto val);

      static inline uint64_t key_hash(key_view k) { return XXH3_64bits(k.data(), k.size()); }
      static inline uint64_t value_hash(value_view k) { return XXH3_64bits(k.data(), k.size()); }
      static inline uint64_t value_hash(object_id k) { return XXH3_64bits(&k, sizeof(k)); }
      static inline uint64_t value_hash(fast_meta_address m) { 
         return value_hash( (object_id)m.to_address() );
      }

      static inline uint8_t key_header_hash(uint64_t kh) { return uint8_t(kh); }
      static inline uint8_t value_header_hash(uint64_t vh) { return uint8_t(vh); }

      struct key_index
      {
         enum value_type
         {
            inline_data = 0,
            obj_id      = 1
         };
         uint16_t   pos : 12 = 0;
         uint16_t   type : 4 = inline_data;
         value_type val_type() const { return (value_type)type; }
         key_index& operator=(const key_index&) = default;
      } __attribute((packed, aligned(1)));
      static_assert(sizeof(key_index) == sizeof(uint16_t));

      struct key_val_pair
      {
         uint16_t _key_size : 10;  // keys can be up to 1kb
         uint16_t _val_size : 6;   // values up to 63 bytes are stored inline,

         uint8_t _key[];

         inline const uint8_t* value_end_ptr() const { return val_ptr() + value_size(); }
         inline uint8_t*       value_end_ptr() { return val_ptr() + value_size(); }

         uint64_t     key_hash() const { return XXH3_64bits(key_ptr(), key_size()); }
         uint64_t     value_hash() const { return XXH3_64bits(val_ptr(), value_size()); }
         int_fast16_t total_size() const { return sizeof(key_val_pair) + _key_size + _val_size; }

         inline int_fast16_t   key_size() const { return _key_size; }
         inline int_fast8_t    value_size() const { return _val_size; }
         inline uint8_t*       key_ptr() { return _key; }
         inline const uint8_t* key_ptr() const { return _key; }
         inline uint8_t*       val_ptr() { return _key + _key_size; }
         inline const uint8_t* val_ptr() const { return _key + _key_size; }
         inline key_view       key() const { return key_view((char*)_key, _key_size); }
         inline value_view     value() const
         {
            return value_view((char*)_key + _key_size, value_size());
         }

         inline const fast_meta_address value_id() const
         {
            assert(_val_size == sizeof(object_id));
            return *((const id_address*)(_key + _key_size));
         }

         inline id_address& value_id()
         {
            assert(_val_size == sizeof(object_id));
            return *((id_address*)(_key + _key_size));
         }
         void set_key(key_view v)
         {
            _key_size = v.size();
            memcpy(key_ptr(), v.data(), v.size());
         }
         void set_value(value_view v)
         {
            assert(v.size() <= _val_size);
            _val_size = v.size();
            memcpy(val_ptr(), v.data(), v.size());
         }
         void set_value(const value_type& v)
         {
            assert(v.size() <= _val_size);
            if (v.is_object_id())
            {
               assert( _val_size >= sizeof(object_id) );
               _val_size   = sizeof(object_id);
               object_id() = v.id().to_address();
            }
            else
            {
               auto vv = v.view();
               assert( _val_size >= vv.size() );
               assert(vv.size() <= max_inline_value_size);
               _val_size = vv.size();
               memcpy(val_ptr(), vv.data(), vv.size());
            }
         }

         /*
         key_val_pair*       next() { return (key_val_pair*)(((char*)this) + padded_size()); }
         const key_val_pair* next() const
         {
            return (const key_val_pair*)(((const char*)this) + padded_size());
         }
         */
      } __attribute((packed)) __attribute((aligned(1)));

      static_assert(sizeof(key_val_pair) == 2);

      void raise_branch_cap(short newcap);

      uint8_t*       key_hashes() { return _key_hashes; }
      const uint8_t* key_hashes() const { return _key_hashes; }

      key_index*       key_offsets() { return (key_index*)(_key_hashes + _branch_cap); }
      const key_index* key_offsets() const { return (const key_index*)(_key_hashes + _branch_cap); }

      int  key_offset_from_tail(int n) const { return key_offsets()[n].pos; }
      bool is_obj_id(uint8_t n) const { return key_offsets()[n].type == key_index::obj_id; }

      uint8_t*       value_hashes() { return (uint8_t*)(key_offsets() + _branch_cap); }
      const uint8_t* value_hashes() const { return (const uint8_t*)(key_offsets() + _branch_cap); }

      inline uint8_t*       end_value_hashes() { return value_hashes() + _branch_cap; }
      inline const uint8_t* end_value_hashes() const { return value_hashes() + _branch_cap; }

      void append(const key_val_pair*   kv,
                  int                   minus_prefix,
                  uint8_t               khash,
                  uint8_t               vhash,
                  key_index::value_type t);

      // data size of the index inclusive of spare slots
      int index_data_size() const
      {
         return 4 * _branch_cap + sizeof(binary_node) - sizeof(node_header);
      }

      // this includes the padding space
      const char* end_index_data() const { return body() + index_data_size(); }

      inline int key_val_section_size() const { return int(_alloc_pos); }
      int        spare_capacity() const
      {
         return (tail() - key_val_section_size()) - (const uint8_t*)end_index_data();
      }

      bool insert_requires_refactor(key_view k, const value_type& v) const
      {
         auto space_req = 4 + calc_key_val_pair_size(k, v) + 32 * 4;
         return (size() - spare_capacity() + space_req) > binary_refactor_threshold;
      }
      bool update_requires_refactor(const key_val_pair* existing, const value_type& new_val) const
      {
         auto space_req = calc_key_val_pair_size(existing->key(), new_val) - existing->key_size() -
                          existing->value_size();
         return (size() - spare_capacity() + space_req) > binary_refactor_threshold;
      }

      bool can_insert(key_view k, const value_type& val) const
      {
         int  s  = calc_key_val_pair_size(k, val);
         auto sc = spare_capacity();
         if (s < sc and num_branches() < _branch_cap)
            return true;
         s += 32;  // room to grow the branch cap
         return s < sc;
         // if numb == branch_cap then size += 4 else size += 0
         //s += (num_branches() == _branch_cap) << 2;
         //return s <= spare_capacity();
      }
      void set_value(int lb_idx, const value_type& val)
      {
         auto& idx = key_offsets()[lb_idx];
         idx.type = val.is_object_id();
         get_key_val_ptr(lb_idx)->set_value(val);
      }

      inline static constexpr bool can_inline(const value_type& val)
      {
         return val.size() <= max_inline_value_size;
      }
      inline static constexpr bool can_inline(object_id val) { return true; }

      // calculates the space required to store this key/val exclusive of node_header,
      // assuming that if value cannot be inlined it will be converted to an object_id
      inline static int calc_key_val_pair_size(key_view key, value_view val)
      {
         // 4 = key_index, keyhash, valhash
         return sizeof(key_val_pair) + key.size() +
                (can_inline(val) ? val.size() : sizeof(object_id));
      }
      inline static int calc_key_val_pair_size(key_view key, id_address val)
      {
         // 4 = pos, keyhash, valhash
         return sizeof(key_val_pair) + key.size() + sizeof(val);
      }
      inline static int calc_key_val_pair_size(key_view key, const value_type& val)
      {
         if (val.is_object_id())
            return calc_key_val_pair_size(key, val.id());
         return calc_key_val_pair_size(key, val.view());
      }

      /**
       * Performs a checksum over just the index/key/value hashes
       * and not over the bulk of the object and skips the reserve 
       * spaces in the index
       */
      uint32_t calculate_checksum() const
      {
         auto start = XXH3_64bits(((const char*)this) + sizeof(checksum),
                                  sizeof(binary_node) - sizeof(checksum) + num_branches());
         auto idx   = XXH3_64bits(key_offsets(), sizeof(key_index) * num_branches());
         auto vhash = XXH3_64bits(value_hashes(), num_branches());
         return start ^ idx ^ vhash;
      }

      // return the nth key value pair
      inline key_val_pair* get_key_val_ptr(int n)
      {
         assert(n < num_branches());
         return (key_val_pair*)(tail() - key_offset_from_tail(n));
      }
      inline const key_val_pair* get_key_val_ptr(int n) const
      {
         assert(n < num_branches());
         return (const key_val_pair*)(tail() - key_offset_from_tail(n));
      }

      inline const key_val_pair* get_key_val_ptr_offset(int n) const
      {
         return (const key_val_pair*)(tail() - n);
      }
      inline key_val_pair* get_key_val_ptr_offset(int n) { return (key_val_pair*)(tail() - n); }

      inline std::string_view get_key(int n) { return get_key_val_ptr(n)->key(); }
      inline std::string_view get_key(int n) const { return get_key_val_ptr(n)->key(); }

      key_val_pair* find_key_val(std::string_view key)
      {
         auto idx = find_key_idx(key);
         return idx >= 0 ? get_key_val_ptr(idx) : nullptr;
      }
      const key_val_pair* find_key_val(std::string_view key) const
      {
         auto idx = find_key_idx(key);
         return idx >= 0 ? get_key_val_ptr(idx) : nullptr;
      }

      int find_key_idx(std::string_view key, uint64_t khash) const
      {
         key_view hashes((char*)key_hashes(), num_branches());
         auto     khh = key_header_hash(khash);
         //  TRIEDENT_WARN( "find key: '", key, "' with h: ", int(khh), "  nb: ", num_branches() );

         int base = 0;
         while (true)
         {
            auto idx = hashes.find(khh);
            if (idx == key_view::npos)
               return -1;
            auto bidx = base + idx;
            auto kvp  = get_key_val_ptr(bidx);
            if (kvp->key() == key)
               return bidx;
            hashes = hashes.substr(idx + 1);
            base   = bidx + 1;
         }
      }
      int find_key_idx(std::string_view key) const
      {
         int idx = lower_bound_idx(key);
         if (idx >= num_branches())
            return -1;
         if (get_key(idx) != key)
            return -1;
         return idx;
      }
      int lower_bound_idx(std::string_view key) const
      {
         int left  = -1;
         int right = num_branches();
         while (right - left > 1)
         {
            int middle = (left + right) >> 1;
            if (get_key(middle) < key)
               left = middle;
            else
               right = middle;
         }
         return right;
      }

      bool validate() const
      {
         assert(_nsize < 4096);
         auto nb = num_branches();
         for (int i = 0; i < nb; ++i)
         {
            auto kvp = get_key_val_ptr(i);
            assert((uint8_t*)kvp < tail());
            assert(kvp->value_size() > 0);
            assert(kvp->key_size() < 130);
         }

         return true;
      }

      /*
      // returns the space required to add a key/val, counts:
      //   2 byte offset
      //   1 byte key hash
      //   1 byte value hash
      //   2 byte sizes of key/val
      //   the actual data of key/val
      static int space_required(key_view key, value_view val)
      {
         return 6 + key.size() + (can_inline(val) ? val.size() : sizeof(object_id));
      }
      */

      /**
       *  Visits all values that contain a value_id, usually
       *  to support retain/release.
       *
       *  By stealing a bit from the value_hash object we can
       *  quickly find just the values that are needed.
       *
       *  callss visitor() with an object_id 
       */
      inline void visit_branches(auto&& visitor) const
      {
         auto       start = key_offsets();
         auto       pos   = start;
         const auto end   = start + num_branches();
         while (pos != end)
         {
            if (pos->type == key_index::obj_id)
            {
               assert(get_key_val_ptr_offset(pos->pos)->value_size() == sizeof(object_id));
               visitor(fast_meta_address(get_key_val_ptr_offset(pos->pos)->value_id()));
            }
            ++pos;
         }
      }

      void insert(int kidx, key_view key, const value_type& val);

   } __attribute((packed));
   static_assert(sizeof(binary_node) == sizeof(node_header) + 4);

}  // namespace arbtrie
//

#include <arbtrie/binary_node_impl.hpp>