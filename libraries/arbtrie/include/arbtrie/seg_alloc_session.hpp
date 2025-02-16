#pragma once
#include <arbtrie/circular_buffer.hpp>
#include <arbtrie/node_header.hpp>
#include <arbtrie/node_meta.hpp>
#include <arbtrie/segment_read_stats.hpp>
#include <arbtrie/sync_lock.hpp>
#include <atomic>
#include <memory>

namespace arbtrie
{
   class seg_allocator;

   class seg_alloc_session
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

         class object_ref
         {
           public:
            object_ref(const object_ref& p);

            inline id_address    address() const { return _address; }
            inline uint32_t      ref() const { return _cached.ref(); }
            inline node_type     type() const { return _cached.type(); }
            inline node_location loc() const { return _cached.loc(); }

            // return false if ref count overflow
            bool retain() { return _meta.retain(); }

            // return last value of pointer if object is deleted, so children can
            // be released... otherwise null
            const node_header* release();

            modify_lock modify() { return modify_lock(_meta, _rlock); }
            bool        try_start_move(node_location loc) { return _meta.try_start_move(loc); }
            auto        try_move(node_location expected_prior_loc, node_location move_to_loc);

            template <typename T = node_header, bool SetReadBit = false>
            const T* header() const;

            template <typename T = node_header>
            std::pair<const T*, node_location> try_move_header();

            template <typename Type, bool SetReadBit = false>
            const Type* as() const;

            void store(temp_meta_type tmt, auto memory_order);

            void refresh(auto memory_order) { _cached = _meta.load(memory_order); }

            auto& rlock() { return _rlock; }
            auto& rlock() const { return _rlock; }

            temp_meta_type meta_data() { return _cached; }

            void            prefetch() { __builtin_prefetch(&_meta, 1, 1); }
            node_meta_type& meta() { return _meta; }

            void maybe_update_read_stats() const;

           protected:
            friend class seg_allocator;
            friend class seg_alloc_session;

            object_ref(seg_alloc_session::read_lock& rlock, id_address adr, node_meta_type& met);

            seg_alloc_session::read_lock& _rlock;
            node_meta_type&               _meta;
            temp_meta_type                _cached;  // cached read of atomic _atom_loc
            id_address                    _address;
         };  // object_ref

         object_ref alloc(id_region reg, uint32_t size, node_type type, auto initfunc);

         // id_address reuse,
         object_ref realloc(object_ref& r, uint32_t size, node_type type, auto initfunc);

         /**
             * @defgroup Region Alloc Helpers
             */
         /// @{
         id_region                              get_new_region();
         void                                   free_meta_node(id_address);
         std::pair<node_meta_type&, id_address> get_new_meta_node(id_region);
         /// @}

         inline object_ref get(id_address adr);
         inline object_ref get(node_header*);

         ~read_lock() { _session.release_read_lock(); }

         node_header* get_node_pointer(node_location);
         void         update_read_stats(node_location, uint32_t node_size, uint64_t time);

         bool       is_synced(node_location);
         sync_lock& get_sync_lock(int seg);

        private:
         friend class seg_alloc_session;

         read_lock(seg_alloc_session& s) : _session(s) { _session.retain_read_lock(); }
         read_lock(const seg_alloc_session&) = delete;
         read_lock(seg_alloc_session&&)      = delete;

         read_lock& operator=(const read_lock&) = delete;
         read_lock& operator=(read_lock&)       = delete;
         read_lock& operator=(read_lock&&)      = delete;

         seg_alloc_session& _session;
      };

      // before any objects can be read, the session must note the
      // current state of the free segment queue so that no segments that
      // could be read while the return value of this method is in scope can
      // be reused (overwritten)
      read_lock lock() { return read_lock(*this); }
      void      sync(sync_type st);

      ~seg_alloc_session();
      seg_alloc_session(seg_alloc_session&& mv);

      uint64_t count_ids_with_refs();

     private:
      friend class lock;
      friend class seg_allocator;

      void retain_read_lock();
      void release_read_lock();

      seg_alloc_session(seg_allocator& a, uint32_t ses_num);
      seg_alloc_session()                         = delete;
      seg_alloc_session(const seg_alloc_session&) = delete;

      void                                   unalloc(uint32_t size);
      std::pair<node_location, node_header*> alloc_data(uint32_t   size,
                                                        id_address adr,
                                                        uint64_t   time = size_weighted_age::now());

      uint32_t _session_num;  // index into _sega's active sessions list

      segment_number                 _alloc_seg_num = -1ull;
      mapped_memory::segment_header* _alloc_seg_ptr = nullptr;
      bool                           _in_alloc      = false;

      std::atomic<uint64_t>&              _session_lock_ptr;
      std::unique_ptr<segment_read_stat>& _segment_read_stat;
      seg_allocator&                      _sega;
      int                                 _nested_read_lock = 0;

      // Reference to the read cache queue from seg_allocator
      circular_buffer<1024 * 1024>& _rcache_queue;
   };
}  // namespace arbtrie
