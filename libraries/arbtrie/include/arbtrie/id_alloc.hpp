#pragma once
#include <arbtrie/block_allocator.hpp>
#include <arbtrie/config.hpp>
#include <arbtrie/debug.hpp>
#include <arbtrie/file_fwd.hpp>
#include <arbtrie/mapping.hpp>
#include <arbtrie/object_id.hpp>
#include <arbtrie/util.hpp>

namespace arbtrie
{

   /**
    * The ID file will grow by 256mb (assuming id_page_size is 4096) 
    */
   static constexpr const uint32_t id_block_size = id_page_size << 16;
   static constexpr const uint32_t ids_per_page = id_page_size / sizeof(uint64_t);

   struct node_location
   {
      uint32_t segment() const { return loc_div16 / (segment_size / 16); }
      uint32_t index() const { return loc_div16 & ((segment_size / 16) - 1); }
      uint64_t loc_div16 = 0;
      constexpr node_location(uint64_t v = 0) : loc_div16(v) {}
      friend bool operator==(node_location a, node_location b)
      {
         return a.loc_div16 == b.loc_div16;
      }
      friend bool operator!=(node_location a, node_location b)
      {
         return a.loc_div16 != b.loc_div16;
      }
   };
#ifdef __clang__
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wbitfield-constant-conversion"
#endif
   static constexpr const node_location end_of_freelist = node_location(-1);
   // initial location before seg_allocator assigns it
   static constexpr const node_location null_node = node_location(-2); 
#ifdef __clang__
#pragma clang diagnostic pop
#endif

   enum node_type : uint8_t
   {
      freelist  = 0,  // not initialized/invalid, must be first enum
      binary    = 1,  // binary search
      value     = 2,  // just the data, no key
      setlist   = 3,  // list of branches
      full      = 5,  // 256 full id_type
      undefined = 6,  // no type has been defined yet

      // future, requires taking a bit, or removing undefined/freelist
      //index    = 7,  // 256 index buffer to id_type
      //bitfield = 8,
      //merge    = 9,  // delta applied to existing node
   };
   static const char* node_type_names[] = {"freelist", "value", "binary",
                                           "setlist",  "full",  "undefined"};

   inline std::ostream& operator<<(std::ostream& out, node_type t)
   {
      if (t < node_type::undefined) [[likely]]
         return out << node_type_names[t];
      return out << "undefined(" << int(t) << ")";
   }

   /**
    * @class node_meta
    * 
    * This class is the core of the arbtrie memory managment algorithm
    * and is responsible for a majority of the lock-free properties. It
    * manages 8 bytes of "meta" information on every node in the trie
    * including its current location, reference count, copy locks,
    * and type. 
    *
    * Because node_meta is an atomic type and we desire to minimize 
    * the number of atomic accesses, @ref node_meta is templated on
    * the storage type so the majority of the API can be used on the
    * temporary read from the atomic. See node_meta<>::temp_type
    *
    */
   template <typename Storage = std::atomic<uint64_t>>
   class node_meta
   {
      /**
       *  Use the bitfield to layout the data,
       *  compute the masks. 
       */
      struct bitfield
      {
         uint64_t ref : 12       = 0;
         uint64_t type : 4       = 0;
         uint64_t copy_flag : 1  = 0;  // set this bit on start of copy, clear it on start of modify
         uint64_t const_flag : 1 = 0;  // 0 when modifying, 1 when not
         // the location divided by 16, 1024 TB addressable
         uint64_t location : 46 = 0;

         constexpr bitfield& from_int(uint64_t i)
         {
            memcpy(this, &i, sizeof(i));
            return *this;
         }
         constexpr uint64_t to_int() const { return std::bit_cast<uint64_t>(*this); }
         constexpr auto&    set_type(node_type t)
         {
            type = t;
            return *this;
         }
         constexpr auto& set_location(node_location l)
         {
            location = l.loc_div16;
            return *this;
         }
         constexpr auto& set_ref(uint16_t r)
         {
            assert(r <= max_ref_count);
            ref = r;
            return *this;
         }
      } __attribute((packed));
      static_assert(sizeof(bitfield) == sizeof(uint64_t));

     public:
      using temp_type = node_meta<uint64_t>;

      static constexpr const uint64_t ref_mask      = make_mask<0, 12>();
      static constexpr const uint64_t type_mask     = make_mask<12, 4>();
      static constexpr const uint64_t copy_mask     = make_mask<16, 1>();
      static constexpr const uint64_t const_mask    = make_mask<17, 1>();
      static constexpr const uint64_t location_mask = make_mask<18, 46>();

      /**
       *  Because retain() uses fetch_add() there is a possability of
       *  overflow. For this reason retain will fail and undo once it
       *  reaches past max_ref_count. A value of 64 means 64 threads would
       *  have to fetch_add() before any thread fetch_sub() after reading
       *  the value. That is an unreasonable number of cores attempting
       *  to retain at the same time; therefore, this should be safe and
       *  still allows ref counts up to 4032. 
       */
      static constexpr const uint64_t max_ref_count = ref_mask - 64;

      /**
       * @defgroup Accessors
       *  These methods work on by the atomic and temp_type 
       */
      ///@{

      uint64_t to_int() const { 
         if constexpr (std::is_same_v<Storage, uint64_t>)
            return _meta; 
         else
            return _meta.load( std::memory_order_relaxed );
      }

      bool          is_changing() const { return not is_const(); }
      bool          is_const() const { return to_int() & const_mask; }
      bool          is_copying() const { return to_int() & copy_mask; }
      uint16_t      ref() const { return bitfield(to_int()).ref; }
      node_location loc() const { return {bitfield(to_int()).location}; }
      node_type     type() const { return node_type(bitfield(to_int()).type); }

      auto& set_ref(uint16_t ref)
      {
         assert(ref < max_ref_count);
         store(bitfield(to_int()).set_ref(ref).to_int(), std::memory_order_relaxed);
         return *this;
      }
      auto& set_type(node_type t)
      {
         _meta = bitfield(to_int()).set_type(t).to_int();
         return *this;
      }

      auto& set_location(node_location nl)
      {
         _meta = bitfield(to_int()).set_location(nl.loc_div16).to_int();
         return *this;
      }
      auto& clear_copy_flag()
      {
         _meta &= ~copy_mask;
         return *this;
      }

      void store(uint64_t v, auto memory_order) { _meta.store(v, memory_order); }
      auto load(auto memory_order = std::memory_order_relaxed) const
      {
         if constexpr (std::is_same_v<Storage, uint64_t>)
            return temp_type(_meta);
         else
            return temp_type(_meta.load(memory_order));
      }
      ///@}

      /**
       * @defgroup Atomic Synchronization 
       *  These methods only work on the default Storage=std::atomic
       */
      ///@{
      // returns the state prior to start modify
      temp_type start_modify()
      {
         // this mask sets copy to 0 and const to 0
         const uint64_t start_mod_mask = ~(copy_mask | const_mask);
         //if constexpr (std::is_same_v<Storage, fake_atomic<uint64_t>>)
         return temp_type(_meta.fetch_and(start_mod_mask, std::memory_order_acquire));
         //else
         //   static_assert(!"cannot modify a temporary view of an atomic object");
      }

      temp_type end_modify()
      {
         // set the const flag to 1 to signal that modification is complete
         // mem order release synchronizies with readers of the modification
         temp_type prior(_meta.fetch_or(const_mask, std::memory_order_release));

         // if a copy was started between start_modify() and end_modify() then
         // the copy bit would be set and the other thread will be waiting
         if (prior.is_copying())
            _meta.notify_all();
      }

      /**
       *  Sets the copy flag to true, 
       */
      bool try_start_move(node_location expected)
      {
         do
         {
            // set the copy bit to 1
            // acquire because if successful, we need the latest writes to the object
            // we are trying to move
            temp_type old(_meta.fetch_or(copy_mask, std::memory_order_acquire));

            if (not old.ref() or old.loc() != expected) [[unlikely]]
            {  // object we are trying to copy has moved or been freed, return false
               _meta.fetch_and(~copy_mask, std::memory_order_relaxed);
               return false;
            }

            if (not old.is_changing()) [[likely]]
               return true;

            // exepcted current value is old|copy because the last fetch_or,
            // this will wait until the value has changed
            _meta.wait(old.to_int() | copy_mask, std::memory_order_acquire);
         } while (true);
      }

      enum move_result : int_fast8_t
      {
         moved   = -1,
         freed   = -2,
         success = 0,
         dirty   = 1,
      };

      /**
       *  Move is only successful if the expected location hasn't changed 
       *  from when try_start_move() was called. If everything is in order
       *  then new_loc is stored.  move_result > 1 is dirty, move_result < 0
       *  means the object is no longer there.  Success is 0.
       */
      move_result try_move(node_location expect_loc, node_location new_loc)
      {
         uint64_t  expected = _meta.load(std::memory_order_acquire);
         temp_type ex;
         do
         {
            ex = temp_type(expected);
            if (not ex.is_copying()) [[unlikely]]
               return move_result::dirty;

            // start_move set the copy bit, start_modify cleared it
            // therefore the prior if already returned.
            assert(not ex.is_changing());
            /*if (ex.is_changing()) [[unlikely]] 
               return move_result::dirty; */

            if (ex.loc() != expect_loc) [[unlikely]]
               return move_result::moved;
            if (ex.ref() == 0) [[unlikely]]
               return move_result::freed;
            ex.set_location(new_loc).clear_copy_flag();
         } while (
             not _meta.compare_exchange_weak(expected, ex.to_int(), std::memory_order_release));
         return move_result::success;
      }

      /**
       *  A thread that doesn't own this object and wants to own it must
       *  ensure that nothing changes if it cannot increment the reference count; therefore,
       *  it cannot use fetch_add() like retain() does and must use compare/exchange loop
       */
      bool try_retain()
      {
         // load, inc, compare and exchange
         throw std::runtime_error("try_retain not impl yet");
         abort();
      }

      /**
       * This method is only safe to call if the caller already "owns" one
       * existing reference count. To retain from a non-owning thread requires
       * calling try_retain
       */
      bool retain()
      {
         temp_type prior(_meta.fetch_add(1, std::memory_order_relaxed));
         if (prior.ref() > node_meta::max_ref_count) [[unlikely]]
         {
            _meta.fetch_sub(1, std::memory_order_relaxed);
            return false;
         }
         return true;
      }
      bool release()
      {
         temp_type prior(_meta.fetch_sub(1, std::memory_order_relaxed));
         assert(prior.ref() != 0);
         if constexpr (debug_memory)
         {
            if (prior.ref() == 0)
               throw std::runtime_error("double release detected");
         }
         return prior.ref() == 1;
      }
      ///@} k

      constexpr node_meta(uint64_t v = 0) : _meta(v) {}
      node_meta& operator=(auto&& m)
      {
         _meta = std::forward<decltype(m)>(m);
         return *this;
      }

     private:
      std::atomic<uint64_t> _meta;
   };
   static_assert(sizeof(node_meta<>) == 8);

   using node_meta_type = node_meta<>;
   using temp_meta_type = node_meta<uint64_t>;
   static_assert(sizeof(node_meta_type) == sizeof(temp_meta_type));

   /**
    *  @class id_alloc
    *  
    *  Manages the index of node_meta objects allocated by
    *  regions and returns id's to enable quick lookup of
    *  the meta objects.
    */
   class id_alloc
   {
     public:
      id_alloc(std::filesystem::path id_file);
      ~id_alloc();

      node_meta_type& get(id_address nid);

      id_region                              get_new_region();
      std::pair<node_meta_type&, id_address> get_new_id(id_region r);
      void                                   free_id(id_address id);

     private:
      struct region_header
      {
         std::mutex            alloc_mutex;
         std::atomic<uint32_t> use_count;
         std::atomic<uint32_t> next_alloc;
         std::atomic<uint64_t> first_free;  // TODO: must init to node_location::end_of_freelist
      };

      struct id_alloc_state
      {
         uint64_t              magic   = 0;  // TODO: identify this file type
         uint64_t              version = 0;
         std::atomic<uint16_t> next_region;
         bool                  clean_shutdown = 0;
         std::atomic<uint64_t> free_release_count;
         region_header         regions[1 << 16];
      };

      std::mutex            _grow_mutex;
      std::filesystem::path _data_dir;
      block_allocator       _block_alloc;
      mapping               _ids_state_file;
      id_alloc_state*       _state;
   };

   inline node_meta_type& id_alloc::get(id_address nid)
   {
      // TODO verify compiler converted all multiply and divide operations to shifts
      uint64_t abs_pos        = nid.index() * sizeof(node_meta_type);
      uint64_t block_num      = abs_pos / id_page_size;
      uint64_t index_in_block = abs_pos & uint64_t(id_page_size - 1);

      auto ptr =
          ((char*)_block_alloc.get(block_num)) + nid.region() * id_page_size + index_in_block;

      return reinterpret_cast<node_meta_type&>(*ptr);
   }

   inline id_region id_alloc::get_new_region()
   {
      // allocate regions in round-robin manner to ensure balanced loading,
      // leverages auto-wrapping of uint16_t
      return {_state->next_region.fetch_add(1, std::memory_order_relaxed)};
   }

   /**
    *  This function is designed to be thread safe, it will lock a mutex
    *  if it must grab from the free list, but will use atomic inc allocate
    *  until the free list must be consulted
    */
   inline std::pair<node_meta_type&, id_address> id_alloc::get_new_id(id_region r)
   {
      if constexpr (debug_memory)
         _state->free_release_count.fetch_add(1, std::memory_order_relaxed);

      const uint32_t ids_per_page = id_page_size / sizeof(node_meta_type);

      auto  num_pages = _block_alloc.num_blocks();
      auto& rhead     = _state->regions[r.region];

      auto prior_ucount = rhead.use_count.fetch_add(1, std::memory_order_relaxed);
      if (prior_ucount >= num_pages * ids_per_page)
      {
         // reserve() is thread safe and if two threads both try to alloc then
         // only one will actually do the work.
         TRIEDENT_WARN("growing all id regions because use count of one region exceeded cap");
         num_pages = _block_alloc.reserve(num_pages + 1, true);
      }
      auto na = rhead.next_alloc.load(std::memory_order_relaxed);
      if (na < num_pages * ids_per_page)
      {
         // then skip the free list, and grab a new one!
         auto nid = rhead.next_alloc.fetch_add(1, std::memory_order_relaxed);

         if (nid < num_pages * id_page_size) [[likely]]
         {
            auto nadr = r + id_index(nid);
            return {get(r + id_index(nid)), nadr};
         }
         else
         {
            // race condition caused attempt to allocate beyond end of page,
            // must undo the add to restore balance... then consult free list
            rhead.next_alloc.fetch_sub(1, std::memory_order_relaxed);
         }
      }
      // there must be something in the free list because if use count implied no
      // free then it would have grown() and returned.

      // TODO: ff_index must init to node_meta::location_mask == end of list
      uint64_t ff_index = 0;

      {  // lock scope, must lock to alloc because of race between
         // reading last free and storing, conviently there are
         // 65k different regions so should be little contention
         std::unique_lock<std::mutex> l{rhead.alloc_mutex};
         ff_index = rhead.first_free.load(std::memory_order_acquire);
         do
         {
            if (ff_index == end_of_freelist)
               throw std::runtime_error("reached end of free list, that shouldn't happen!");
         } while (rhead.first_free.compare_exchange_weak(
             ff_index, get(r + id_index(ff_index)).loc().loc_div16, std::memory_order_relaxed));
      }

      node_meta_type::temp_type tmeta(ff_index);
      ff_index     = tmeta.loc().loc_div16;
      auto new_adr = r + id_index(ff_index);

      //      std::cerr << "  reused id: " << ff << "\n";
      auto& ffa = get(new_adr);  //r + id_index(ff_index));
      tmeta.set_ref(1).set_location(null_node);

      // store 1 = ref count 1 prevents object as being interpreted as unalloc
      ffa.store(tmeta.to_int(), std::memory_order_relaxed);

      //     std::cerr << "   post alloc free list: ";
      //    print_free_list();
      return {ffa, new_adr};
   }

   inline void id_alloc::free_id(id_address adr)
   {
      if constexpr (debug_memory)
         _state->free_release_count.fetch_sub(1, std::memory_order_relaxed);

      auto& rhead          = _state->regions[adr.region()];
      auto& head_free_list = rhead.first_free;
      auto& next_free      = get(adr);
      auto  new_head       = temp_meta_type().set_location(end_of_freelist).to_int();

      uint64_t cur_head = rhead.first_free.load(std::memory_order_acquire);
      do
      {
         //assert(not(cur_head & ref_mask));
         //assert(not(next_free & ref_mask));
         next_free.store(cur_head, std::memory_order_release);
      } while (not rhead.first_free.compare_exchange_weak(cur_head, new_head,
                                                          std::memory_order_release));
      rhead.use_count.fetch_sub(1, std::memory_order_relaxed);
   }

}  // namespace arbtrie
