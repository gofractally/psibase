#pragma once
#include <cassert>
#include <iostream>
#include <optional>
#include <string_view>
#include <variant>
#include <arbtrie/object_id.hpp>
#include <arbtrie/config.hpp>
#include <arbtrie/util.hpp>
#include <arbtrie/node_location.hpp>

namespace arbtrie
{
   enum node_type : uint8_t
   {
      freelist  = 0,  // not initialized/invalid, must be first enum
      binary    = 1,  // binary search
      value     = 2,  // just the data, no key
      setlist   = 3,  // list of branches
      full      = 4,  // 256 full id_type
      undefined = 5,  // no type has been defined yet

      // future, requires taking a bit, or removing undefined/freelist
      //index    = 7,  // 256 index buffer to id_type
      //bitfield = 8,
      //merge    = 9,  // delta applied to existing node
   };
   static const char* node_type_names[] = {"freelist", "binary", "value",
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
    *  ## Modify / Copy Locking Protocol
    *
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
         uint64_t const_flag : 1 = 1;  // 0 when modifying, 1 when not
         // the location divided by 16, 1024 TB addressable,
         // upgrade to cacheline gives 4096 TB addressable
         uint64_t location : 46 = 0;


         constexpr bitfield& from_int(uint64_t i)
         {
            memcpy(this, &i, sizeof(i));
            return *this;
         }
         explicit bitfield( uint64_t bf ) { from_int(bf); }

         // doesn't work as a constexpr on all compilers
         constexpr uint64_t to_int() const { return std::bit_cast<uint64_t>(*this); }
         constexpr auto&    set_type(node_type t)
         {
            type = t;
            return *this;
         }
         constexpr auto& set_location(node_location l)
         {
            location = l.to_aligned();
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
      static constexpr const uint64_t max_ref_count = ref_mask - max_threads;

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
      node_location loc() const { return node_location::from_aligned(bitfield(to_int()).location); }
      node_type     type() const { return node_type(bitfield(to_int()).type); }

      auto& set_ref(uint16_t ref)
      {
         assert(ref < max_ref_count);
         _meta = bitfield(to_int()).set_ref(ref).to_int();
         return *this;
      }

      auto& set_type(node_type t)
      {
         _meta = bitfield(to_int()).set_type(t).to_int();
         return *this;
      }

      auto& set_location(node_location nl)
      {
         _meta = bitfield(to_int()).set_location(nl).to_int();
         return *this;
      }
      auto& clear_copy_flag()
      {
         _meta &= ~copy_mask;
         return *this;
      }

      void store(uint64_t v, auto memory_order) { _meta.store(v, memory_order); }
      void store( temp_type v, auto memory_order) { _meta.store(v.to_int(), memory_order); }
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
         if constexpr ( use_wait_free_modify ) {
            constexpr const uint64_t start_mod_mask = ~(copy_mask | const_mask);
            return temp_type(_meta.fetch_and(start_mod_mask));
         } else {
            temp_type prior(_meta.fetch_and(~const_mask) );
            if( prior.is_copying() ) {
               TRIEDENT_WARN( "waiting on copy before modifying" );
               _meta.wait( prior.to_int() & ~const_mask );
            }
            return prior;
         }
      }

      temp_type end_modify()
      {
         // set the const flag to 1 to signal that modification is complete
         // mem order release synchronizies with readers of the modification
         temp_type prior(_meta.fetch_or(const_mask, std::memory_order_release));

         // if a copy was started between start_modify() and end_modify() then
         // the copy bit would be set and the other thread will be waiting
         if (prior.is_copying()){
            _meta.notify_all();
         }
         return prior;
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
            temp_type old(_meta.fetch_or(copy_mask));//, std::memory_order_acquire));

            if (not old.ref() or old.loc() != expected) [[unlikely]]
            {  // object we are trying to copy has moved or been freed, return false
               _meta.fetch_and(~copy_mask, std::memory_order_relaxed);
               return false;
            }

            if (not old.is_changing()) [[likely]]
               return true;

            // exepcted current value is old|copy because the last fetch_or,
            // this will wait until the value has changed
            //_meta.wait(old.to_int() | copy_mask, std::memory_order_acquire);
            _meta.wait(old.to_int() | copy_mask);//, std::memory_order_acquire);
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
         uint64_t  expected;
         if constexpr ( not use_wait_free_modify ) {
            expected = _meta.fetch_and( ~copy_mask, std::memory_order_relaxed );
            if( not (expected & const_mask) ) {
               TRIEDENT_WARN( "notify modify thread after copy" );
               _meta.notify_all();
            }
         } else {
            expected = _meta.load(std::memory_order_relaxed);
         }

         temp_type ex;
         do
         {
            ex = temp_type(expected);
            if constexpr( use_wait_free_modify ) {
               if (not ex.is_copying()) [[unlikely]]
                  return move_result::dirty;

               // start_move set the copy bit, start_modify cleared it
               // therefore the prior if already returned.
               assert(not ex.is_changing());
            }

            if constexpr ( debug_memory ) {
               if (ex.is_changing()) [[unlikely]] 
               {
                  TRIEDENT_WARN( " SHOULD NEVER HAPPEN DIRTY?" );
                  return move_result::dirty; 
               }
            }

            if (ex.loc() != expect_loc) [[unlikely]]
               return move_result::moved;
            if (ex.ref() == 0) [[unlikely]]
               return move_result::freed;
            ex.set_location(new_loc).clear_copy_flag();
         } while (
             //not _meta.compare_exchange_weak(expected, ex.to_int(), std::memory_order_release));
             not _meta.compare_exchange_weak(expected, ex.to_int()) );
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
      temp_type release()
      {
         /**
          *  Normally reference counting requires this to be memory_order_acquire
          *  or, technically, memory_order_release followed by an acquire fence
          *  if and only if prior was 1.  This is to make sure all writes to the
          *  memory are complete before the object is theoretically handed over
          *  to someone else; however, we have a unique situation:
          *
          *  1. all data with a reference count > 1 is constant and protected by
          *     the segment sequence lock.
          *  2. The caller of release() holds the segment lock that prevents it
          *  from being reused for anyone else until after that is released.
          *
          *  In other words the "life time" of the object extends to the read
          *  lock and this decrement is not in danger given all threads
          *  synchronize their memory on the sequence numbers.
          */
         temp_type prior(_meta.fetch_sub(1, std::memory_order_relaxed));
         assert(prior.ref() != 0);
         if constexpr (debug_memory)
         {
            if (prior.ref() == 0)
               throw std::runtime_error("double release detected");
         }
         return prior;
      }
      ///@} k

      node_meta( const node_meta<uint64_t>& cpy ):_meta(cpy._meta){}

      constexpr node_meta(uint64_t v = const_mask) : _meta(v) {}

      /*
      node_meta& operator=(auto&& m)
      {
         _meta = std::forward<decltype(m)>(m);
         return *this;
      }
      */

     private:
      Storage _meta;
   };
   static_assert(sizeof(node_meta<>) == 8);

   using node_meta_type = node_meta<>;
   using temp_meta_type = node_meta<uint64_t>;
   static_assert(sizeof(node_meta_type) == sizeof(temp_meta_type));




}  // namespace arbtrie
