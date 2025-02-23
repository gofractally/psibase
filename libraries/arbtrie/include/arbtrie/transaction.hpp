#pragma once
#include <arbtrie/iterator.hpp>
#include <functional>

namespace arbtrie
{

   using read_transaction = iterator<iterator_caching_mode::noncaching>;

   /**
    * A write transaction is a mutable iterator that knows how
    * to commit and abort the node_handle that it manages. 
    */
   class write_transaction : public mutable_iterator<caching>
   {
     private:
      friend class write_session;

      write_transaction(write_session&                   ws,
                        node_handle                      r,
                        std::function<void(node_handle)> commit_callback,
                        std::function<void()>            abort_callback = {})
          : mutable_iterator<caching>(ws, std::move(r))
      {
         assert(commit_callback);
         _abort_callback  = abort_callback;
         _commit_callback = commit_callback;
      }

     public:
      ~write_transaction()
      {
         if (_abort_callback)
            _abort_callback();
      }

      /**
       * Aborts the transaction and returns the node_handle
       * containing the transaction's state, which will be
       * deleted if not utilized by the caller. Can only
       * be called once.
       * 
       * @return the node_handle containing the transaction's state
       */
      node_handle abort()
      {
         if (_abort_callback)
         {
            _abort_callback();
            _abort_callback = std::function<void()>();
         }
         return std::move(_root);
      }

      /** commits the changes back to the source of the
       * transaction, but can only be called once.
       */
      void commit()
      {
         assert(_commit_callback);
         _commit_callback(std::move(_root));
         _commit_callback = {};
      }

      using mutable_iterator<caching>::get_root;
      using mutable_iterator<caching>::set_root;
      /**
       * Starts a new sub-transaction based upon the state of this
       * transaction that commits to this transaction when it is
       * done.  Any modifications to this transaction after the
       * creation of the sub-transaction will be lost if the
       * sub-transaction is committed. 
       */
      write_transaction start_transaction()
      {
         return write_transaction(*_ws, get_root(),
                                  [this](node_handle commit) { set_root(std::move(commit)); });
      }

     private:
      write_session*                   _ws;
      std::function<void()>            _abort_callback;
      std::function<void(node_handle)> _commit_callback;
   };
}  // namespace arbtrie
