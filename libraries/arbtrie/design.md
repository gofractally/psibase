
ObjectId {
   Size:16  - specifies the disk file (or the mmap cache)
   Index:48  - specifies the offset in the file  
}

ObjectLoc[ObjectId]


Main Thread:
   on deref ObjectId
     if( ObjectLoc[id].size == Cache ) { /// no particular atomic operations required
        auto obj = cache.base + ObjectLoc[id].loc
        update object LRU linked list
        update object.page LRU linked list
        return pointer to object
     }
     else {
        auto ptr = arena.alloc(objsize)
        if( not ptr ) {
           if( not page_out( LRU( objsize ) ) )
              page_out_LRU_page();
           ptr = arena.alloc(objsize)
        }

        obj = new (ptr) object;
        file_for_size(obj.size) - pread( pos, size );
        
        atomic set ObjectLoc[id] to {Cache,offset} using memory order release
        return pointer to object
     }

   on page_out( objsize ) {
      get LRU object
      get free location in file_for_size(obj.size)
      pwrite to file
      atomic set ObjectLoc[id] to {File,offset} using memory order release
   }


   - at the very least a sub allocator for pages that are only for objects is required
   - arena must only contain objects, no other types can be alloced in cache arena
   on page_out_page() {
      for each object on page
         page_out( obj );
         free(obj)... the last object out the door frees the page
   }

Read Threads:

   on readObject( objid, buffer ) {
      objpos = ObjectLoc[objid].read( memory_order_acquire );
      do {
         if( cache ) {
            memcpy( buff, arena.base + objpos.indx )
         } else {
            pread( ... )
         }
      } while( objpos != ObjectLoc[objid].read( memory_order_acquire ) );

   }
   
Free Heaps
   "Slow Solution - Cache Unfriendly"
   Maintain a pointer to the last free item
   Store a pointer to the item freed before that in that items location

   on alloc read the last freed item location to get the next freed item location
   write object to the last freed item location.

   "Fast Solution"
   Maintain a minheap of all free locations and always write to the lowest
   freed item. This will keep the file contents clustered by LRU 

Pinned Cache:
    Fixed Amount of Ram
    


