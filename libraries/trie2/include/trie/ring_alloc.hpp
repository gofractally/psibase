#pragma once
#include <boost/interprocess/offset_ptr.hpp>
#include <optional>
#include <trie/object_db.hpp>

namespace trie
{
   using object_id = object_db::object_id;

   struct managed_ring;

   class ring_allocator
   {
     public:
      using id = object_id;

      enum access_mode
      {
         read_only  = 0,
         read_write = 1
      };

      struct config
      {
         uint64_t max_ids    = 100 * 1000 * 1000ull;
         uint64_t hot_pages  = 1000 * 1000ull;
         uint64_t warm_pages = 1000 * 1000ull;
         uint64_t cool_pages = 1000 * 1000ull;
         uint64_t cold_pages = 1000 * 1000ull;
      };

      ring_allocator(std::filesystem::path dir, access_mode mode, config cfg);

      std::pair<id, char*> alloc(size_t num_bytes);
      void                 retain(id);
      void                 release(id);

      void swap();

      // grows the free area after swap is complete,
      // must synchronize with reader threads, only has work to do
      // if swap has made progress.
      void claim_free();

      //  pointer is valid until GC runs
      char*                      get(id);
      uint32_t                   ref(id i) const { return _obj_ids->ref(i); }
      std::pair<uint16_t, char*> get_ref(id i) { return {ref(i), get(i)}; }

      enum cache_level_type
      {
         hot_cache  = 0,  // pinned, zero copy access (ram) 50% of RAM
         warm_cache = 1,  // pinned, copy to hot on access (ram) 25% of RAM
         cool_cache = 2,  // not pinned, copy to hot on access (disk cache)  25% of RAM
         cold_cache = 3   // not pinned, copy to hot on access (uncached) AS NEEDED DISK
      };

      void dump();

     private:
      template <bool CopyData = false>
      char* alloc(managed_ring& ring, id nid, uint32_t num_bytes, char* data = nullptr);

      inline managed_ring&          hot() { return *_levels[hot_cache]; }
      inline managed_ring&          warm() { return *_levels[warm_cache]; }
      inline managed_ring&          cool() { return *_levels[cool_cache]; }
      inline managed_ring&          cold() { return *_levels[cold_cache]; }
      std::unique_ptr<object_db>    _obj_ids;
      std::unique_ptr<managed_ring> _levels[4];
   };

   struct object_header
   {
      // size may not be a multiple of 8, next object is at data() + (size+7)&-8
      uint64_t size : 24;  // bytes of data, not including header
      uint64_t id : 40;

      inline bool     is_free_area() const { return size == 0; }
      inline uint64_t free_area_size() const { return id; }
      inline uint64_t data_size() const { return size; }
      inline uint32_t data_capacity() const { return (size + 7) & -8; }
      inline char*    data() const { return (char*)(this + 1); }
      inline void     set_free_area_size(uint64_t s)
      {
         size = 0, id = s;
         assert(s != 0);
      }
      inline void set(object_id i, uint32_t numb) { size = numb, id = i.id; }

      // assuming size is 0, and therefore this is a "free area", id
      // holds the size of the free area starting at this. Returns the
      // first object after the free area.
      object_header* end_free() const
      {
         assert(size == 0);
         return reinterpret_cast<object_header*>(((char*)this) + id);
      }
      // assuming obj header holds an obj, returns the next spot that may hold an obj
      object_header* next() const { return (object_header*)(data() + data_capacity()); }
   } __attribute__((packed)) __attribute__((aligned(1)));
   static_assert(sizeof(object_header) == 8, "unexpected padding");

   // wraps the file and handles resizing
   struct managed_ring
   {
      void dump(object_db&);

      // the object stored in memory
      struct header
      {
         // TODO pad these variables to eliminate
         // false sharing when using multiple threads

         uint64_t                       size;              // file size, max we can move end to
         int64_t                        total_free_bytes;  // used to track % free
         int64_t                        total_alloc_bytes;
         bip::offset_ptr<object_header> begin;  // the first obj
         bip::offset_ptr<object_header> end;    // the high water before circle

         // the main thread moves this forward as it consumes free space
         // points at a free area
         bip::offset_ptr<object_header> alloc_cursor;

         // the swap thread moves this forward as it copies objects to lower levels,
         // points to the next object to be moved to swap or the end of the future
         // free area
         bip::offset_ptr<object_header> swap_cursor;

         inline uint64_t free_space() const;
         inline void     update_size(uint64_t new_size);
         inline char*    file_begin_pos() const { return (char*)this; }
         inline char*    end_pos() const { return (char*)end.get(); }
         inline uint32_t capacity() const { return (size + 7) & -8; }

         header(uint64_t size);
      };

      managed_ring(std::filesystem::path            filename,
                   uint64_t                         max_size,
                   ring_allocator::cache_level_type lev,
                   bool                             pin = false);

      inline auto    free_space() const { return _head->free_space(); }
      inline auto&   alloc_cursor() { return _head->alloc_cursor; }
      inline auto&   swap_cursor() { return _head->swap_cursor; }
      inline char*   begin_pos() const { return (char*)_head->begin.get(); }
      inline char*   end_pos() const { return (char*)_head->end.get(); }
      object_header* get_object(uint64_t offset)
      {
         return reinterpret_cast<object_header*>(begin_pos() + offset);
      }

      ring_allocator::cache_level_type level;

      header*                             _head;
      object_header*                      _begin;
      object_header*                      _end;
      std::unique_ptr<bip::file_mapping>  _file_map;
      std::unique_ptr<bip::mapped_region> _map_region;
   };
   inline uint64_t managed_ring::header::free_space() const
   {
      auto ac = alloc_cursor.get();
      auto bc = begin.get();
      auto ec = end.get();

      if (ac == bc)
         return ac->id;

      if (((char*)ac + ac->id) == (char*)ec)
         return ac->id + (bc->size == 0 ? bc->id : 0);

      return ac->id;
   }

}  // namespace trie

/*

   on alloc(size)
     attempt to write to the current pos, if enough space.
     while not enough space then look at size of next object
     find the LRU object of that size and copy it to disk update loc idx
     copy the next object to the freed location and update loc idx


   LRU objects get swapped to disk and alloc cost is either:
         1. free or
         2. proportional to 2x memcpy of the size being allocated
         3. 3-4

*/
