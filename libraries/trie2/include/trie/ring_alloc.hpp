#pragma once
#include <boost/interprocess/offset_ptr.hpp>
#include <chrono>
#include <optional>
#include <thread>
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

      struct swap_position
      {
         swap_position() {}
         uint64_t _swap_pos[4] = {-1ull, -1ull, -1ull, -1ull};
      };

      swap_position get_swap_pos() const;

      ring_allocator(std::filesystem::path dir, access_mode mode, config cfg);

      std::pair<id, char*> alloc(size_t num_bytes);
      void                 retain(id);
      void                 release(id);

      void swap();

      // grows the free area after swap is complete,
      // must synchronize with reader threads, only has work to do
      // if swap has made progress.
      void claim_free(swap_position sp = swap_position());

      //  pointer is valid until GC runs
      char* get(id i);
      template <bool CopyToHot = true>
      char* get_cache(id);  // do not move to hot cache
      char* get_cache(id i, std::vector<char>& tmp);

      uint32_t                   ref(id i) const { return _obj_ids->ref(i); }
      std::pair<uint16_t, char*> get_ref(id i) { return {ref(i), get(i)}; }
      std::pair<uint16_t, char*> get_ref_no_cache(id i);

      enum cache_level_type
      {
         hot_cache  = 0,  // pinned, zero copy access (ram) 50% of RAM
         warm_cache = 1,  // pinned, copy to hot on access (ram) 25% of RAM
         cool_cache = 2,  // not pinned, copy to hot on access (disk cache)  25% of RAM
         cold_cache = 3   // not pinned, copy to hot on access (uncached) AS NEEDED DISK
      };

      void dump();

      std::function<void()> _try_claim_free;
      ~ring_allocator()
      {
         _done.store(true);
         _swap_thread->join();
      }

     private:
      template <bool CopyData = false, bool RequireObjLoc=true>
      char* alloc(managed_ring& ring, id nid, uint32_t num_bytes, char* data = nullptr);

      inline managed_ring&          hot() const { return *_levels[hot_cache]; }
      inline managed_ring&          warm() const { return *_levels[warm_cache]; }
      inline managed_ring&          cool() const { return *_levels[cool_cache]; }
      inline managed_ring&          cold() const { return *_levels[cold_cache]; }
      std::unique_ptr<object_db>    _obj_ids;
      std::unique_ptr<managed_ring> _levels[4];
      std::unique_ptr<std::thread>  _swap_thread;
      std::atomic<bool>             _done = false;

      void swap_loop()
      {
         while (not _done.load(std::memory_order_relaxed))
         {
            swap();
            using namespace std::chrono_literals;
            std::this_thread::sleep_for(1ms);
         }
      }
   };

   struct object_header
   {
      // size may not be a multiple of 8, next object is at data() + (size+7)&-8
      uint64_t size : 24;  // bytes of data, not including header
      uint64_t id : 40;

      inline bool     is_free_area() const { return id == 0; }
      inline uint64_t free_area_size() const { return id; }
      inline uint64_t data_size() const { return size; }
      inline uint32_t data_capacity() const { return (size + 7) & -8; }
      inline char*    data() const { return (char*)(this + 1); }
      inline void     set_free_area_size(uint64_t s)
      {
         size = s, id = 0;
         assert(s == size);
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

         void validate()
         {
            assert(alloc_p <= end_free_p);
            assert(swap_p <= alloc_p);
            assert(alloc_area_size >= get_free_space());
            //assert(alloc_area_size >= swap_p - end_free_p);
         }

         uint64_t                       size;              // file size, max we can move end to
         int64_t                        total_free_bytes;  // used to track % free
         int64_t                        total_alloc_bytes;
         int64_t                        total_swapped_bytes;
         int64_t                        cache_hits = 0;
         bip::offset_ptr<object_header> begin;  // the first obj
         bip::offset_ptr<object_header> end;    // the high water before circle

         // the main thread moves this forward as it consumes free space
         // points at a free area
         //bip::offset_ptr<object_header> alloc_cursor;

         // the swap thread moves this forward as it copies objects to lower levels,
         // points to the next object to be moved to swap or the end of the future
         // free area
         //bip::offset_ptr<object_header> swap_cursor;
         //bip::offset_ptr<object_header> end_free_cursor;

         /// these positions only ever increment
         std::atomic<uint64_t> alloc_p;
         std::atomic<uint64_t> swap_p;  // this could be read by multiple threads
         std::atomic<uint64_t> end_free_p;
         uint64_t              alloc_area_size;

         object_header* get_alloc_pos() const
         {
            return reinterpret_cast<object_header*>((char*)begin.get() + alloc_p.load( std::memory_order_relaxed) % alloc_area_size);
         }
         object_header* get_swap_pos() const
         {
            return reinterpret_cast<object_header*>(
                (char*)begin.get() + swap_p.load(std::memory_order_relaxed) % alloc_area_size);
         }
         object_header* get_end_free_pos() const
         {
            return begin.get() + end_free_p % alloc_area_size;
         }
         object_header* get_end_pos() const { return end.get(); }
         uint64_t       get_free_space() const { return end_free_p.load( std::memory_order_relaxed) - alloc_p.load( std::memory_order_relaxed); }
         uint64_t       get_potential_free_space() const { return swap_p.load( std::memory_order_relaxed) + alloc_area_size - alloc_p.load( std::memory_order_relaxed); }
         uint64_t       max_contigous_alloc() const
         {
            auto ap =  alloc_p.load();
            auto ep = end_free_p.load();
            auto free_space = ep - ap;
            auto wraped = (ap + free_space) % alloc_area_size;
            if( (ap % alloc_area_size) > wraped ) {
               return free_space - wraped;
            }
            return free_space;

            /*
            if( alloc_p.load(std::memory_order_relaxed) == end_free_p.load( std::memory_order_relaxed ) )
               return 0;

            auto fp = (char*)get_end_free_pos();
            auto ep = (char*)get_end_pos();
            //      auto bp = (char*)get_begin_pos();
            auto ap = (char*)get_alloc_pos();

            if (fp <= ap)
               return ep - ap;  // + fp - bp;
            else
               return fp - ap;
               */

            // potential cursor positions
            //  [B           A     F  S    E]      F - A
            //  [B    S      A     F       E]      F - A
            //  [B  F  S     A             E]      E - A + F - B
            //  return (char*)get_end_pos() - get_alloc_pos();
         }

         /*
         inline uint64_t free_space() const;
         inline char*    file_begin_pos() const { return (char*)this; }
         inline char*    end_pos() const { return (char*)end.get(); }
         inline uint32_t capacity() const { return ((size-sizeof(header)) + 7) & -8; }
         */

         inline void update_size(uint64_t new_size);
         header(uint64_t size);
      };

      managed_ring(std::filesystem::path            filename,
                   uint64_t                         max_size,
                   ring_allocator::cache_level_type lev,
                   bool                             pin = false);

      inline auto     get_free_space() const { return _head->get_free_space(); }
      inline auto*    get_alloc_cursor() { return _head->get_alloc_pos(); }
      inline auto*    get_swap_cursor() { return _head->get_swap_pos(); }
      inline uint64_t max_contigous_alloc() const { return _head->max_contigous_alloc(); }
      /*
      inline auto&   swap_cursor() { return _head->swap_cursor; }
      inline auto&   end_free_cursor() { return _head->end_free; }
      inline char*   end_pos() const { return (char*)_head->end.get(); }
      */
      inline char*   begin_pos() const { return (char*)_head->begin.get(); }
      object_header* get_object(uint64_t offset)
      {
         ++_head->cache_hits;  // TODO: remove from release
         return reinterpret_cast<object_header*>(begin_pos() + offset);
      }

      ring_allocator::cache_level_type level;

      FILE*                               _cfile = nullptr;
      int                                 _cfileno;
      header*                             _head;
      object_header*                      _begin;
      object_header*                      _end;
      std::unique_ptr<bip::file_mapping>  _file_map;
      std::unique_ptr<bip::mapped_region> _map_region;
   };

   inline ring_allocator::swap_position ring_allocator::get_swap_pos() const
   {
      swap_position r;
      r._swap_pos[0] = hot()._head->swap_p;
      r._swap_pos[1] = warm()._head->swap_p;
      r._swap_pos[2] = cool()._head->swap_p;
      r._swap_pos[3] = cold()._head->swap_p;
      return r;
   }

   inline char* ring_allocator::get_cache(id i, std::vector<char>& tmp)
   {
      auto cur_size = tmp.size();
      auto loc      = _obj_ids->get(i);
      auto old_loc  = loc;
      do
      {
         auto obj = _levels[loc.cache]->get_object(loc.offset);
         tmp.resize(cur_size + obj->size + 8);
         memcpy(tmp.data() + cur_size, obj, obj->size + 8);
         old_loc = loc;
         loc     = _obj_ids->get(i);
      } while (loc != old_loc);
      return tmp.data() + cur_size + 8;
   }

   //  pointer is valid until claim_free runs, reads can read it then check to see if
   //  the gc moved past char* while reading then read again at new location
   template <bool CopyToHot>
   char* ring_allocator::get_cache(id i)
   {
      auto loc = _obj_ids->get(i);

      if (loc.cache == hot_cache)
         return hot().get_object(loc.offset)->data();

      /*
      if( loc.cache == cool_cache ) {
          auto& ring = _levels[loc.cache];
          if( ring->_cfile ) {
             char temp_buffer[512];
             object_header* ob = reinterpret_cast<object_header*>(temp_buffer);;
             // TODO: this could fail at EOF?
             auto re = pread( ring->_cfileno,  temp_buffer, sizeof(temp_buffer), loc.offset + ((sizeof(managed_ring::header)+7)&-8) );
           //  assert( re == sizeof(ob) );

          //   assert( obj->id == ob.id );
          //   assert( obj->size == ob.size );

             char* ptr = alloc<false>(hot(), id{ob->id}, ob->size);

             if( ob->size < sizeof(temp_buffer)-8 ) {
                memcpy( ptr, temp_buffer+8, ob->size );
                return ptr;
             } else {
                re = pread( _levels[loc.cache]->_cfileno,  ptr, ob->size, 8+loc.offset + ((sizeof(managed_ring::header)+7)&-8) );
                assert( re == ob->size );
             return ptr;
             }
          }
      }
      */
      auto obj = _levels[loc.cache]->get_object(loc.offset);

      /// TODO: if size > X do not copy to hot, copy instead to warm

      if constexpr (CopyToHot)
      {
         if (obj->size > 4096)
            return obj->data();
         return alloc<true,true>(hot(), id{obj->id}, obj->size, obj->data());
      }
      else
      {
         return obj->data();
      }
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
