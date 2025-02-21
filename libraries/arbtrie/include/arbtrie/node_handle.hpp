#pragma once
#include <arbtrie/debug.hpp>
#include <arbtrie/node_meta.hpp>

namespace arbtrie
{
   class database;
   class read_session;
   class write_session;

   /**
   * Responsible for maintaining reference count for id and
   * releasing it. 'node_handle', like std::shared_ptr, is
   * not thread safe when being copied or modified. 
   *
   * A node handle should not outlive the session passed to
   * its constructor unless the internal address is taken or
   * its contents moved. If the handle still has a valid address
   * on destruction, it will attempt to release the address by
   * calling into the session's release_id() method.
   * 
   * TODO: should release just push it into a queue for the
   * compactor to pick up, that way we avoid any potential issues
   * with the handle being copied or moved to another thread.
   */
   class node_handle
   {
     private:
      friend class read_session;
      friend class write_session;

     public:
      node_handle(read_session& s) : _session(&s) {}
      node_handle(read_session& s, id_address retains) : _session(&s), _id(retains) { retain(); }

      ~node_handle() { release(); }

      node_handle(node_handle&& mv) : _id(mv._id), _session(mv._session) { mv._id = {}; }

      node_handle(const node_handle& cp) : _id(cp._id), _session(cp._session) { retain(); }

      node_handle& operator=(const node_handle& other)
      {
         if (this == &other)
            return *this;
         release();
         _id = other._id;
         retain();
         return *this;
      }

      node_handle& operator=(node_handle&& other)
      {
         if (this == &other)
            return *this;
         return give(other.take());
      }

      id_address address() const { return _id; }
      int        ref() const;
      bool       is_valid() const { return _id != id_address(); }

      /** The caller takes responsibility for releasing the id
         * that is returned.
         */
      id_address take()
      {
         auto tmp = _id;
         _id      = id_address();
         return tmp;
      }

      /**
         * Give this handle the responsiblity of releasing the given_id
         */
      node_handle& give(id_address given_id)
      {
         if (given_id == _id)
            return *this;
         release();
         _id = given_id;
         return *this;
      }

      void reset() { release(); }

     private:
      void release();
      void retain();

      id_address    _id;
      read_session* _session;
   };

}  // namespace arbtrie
