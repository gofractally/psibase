#pragma once
#include <arbtrie/debug.hpp>
#include <arbtrie/node_meta.hpp>

namespace arbtrie
{
   class database;
   class root;
   class read_session;
   class write_session;
   using root_ptr = std::shared_ptr<root>;



  /**
   * Responsible for maintaining reference count for id and
   * releasing it.
   */
  class node_handle {
     private:
        friend class read_session;
        friend class write_session;
        node_handle( read_session& s ):_session(&s){}
        node_handle( read_session& s, object_id retains ):_session(&s),_id(retains){
           retain();
        }

     public:
        ~node_handle() {
           release();
        }

        node_handle( node_handle&& mv )
        :_id(mv._id),_session(mv._session) { mv._id = {}; }

        node_handle( const node_handle& cp)
        :_id(cp._id),_session(cp._session) { 
          retain();   
        }

        node_handle& operator=(const node_handle& other ) {
           if( this == &other ) return *this;
           release();
           _id = other._id;
           retain();
           return *this;
        }

        node_handle& operator=(node_handle&& other ) {
           if( this == &other ) return *this;
           return give( other.take() );
        }

        object_id id()const{ return _id; }
        int ref()const;

        /** The caller takes responsibility for releasing the id
         * that is returned.
         */
        object_id take() { 
           auto tmp = _id;
           _id = {};//.id = 0;
           return tmp;
        }

        /**
         * Give this handle the responsiblity of releasing the given_id
         */
        node_handle& give( object_id given_id ) {
           release();
           _id = given_id;
           return *this;
        }


     private:
        void release();
        void retain();

        object_id     _id;
        read_session* _session;

  };







   class root_data
   {
      friend class root;

     private:
      // If db == nullptr, then the other fields don't matter. There are 3
      // ways to represent an empty tree:
      //    shared_ptr<root>  == nullptr ||     // Default-initialized shared_ptr
      //    root::db          == nullptr ||     // Moved-from or default-initialized root
      //    root::id          == {}             // Result of removing from an almost-empty tree
      //
      // If ancestor == nullptr, then id (if not 0) has a refcount on it which will be
      // decremented within ~root(). If this fails to happen (SIGKILL), then the refcount
      // will leak; mermaid can clean this up. If id is referenced within a leaf, or there
      // are any other root instances pointing at it, then its refcount will be greater
      // than 1, preventing its node from being dropped or edited in place. If
      // shared_ptr<root>::use_count is greater than 1, then it also won't be dropped or
      // edited in place. This limits edit-in-place to nodes which aren't reachable by
      // other threads.
      //
      // If ancestor != nullptr, then id doesn't have a refcount on it. ancestor
      // keeps ancestor's id alive. ancestor's id keeps this id alive. If ancestor is
      // held anywhere else, then either its shared_ptr::use_count or its storage
      // refcount will be greater than 1, preventing it from being dropped or edited
      // in place, which in turn keeps this id and the node it references safe.

      read_session*              session = nullptr;
      std::shared_ptr<root_data> ancestor;
      object_id                  id;


     public:
      root_data(read_session* ses, std::shared_ptr<root_data> ancestor = {}, object_id id = {});
      /*
          : session(ses), ancestor(std::move(ancestor)), id(id)
      {
         if constexpr (debug_roots)
            std::cout << id.id << ": root(): ancestor=" << (ancestor ? ancestor->id.id : 0)
                      << std::endl;
      }
      */


      root_data(const root_data&) = delete;
      root_data(root_data&&)      = default;
      ~root_data();

      root_data& operator=(const root_data&) = delete;
      root_data& operator=(root_data&&)      = default;
   };  // root_data

   class root
   {
     public:
      friend class read_session;
      friend class write_session;
      bool is_unique() const;
      object_id id()const { return _data->id; }
      int references() const { return _data.use_count(); }

      root(root&& mv)      = default;
      root(const root& cp) = default;
      ~root() = default;

      root& operator = ( root&& r ) = default;
      root& operator = ( const root& r ) = default;
     private:
      root(read_session& rs) { _data = std::make_shared<root_data>(&rs, nullptr, object_id()); }
      root(read_session& rs, object_id id)
      {
         _data = std::make_shared<root_data>(&rs, nullptr, id);
      }

      friend class database;

      void set_id(object_id rid);

      std::shared_ptr<root_data> _data;
   };

}  // namespace arbtrie
