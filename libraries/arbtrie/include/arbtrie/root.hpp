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
        node_handle( read_session& s, fast_meta_address retains ):_session(&s),_id(retains){
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

        fast_meta_address address()const{ return _id; }
        int ref()const;

        /** The caller takes responsibility for releasing the id
         * that is returned.
         */
        fast_meta_address take() { 
           auto tmp = _id;
           _id = {};//.id = 0;
           return tmp;
        }

        /**
         * Give this handle the responsiblity of releasing the given_id
         */
        node_handle& give( fast_meta_address given_id ) {
           release();
           _id = given_id;
           return *this;
        }


     private:
        void release();
        void retain();

        fast_meta_address _id;
        read_session* _session;

  };



}  // namespace arbtrie
