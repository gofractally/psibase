#pragma once
#include <atomic>

namespace arbtrie {
   /**
    *  Any number of threads may modify data so long as they are the
    *  unique owner of that data and the data hasn't already been synced.
    *    - unique owner means node refcount of 1 from root to leaf
    *
    *  However, only one thread may sync data at a time and that thread cannot
    *  sync data while there are any modifications in progress on the segment
    *  that is being synced. 
    *
    *  Fortunately, modify threads need not wait until a sync is finished because
    *  they can choose to "assume" the data has been synced and copy it to their
    *  thread-local alloc segment and then modify it. 
    *       - this assumes nothing in this thread's alloc segment
    *       has been changed by the syncing thread, to maintain this invariant 
    *       any modification must check whether the mod is to an object in
    *       another thread's alloc buffer and copy it to their own session-local
    *       alloc buffer before modifying.
    *
    *  So modify threads only need to "try to modify" in an effort to avoid a memcpy.
    *
    *  Two threads that are both trying to sync need to wait on eachother 
    *  to avoid redundant syncs and they must wait on modify to complete.
    *
    *  On sync
    *     - only sync your own alloc segment
    *         * your thread did not modify data in other alloc segments
    *     - sync all segments in the sync queue,
    *         the sync queue is filled with segments when a session's
    *         alloc segment is filled and there is unsynced data
    *     - the sync lock can be on a per-segment basis, meaning modifications
    *       can occur on other unsynced segments while one segment is syncing.
    */
   struct sync_lock {
      static constexpr const uint64_t sync_mask = make_mask<63, 1>();

      bool try_modify() {
         // this is relaxed because we don't need to acquire any memory
         // from the thread that is doing the syncing nor publish our
         // writes because this is done before we write.
         //
         // TODO: fetch_add is often implimented as C&S on non-intel
         // architectures, in which case we might as well do a
         // C&S here and abort if it fails rather than calling
         // end_modify() to undo the increment.
         auto prior = _state.fetch_add(1, std::memory_order_relaxed);
         if( prior & sync_mask ) 
         {
            end_modify();
            return false;
         }
         return true;
      }
      void end_modify() {
         // after modfying the data we need to make sure the sync thread
         // sees it before flushing to disk.
         auto prior = _state.fetch_sub(1, std::memory_order_release);
         if( prior -1 == sync_mask )
            _state.notify_all();
      }

      void start_sync() {
         _sync_lock.lock();
         // acquire the memory written before end_modify() was called
         auto prior = _state.fetch_or( sync_mask, std::memory_order_acquire);
         prior |= sync_mask;
         while( prior != sync_mask ) {
            TRIEDENT_WARN( "prior: ", prior, " vs sync mask: ", sync_mask );
            _state.wait( prior | sync_mask );
            // this can be relaxed because we already synchronized
            // on the wait()/notify_all() from end_modify()
            prior = _state.load( std::memory_order_relaxed );
         }
      }
      void end_sync() {
         _state.fetch_and( ~sync_mask, std::memory_order_relaxed );
         _sync_lock.unlock();
      }
      sync_lock():_state(0){}

      std::mutex           _sync_lock;
      std::atomic<int64_t> _state;
   };

} // arbtrie
