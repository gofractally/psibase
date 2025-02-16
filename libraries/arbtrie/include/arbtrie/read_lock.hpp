#pragma once
#include <arbtrie/node_meta.hpp>

namespace arbtrie
{
   class seg_alloc_session;
   class read_lock;
   class node_header;

   /**
   * @brief A lock that allows a single thread to modify a node
   * 
   * This object is returned by the modify() method on object_ref and
   * ensures that the modify lock is released when the modify lock 
   * goes out of scope.
   */
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

   class object_ref;

   /**
     * Ensures the read-lock is released so segments can be recycled
     * and ensures that all data access flows through a read_lock.
     *
     * note: no mutexes are involved with this lock
     */
   class read_lock
   {
     public:
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
      friend class object_ref;

      read_lock(seg_alloc_session& s) : _session(s) { _session.retain_read_lock(); }
      read_lock(const seg_alloc_session&) = delete;
      read_lock(seg_alloc_session&&)      = delete;

      read_lock& operator=(const read_lock&) = delete;
      read_lock& operator=(read_lock&)       = delete;
      read_lock& operator=(read_lock&&)      = delete;

      seg_alloc_session& _session;
   };

}  // namespace arbtrie

#include <arbtrie/object_ref.hpp>
