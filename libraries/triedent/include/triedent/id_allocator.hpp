#pragma once
#include <triedent/block_allocator.hpp>
#include <triedent/file_fwd.hpp>
#include <triedent/mapping.hpp>
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

      inline static constexpr uint64_t extract_next_ptr(uint64_t x) { return (x >> object_info::location_rshift); }
      inline static constexpr uint64_t create_next_ptr(uint64_t x) { return (x << object_info::location_rshift); }

      id_allocator(std::filesystem::path id_file)
          : _data_dir(id_file),
            _block_alloc(id_file, id_block_size, 8192 /*1TB*/),
            _ids_header_file(id_file.native() + ".header", access_mode::read_write)
      {
         if (_ids_header_file.size() == 0)
         {
            _ids_header_file.resize(round_to_page(sizeof(ids_header)));
            auto idh = new (_ids_header_file.data()) ids_header();
            idh->_next_alloc.store(1);
            idh->_end_id.store(0);
            idh->_first_free.store(0);
         }
         _idheader = reinterpret_cast<ids_header*>(_ids_header_file.data());
      }

      uint64_t get_capacity() const { return _idheader->_end_id.load(std::memory_order_relaxed); }

      std::atomic<uint64_t>& get(object_id id)
      {
         auto abs_pos        = id.id * sizeof(uint64_t);
         auto block_num      = abs_pos / id_block_size;
         auto index_in_block = uint64_t(abs_pos) & uint64_t(id_block_size - 1);
         auto ptr            = ((char*)_block_alloc.get(block_num)) + index_in_block;
         return reinterpret_cast<std::atomic<uint64_t>&>(*ptr);
      }

      /**
          * The value stored at the returned object_id is equal to
          * alloc_session::default_id_value which indicates undefined type with
          * a reference count of 1. If you store 0 at this location the allocator
          * will think it is free and invariants about load capacity will be broken.
          */
      std::pair<std::atomic<uint64_t>&, object_id> get_new_id()
      {
     //    std::cerr << "get new id...\n";
      //   std::cerr << "   pre alloc free list: ";
       //  print_free_list();

         auto brand_new = [&]()
         {
            grow();  // ensure that there should be new id
            object_id id{_idheader->_next_alloc.fetch_add(1, std::memory_order_relaxed)};

            auto& atom = get(id);
            atom.store(obj_val(node_type::undefined, 1), std::memory_order_relaxed);

        //    std::cerr << " brand new id: " << id.id << "\n";
            return std::pair<std::atomic<uint64_t>&, object_id>(atom, id);
         };

         std::unique_lock<std::mutex> l{_alloc_mutex};
         uint64_t                     ff = _idheader->_first_free.load(std::memory_order_acquire);
        // std::cerr << "first free: " << extract_next_ptr(ff) << "\n";
         do
         {
            if (ff == 0)
            {
         //      std::cerr << "alloc brand new! \n";
               _alloc_mutex.unlock();
               l.release();
               return brand_new();
            }
         } while (not _idheader->_first_free.compare_exchange_strong(
             ff, get({extract_next_ptr(ff)}).load(std::memory_order_relaxed)));

         ff = extract_next_ptr(ff);
   //      std::cerr << "  reused id: " << ff << "\n";
         auto& ffa = get({ff});
         // store 1 = ref count 1 prevents object as being interpreted as unalloc
         ffa.store(obj_val(node_type::undefined, 1), std::memory_order_relaxed);


    //     std::cerr << "   post alloc free list: ";
     //    print_free_list();
         return {ffa, {ff}};
      }

      void print_free_list() {
         uint64_t id = extract_next_ptr(_idheader->_first_free.load());
         std::cerr << id;
         while( id ) {
            id = extract_next_ptr(get({id}));
            std::cerr << ", " << id;
         }
         std::cerr << " END\n";
      }

      void free_id(object_id id)
      {
     //    std::cerr << "                            free " << id.id << "\n";
         // store the head of the free list into the pointer section of get(id)
         // set the head of the free list to id if and only if the head of the free list
         // has not changed

         auto& head_free_list = _idheader->_first_free;
         auto& next_free      = get(id);
    //     std::cerr << "               free _first_free: " << extract_next_ptr(head_free_list.load())
    //               << "\n";

         auto new_head = create_next_ptr(id.id);

         uint64_t cur_head = _idheader->_first_free.load(std::memory_order_acquire);
         assert( not (cur_head & object_info::ref_mask) );
         do
         {
            next_free.store(cur_head, std::memory_order_release);
         } while (not head_free_list.compare_exchange_strong(cur_head, new_head));
     //    std::cerr <<"  post free free list: ";
     //    print_free_list();
      }

     private:
      friend class alloc_session;

      void grow()
      {
         // optimistic...
         if (_idheader->_next_alloc.load(std::memory_order_relaxed) <
             _idheader->_end_id.load(std::memory_order_relaxed))
            return;

         void* ptr;
         {
            std::lock_guard l{_grow_mutex};
            if (_idheader->_next_alloc.load() < _idheader->_end_id.load())
               return;  // no need to grow, another thread grew first

      //      std::cerr << "growing obj id db\n";
            ptr = _block_alloc.get(_block_alloc.alloc());
            _idheader->_end_id.store(_block_alloc.num_blocks() * _block_alloc.block_size() / 8);
         }  // don't hold lock while doing mlock

         if (::mlock(ptr, id_block_size))
         {
            std::cerr << "WARNING: unable to mlock ID lookups\n";
            ::madvise(ptr, id_block_size, MADV_RANDOM);
         }
      }

      std::mutex            _alloc_mutex;
      std::mutex            _grow_mutex;
      std::filesystem::path _data_dir;
      block_allocator       _block_alloc;

      /**
       * Mapped from disk to track meta data associated with the IDs
       */
      struct ids_header
      {
         uint64_t _magic      = 0;
         uint64_t _block_size = id_block_size;

         std::atomic<uint64_t> _next_alloc;  /// the next new ID to be allocated
         std::atomic<uint64_t> _end_id;      /// the first ID beyond the end of file

         // the lower 15 bits represent the alloc_session number of the last write
         // the upper bits represent the index of the first free ID, the value
         // stored at that index is the index of the next free ID or 0 if there
         // are no unused ids available.
         std::atomic<uint64_t> _first_free;  /// index of an ID that has the index of the next ID
      };

      ids_header* _idheader;
      mapping     _ids_header_file;
   };
};  // namespace triedent
