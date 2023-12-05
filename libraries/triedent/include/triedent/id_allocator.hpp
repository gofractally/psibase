#pragma once
#include <triedent/lehmer64.h>
#include <triedent/block_allocator.hpp>
#include <triedent/object_fwd.hpp>

namespace triedent
{
   /**
    *  A simple spin lock that uses object_info::locked to grab / release
    *  the lock.
    */
   class object_info_lock
   {
     public:
      object_info_lock(std::atomic<uint64_t>& obj) : _obj(obj) {}
      void lock() noexcept
      {
         uint64_t cur = _obj.load(std::memory_order_relaxed);
         do
         {
            while (cur & object_info::lock_mask)
            {
               // __builtin_ia32_pause(); not supported by clang
#if defined(__i386__) || defined(__x86_64__)
               asm volatile("pause");
#elif defined(__arm__)
               asm volatile("yield");
#endif

               cur = _obj.load(std::memory_order_relaxed);
            }
            if (_obj.compare_exchange_weak(cur, cur | object_info::lock_mask,
                                           std::memory_order_acquire, std::memory_order_relaxed))
               return;
         } while (true);
      }

      bool try_lock() noexcept
      {
         uint64_t cur = _obj.load(std::memory_order_relaxed);
         if (cur & object_info::lock_mask)
            return false;
         return _obj.compare_exchange_weak(cur, cur | object_info::lock_mask,
                                           std::memory_order_acquire, std::memory_order_relaxed);
      }

      void unlock() noexcept
      {
         auto cur = _obj.load(std::memory_order_relaxed);
         while (not _obj.compare_exchange_weak(cur, cur & ~object_info::lock_mask,
                                               std::memory_order_release,
                                               std::memory_order_relaxed))
            ;
      }

     private:
      std::atomic<uint64_t>& _obj;
   };

   inline constexpr uint64_t obj_val(node_type type, uint16_t ref)
   {
      object_info result{0};
      // This is distinct from any valid offset
      result._location = (1ull << object_info::location_rshift) - 1;
      result._ref      = ref;
      result._type     = static_cast<std::uint64_t>(type);
      return result.to_int();
   }

   /**
    *  Allocates object ids across multiple threads with
    *  minimal locking by simulating a hash table that grows
    *  when collision rate gets too high. 
    *
    *  - alloc and free are thread safe and non-blocking except 
    *  alloc will block if the load reaches 80% in order to grow
    *  the backing file.
    *
    *  - free is constant time two atomic operations with no memory ordering requirments
    *  - alloc typically requires fetching 1 cache line and doing 
    *    less than 8 loads and 1 C&S and 1 fetch add, but occassionally (0.1-.01%)
    *    may take 3 or 4 times as long. 
    *
    *  There are no memory ordering requirments because the object's value
    *  speaks for itself and is not gaurding other memory.
    */
   class id_allocator
   {
     public:
      static const uint32_t id_block_size = 1024 * 1024 * 128;
      static_assert(id_block_size % 64 == 0, "should be divisible by cacheline");

     public:
      id_allocator(std::filesystem::path id_file)
          : _data_dir(id_file), _block_alloc(id_file, id_block_size, 8192 /*1TB*/)
      {
         auto nb = _block_alloc.num_blocks();
         if (not nb)
         {
            _block_alloc.alloc();
            ++nb;
         }

         auto data    = (std::atomic<uint64_t>*)_block_alloc.get(0);
         _block_size  = data;
         _free_slots  = data + 1;
         _total_slots = data + 2;
         _block_size->store(2 * id_block_size + 1);
         _total_slots->store((2 * nb * id_block_size) / sizeof(object_info) + 1);
         _num_slots = _total_slots->load() / 2;

         if (not _free_slots->load())
         {
            /// first 3 slots are reserved this meta data, sub 6 and not 3 because
            /// we want to preserve the first bit to always be 1
            _free_slots->store(_num_slots - 6);
         }
      }

      uint64_t get_free_count() const { return _free_slots->load(std::memory_order_relaxed) / 2; }

      uint64_t get_capacity() const { return _num_slots; }

      std::atomic<uint64_t>& get(object_id id)
      {
         assert(id.id > 2);  // first 3 ids are reserved
         auto abs_pos        = id.id * sizeof(uint64_t);
         auto block_num      = abs_pos / id_block_size;
         auto index_in_block = abs_pos - (block_num * id_block_size);
         auto ptr            = ((char*)_block_alloc.get(block_num)) + index_in_block;
         return reinterpret_cast<std::atomic<uint64_t>&>(*ptr);
      }

      void free(object_id id)
      {
         assert(id.id > 2);  // first 3 ids are reserved
         get(id).store(0, std::memory_order_relaxed);

         // while store may be reordered, the purpose of free slots
         // is only to calculate an estimated load, likewise allcoators
         // do not depend upon storing 0 above happening before or after
         // adding 2 to preserve the first bit
         _free_slots->fetch_add(2, std::memory_order_relaxed);
      }

      /**
       * Holds random number generator so that each thread has its own
       * rng to avoid collisions.  Only alloc session can call object
       * allocator.alloc()
       *
       * At 80% full, there is an 80% chance of any particular slot
       * being occupied.  The each probe checks 8 slots (one cacheline)
       * which means there is a 16% chance of collision on the first probe
       * and a 3% chance on the second probe and 0.5% by the 3rd probe.
       *
       * When it reaches 80% the capacity will grow by a block size, say
       * 128MB. This will be a smaller and smaller percentage of the total size
       * growth over time which means performance will level out around 80% 
       * full with 1 out of 1000 taking 3 probes.  85% of allocs will
       * take only 1 probe.
       */
      struct alloc_session
      {
        public:
         static const uint64_t default_id_value = obj_val(node_type::undefined, 1);

         /**
          * The value stored at the returned object_id is equal to
          * alloc_session::default_id_value which indicates undefined type with
          * a reference count of 1. If you store 0 at this location the allocator
          * will think it is free and invariants about load capacity will be broken.
          */
         std::pair<std::atomic<uint64_t>&, object_id> get_new_id()
         {
            auto load = (_oa._total_slots->load(std::memory_order_relaxed)) /
                        _oa._free_slots->load(std::memory_order_relaxed);
            if (load > 4)  // more than 80% full
               _oa.grow();

            int reprobes = 0;
            while (true)  // reprobe
            {
               // TODO make this a shift operation

               uint64_t test_id = _rng.next() % _oa._num_slots;
               // triggers assert in debug, but is ok
               //if( test_id <= 2 ) [[unlikely]] test_id = 3; //TODO: do somethinb better with this
               //             std::cerr<<" probe: " << test_id << "  \n";
               //  std::cerr<< "test id: " << test_id <<" of " << _oa._num_slots <<"\n";

               auto& atomic = _oa.get({test_id});

               auto start_cache = ((uintptr_t)&atomic) & ~(0x3full);  // round down to cache line

               auto cacheline = (std::atomic<uint64_t>*)start_cache;
               int  init_pos  = &atomic - cacheline;
               int  pos       = init_pos;

               // linear scan in case of collision, because the
               // cache line is already loaded, this should have low 
               // cost and ensure we stay in the same memory block as
               // the initial probe. A 64 byte cache line has 8 ids
               for (uint32_t i = 0; i < 8; ++i)
               {
                  auto& atom = cacheline[pos];

                  auto cur_val = atom.load(std::memory_order_relaxed);
                  if (cur_val == 0)  // try to claim it
                  {
                     uint64_t expected = 0;
                     if (atom.compare_exchange_weak(expected, default_id_value, std::memory_order_relaxed, std::memory_order_relaxed))
                     {
                        if( reprobes > 8 ) {
                           std::cerr << "a lot of reprobing going on: " << reprobes <<"\n";
                        }
                        // presere the first bit
                        _oa._free_slots->fetch_sub(2, std::memory_order_relaxed);
                        //           std::cerr<< "total free: " << _oa.get_free_count() <<"\n";
                        return std::pair<std::atomic<uint64_t>&, object_id>(
                            atom, test_id + pos - init_pos);
                     }
                     else
                     {
                        break;  // another thread randomly trying to allocate
                                // on our cache line, might as well randomly reprobe
                                // elsewhere.
                     }
                  }
                  //      std::cerr <<"cur: " << cur_val <<" i: " <<i <<"   pos: " << pos <<"  ptr: " <<cacheline <<"  \n";
                  pos = (++pos) & 7;  // wrap the end of cacheline
               }                      // current cache line
               ++reprobes;
            }                         // while true
         }

        private:
         friend class id_allocator;
         alloc_session(id_allocator& oa) : _oa(oa), _rng(0*(uint64_t)this) {}// TODO randomize this

         id_allocator& _oa;
         lehmer64_rng  _rng;
      };

      auto start_session() { return alloc_session(*this); }

     private:
      friend class alloc_session;

      void grow()
      {
         std::lock_guard l{_grow_mutex};

         // two threads might try to grow at the same time because they
         // both saw the load condition, by putting this within the mutex
         // only one thread will actually result in a grow.
         auto load = (_total_slots->load()) /
                     _free_slots->load();
         if (load < 4)
            return;

         auto ptr = _block_alloc.get(_block_alloc.alloc());

         if (not ::mlock(ptr, id_block_size))
         {
            std::cerr << "WARNING: unable to mlock ID lookups\n";
            ::madvise(ptr, id_block_size, MADV_RANDOM);
         }

         // 2* because we have to preserve the first bit
         _free_slots->fetch_add(2 * id_block_size / sizeof(object_info));
         _total_slots->fetch_add(2 * id_block_size / sizeof(object_info));

         _num_slots = _total_slots->load() / 2;
      }

      std::mutex            _grow_mutex;
      std::filesystem::path _data_dir;
      block_allocator       _block_alloc;

      uint64_t _num_slots;

      // IDs 1, 2 and 3 are used to store some general
      // accounting overhead rather than create a separate shared memory
      // file.  However, these values must never be 0 and the first bit must
      // never be zero (the ref count bit) so that other code can never think
      // that these slots are available. Therefore the value stored in these
      // variables is 2x + 1 greater than the real value.
      std::atomic<uint64_t>* _block_size;
      std::atomic<uint64_t>* _free_slots;
      std::atomic<uint64_t>* _total_slots;
   };
};  // namespace triedent
