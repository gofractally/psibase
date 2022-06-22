#pragma once
#include <boost/interprocess/offset_ptr.hpp>
#include <chrono>
#include <functional>
#include <optional>
#include <thread>
#include <triedent/object_db.hpp>

namespace triedent
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
      using object_type = object_location::object_type;

      swap_position get_swap_pos() const;

      ring_allocator(std::filesystem::path dir, access_mode mode);
      static void create(std::filesystem::path dir, config cfg);

      std::pair<location_lock, char*> alloc(size_t num_bytes, object_location::object_type);

      location_lock spin_lock(object_id id) { return _obj_ids->spin_lock(id); }

      void retain(id);

      // return a pointer to the obj and its type if released
      std::pair<char*, object_location::object_type> release(id);

      bool        swap();
      inline void ensure_free_space();

      // grows the free area after swap is complete,
      // must synchronize with reader threads, only has work to do
      // if swap has made progress.
      void claim_free(swap_position sp = swap_position());

      //  pointer is valid until GC runs
      template <bool CopyToHot = true>
      std::pair<char*, object_type> get_cache_with_type(id);

      uint32_t ref(id i) const { return _obj_ids->ref(i); }

      enum cache_level_type
      {
         hot_cache  = 0,  // pinned, zero copy access (ram) 50% of RAM
         warm_cache = 1,  // pinned, copy to hot on access (ram) 25% of RAM
         cool_cache = 2,  // not pinned, copy to hot on access (disk cache)  25% of RAM
         cold_cache = 3   // not pinned, copy to hot on access (uncached) AS NEEDED DISK
      };

      void dump(bool detail = false);

      std::function<void()> _try_claim_free;
      ~ring_allocator()
      {
         _done.store(true);
         _swap_thread->join();
      }

      /**
       * Sets all non-zero refs to c
       */
      void reset_all_ref_counts(uint16_t c) { _obj_ids->reset_all_ref_counts(c); }
      void adjust_all_ref_counts(int16_t c) { _obj_ids->adjust_all_ref_counts(c); }

      void validate();
      void validate(id i) { _obj_ids->validate(i); }

     private:
      uint64_t wait_on_free_space(managed_ring& ring, uint64_t used_size);
      char*    alloc(managed_ring&        ring,
                     const location_lock& lock,
                     uint32_t             num_bytes,
                     char*                src = nullptr);

      inline managed_ring&          hot() const { return *_levels[hot_cache]; }
      inline managed_ring&          warm() const { return *_levels[warm_cache]; }
      inline managed_ring&          cool() const { return *_levels[cool_cache]; }
      inline managed_ring&          cold() const { return *_levels[cold_cache]; }
      std::unique_ptr<object_db>    _obj_ids;
      std::unique_ptr<managed_ring> _levels[4];
      std::unique_ptr<std::thread>  _swap_thread;
      std::atomic<bool>             _swapped;
      std::atomic<bool>             _done = false;

      std::atomic<bool> _debug = false;
      void              swap_loop()
      {
         while (not _done.load())
         {
            bool did_work = swap();
            using namespace std::chrono_literals;
            if (not did_work)
            {
               std::this_thread::sleep_for(10us);
            }
         }
         WARN("EXIT SWAP LOOP");
      }
   };

   using object_header = triedent::object_header;

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
            if (not(alloc_p <= end_free_p))
               throw std::runtime_error("alloc pointer should be behind end free");
            if (not(swap_p <= alloc_p))
               throw std::runtime_error("swap pointer should be behind alloc pointer");
            if (not(alloc_area_size >= get_free_space()))
               throw std::runtime_error("free space is larger than memory area");
         }

         uint64_t                       size;  // file size, max we can move end to
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
         alignas(64) std::atomic<uint64_t> alloc_p;
         alignas(64) std::atomic<uint64_t> swap_p;  // this could be read by multiple threads
         alignas(64) std::atomic<uint64_t> end_free_p;
         uint64_t alloc_area_mask;
         uint64_t alloc_area_size;

         object_header* get_alloc_pos() const
         {
            return reinterpret_cast<object_header*>(  //
                (char*)begin.get() + (alloc_p.load() & alloc_area_mask));
         }
         object_header* get_swap_pos() const
         {
            return reinterpret_cast<object_header*>(  //
                (char*)begin.get() + (swap_p.load() & alloc_area_mask));
         }
         object_header* get_end_free_pos() const
         {
            return begin.get() + (end_free_p & alloc_area_mask);
         }
         inline object_header* get_end_pos() const { return end.get(); }
         inline uint64_t       get_free_space() const { return end_free_p.load() - alloc_p.load(); }
         inline uint64_t       get_potential_free_space() const
         {
            return swap_p.load() + alloc_area_size - alloc_p.load();
         }
         uint64_t max_contigous_alloc() const
         {
            auto ap         = alloc_p.load();
            auto ep         = end_free_p.load();
            auto free_space = ep - ap;
            auto wraped     = (ap + free_space) & alloc_area_mask;
            if ((ap & alloc_area_mask) > wraped)
            {
               return free_space - wraped;
            }
            return free_space;
         }

         inline void update_size(uint64_t new_size);
         header(uint64_t size);
      };

      managed_ring(std::filesystem::path            filename,
                   ring_allocator::cache_level_type level,
                   bool                             pin = false);

      static void create(std::filesystem::path filename, uint8_t logsize);

      inline auto     get_free_space() const { return _head->get_free_space(); }
      inline auto*    get_alloc_cursor() { return _head->get_alloc_pos(); }
      inline auto*    get_swap_cursor() { return _head->get_swap_pos(); }
      inline uint64_t max_contigous_alloc() const { return _head->max_contigous_alloc(); }
      /*
      inline auto&   swap_cursor() { return _head->swap_cursor; }
      inline auto&   end_free_cursor() { return _head->end_free; }
      inline char*   end_pos() const { return (char*)_head->end.get(); }
      */
      inline char*   begin_pos() const { return (char*)_begin; }  //_head->begin.get(); }
      object_header* get_object(uint64_t offset)
      {
         // TODO: UB since this isn't atomic and there are multiple reader threads
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
      r._swap_pos[0] = hot()._head->swap_p.load();
      r._swap_pos[1] = warm()._head->swap_p.load();
      r._swap_pos[2] = cool()._head->swap_p.load();
      r._swap_pos[3] = cold()._head->swap_p.load();
      return r;
   }

   inline void ring_allocator::ensure_free_space()
   {
      if (hot()._head->get_free_space() < 16 * 1024 * 1024)
      {
         _try_claim_free();
         while (hot()._head->get_free_space() < 16 * 1024 * 1024)
            _try_claim_free();
      }
   }

   //  pointer is valid until claim_free runs, reads can read it then check to see if
   //  the gc moved past char* while reading then read again at new location

   template <bool CopyToHot>
   std::pair<char*, ring_allocator::object_type> ring_allocator::get_cache_with_type(id i)
   {
      auto loc = _obj_ids->get(i);
      auto obj = _levels[loc.cache]->get_object(loc.offset);

      if constexpr (not CopyToHot)
         return {obj->data(), object_type(loc.type)};

      if (loc.cache == hot_cache)
         return {obj->data(), object_type(loc.type)};

      if (obj->size > 4096)
         return {obj->data(), (object_type)loc.type};

      return {alloc(hot(), _obj_ids->spin_lock({.id = obj->id}), obj->size, obj->data()),
              (object_type)loc.type};
   }

   inline uint64_t ring_allocator::wait_on_free_space(managed_ring& ring, uint64_t used_size)
   {
      WARN("wait on free space");

      uint64_t max_contig = 0;
      while ((ring._head->get_potential_free_space()) < used_size)
      {
         WARN("WAITING ON FREE SPACE: level: ", ring.level);
         using namespace std::chrono_literals;
         std::this_thread::sleep_for(10us);
         _try_claim_free();
         if (ring.level == 3)
         {
            dump();
            throw std::runtime_error("database is out of space");
         }
      }
      max_contig = ring.max_contigous_alloc();

      if (max_contig < used_size)
      {
         while ((ring._head->get_potential_free_space()) > used_size)
         {
            _try_claim_free();
            if (ring.get_free_space() < used_size)
            {
               // there is potential free space, but a reader is blocking us?
               WARN("what happened here?!!  level: ", ring.level,
                    "  ef: ", ring._head->end_free_p.load(), "  ap: ", ring._head->alloc_p.load(),
                    "  used_size: ", used_size, " max c: ", max_contig,
                    " delta: ", ring._head->end_free_p.load() - ring._head->alloc_p.load(),
                    " swap p: ", ring._head->swap_p.load(),
                    " pot fre: ", ring._head->get_potential_free_space(),
                    " free: ", ring._head->get_free_space());
               dump();

               using namespace std::chrono_literals;
               std::this_thread::sleep_for(100us);
            }
            max_contig = ring.max_contigous_alloc();

            if (max_contig >= used_size)
               break;

            if (max_contig > 0)
            {
               auto* cur = ring.get_alloc_cursor();
               cur->set_free_area_size(max_contig);
               ring._head->alloc_p += max_contig;
               max_contig = ring.max_contigous_alloc();
            }
         }
      }
      return max_contig;
   }

   //=================================
   //   alloc
   //=================================
   inline char* ring_allocator::alloc(managed_ring&        ring,
                                      const location_lock& lock,
                                      uint32_t             num_bytes,
                                      char*                data)
   {
      uint32_t round_size = (num_bytes + 7) & -8;  // data padding
      uint64_t used_size  = round_size + sizeof(object_header);

      auto max_contig = ring.max_contigous_alloc();

      if (max_contig < used_size) [[unlikely]]
         max_contig = wait_on_free_space(ring, used_size);

      auto* cur = ring.get_alloc_cursor();

      auto& alp = ring._head->alloc_p;
      auto  ap  = alp.load();
      alp.store(ap + used_size);
      cur->set(lock.get_id(), num_bytes);

      if (data)
         memcpy(cur->data(), data, num_bytes);

      _obj_ids->move(lock, ring.level, (char*)cur - ring.begin_pos());
      return cur->data();
   }

   // moves data from higher levels to lower levels
   // can be run in any single thread because it doesn't modify the
   // source and it is the only modifies free areas of lower levels
   inline bool ring_allocator::swap()
   {
      auto do_swap = [this](auto* from, auto* to)
      {
         uint64_t sp             = from->_head->swap_p.load();
         uint64_t ap             = from->_head->alloc_p.load();
         auto     maxs           = from->_head->alloc_area_size;
         auto     potential_free = sp + maxs - ap;
         uint64_t target = 1024 * 1024 * 40ull;  //maxs / 32;  // target a certain amount free

         if (target < potential_free)
            return false;

         auto bytes = target - potential_free;
         if (bytes < 1024 * 256)
            return false;

         uint64_t bytes_freed = 0;

         auto beg    = (char*)from->_head->begin.get();
         auto msk    = from->_head->alloc_area_mask;
         auto to_obj = [beg, msk](auto p)
         { return reinterpret_cast<object_header*>(beg + (p & msk)); };

         auto p   = sp;
         auto end = std::min<uint64_t>(ap, p + bytes);

         while (p < end)
         {
            auto o = to_obj(p);
            if (o->id == 0)  // unused space
            {
               p += o->size;
               assert(o->size != 0);
            }
            else
            {
               using obj_type = object_location::object_type;
               uint16_t ref;
               auto     loc = _obj_ids->get(id{o->id}, ref);
               if (ref != 0 && loc.cache == from->level && from->get_object(loc.offset) == o)
               {
                  if (auto lock = _obj_ids->try_lock({.id = o->id}))
                     // TODO: don't wait on free space
                     alloc(*to, *lock, o->size, o->data());
                  else
                     break;
               }
               p += o->data_capacity() + 8;
            }
         }
         if (p != sp)
         {
            from->_head->swap_p.store(p);
            return true;
         }
         return false;
      };

      bool did_work = false;
      did_work |= do_swap(&hot(), &warm());
      did_work |= do_swap(&warm(), &cool());
      did_work |= do_swap(&cool(), &cold());
      return did_work;
   }

   // updates the free range after swapping, this allows alloc to start
   // reusing this space. Must make sure any threads reading are done
   // before advancing free space.
   inline void ring_allocator::claim_free(swap_position sp)
   {
      auto claim = [this](auto& ring, uint64_t mp)
      {
         // TODO: load relaxed and store relaxed if swapping is being managed by another thread
         ring._head->end_free_p.store(ring._head->alloc_area_size +
                                      std::min<uint64_t>(ring._head->swap_p.load(), mp));
      };
      claim(hot(), sp._swap_pos[0]);
      claim(warm(), sp._swap_pos[1]);
      claim(cool(), sp._swap_pos[2]);
      claim(cold(), sp._swap_pos[3]);
   }

   inline void ring_allocator::retain(id i)
   {
      _obj_ids->retain(i);
   }

   inline std::pair<char*, object_location::object_type> ring_allocator::release(id i)
   {
      auto l = _obj_ids->release(i);
      return {(l.second > 0 ? nullptr
                            : (char*)_levels[l.first.cache]->get_object(l.first.offset)->data()),
              (object_location::object_type)l.first.type};
   }

   inline std::pair<location_lock, char*> ring_allocator::alloc(  //
       size_t                       num_bytes,
       object_location::object_type t)
   {
      if (num_bytes > 0xffffff - 8) [[unlikely]]
         throw std::runtime_error("obj too big");

      auto lock = _obj_ids->alloc(t);
      auto ptr  = alloc(hot(), lock, num_bytes);
      return {std::move(lock), ptr};
   }
   inline void ring_allocator::validate()
   {
      hot()._head->validate();
      warm()._head->validate();
      cool()._head->validate();
      cold()._head->validate();
   }

}  // namespace triedent
