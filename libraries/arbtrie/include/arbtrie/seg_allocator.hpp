#pragma once
#include <arbtrie/debug.hpp>
#include <arbtrie/id_allocator.hpp>
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
         std::atomic<uint32_t> _alloc_pos = 16;  // sizeof(segment_header)
         uint32_t
             _age;  // every time a segment is allocated it is assigned an age which aids in reconstruction
         // used to calculate object density of segment header,
         // to establish madvise
         uint32_t _num_objects = 0;  // inc on alloc
         uint32_t _checksum    = 0;  // TODO
      };
      static_assert(sizeof(segment_header) == 16);

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
            template <typename T = node_header>
            class object_ref
            {
              public:
               template <typename Other>
               friend class object_ref;

               template <typename Other>
               object_ref(object_ref<Other> p)
                   : _rlock(p._rlock), _id(p._id), _atom_loc(p._atom_loc), _cached(p._cached)
               {
               }

               inline object_id       id() const { return _id; }
               inline uint32_t        ref() const { return _cached.ref(); }
               inline node_type       type() const { return _cached.type(); }
               inline object_location loc() const { return _cached.loc(); }

               // return false if ref count overflow
               bool retain();
               // return true if object is deleted
               bool     release();
               const T* obj() const;  // TODO: rename header()
               T*       obj();        // TODO: rename header()

               template <typename Type>
               Type* as()
               {
                  return reinterpret_cast<Type*>(obj());
               };
               template <typename Type>
               const Type* as() const
               {
                  return reinterpret_cast<const Type*>(obj());
               };

               explicit inline operator bool() const { return bool(id()); }

               T*       operator->() { return as<T>(); }
               const T* operator->() const { return as<T>(); }

               int64_t as_id() const { return _id.id; }

               auto& get_mutex() const { return _rlock._session._sega._id_alloc.get_mutex(_id); }

               // return false if object is released or moved while atempting to move
               bool move(object_location expected_prior_loc, object_location move_to_loc);

               bool cache_object();

               void refresh() { _cached = object_meta(_atom_loc.load(std::memory_order_acquire)); }

               auto& rlock() { return _rlock; }
               auto& rlock()const { return _rlock; }

               object_ref clone(const T* v) const { return rlock().clone(v); }

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
               object_meta                        _cached;  // cached read of atomic _atom_loc
               object_id                          _id;
            };  // object_ref

            template <typename T>
            inline object_ref<T>    clone(const T* n);
            object_ref<node_header> alloc(uint32_t size, node_type type, auto initfunc);

            object_ref<node_header> realloc(object_id reuse,
                                            uint32_t  size,
                                            node_type type,
                                            auto      initfunc);

            template <typename T>
            object_ref<T> clone(T* n);

            template <typename T = node_header>
            inline object_ref<T> get(object_id id)
            {
               return object_ref<T>(*this, id, _session._sega._id_alloc.get(id));
            }

            inline object_ref<node_header> get(node_header*);

            // checks known invariants:
            //   id < max_id of id_allocator
            //   id points to obj that points back to it
            //   ref_count > 0
            //   node_type is known and defined
            //   ptr is in a valid range
            //   others?
            object_ref<node_header> validate(object_id id) const
            {
               throw std::runtime_error("read_lock::validate not impl");
            }

            ~read_lock() { _session.release_read_lock(); }

           private:
            friend class session;
            template <typename T>
            friend class object_ref;

            node_header* get_object_pointer(object_location);

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
               auto pt = _sega._session_ptrs[_session_num].load(std::memory_order_acquire);
               if (pt == -1ull)
                  _sega._session_ptrs[_session_num].store(
                      _sega._header->end_ptr.load(std::memory_order_acquire),
                      std::memory_order_relaxed);
               else  // TODO: this may be ok, but if so then
                  throw std::runtime_error("attempt to double-lock");
            }
         }

         // R* goes to inifinity and beyond
         void release_read_lock()
         {
            --_nested_read_lock;
            if (not _nested_read_lock)
            {
               assert(_sega._session_ptrs[_session_num] != -1ull);
               _sega._session_ptrs[_session_num] = -1ull;
            }
         }

         session(seg_allocator& a, uint32_t ses_num)
             : _session_num(ses_num), _alloc_seg_num(-1ull), _alloc_seg_ptr(nullptr), _sega(a)
         {
         }

         session()               = delete;
         session(const session&) = delete;

         /**
          *   alloc_data
          *
          */
         std::pair<object_location, node_header*> alloc_data(uint32_t  size,
                                                             object_id id,
                                                             node_type t)
         {
            assert(size < segment_size - 16);
            // A - if no segment get a new segment
            if (not _alloc_seg_ptr or
                _alloc_seg_ptr->_alloc_pos.load(std::memory_order_relaxed) > segment_size)
            {
               auto [num, ptr] = _sega.get_new_segment();
               _alloc_seg_num  = num;
               _alloc_seg_ptr  = ptr;
               _sega._header->seg_meta[_alloc_seg_num]._last_sync_pos.store(
                   0, std::memory_order_relaxed);
            }

            auto* sh           = _alloc_seg_ptr;
            auto  rounded_size = (size + 15) & -16;

            auto cur_apos = sh->_alloc_pos.load(std::memory_order_relaxed);

            assert(not(cur_apos & 15));

            auto spec_pos   = uint64_t(cur_apos) + rounded_size;
            auto free_space = segment_size - cur_apos;

            // B - if there isn't enough space, notify compactor go to A
            if (spec_pos > (segment_size - sizeof(node_header)))
            {
               if (free_space >= sizeof(node_header))
               {
                  assert(cur_apos + sizeof(uint64_t) <= segment_size);
                  memset(((char*)sh) + cur_apos, 0, sizeof(node_header));
               }
               _sega._header->seg_meta[_alloc_seg_num].free(segment_size - sh->_alloc_pos);
               sh->_alloc_pos.store(uint32_t(-1), std::memory_order_release);
               _alloc_seg_ptr = nullptr;
               _alloc_seg_num = -1ull;

               return alloc_data(size, id, t);  // recurse
            }

            auto obj       = ((char*)sh) + sh->_alloc_pos.load(std::memory_order_relaxed);
            auto head      = (node_header*)obj;
            head           = new (head) node_header(size, t, 0, 0);
            head->_node_id = id.id;

            auto new_alloc_pos =
                rounded_size + sh->_alloc_pos.fetch_add(rounded_size, std::memory_order_relaxed);
            sh->_num_objects++;

            auto loc = _alloc_seg_num * segment_size + cur_apos;

            return {object_location{loc}, head};
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
      const node_header* get_object(object_location loc) const;
      const node_header* get_object(object_id oid) const;

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
   inline T* seg_allocator::session::read_lock::object_ref<T>::obj()
   {
      object_meta val(_atom_loc.load(std::memory_order_acquire));

      if (not val.ref())
         return nullptr;
      else
         return (T*)_rlock.get_object_pointer(val.loc());

      /*
      auto val = _atom_loc.load(std::memory_order_acquire);

      if( (val & object_meta::ref_mask)  == 0  ) {
         return nullptr;
      }

      object_location loc{._offset = 8 * ( val >> object_info::location_rshift)};
      auto            ptr = _rlock.get_object_pointer(loc);
      return ptr;
      */
   }

   template <typename T>
   inline const T* seg_allocator::session::read_lock::object_ref<T>::obj() const
   {
      object_meta val(_atom_loc.load(std::memory_order_acquire));

      if (not val.ref())
         return nullptr;
      else
         return (const T*)_rlock.get_object_pointer(val.loc());
      /*
      auto val = _atom_loc.load(std::memory_order_acquire);

      if( (val & object_info::ref_mask)  == 0  ) {
         return nullptr;
      }

      object_location loc{._offset = 8 * ( val >> object_info::location_rshift)};
      auto            ptr = _rlock.get_object_pointer(loc);
      return ptr;
      */
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

      //inline auto& as_value_node() const { return *this->template as<value_node>(); }
      //inline auto& as_inner_node() const { return *this->template as<inner_node>(); }

      inline T* operator->() const { return const_cast<T*>(this->template as<T>()); }
      inline T& operator*() const { return const_cast<T&>(*this->template as<T>()); }

      ~mutable_deref() { this->obj()->update_checksum(); }

     private:
      std::unique_lock<std::mutex> lock;
   };  // mutable_deref

   /**
    * @param expect - the current location the caller things the object is at
    * @param loc    - the new location the caller wants it to point at if and only
    *                 if the expected location hasn't changed.
    * @return true if the swap was made and the object still has a positive ref count
    */
   template <typename T>
   bool seg_allocator::session::read_lock::object_ref<T>::move(object_location expect_loc,
                                                               object_location loc)
   {
      uint64_t expected = _atom_loc.load(std::memory_order_acquire);
      do
      {
         object_meta ex(expected);
         // TODO: every call to ex.loc() does a mult by 16, could be replaced
         // by ex.raw_loc() compared to loc.offset >> 4
         if (ex.loc() != expect_loc or ex.ref() == 0)
            return false;
         _cached = ex.set_location(loc);
      } while (not _atom_loc.compare_exchange_weak(expected, _cached.to_int(),
                                                   std::memory_order_release));
      return true;
   }

   template <typename T>
   bool seg_allocator::session::read_lock::object_ref<T>::retain()
   {
      object_meta prior(_atom_loc.fetch_add(1, std::memory_order_relaxed));
      if (prior.ref() > object_meta::max_ref_count) [[unlikely]]
      {
         _atom_loc.fetch_sub(1, std::memory_order_relaxed);
         return false;
      }
      return true;

      /*
      auto prior = _atom_loc.fetch_add(1, std::memory_order_relaxed);
      if ((prior & object_info::ref_mask) >= object_info::max_ref_count) [[unlikely]]
      {
         _atom_loc.fetch_sub(1, std::memory_order_relaxed);
         return false;
      }
      assert( prior & object_info::ref_mask );
      return true;
      */
   }

   template <typename T>
   bool seg_allocator::session::read_lock::object_ref<T>::release()
   {
      assert(ref() != 0);
      assert(type() != node_type::undefined);
      auto prior = _atom_loc.fetch_sub(1, std::memory_order_relaxed);
      if ((prior & object_meta::ref_mask) > 1)
         return false;

      _cached  = object_meta(prior - 1);
      auto loc = _cached.loc();
      auto seg = loc.segment();

      auto obj_ptr =
          (node_header*)((char*)_rlock._session._sega._block_alloc.get(seg) + loc.index());
      obj_ptr->set_type(node_type::undefined);

      // signal to compactor that this data is no longer valid before
      // we allow the ID to be reused.

      // by touching this we are forcing pages to be written that were previously constant,
      // but with recent changes to move() this check is almost redundant
      obj_ptr->checksum = -1;  //TODO: does this prevent false invalid checksum in validate

      // This ID can be reused almost immediately after calling this method
      // which means this objref object is worthless to the caller
      _rlock._session._sega._id_alloc.free_id(_id);
      _rlock._session._sega._header->seg_meta[seg].free_object(obj_ptr->object_capacity());

      return true;
   }

   template <typename T>
   using object_ref = seg_allocator::session::read_lock::object_ref<T>;

   template <typename T>
   inline object_ref<T> seg_allocator::session::read_lock::clone(const T* n)
   {
      auto [atom, id]      = _session._sega._id_alloc.get_new_id();
      auto [loc, node_ptr] = _session.alloc_data(n->size(), id, n->get_type());
      memcpy(node_ptr, n, n->size());
      node_ptr->set_id(n->id());

      atom.store(object_meta(n->get_type(), loc, 1).to_int(), std::memory_order_relaxed);
      return object_ref(*this, id, atom);
   }

   /// @pre refcount of id is 1
   inline object_ref<node_header> seg_allocator::session::read_lock::realloc(object_id id,
                                                                             uint32_t  size,
                                                                             node_type type,
                                                                             auto      init)
   {
   //   std::cerr << "realloc " << id <<" size: " << size <<" \n";
      // TODO: mark the free space associated with the current location of id
      assert(size >= sizeof(node_header));
      assert(type != node_type::undefined);

      auto& atom           = _session._sega._id_alloc.get(id);
      auto [loc, node_ptr] = _session.alloc_data(size, id, type);

      init(node_ptr);

      // we can stomp on the data because it is impossible for the ref count to
      // increase while realloc and even if compactor moves the data from the
      // old location, the new data should take priority
      atom.store(object_meta(type, loc, 1).to_int(), std::memory_order_release);

      assert(object_ref(*this, id, atom).type() != node_type::undefined);
      return object_ref(*this, id, atom);
   }

   inline object_ref<node_header> seg_allocator::session::read_lock::alloc(uint32_t  size,
                                                                           node_type type,
                                                                           auto      init)
   {
      assert(size >= sizeof(node_header));
      assert(type != node_type::undefined);

      auto [atom, id]      = _session._sega._id_alloc.get_new_id();
      auto [loc, node_ptr] = _session.alloc_data(size, id, type);

      init(node_ptr);

      atom.store(object_meta(type, loc, 1).to_int(), std::memory_order_release);

      assert(object_ref(*this, id, atom).type() != node_type::undefined);
      return object_ref(*this, id, atom);
   }

   inline node_header* seg_allocator::session::read_lock::get_object_pointer(object_location loc)
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
      return (node_header*)((char*)_session._sega._block_alloc.get(loc.segment()) + loc.index());
   }

   /**
    *  Given obj, if it isn't already located in the allocation segment of
    *  this thread or in the allocation segment of another thread then
    *  move it to the allocation segment of the current thread.
    *
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
         auto cur_loc = loc();

         assert(ref());
         assert(cur_loc._offset);
         assert(cur_loc._offset & (segment_size - 1));

         auto         cur_seg_ptr = _rlock._session._sega.get_segment(cur_loc.segment());
         node_header* cur_obj_ptr = (node_header*)(((char*)cur_seg_ptr) + cur_loc.index());

         assert(0 != cur_seg_ptr->_alloc_pos);  // this would be on a freed segment

         // this would mean its currently located in an active alloc thread, while
         // we could re-alloc it is probably already hot because a writer, reader,
         // or compactor has just recently copied it.
         if (cur_seg_ptr->_alloc_pos.load(std::memory_order_relaxed) != uint32_t(-1))
            return false;

         auto obj_size    = cur_obj_ptr->object_capacity();
         auto [nloc, ptr] = _rlock._session.alloc_data(obj_size, _id, cur_obj_ptr->get_type());
         memcpy(ptr, cur_obj_ptr, obj_size);
         if (move(loc(), nloc))
         {
            // note that this item has been freed from the segment so the space
            // can be recovered by the compactor
            _rlock._session._sega._header->seg_meta[cur_loc.segment()].free_object(obj_size);
            return true;
         }
      }
      return false;
   }

}  // namespace arbtrie
