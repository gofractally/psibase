#pragma once
#include <arbtrie/mapped_memory.hpp>
#include <arbtrie/debug.hpp>
#include <arbtrie/id_alloc.hpp>
#include <arbtrie/mapping.hpp>
#include <arbtrie/node_header.hpp>
#include <arbtrie/sync_lock.hpp>
#include <arbtrie/segment_read_stats.hpp>
#include <thread>

/**
 *  @file seg_allocator.hpp
 *
 *  Responsible for allocating large segments of memory (multiple MB power of 2), each
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
 *     are identical and the reader already has a "lock" in the form of object reference counts
 *     that force it to clone to modify anything with 2+ references. 
 *
 *  5. A garbage-collector (GC) thread finds the most empty segment and moves 
 *     all of the objects that remain to its own segment, then makes the
 *     segment available for reuse by other threads (once all threads have
 *     released the implied write lock)
 *
 *
 *    Segment Recycle Buffer 
 *
 *      [==N=R1---R2--A]
 *
 *        N = position of next segment to be reused on alloc
 *        R1..RN = the last position of A observed by each thread
 *        A = position the next segment to be recycled gets pushed to
 *
 *          1. new segment is allocated (mmap) 
 *          2. data is written until it is full (seg.alloc_p reaches end)
 *          3. nodes are released marking potential free space
 *          4. compactor copies remaining data to another new segment 
 *          5. compactor pushes segment into queue for reallocation and increments A ptr
 *          6. read threads 'lock' the reallocation queue by observing A the
 *              position of the last segment pushed to the queue and copying to
 *              a thread-local variable
 *          7. when a new segment needs to be allocated it can only recycle
 *              segments if all threads have observed the updated recycle 
 *              queue position; therefore, it pulls from N and advances N
 *              until the last one it pulls is N == R1 and N = R1+1. 
 *       
 *       A is really N copies of A, one per thread and shares the same
 *       64 bit value as NX & RX. The compactor reads RXAX and writes
 *       RX(AX+1) with memory order release. 
 *
 *       Nodes lock by reading RXAX and storing AXAX
 *
 *         
 *
 *
 *        
 *  6. the Object ID allocation system can be made thread safe by giving
 *     each "writing session" a "segment" of the object id space. Writers would
 *     only have to synchronize id allocation requests when their segments are full.
 *
 *  Theory: 
 *      a. data will be organized in the order it tends to be accessed in
 *      b. infrequently modified data will be grouped together by GC 
 *          - because as things are modified they are moved away 
 *      c. the most-recent N segments can have their memory pinned
 *      d. madvise can be effeciently used to mark alloc segmentsfor
 *           SEQ and/or pin them to memory. It can also mark segments as
 *           RANDOM or UNNEEDED to improve OS cache managment.
 *
 *   Future Work:
 *      0. Large objects should not get moved around and could utilize their own allocation
 *         system... or at the very least get grouped together because they are less likely to
 *         be modified than smaller objects.
 *      1. separating binary nodes and value nodes from other inner node types reduces probability of
 *         loading unecessary data from disk.
 *      2. as nodes are being read set a "read bit", then when compacting, move read nodes to different
 *         segments from unread ones. 
 *              - take a bit from the reference count in node_meta
 *                   a. this would not result in an extra cacheline miss
 *                   b. this could be lazy non-looping compare & swap to prevent
 *                      readers/writers from stomping on eachother. 
 *                   c. the read bit only needs to modified if not already set
 *                   d. the read bit only needs to be set on segments not mmapped
 *                   e. the read bit gets automatically cleared when node is moved
 *                   f. generate a random number and only update the read bit some of the time.
 *                             - the probability of updating the read bit depends upon how "cold"
 *                             the object is (age of segment). Colder segments are less likely to
 *                             mark an object read because of one access. But if an object "becomes hot"
 *                             then it is more likely to get its read bit set.
 *              - add meta data to the segment that tracks how many times the objects
 *                in the segment have been moved due to lack of access. When compacting
 *                a segment you add one to that source segments "access age" for the segment
 *                that is receiving the idol segments. 
 *              - when selecting a segment to compact there are several metrics to consider:
 *                   a. what percentage of the segment has been freed and therefore net recaptured space
 *                   b. what percentage of remaining data has been read at least once
 *                          - a segment that is 50% read has greater sorting effeciency than
 *                            a segment that is 10% or 90% read. 
 *                   c. the number of times the objects in the segment have been moved because
 *                      of lack of access. 
 *
 */
namespace arbtrie
{
   class seg_allocator
   {
     protected:
      friend class database;
      void    release_unreachable();
      void    reset_meta_nodes(recover_args args);
      void    reset_reference_counts();
      int64_t clear_lock_bits();
      void    sync_segment(int seg, sync_type st) noexcept;

     public:
      // only 64 bits in bitfield used to allocate sessions
      // only really require 1 per thread
      static const uint32_t max_session_count = 64;

      seg_allocator(std::filesystem::path dir);
      ~seg_allocator();

      void     dump();
      void     print_region_stats() { _id_alloc.print_region_stats(); }
      uint64_t count_ids_with_refs() { return _id_alloc.count_ids_with_refs(); }
      void     sync(sync_type st = sync_type::sync);
      void     start_compact_thread();
      void     stop_compact_thread();
      bool     compact_next_segment();

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
               modify_lock(node_meta_type& m, read_lock& rl);
               ~modify_lock();

               // returned mutable T is only valid while modify lock is in scope
               template <typename T>
               T* as();

               template <typename T>
               void as(std::invocable<T*> auto&& call_with_tptr);
               void release();

              private:
               void unlock();

               bool            _released = false;
               temp_meta_type  _locked_val;
               node_meta_type& _meta;
               read_lock&      _rlock;
               node_header*    _observed_ptr = nullptr;
               sync_lock*      _sync_lock    = nullptr;
            };

            template <typename T = node_header>
            class object_ref
            {
              public:
               template <typename Other>
               friend class object_ref;

               template <typename Other>
               object_ref(object_ref<Other> p);

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
               auto        try_move(node_location expected_prior_loc, node_location move_to_loc);

               template <bool SetReadBit = false>
               const T* header() const;

               template <typename Type>
               const Type* as() const;

               void store(temp_meta_type tmt, auto memory_order);

               void refresh(auto memory_order) { _cached = _meta.load(memory_order); }

               auto& rlock() { return _rlock; }
               auto& rlock() const { return _rlock; }

               temp_meta_type meta_data() { return _cached; }

               void            prefetch() { __builtin_prefetch(&_meta, 1, 1); }
               node_meta_type& meta() { return _meta; }

              protected:
               friend class seg_allocator;
               friend class seg_allocator::session;

               object_ref(seg_allocator::session::read_lock& rlock,
                          fast_meta_address                  adr,
                          node_meta_type&                    met);

               seg_allocator::session::read_lock& _rlock;
               node_meta_type&                    _meta;
               temp_meta_type                     _cached;  // cached read of atomic _atom_loc
               fast_meta_address                  _address;
            };  // object_ref

            object_ref<node_header> alloc(id_region reg,
                                          uint32_t  size,
                                          node_type type,
                                          auto      initfunc);
            object_ref<node_header> realloc(object_ref<node_header>& r,
                                            // fast_meta_address reuse,
                                            uint32_t  size,
                                            node_type type,
                                            auto      initfunc);

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

            inline object_ref<node_header> get(node_header*);

            ~read_lock() { _session.release_read_lock(); }

            node_header* get_node_pointer(node_location);

            bool       is_synced(node_location);
            sync_lock& get_sync_lock(int seg);

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
         void      sync(sync_type st);

         ~session();
         session(session&& mv);

         uint64_t count_ids_with_refs();

        private:
         friend class lock;
         friend class seg_allocator;

         void retain_read_lock();
         void release_read_lock();

         session(seg_allocator& a, uint32_t ses_num);
         session()               = delete;
         session(const session&) = delete;

         void                                   unalloc(uint32_t size);
         std::pair<node_location, node_header*> alloc_data(uint32_t size, fast_meta_address adr);

         uint32_t _session_num;  // index into _sega's active sessions list

         segment_number                 _alloc_seg_num = -1ull;
         mapped_memory::segment_header* _alloc_seg_ptr = nullptr;

         std::atomic<uint64_t>& _session_lock_ptr;
         seg_allocator& _sega;
         int            _nested_read_lock = 0;
      };

      session start_session() { return session(*this, alloc_session_num()); }

     private:
      friend class session;
      std::optional<session> cses;

      mapped_memory::segment_header* get_segment(segment_number seg) noexcept
      {
         return static_cast<mapped_memory::segment_header*>(_block_alloc.get(seg));
      }

      uint32_t alloc_session_num();
      void     release_session_num(uint32_t sn);

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
      block_allocator _block_alloc;

      // keeps track of the segments that are mlocked.... 
      // TODO: this needs to get refactored
      alignas(64) std::atomic<uint32_t> _total_mlocked = 0;
      alignas(64) std::array<std::atomic<int32_t>, 256> _mlocked;

      /**
       *  This is the highest the alloc_ptr is allowed to
       *  advance and equal to min value of thread_ptrs.
       *
       *  Do not read directly, read via get_min_read_ptr()
       */
      std::atomic<uint64_t> _min_read_ptr = -1ull;  // min(R*)
      uint64_t              get_min_read_ptr();
      void                  set_session_end_ptrs(uint32_t e);

      struct aligned_atomic64 : public std::atomic<uint64_t>
      {
         uint64_t padding[7];
      } __attribute__((__aligned__(8)));

      /**
       *  Lower 32 bits represent R* above
       *  Upper 32 bits represent what compactor has pushed to the session
       *
       *  Allocator takes the min of the lower 32 bits to determine the lock position.
       */
      aligned_atomic64 _session_lock_ptrs[64];
      static_assert(sizeof(_session_lock_ptrs) == 64 * 64);

      /**
       * As sessions are allocated, they are given memory to track the
       * number of bytes read. The compactor thread sums the results from
       * the individual threads and updates the segment meta data it uses
       * to prioritize compaction. Each session is given its own on the
       * assumption that each session belongs to its own thread and we
       * do not want write contention on read access.
       */
      std::array<std::unique_ptr<segment_read_stat>, 64> _session_read_stats;


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

      std::vector<sync_lock> _seg_sync_locks;
      std::vector<int>       _dirty_segs;
      std::mutex             _dirty_segs_mutex;
      uint64_t               _next_dirt_seg_index = 0;
      uint64_t               _last_synced_index   = 0;

      void push_dirty_segment(int seg_num)
      {
         std::unique_lock lock(_dirty_segs_mutex);
         _dirty_segs[_next_dirt_seg_index % max_segment_count] = seg_num;
         ++_next_dirt_seg_index;
      }
      int get_last_dirty_seg_idx()
      {
         std::unique_lock lock(_dirty_segs_mutex);
         return _next_dirt_seg_index;
      }
   };  // seg_allocator

   template <typename T>
   using object_ref = seg_allocator::session::read_lock::object_ref<T>;


   // copy E to R*
   inline void seg_allocator::session::retain_read_lock()
   {
      if (++_nested_read_lock != 1)
         return;

      uint64_t cur = _session_lock_ptr.load(std::memory_order_acquire);

      //cur.locked_end = cur.view_of_end;
      uint32_t view_of_end = cur >> 32;
      uint32_t cur_end     = uint32_t(cur);
      // it should be unlocked which signaled by max
      assert(cur_end == uint32_t(-1));
      auto diff = cur_end - view_of_end;

      // an atomic sub should leave the higher-order bits in place where the view
      // from the compactor is being updated.
      _session_lock_ptr.fetch_sub(diff, std::memory_order_release);
   }

   // R* goes to inifinity and beyond
   inline void seg_allocator::session::release_read_lock()
   {
      // set it to max uint32_t
      if (not --_nested_read_lock)
         _session_lock_ptr.fetch_or(uint32_t(-1));
      assert(_nested_read_lock >= 0);
   }

   inline seg_allocator::session::read_lock::modify_lock::modify_lock(node_meta_type& m,
                                                                      read_lock&      rl)
       : _meta(m), _rlock(rl), _sync_lock(nullptr)
   {
      _locked_val = _meta.start_modify();
   }

   inline seg_allocator::session::read_lock::modify_lock::~modify_lock()
   {
      if (not _released)
         unlock();
   }



}  // namespace arbtrie
#include <arbtrie/seg_allocator_object_ref.hpp>
#include <arbtrie/seg_allocator_read_lock.hpp>
