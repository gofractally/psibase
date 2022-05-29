#include <trie/object_db.hpp>

namespace trie {

   /**
    * Can only be allocated in trie::arena 
    */
   template<typename T>
   class shm_vector {
      public:
         uint64_t size()const;
         void     resize( uint64_t s );
         T&       operator[]( uint64_t p );
      private:
         friend class arena;
         shm_vector( uint64_t size );
         ~shm_vector();

         offset_ptr<T> array;
         uint64_t      size;
         uint64_t      reserve;
   };

   /**
    *  Quickly finds a free object id in log64(N) time using
    *  about 1 bit per object to indicate whether it is free or not.
    */
   class free_tree {
      public:
         // adjusts the maximum number of elements
         void reserve( uint64_t max_slots );
         uint64_t size();
         uint64_t capacity();

         // marks a bit as allocated that wasn't previously
         uint64_t alloc();
         void free( uint64_t pos );

         free_tree* make( uint64_t bits );
      private:
         uint64_t num_objects; // the maximum number of objects
         uint64_t num_free; // the number that are free

         // keeps track of the current location where new
         // free objects are being sourced from, makes finding
         // the next free slot faster.
         std::vector<uint16_t> cursor;

         // free_slot_tree[0][N-N/64] has 1 bit per obj 
         // free slot_tree[1][N-N/64^2] has 1 bit per item in free_slot_tree[0]
         // free slot_tree[2][N-N/64^3] has 1 bit per item in free_slot_tree[1]
         std::vector< std::vector<uint64_t> > free_slot_tree;
   };

   struct object_file {
      uint16_t          object_size;
      uint64_t          num_objects;
      free_tree         free_items;

      std::vector<char> data; /// for now
   };

   struct object_pos {
      uint64_t  size:16;
      int64_t   offset:48; // negative offsets are relative to cache arena,
                           // positive offsets are index into per_size_file
                           // defined by size
   } __attribute__((packed));

   struct object_db_shm {
       free_tree           free_objects[256];
       free_tree           free_object_ids;
       offset_ptr<object>  _least_recently_used[256];// pointer circular double linked list of objects
   };

   struct object_db_impl {
       std::vector<FILE*>        per_size_files;
       mapped_vector<uint8_t>    ref_counts;
       mapped_vector<object_pos> object_positions;
   };


   char* object_db::alloc( uint32_t size ) {
      auto new_obj_id = _shm.free_object_ids.next();
      auto p = new (_arena.allocate( sizeof(object) + size )) object( new_obj_id, size );

      if( not p ) /// cache must be full... 
         //free_cache();

      append_to_most_recenlty_used( p );
      move_page_to_most_recently_used_page();

      offset = p - arena.data_start();
      ref_counts[new_obj_id] = 1;
      object_positions[new_obj_id] = { size, -offset };

      return p;
   }

   void free_cache() {
      // get object from lru list for obj size
      //   if there are no pages reserved for objects of this size and there
      //   are no free pages... then free from LRU list until a full page becomes
      //   available (this could take a while if objects are scattered)
      //   pick least recently used page and purge all objects on it to disk
      //        * this would require grabbing the write lock incase readers are
      //        accessing objects on the page we grab.
      //
      //
      // find next free slot in free_objects[o.size]
      // write object to that spot in file
      // update object_positions[obj_id] = {size, free_slot_in_file}
      // - this could be a while if the LRU objects are scattered around pages
           // - perhaps
   }
}
