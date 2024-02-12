#pragma once
#include <arbtrie/config.hpp>
#include <arbtrie/debug.hpp>
#include <arbtrie/id_alloc.hpp>
#include <arbtrie/mapping.hpp>
#include <arbtrie/node_header.hpp>
#include <thread>

/**
 *  @file seg_allocator.hpp
 *
 *  Responsible for allocating large segments of memory (256MB), each
 *  segment in turn stores objects pointed to from the id_allocator.
 *
 *  1. Each thread has its own session and allocates to its own
 *     segment in an append-only manner.
 *  2. Once an object has been written to a segment and its location
 *     exposed to the id_allocator it is considered immutible by
 *     the segment allocator, apps may still mutate it if they independently
 *     verify that only one thread is reading it and they lock the id while
 *     modifying it so that the gc thread doesn't try to compact it.
 *          - this should be unlikely because all modify in place operations
 *          occur with temporary, uncommited data which will likely be in
 *          the active allocation segment where it won't be moved anyway
 *  3. Once a segment is full, it is marked as read-only to the seg_allocator until
 *     its data is no longer referenced and the segment can be 
 *     recycled. E.g. no new allocation will write over it.
 *  4. When data is read, it is copied to the current alloc segment unless
 *     another thread locked it first. Once copied the
 *     item's location in the object db is updated and it is unlocked.
 *
 *     No threads need to wait for the copy because the data in the old location and new location
 *     are identical and the reader already has a "lock" on the old location
 *
 *  5. A garbage-collector (GC) thread finds the most empty segment and moves 
 *     all of the objects that remain to its own segment, then makes the
 *     segment available for reuse by other threads (one all threads have
 *     released the implied write lock)
 *  6. the Object ID allocation system can be made thread safe by giving
 *     each "writing session" a "segment" of the object id space. Writers would
 *     only have to synchronize id allocation requests when their segments are full.
 *
 *  Theory: 
 *      a. data will be organized in the order it tends to be accessed in
 *      b. infrequently accessed data will be grouped together by GC
 *      c. the most-recent N segments can have their memory pinned
 *      d. madvise can be effeciently used to mark alloc segmentsfor
 *           SEQ and/or pin them to memory. It can also mark segments as
 *           RANDOM or UNNEEDED to improve OS cache managment.
 *
 *   
 */

namespace arbtrie
{
   /// index into meta[free_segment_index]._free_segment_number
   using free_segment_index = uint64_t;

   /// object pointers can only address 48 bits
   /// 128 TB limit on database size with 47 bits, this saves us
   /// 8MB of memory relative to 48 bits in cases with less than 128 TB
   static constexpr const uint64_t max_segment_count = max_database_size / segment_size;

   // types that are memory mapped
   namespace mapped_memory
   {

      // meta data about each segment,
      // stored in an array in allocator_header indexed by segment number
      struct segment_meta
      {
         // returns the free space in bytes, and number of objects freed
         std::pair<uint32_t, uint32_t> get_free_space_and_objs() const
         {
            uint64_t v = _free_space_and_obj.load(std::memory_order_relaxed);
            return std::make_pair(v >> 32, v & 0xffffffff);
         }

         // notes that an object of size was freed
         void free_object(uint32_t size)
         {
            uint64_t so = size;
            so <<= 32;
            so += 1;
            _free_space_and_obj.fetch_add(so, std::memory_order_relaxed);
         }

         // doesn't increment object count
         void free(uint32_t size)
         {
            uint64_t so = size;
            so <<= 32;
            _free_space_and_obj.fetch_add(so, std::memory_order_relaxed);
         }

         void clear()
         {
            _free_space_and_obj.store(0, std::memory_order_relaxed);
            _last_sync_pos.store(segment_size, std::memory_order_relaxed);
         }

         /// the total number of bytes freed by swap
         /// or by being moved to other segments.
         std::atomic<uint64_t> _free_space_and_obj;
         std::atomic<uint64_t> _last_sync_pos;  // position of alloc pointer when last synced
      };

      /// should align on a page boundary
      struct segment_header
      {
         // the next position to allocate data, only
         // used by the thread that owns this segment and
         // set to uint64_t max when this segment is ready
         // to be marked read only to the seg_allocator
         std::atomic<uint32_t> _alloc_pos = 64;  // sizeof(segment_header)
         uint32_t              _age;  // every time a segment is allocated it is assigned an age
                                      // which aids in reconstruction

         // used to calculate object density of segment header,
         // to establish madvise
         // uint32_t _num_objects = 0;  // inc on alloc
         uint32_t _checksum    = 0;  // TODO
      };
      static_assert(sizeof(segment_header) <= 64);

      /**
        * The data stored in the alloc header is not written to disk on sync
        * and may be in a corrupt state after a hard crash. Aall values contained
        * within the allocator_header must be reconstructed from the segments
       */
      struct allocator_header
      {
         // when no segments are available for reuse, advance by segment_size
         alignas(64) std::atomic<segment_offset> alloc_ptr;    // A below
         alignas(64) std::atomic<free_segment_index> end_ptr;  // E below

         // set to 0 just before exit, set to 1 when opening database
         std::atomic<bool>     clean_exit_flag;
         std::atomic<uint32_t> next_alloc_age = 0;

         // meta data associated with each segment, indexed by segment number
         segment_meta seg_meta[max_segment_count];

         // circular buffer described, big enough to hold every
         // potentially allocated segment which is subseuently freed.
         //
         // |-------A----R1--R2---E-------------| max_segment_count
         //
         // A = alloc_ptr where recycled segments are used
         // R* = session_ptrs last known recycled segment by each session
         // E = end_ptr where the next freed segment is posted to be recycled
         // Initial condition A = R* = E = 0
         // Invariant A <= R* <= E unless R* == -1
         //
         // If A == min(R*) then we must ask block_alloc to create a new segment
         //
         // A, R*, and E are 64 bit numbers that count to infinity, the
         // index in the buffer is A % max_segment_count which should be
         // a simple bitwise & operation if max_segment_count is a power of 2.
         // The values between [A-E) point to recyclable segments assuming no R*
         // is present. Values before A or E and after point to no valid segments
         segment_number free_seg_buffer[max_segment_count];
      };

      /// crash recovery:
      /// 1. scan all segments to find those that were mid-allocation:
      ///    if a lot of free space, then swap them and push to free seg buffer
      /// 2. Update reference counts on all objects in database
      /// 3. ? pray ?

   }  // namespace mapped_memory

   class seg_allocator
   {
     protected:
      friend class database;
      void release_unreachable();
      void reset_meta_nodes( recover_args args );
      void reset_reference_counts();
      int64_t  clear_lock_bits();
      void sync_segment( int seg, sync_type st );

     public:
      // only 64 bits in bitfield used to allocate sessions
      // only really require 1 per thread
      static const uint32_t max_session_count = 64;

      seg_allocator(std::filesystem::path dir);
      ~seg_allocator();

      void dump();
      void print_region_stats() { _id_alloc.print_region_stats(); }
      void sync(sync_type st = sync_type::sync);
      void start_compact_thread();
      void stop_compact_thread();
      bool compact_next_segment();

      class session
      {
        public:
         /**
          * Ensures the read-lock is released so segments can be recycled
          * and ensures that all data access flows through a read_lock.
          *
          * note: no mutexes are involved with this lock
          */
         class read_lock
         {
           public:
            class modify_lock
            {
              public:
               modify_lock(node_meta_type& m, read_lock& rl) : _meta(m), _rlock(rl)
               {
                  _locked_val = _meta.start_modify();
               }

               ~modify_lock()
               {
                  if (not _released)
                     unlock();
               }

               // returned mutable T is only valid while modify lock is in scope
               template <typename T>
               T* as()
               {
                  _observed_ptr = _rlock.get_node_pointer(_locked_val.loc());
                  assert(_locked_val.ref());
                  assert(_observed_ptr->validate_checksum());
                  return (T*)_observed_ptr;
               }
               template <typename T>
               void as(auto&& call_with_tptr)
               {
                  assert(_locked_val.ref());
                  call_with_tptr((T*)(_observed_ptr = _rlock.get_node_pointer(_locked_val.loc())));
               }

               void release()
               {
                  _released = true;
                  unlock();
               }

              private:
               void unlock()
               {
                  // TODO: check to see if checksum actually changed?
                  // to let us know if we are making empty changes
                  if (_observed_ptr) [[likely]]
                  {
                     assert(_observed_ptr->validate_checksum());
                     //_observed_ptr->checksum = update_checksum();
                  }
                  else
                     TRIEDENT_WARN("got modify lock but never read data");

                  _meta.end_modify();
               }
               bool            _released = false;
               temp_meta_type  _locked_val;
               node_meta_type& _meta;
               read_lock&      _rlock;
               node_header*    _observed_ptr = nullptr;
            };

            template <typename T = node_header>
            class object_ref
            {
              public:
               template <typename Other>
               friend class object_ref;

               template <typename Other>
               object_ref(object_ref<Other> p)
                   : _rlock(p._rlock), _address(p._address), _meta(p._meta), _cached(p._cached)
               {
               }

               inline fast_meta_address address() const { return _address; }
               inline uint32_t          ref() const { return _cached.ref(); }
               inline node_type         type() const { return _cached.type(); }
               inline node_location     loc() const { return _cached.loc(); }

               // return false if ref count overflow
               bool retain() { return _meta.retain(); }

               // return last value of pointer if object is deleted, so children can
               // be released... otherwise null
               const node_header* release();

               modify_lock modify() { return modify_lock(_meta, _rlock); }
               bool        try_start_move(node_location loc) { return _meta.try_start_move(loc); }
               auto        try_move(node_location expected_prior_loc, node_location move_to_loc)
               {
                  return _meta.try_move(expected_prior_loc, move_to_loc);
               }

               const T* header() const;
               const T* operator->() const { return header(); }
               template <typename Type>
               const Type* as() const
               {
                  assert(header()->validate_checksum());
                  assert(Type::type == header()->get_type());
                  return reinterpret_cast<const Type*>(header());
               };
               void store(temp_meta_type tmt, auto memory_order)
               {
                  _meta.store(_cached = tmt, memory_order);
               }

               //explicit inline operator bool() const { return bool(id()); }

               //auto& get_mutex() const { return _rlock._session._sega._id_alloc.get_mutex(_id); }

               // return false if object is released or moved while atempting to move

               //bool cache_object();

               void refresh() { _cached = _meta.load(std::memory_order_acquire); }

               auto& rlock() { return _rlock; }
               auto& rlock() const { return _rlock; }

               //object_ref clone(const T* v) const { return rlock().clone(v); }

               temp_meta_type meta_data() { return _cached; }

               void            prefetch() { __builtin_prefetch(&_meta, 1, 1); }
               node_meta_type& meta() { return _meta; }

              protected:
               friend class seg_allocator;
               friend class seg_allocator::session;

               object_ref(seg_allocator::session::read_lock& rlock,
                          fast_meta_address                  adr,
                          node_meta_type&                    met)
                   : _rlock(rlock),
                     _meta(met),
                     _cached(_meta.load(std::memory_order_relaxed)),
                     _address(adr)
               {
                  //    assert(_ptr == nullptr or (_ptr and (_ptr->id == _id.id)));
               }

               seg_allocator::session::read_lock& _rlock;
               node_meta_type&                    _meta;
               temp_meta_type                     _cached;  // cached read of atomic _atom_loc
               fast_meta_address                  _address;
            };  // object_ref

            //template <typename T>
            //inline object_ref<T>    clone(const T* n);
            //template <typename T>
            //object_ref<T> clone(T* n);

            object_ref<node_header> alloc(id_region reg,
                                          uint32_t  size,
                                          node_type type,
                                          auto      initfunc);
            object_ref<node_header> realloc(fast_meta_address reuse,
                                            uint32_t          size,
                                            node_type         type,
                                            auto              initfunc);

            /**
             * @defgroup Region Alloc Helpers
             */
            /// @{
            id_region get_new_region() { return _session._sega._id_alloc.get_new_region(); }
            void      free_meta_node(fast_meta_address);
            std::pair<node_meta_type&, fast_meta_address> get_new_meta_node(id_region);
            /// @}

            template <typename T = node_header>
            inline object_ref<T> get(fast_meta_address adr)
            {
               return object_ref<T>(*this, adr, _session._sega._id_alloc.get(adr));
            }

            // this is for help in lldb
            //object_ref<node_header> get_by_id(object_id id) { return get(id); }

            inline object_ref<node_header> get(node_header*);

            ~read_lock() { _session.release_read_lock(); }

            node_header* get_node_pointer(node_location);

           private:
            friend class session;
            template <typename T>
            friend class object_ref;

            read_lock(session& s) : _session(s) { _session.retain_read_lock(); }
            read_lock(const session&) = delete;
            read_lock(session&&)      = delete;

            read_lock& operator=(const read_lock&) = delete;
            read_lock& operator=(read_lock&)       = delete;
            read_lock& operator=(read_lock&&)      = delete;

            session& _session;
         };

         // before any objects can be read, the session must note the
         // current state of the free segment queue so that no segments that
         // could be read while the return value of this method is in scope can
         // be reused (overwritten)
         read_lock lock() { return read_lock(*this); }

         ~session()
         {
            if (_session_num == -1)
               return;
            if (_alloc_seg_ptr)  // not moved
            {
               if (segment_size - _alloc_seg_ptr->_alloc_pos >= sizeof(node_header))
               {
                  memset(((char*)_alloc_seg_ptr) + _alloc_seg_ptr->_alloc_pos, 0,
                         sizeof(node_header));  // mark last object
               }
               _sega._header->seg_meta[_alloc_seg_num].free(segment_size -
                                                            _alloc_seg_ptr->_alloc_pos);
               _alloc_seg_ptr->_alloc_pos = uint32_t(-1);
               _alloc_seg_num             = -1ull;
            }
            _sega.release_session_num(_session_num);
         }

         session(session&& mv)
             : _sega(mv._sega),
               _session_num(mv._session_num),
               _alloc_seg_num(mv._alloc_seg_num),
               _alloc_seg_ptr(mv._alloc_seg_ptr)
         {
            mv._session_num = -1;
         }

        private:
         friend class lock;
         friend class seg_allocator;

         // copy E to R*
         void retain_read_lock()
         {
            ++_nested_read_lock;
            if (_nested_read_lock == 1)
            {
               uint64_t cur =
                   _sega._session_lock_ptrs[_session_num].load(std::memory_order_acquire);
               //cur.locked_end = cur.view_of_end;
               uint32_t view_of_end = cur >> 32;
               uint32_t cur_end     = uint32_t(cur);
               // it should be unlocked which signaled by max
               assert(cur_end == uint32_t(-1));
               auto diff = cur_end - view_of_end;

               // an atomic sub should leave the higher-order bits in place where the view
               // from the compactor is being updated.
               _sega._session_lock_ptrs[_session_num].fetch_sub(diff, std::memory_order_release);
            }
         }

         // R* goes to inifinity and beyond
         void release_read_lock()
         {
            --_nested_read_lock;
            assert(_nested_read_lock >= 0);
            if (not _nested_read_lock)
            {
               //  assert(_sega._session_ptrs[_session_num] != -1ull);
               //_sega._session_ptrs[_session_num] = -1ull;
               //  _sega._session_lock_ptrs[_session_num].fetch_or( , std::memory_order_release );

               // set it to max uint32_t
               _sega._session_lock_ptrs[_session_num].fetch_or(uint32_t(-1));
            }
         }

         session(seg_allocator& a, uint32_t ses_num)
             : _session_num(ses_num), _alloc_seg_num(-1ull), _alloc_seg_ptr(nullptr), _sega(a)
         {
         }

         session()               = delete;
         session(const session&) = delete;

         void unalloc(uint32_t size)
         {
            auto rounded_size = round_up_multiple<64>(size);
            if (_alloc_seg_ptr) [[likely]]
            {
               auto cap = _alloc_seg_ptr->_alloc_pos.load(std::memory_order_relaxed);
               if (cap and cap < segment_size) [[likely]]
               {
                  auto cur_apos =
                      _alloc_seg_ptr->_alloc_pos.fetch_sub(rounded_size, std::memory_order_relaxed);
                  cur_apos -= rounded_size;
                  memset(((char*)_alloc_seg_ptr) + cur_apos, 0, sizeof(node_header));
               }
               //_alloc_seg_ptr->_num_objects--;
            }
         }
         /**
          *   alloc_data
          *
          *   TODO: all objects should be aligned to a cache line of 64 bytes
          *   because it reduces the total number of cache lines that must be fetched. 
          *   Every time a node crosses a cacheline it doubles the required memory
          *   bandwidth.  A side effect is that it increases the total addressable space
          *   of the database by 4x (and/or) gives us more bits in node_meta.
          */
         std::pair<node_location, node_header*> alloc_data(uint32_t size, fast_meta_address adr)
         {
            assert(size <
                   segment_size - round_up_multiple<64>(sizeof(mapped_memory::segment_header)));
            // A - if no segment get a new segment
            if (not _alloc_seg_ptr or _alloc_seg_ptr->_alloc_pos.load(std::memory_order_relaxed) >
                                          segment_size) [[unlikely]]
            {
               auto [num, ptr] = _sega.get_new_segment();
               _alloc_seg_num  = num;
               _alloc_seg_ptr  = ptr;
             //  if (not _alloc_seg_ptr->_write_lock.try_lock())
             //  {
             //     TRIEDENT_WARN("unable to get write lock on segment");
             //  }
               _sega._header->seg_meta[_alloc_seg_num]._last_sync_pos.store(
                   0, std::memory_order_relaxed);
            }

            auto* sh           = _alloc_seg_ptr;
            auto  rounded_size = round_up_multiple<64>(size);

            auto cur_apos = sh->_alloc_pos.load(std::memory_order_relaxed);

            auto spec_pos   = uint64_t(cur_apos) + rounded_size;
            auto free_space = segment_size - cur_apos;

            // B - if there isn't enough space, notify compactor go to A
            if (spec_pos > (segment_size - sizeof(node_header))) [[unlikely]]
            {
               if (free_space >= sizeof(node_header))
               {
                  assert(cur_apos + sizeof(uint64_t) <= segment_size);
                  memset(((char*)sh) + cur_apos, 0, sizeof(node_header));
               }
               _sega._header->seg_meta[_alloc_seg_num].free(segment_size - sh->_alloc_pos);
               sh->_alloc_pos.store(uint32_t(-1), std::memory_order_release);
               //_alloc_seg_ptr->_write_lock.unlock();
               _alloc_seg_ptr = nullptr;
               _alloc_seg_num = -1ull;

               return alloc_data(size, adr);  // recurse
            }

            auto obj  = ((char*)sh) + sh->_alloc_pos.load(std::memory_order_relaxed);
            auto head = (node_header*)obj;
            head      = new (head) node_header(size, adr);

            auto new_alloc_pos =
                rounded_size + sh->_alloc_pos.fetch_add(rounded_size, std::memory_order_relaxed);
            //sh->_num_objects++;

            auto loc = _alloc_seg_num * segment_size + cur_apos;

            return {node_location::from_absolute(loc), head};
         }

         uint32_t _session_num;  // index into _sega's active sessions list

         segment_number                 _alloc_seg_num = -1ull;
         mapped_memory::segment_header* _alloc_seg_ptr = nullptr;

         seg_allocator& _sega;
         int            _nested_read_lock = 0;
      };

      session start_session() { return session(*this, alloc_session_num()); }

     private:
      friend class session;
      std::optional<session> cses;

      mapped_memory::segment_header* get_segment(segment_number seg)
      {
         return static_cast<mapped_memory::segment_header*>(_block_alloc.get(seg));
      }

      uint32_t alloc_session_num()
      {
         auto fs_bits = _free_sessions.load(std::memory_order_relaxed);
         if (fs_bits == 0)
         {
            throw std::runtime_error("max of 64 sessions can be in use");
         }
         auto fs          = std::countr_zero(fs_bits);
         auto new_fs_bits = fs_bits & ~(1 << fs);

         while (not _free_sessions.compare_exchange_weak(fs_bits, new_fs_bits))
         {
            if (fs_bits == 0)
            {
               throw std::runtime_error("max of 64 sessions can be in use");
            }
            fs          = std::countr_zero(fs_bits);
            new_fs_bits = fs_bits & ~(1 << fs);
         }
         //    std::cerr << "   alloc session bits: " << fs << " " <<std::bitset<64>(new_fs_bits) << "\n";
         //    std::cerr << "   new fs bits: " << std::bitset<64>(new_fs_bits) << "\n";
         //    _free_sessions.store(new_fs_bits);
         return fs;
      }
      void release_session_num(uint32_t sn) { _free_sessions.fetch_or(uint64_t(1) << sn); }

      std::pair<segment_number, mapped_memory::segment_header*> get_new_segment();

      void compact_loop();
      void compact_segment(session& ses, uint64_t seg_num);

      /**
       * This must be called via a session because the session is responsible
       * for documenting what regions could be read
       *
       * All objects are const because they cannot be modified after being
       * written.
       */
      const node_header* get_object(node_location loc) const;

      /**
       *  After all writes are complete, and there is not enough space
       *  to allocate the next object the alloc_ptr gets set to MAX and
       *  the page gets 
       */
      void finalize_segment(segment_number);

      /**
       *  After all data has been removed from a segment
       * - madvise free/don't need 
       * - add the segment number to the free segments at allocator_header::end_ptr
       * - increment allocator_header::end_ptr
       */
      void release_segment(segment_number);

      /**
       * finds the most empty segment that is at least 25% empty
       * - marks it for sequential access
       * - scans it for remaining objects, moving them to a new region
       * - releases segment
       * - marks it as unneeded 
       *
       * and moves its contents to
       * a new segment owned by the gc thread th
       */
      std::thread _compact_thread;

      // maps ids to locations
      id_alloc _id_alloc;

      // allocates new segments
      block_allocator  _block_alloc;
      alignas(64) std::atomic<uint32_t>    _total_mlocked = 0;
      alignas(64) std::array<std::atomic<int32_t>,256> _mlocked;

      /**
       *  This is the highest the alloc_ptr is allowed to
       *  advance and equal to min value of thread_ptrs.
       *
       *  Do not read directly, read via get_min_read_ptr()
       */
      std::atomic<uint64_t> _min_read_ptr = -1ull;  // min(R*)
      uint64_t              get_min_read_ptr();
      void                  set_session_end_ptrs(uint32_t e);

      /**
       *  Lower 32 bits represent R* above
       *  Upper 32 bits represent what compactor has pushed to the session
       *
       *  Allocator takes the min of the lower 32 bits to determine the lock position.
       */
      std::atomic<uint64_t> _session_lock_ptrs[64];

      // to allocate a new session in thread-safe way you
      // load, find first non-zero bit, and attempt to set it via C&S,
      // the index of the bit is the session id.
      // Reverse the process to free a session
      std::atomic<uint64_t> _free_sessions = -1ull;

      std::atomic<bool> _done;

      mapping                          _header_file;
      mapped_memory::allocator_header* _header;
      bool                             _in_alloc = false;
      std::mutex                       _sync_mutex;
   };  // seg_allocator

   /*
   template <typename T>
   inline T* seg_allocator::session::read_lock::object_ref<T>::obj()
   {
      object_meta val(_atom_loc.load(std::memory_order_acquire));

      assert(0 != val.ref());
      //  if (not val.ref()) [[unlikely]]
      //     return nullptr;
      //  else
      return (T*)_rlock.get_object_pointer(val.loc());
   }
   */

   template <typename T>
   inline const T* seg_allocator::session::read_lock::object_ref<T>::header() const
   {
      assert(_meta.load(std::memory_order_relaxed).ref());
      auto r = (const T*)_rlock.get_node_pointer(_meta.load(std::memory_order_acquire).loc());
      if constexpr (debug_memory)
      {
         if (not r->validate_checksum())
         {
            TRIEDENT_WARN("checksum: ", r->checksum);
            abort();
         }
         assert(r->validate_checksum());
      }
      return r;
   }

   template <typename T>
   using object_ref = seg_allocator::session::read_lock::object_ref<T>;

   /// @pre refcount of id is 1
   inline object_ref<node_header> seg_allocator::session::read_lock::realloc(fast_meta_address adr,
                                                                             uint32_t          size,
                                                                             node_type         type,
                                                                             auto              init)
   {
      auto oref    = get(adr);
      auto l       = oref.loc();
      auto seg     = l.segment();
      auto obj_ptr = (node_header*)((char*)_session._sega._block_alloc.get(seg) + l.abs_index());

      _session._sega._header->seg_meta[seg].free_object(obj_ptr->object_capacity());

      //   std::cerr << "realloc " << id <<" size: " << size <<" \n";
      // TODO: mark the free space associated with the current location of id
      assert(size >= sizeof(node_header));
      assert(type != node_type::undefined);

      //auto& atom           = _session._sega._id_alloc.get(id);
      auto [loc, node_ptr] = _session.alloc_data(size, adr);

      if constexpr (debug_memory)
      {
         auto      seg_end = (char*)_session._sega._block_alloc.get(seg) + segment_size;
         uint32_t* check   = (uint32_t*)(((char*)node_ptr) + size);
         if (loc.abs_index() + size < segment_size)
         {
            auto old = *check;
            init(node_ptr);
            assert(*check == 0 or *check == old or *check == 0xbaadbaad);
         }
         else
            init(node_ptr);
      }
      else
      {
         init(node_ptr);
      }

      assert(node_ptr->validate_checksum());
      assert(node_ptr->_nsize == size);
      assert(node_ptr->_ntype == type);
      assert(node_ptr->_node_id == adr.to_int());

      // we can stomp on the data because it is impossible for the ref count to
      // increase while realloc and even if compactor moves the data from the
      // old location, the new data should take priority and this thread shouldn't
      // be holding the modify lock while realloc and
      oref.store(temp_meta_type().set_type(type).set_location(loc).set_ref(1),
                 std::memory_order_release);
      return oref;
   }

   inline std::pair<node_meta_type&, fast_meta_address>
   seg_allocator::session::read_lock::get_new_meta_node(id_region reg)
   {
      return _session._sega._id_alloc.get_new_id(reg);
      //auto [atom, id]      = _session._sega._id_alloc.get_new_id(reg);
   }

   inline object_ref<node_header> seg_allocator::session::read_lock::alloc(id_region reg,
                                                                           uint32_t  size,
                                                                           node_type type,
                                                                           auto      init)
   {
      if constexpr (debug_memory)
      {
         assert(not _session._sega._in_alloc);
         _session._sega._in_alloc = true;
      }

      assert(size >= sizeof(node_header));
      assert(type != node_type::undefined);

      auto [atom, id]      = _session._sega._id_alloc.get_new_id(reg);
      auto [loc, node_ptr] = _session.alloc_data(size, id);
      //TRIEDENT_WARN( "alloc id: ", id, " type: " , node_type_names[type], " loc: ", loc._offset, " size: ", size);

      //init(node_ptr);
      if constexpr (debug_memory)
      {
         uint32_t* check = (uint32_t*)(((char*)node_ptr) + size);
         if (loc.abs_index() + size < segment_size)
         {
            auto old = *check;
            init(node_ptr);
            assert(*check == 0 or *check == old or *check == 0xbaadbaad);
         }
         else
            init(node_ptr);
      }
      else
      {
         init(node_ptr);
      }

      assert(node_ptr->validate_checksum());

      auto tmp = temp_meta_type().set_type(type).set_location(loc).set_ref(1);
      //atom.store(object_meta(type, loc, 1).to_int(), std::memory_order_release);
      atom.store(temp_meta_type().set_type(type).set_location(loc).set_ref(1),
                 std::memory_order_release);

      assert(node_ptr->_nsize == size);
      assert(node_ptr->_ntype == type);
      assert(node_ptr->_node_id == id.to_int());
      assert(object_ref(*this, id, atom).type() != node_type::undefined);

      if constexpr (debug_memory)
      {
         _session._sega._in_alloc = false;
      }

      return object_ref(*this, id, atom);
   }

   inline node_header* seg_allocator::session::read_lock::get_node_pointer(node_location loc)
   {
      auto segment = (mapped_memory::segment_header*)_session._sega._block_alloc.get(loc.segment());
      // 0 means we are accessing a swapped object on a segment that hasn't started new allocs
      // if alloc_pos > loc.index() then we haven't overwriten this object yet, we are accessing
      // data behind the alloc pointer which should be safe
      // to access data we had to get the location from obj id database and we should read
      // with memory_order_acquire, when updating an object_info we need to write with
      // memory_order_release otherwise the data written may not be visible yet to the reader coming
      // along behind

      // only check this in release if this flag is set
      if constexpr (debug_memory)
      {
         auto ap = segment->_alloc_pos.load(std::memory_order_relaxed);
         if (not(ap == 0 or ap > loc.abs_index()))
         {
            TRIEDENT_WARN("ap: ", ap, "  loc: ", loc.aligned_index(), " abs: ", loc.abs_index(),
                          "loc.segment: ", loc.segment());
            abort();
         }
      }
      else  // always check in debug builds
         assert(segment->_alloc_pos == 0 or segment->_alloc_pos > loc.abs_index());

      return (node_header*)((char*)_session._sega._block_alloc.get(loc.segment()) +
                            loc.abs_index());
   }

   inline void seg_allocator::session::read_lock::free_meta_node(fast_meta_address a)
   {
      _session._sega._id_alloc.free_id(a);
   }

   /**
    *  Returns the last value of the node pointer prior to release so that
    *  its children may be released, or null if the children shouldn't be released.
    */
   template <typename T>
   const node_header* seg_allocator::session::read_lock::object_ref<T>::release()
   {
      //      TRIEDENT_DEBUG( "  ", address(), "  ref: ", ref(), " type: ", node_type_names[type()] );
      auto prior = _meta.release();
      if (prior.ref() > 1)
         return nullptr;

      auto result = _rlock.get_node_pointer(prior.loc());

      //     TRIEDENT_DEBUG( "  free ", address() );

      auto ploc    = prior.loc();
      auto obj_ptr = _rlock.get_node_pointer(ploc);
      //    (node_header*)((char*)_rlock._session._sega._block_alloc.get(seg) + loc.abs_index());

      _rlock.free_meta_node(_address);
      _rlock._session._sega._header->seg_meta[ploc.segment()].free_object(
          obj_ptr->object_capacity());
      return result;
   }

}  // namespace arbtrie
