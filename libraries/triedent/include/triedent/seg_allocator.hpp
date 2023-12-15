#pragma once
#include <thread>
#include <triedent/debug.hpp>
#include <triedent/id_allocator.hpp>
#include <triedent/mapping.hpp>


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

namespace triedent
{
   /// index into meta[free_segment_index]._free_segment_number
   using free_segment_index = uint64_t;

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
         std::atomic<uint32_t> _alloc_pos = 16; // sizeof(segment_header)
         uint32_t _age; // every time a segment is allocated it is assigned an age which aids in reconstruction
         // used to calculate object density of segment header,
         // to establish madvise
         uint32_t _num_objects = 0;  // inc on alloc
         uint32_t _checksum = 0; // TODO
      };
      static_assert(sizeof(segment_header) == 16);

      struct allocator_header
      {
         // when no segments are available for reuse, advance by segment_size
         alignas(64) std::atomic<segment_offset> alloc_ptr;    // A below
         alignas(64) std::atomic<free_segment_index> end_ptr;  // E below

         // set to 0 just before exit, set to 1 when opening database
         std::atomic<bool> clean_exit_flag;
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
     public:
      // only 64 bits in bitfield used to allocate sessions
      // only really require 1 per thread
      static const uint32_t max_session_count = 64;

      seg_allocator(std::filesystem::path dir);
      ~seg_allocator();

      void dump();
      void sync(sync_type st = sync_type::sync);
      void start_compact_thread();
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
            template <typename T = char>
            class object_ref
            {
              public:
               template <typename Other>
               friend class object_ref;

               template <typename Other>
               object_ref(object_ref<Other> p)
                   : _rlock(p._rlock), _id(p._id), _atom_loc(p._atom_loc), _cached(p._cached)
               //    _ptr(p._ptr)
               {
                  //      assert(_ptr == nullptr or (_ptr and (_ptr->id == _id.id)));
               }

               object_id       id() const { return _id; }
               uint32_t        ref_count() const { return _cached.ref(); }
               node_type       type() const { return _cached.type(); }
               auto            read() const { return _cached.read(); }
               object_location location() const { return _cached.location(); }

               // return false if ref count overflow
               bool retain();
               // return true if object is deleted
               bool                 release();
               const object_header* obj() const;  // TODO: rename header()
               object_header*       obj();        // TODO: rename header()

               char* data()
               {
                  assert(obj());
                  return obj()->data();
               }

               template <typename Type>
               Type* as()
               {
                  return reinterpret_cast<Type*>(obj()->data());
               };
               template <typename Type>
               const Type* as() const
               {
                  return reinterpret_cast<const Type*>(obj()->data());
               };

               explicit inline operator bool() const { return bool(id()); }
               bool            is_leaf_node() const { return type() != node_type::inner; }
               inline auto& as_value_node() const { return *this->template as<const value_node>(); }
               inline auto& as_inner_node() const { return *this->template as<const inner_node>(); }

               inline const T* operator->() const { return this->template as<const T>(); }
               inline T*       operator->() { return this->template as<T>(); }
               inline const T& operator*() const { return *(this->template as<const T>()); }

               int64_t as_id() const { return _id.id; }

               auto loc() const { return _cached.location(); }

               auto& get_mutex() const { return _rlock._session._sega._id_alloc.get_mutex(_id); }

               // return false if object is released while atempting to move
               bool move(object_location loc);

               bool cache_object();

               void refresh() { _cached = object_info(_atom_loc.load(std::memory_order_acquire)); }

              protected:
               friend class seg_allocator;
               friend class seg_allocator::session;

               object_ref(seg_allocator::session::read_lock& rlock,
                          object_id                          id,
                          std::atomic<uint64_t>&             atom_loc)
                   : _rlock(rlock),
                     _atom_loc(atom_loc),
                     _cached(atom_loc.load(std::memory_order_acquire)),
                     _id(id)
               {
                  //    assert(_ptr == nullptr or (_ptr and (_ptr->id == _id.id)));
               }

               seg_allocator::session::read_lock& _rlock;
               std::atomic<uint64_t>&             _atom_loc;
               object_info                        _cached;  // cached read of atomic _atom_loc
               object_id                          _id;
            };

            object_ref<char> alloc(uint32_t size, node_type type);

            template <typename T = char>
            object_ref<T> get(object_id id)
            {
               return object_ref<T>(*this, id, _session._sega._id_alloc.get(id));
            }

            object_ref<char> get(object_header*);

            // checks known invariants:
            //   id < max_id of id_allocator
            //   id points to obj that points back to it
            //   ref_count > 0
            //   node_type is known and defined
            //   ptr is in a valid range
            //   others?
            object_ref<char> validate(object_id id) const
            {
               throw std::runtime_error("read_lock::validate not impl");
            }

            ~read_lock() { _session.release_read_lock(); }

           private:
            friend class session;
            template <typename T>
            friend class object_ref;

            object_header* get_object_pointer(object_location);

            read_lock(session& s) : _session(s) { _session.retain_read_lock(); }
            session& _session;
         };

         // before any objects can be read, the session must note the
         // current state of the free segment queue so that no segments that
         // could be read while the return value of this method is in scope can
         // be reused.
         read_lock lock() { return read_lock(*this); }

         ~session()
         {
            if( _session_num == -1 ) return;
            if (_alloc_seg_ptr)  // not moved
            {
               if (segment_size - _alloc_seg_ptr->_alloc_pos >=  sizeof(object_header) )
               {
                  memset(((char*)_alloc_seg_ptr) + _alloc_seg_ptr->_alloc_pos, 0,
                         sizeof(object_header));  // mark last object
               }
               _sega._header->seg_meta[_alloc_seg_num].free(segment_size -
                                                            _alloc_seg_ptr->_alloc_pos);
               _alloc_seg_ptr->_alloc_pos = uint32_t(-1);
               _alloc_seg_num             = -1ull;
            }
            _sega.release_session_num(_session_num);
         }

         session( session&& mv ):_sega(mv._sega), _session_num(mv._session_num), _alloc_seg_num(mv._alloc_seg_num), _alloc_seg_ptr(mv._alloc_seg_ptr) {
            mv._session_num = -1;
         }

        private:
         friend class lock;
         friend class seg_allocator;

         // copy E to R*
         void retain_read_lock()
         {
            auto pt = _sega._session_ptrs[_session_num].load(std::memory_order_acquire);
            if (pt == -1ull)
               _sega._session_ptrs[_session_num].store(
                   _sega._header->end_ptr.load(std::memory_order_acquire),
                   std::memory_order_relaxed);
            else  // TODO: this may be ok, but if so then
               throw std::runtime_error("attempt to double-lock");
         }

         // R* goes to inifinity and beyond
         void release_read_lock()
         {
            assert(_sega._session_ptrs[_session_num] != -1ull);
            _sega._session_ptrs[_session_num] = -1ull;
         }

         session(seg_allocator& a, uint32_t ses_num)
             : _session_num(ses_num), _alloc_seg_num(-1ull), _alloc_seg_ptr(nullptr), _sega(a)
         {
         }

         session()               = delete;
         session(const session&) = delete;

         std::pair<object_location, char*> alloc_data(uint32_t size, object_id id)
         {
            assert(size < segment_size - 16);
            // A - if no segment get a new segment
            if (not _alloc_seg_ptr or _alloc_seg_ptr->_alloc_pos.load( std::memory_order_relaxed) > segment_size )
            {
               auto [num, ptr] = _sega.get_new_segment();
               _alloc_seg_num  = num;
               _alloc_seg_ptr  = ptr;
               _sega._header->seg_meta[_alloc_seg_num]._last_sync_pos.store(
                   0, std::memory_order_relaxed);
            }

            auto* sh           = _alloc_seg_ptr;
            auto  rounded_size = (size + 7) & -8;

            auto cur_apos  = sh->_alloc_pos.load(std::memory_order_relaxed);
            auto spec_pos  = uint64_t(cur_apos) + rounded_size;
            auto free_space = segment_size - cur_apos;

            // B - if there isn't enough space, notify compactor go to A
            if ( spec_pos > (segment_size-sizeof(object_header)) )
            {
               if( free_space >= sizeof(object_header) ) {
                  assert(cur_apos + sizeof(uint64_t) <= segment_size);
                  memset(((char*)sh) + cur_apos, 0, sizeof(uint64_t));
               }
               _sega._header->seg_meta[_alloc_seg_num].free(segment_size - sh->_alloc_pos);
               sh->_alloc_pos.store(uint32_t(-1), std::memory_order_release);
               _alloc_seg_ptr = nullptr;
               _alloc_seg_num = -1ull;

               return alloc_data(size, id);  // recurse
            }

            auto obj = ((char*)sh) + sh->_alloc_pos.load(std::memory_order_relaxed);
            auto head = (object_header*)obj;
            head->size = size-sizeof(object_header);
            head->id = id.id;

            auto new_alloc_pos = rounded_size + sh->_alloc_pos.fetch_add(rounded_size, std::memory_order_relaxed);
            sh->_num_objects++;

            auto loc = _alloc_seg_num * segment_size + cur_apos;

            return {object_location{loc}, obj}; 
         }

         uint32_t _session_num;  // index into _sega's active sessions list

         segment_number                 _alloc_seg_num = -1ull;
         mapped_memory::segment_header* _alloc_seg_ptr = nullptr;

         seg_allocator& _sega;

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
      const object_header* get_object(object_location loc) const;
      const object_header* get_object(object_id oid) const;

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
      id_allocator _id_alloc;

      // allocates new segments
      block_allocator _block_alloc;

      /**
       *  This is the highest the alloc_ptr is allowed to
       *  advance and equal to min value of thread_ptrs.
       *
       *  Do not read directly, read via get_min_read_ptr()
       */
      std::atomic<uint64_t> _min_read_ptr = -1ull;  // min(R*)
      uint64_t              get_min_read_ptr();

      /**
      * At the start of each access to the DB, 
      * a read thread must copy the end_ptr and store
      * it in this array indexed by the thread number. When
      * the thread is done accessing the data it will reset
      * the pointer to max_int64.  Each read pos is an index
      * into _free_segments
      *
      * TODO: perhaps these need to be on their own cache line
      * since different threads are writing to them, if so then
      * we can store other session-local data on that cache line
      * for free.
      */
      std::atomic<uint64_t> _session_ptrs[64];  // R* above

      // to allocate a new session in thread-safe way you
      // load, find first non-zero bit, and attempt to set it via C&S,
      // the index of the bit is the session id.
      // Reverse the process to free a session
      std::atomic<uint64_t> _free_sessions = -1ull;

      std::atomic<bool> _done;

      mapping                          _header_file;
      mapped_memory::allocator_header* _header;
   };

   template <typename T>
   inline object_header* seg_allocator::session::read_lock::object_ref<T>::obj()
   {
      object_location loc{._offset = 8 * (_atom_loc.load(std::memory_order_acquire) >>
                                          object_info::location_rshift)};
      return _rlock.get_object_pointer(loc);
   }
   template <typename T>
   inline const object_header* seg_allocator::session::read_lock::object_ref<T>::obj() const
   {
      object_location loc{._offset = 8 * (_atom_loc.load(std::memory_order_acquire) >>
                                          object_info::location_rshift)};
      return _rlock.get_object_pointer(loc);
   }

   template <typename T>
   using deref = seg_allocator::session::read_lock::object_ref<T>;

   /**
    * Holds a unique_lock that toggles a bit and prevents the
    * underlying object from being moved or released while the lock
    * is held.
    */
   template <typename T>
   struct mutable_deref : public deref<T>
   {

      mutable_deref(const deref<T>& src) : deref<T>(src), lock(src.get_mutex()) {}

      /*
      mutable_deref(std::unique_lock<std::mutex>& m, const deref<T>& src) 
         : deref<T>(src), lock(m)
      {
      }
      */

      inline auto& as_value_node() const { return *this->template as<value_node>(); }
      inline auto& as_inner_node() const { return *this->template as<inner_node>(); }

      inline T* operator->() const { return const_cast<T*>(this->template as<T>()); }
      inline T& operator*() const { return const_cast<T&>(*this->template as<T>()); }

     private:
      std::unique_lock<std::mutex> lock;
   };  // mutable_deref
   
   template <typename T>
   bool seg_allocator::session::read_lock::object_ref<T>::move( object_location loc )
   {
      uint64_t expected = _atom_loc.load(std::memory_order_acquire);
      do
      {
         _cached = object_info(expected).set_location(loc);
         if( _cached.ref() == 0 ) {
            return false; 
         }
         assert( type() != node_type::undefined );
      } while (not _atom_loc.compare_exchange_weak(expected, _cached.to_int(), std::memory_order_release));
      return true;
   }

   template <typename T>
   bool seg_allocator::session::read_lock::object_ref<T>::retain()
   {
      auto prior = _atom_loc.fetch_add(1, std::memory_order_relaxed);
      if ((prior & object_info::ref_mask) >= object_info::max_ref_count) [[unlikely]]
      {
         _atom_loc.fetch_sub(1, std::memory_order_relaxed);
         return false;
      }
      // _cached = object_info(prior + 1);  // TODO: may be unnessary work
      return true;

      uint64_t cur = _atom_loc.load(std::memory_order_relaxed);
      do
      {
         assert((cur & object_info::ref_mask) < 100);
         //assert((cur & object_info::ref_mask) >= 1);
         if ((cur & object_info::ref_mask) >= object_info::max_ref_count)
            return false;
      } while (not _atom_loc.compare_exchange_weak(cur, cur + 1));
      //, std::memory_order_relaxed, std::memory_order_relaxed));

      //    std::cerr<<"retain: "<<_id.id <<" ref="<< (_atom_loc.load()&object_info::ref_mask) <<"\n";
      return true;
   }
   template <typename T>
   bool seg_allocator::session::read_lock::object_ref<T>::release()
   {
      assert(ref_count() != 0 );
      assert(type() != node_type::undefined);
      auto prior = _atom_loc.fetch_sub(1, std::memory_order_relaxed);
      if ((prior & object_info::ref_mask) > 1)
         return false;

      _cached = object_info( prior -1 );
      auto loc = _cached.location();
      auto seg = loc.segment();

      auto obj_ptr =
          (const object_header*)((char*)_rlock._session._sega._block_alloc.get(seg) + loc.index());

      _rlock._session._sega._id_alloc.free_id(_id);
      _rlock._session._sega._header->seg_meta[seg].free_object(obj_ptr->data_capacity());
      return true;
   }

   template <typename T>
   using object_ref = seg_allocator::session::read_lock::object_ref<T>;
   inline object_ref<char> seg_allocator::session::read_lock::alloc(uint32_t size, node_type type)
   {
      assert(type != node_type::undefined);

      auto [atom, id] = _session._sega._id_alloc.get_new_id();
      auto [loc, ptr] = _session.alloc_data(size + sizeof(object_header), id);

      // TODO: this could break if object_info changes
      atom.store(1 | (uint64_t(type) << 15) | ((loc._offset / 8) << 19), std::memory_order_relaxed);

      assert( object_ref(*this, id, atom).type() != node_type::undefined );
      return object_ref(*this, id, atom);
   }

   inline object_ref<char> seg_allocator::session::read_lock::get(object_header* oh)
   {
      object_id oid(oh->id);
      return object_ref(*this, oid, _session._sega._id_alloc.get(oid));
   }

   inline object_header* seg_allocator::session::read_lock::get_object_pointer(object_location loc)
   {
      auto segment = (mapped_memory::segment_header*)_session._sega._block_alloc.get(loc.segment());
      // 0 means we are accessing a swapped object on a segment that hasn't started new allocs
      // if alloc_pos > loc.index() then we haven't overwriten this object yet, we are accessing
      // data behind the alloc pointer which should be safe
      // to access data we had to get the location from obj id database and we should read
      // with memory_order_acquire, when updating an object_info we need to write with
      // memory_order_release otherwise the data written may not be visible yet to the reader coming
      // along behind
      assert(segment->_alloc_pos == 0 or segment->_alloc_pos > loc.index());
      return (object_header*)((char*)_session._sega._block_alloc.get(loc.segment()) + loc.index());
   }

   /**
    *  Given obj, if it isn't already located in the allocation segment of
    *  this thread or in the allocation segment of another thread then
    *  move it to the allocation segment of the current thread.
    *
    *  - do not move it if the object ref is 0...
    *  - do not wait for a write lock, if we can't get the write lock
    *  then we will just let another thread move it
    *
    *  @return true if the object was moved
    */
   template <typename T>
   bool seg_allocator::session::read_lock::object_ref<T>::cache_object()
   {
      std::unique_lock ul(get_mutex(), std::try_to_lock);

      if (ul.owns_lock())
      {
         auto cur_loc = location()._offset;

         assert(ref_count());
         assert(cur_loc);
         assert(cur_loc & (segment_size - 1));

         auto           cur_seg     = cur_loc / segment_size;
         auto           cur_seg_ptr = _rlock._session._sega.get_segment(cur_seg);
         object_header* cur_obj_ptr =
             (object_header*)(((char*)cur_seg_ptr) + (cur_loc & (segment_size - 1)));

         assert(0 != cur_seg_ptr->_alloc_pos);  // this would be on a freed segment

         // this would mean its currently located in an active alloc thread
         if (cur_seg_ptr->_alloc_pos.load(std::memory_order_relaxed) == uint32_t(-1))
            return false;

         auto obj_size   = cur_obj_ptr->object_size();
         auto [loc, ptr] = _rlock._session.alloc_data(obj_size, _id);
         memcpy(ptr, cur_obj_ptr, obj_size);
         if( move(loc) ) {
            // note that this item has been freed from the segment so the segment can be
            // recovered
            _rlock._session._sega._header->seg_meta[cur_seg].free_object(obj_size);
         }

         return true;
      }
      return false;
   }

}  // namespace triedent
