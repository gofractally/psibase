#pragma once
#include <cassert>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <mutex>
#include <span>
#include <vector>

#include <triedent/debug.hpp>
#include <triedent/file_fwd.hpp>
#include <triedent/gc_queue.hpp>
#include <triedent/location_lock.hpp>
#include <triedent/mapping.hpp>
#include <triedent/object_fwd.hpp>

namespace triedent
{
   inline constexpr bool debug_id = false;

   struct object_info
   {
      explicit constexpr object_info(std::uint64_t x)
          : _offset(x >> 19), cache((x >> 17) & 3), _type((x >> 15) & 3), ref(x & (0x7FFF))
      {
      }
      std::uint64_t          ref : 15;
      std::uint64_t          _type : 2;
      std::uint64_t          cache : 2;
      std::uint64_t          _offset : 45;
      node_type              type() const { return static_cast<node_type>(_type); }
      std::uint64_t          offset() const { return _offset * 8; }
      constexpr object_info& set_location(object_location loc)
      {
         cache   = loc.cache;
         _offset = loc.offset / 8;
         return *this;
      }
      constexpr std::uint64_t to_int() const
      {
         return ref | (_type << 15) | (cache << 17) | (_offset << 19);
      }
      constexpr operator object_location() const { return {.offset = _offset * 8, .cache = cache}; }
   };

   struct mutex_group
   {
      static constexpr std::size_t count = 64;
      static constexpr std::size_t align = 64;
      explicit mutex_group() : _items(new location_mutex[count]) {}
      location_mutex& operator()(void* base, void* ptr) const
      {
         auto diff = reinterpret_cast<std::uintptr_t>(ptr) - reinterpret_cast<std::uintptr_t>(base);
         return _items[(diff / align) % count];
      }
      std::unique_ptr<location_mutex[]> _items;
   };

   /**
    * Assignes unique ids to objects, tracks their reference counts,
    * and their location.
    */
   class object_db
   {
      friend location_lock;

     public:
      using object_id = triedent::object_id;

      object_db(gc_queue&             gc,
                std::filesystem::path idfile,
                access_mode           mode,
                bool                  allow_gc = false);

      // Bumps the reference count by 1 if possible
      bool bump_count(object_id id)
      {
         auto& atomic = header()->objects[id.id];
         auto  obj    = atomic.load();
         do
         {
            // All 1's isn't used; that leaves room for gc to add 1
            // and also helps detect bugs (e.g. decrementing 0)
            if ((obj & ref_count_mask) == ref_count_mask - 1)
            {
               debug(id.id, "bump failed; need copy");
               return false;
            }
         } while (!atomic.compare_exchange_weak(obj, obj + 1));

         debug(id.id, "bump");
         return true;
      }

      // A thread which holds a location_lock may:
      // * Move the object to another location
      // * Modify the object if it's not already exposed to reader threads

      // Only acquire the lock if id points to loc
      location_lock lock(object_id id, object_location loc)
      {
         auto* h      = header();
         auto& atomic = h->objects[id.id];
         // If the object has already been moved, don't bother locking
         if (object_info info{atomic.load()}; info.ref != 0 && info == loc)
         {
            location_lock l{_location_mutexes(h, &atomic), id};
            if (object_info info{atomic.load()}; info.ref != 0 && info == loc)
            {
               return l;
            }
         }
         return location_lock{};
      }
      location_lock lock(object_id id)
      {
         auto* h      = header();
         auto& atomic = h->objects[id.id];
         return location_lock{_location_mutexes(h, &atomic), id};
      }

      void move(const location_lock& lock, object_location loc)
      {
         auto& atomic = header()->objects[lock.get_id().id];
         auto  obj    = atomic.load();
         assert(object_info{obj}.ref != 0);
         while (!atomic.compare_exchange_weak(obj, object_info{obj}.set_location(loc).to_int()))
         {
         }
         debug(lock.get_id().id, "move");
      }

      bool compare_and_move(const location_lock& lock,
                            object_location      expected,
                            object_location      loc)
      {
         auto& atomic = header()->objects[lock.get_id().id];
         auto  obj    = atomic.load();
         while (true)
         {
            object_info info{obj};
            if (info.ref == 0 || info != expected)
               return false;
            info.set_location(loc);
            if (atomic.compare_exchange_weak(obj, info.to_int()))
            {
               debug(lock.get_id().id, "move");
               return true;
            }
         }
      }

      // The id must not be accessible to any thread
      // besides the creator.
      void init(object_id id, object_location loc)
      {
         auto&       atomic = header()->objects[id.id];
         object_info info{atomic.load()};
         assert(info.to_int() == obj_val(info.type(), 1));
         info.set_location(loc);
         atomic.store(info.to_int());
      }

      object_id alloc(std::unique_lock<gc_session>&, node_type type);

      object_info release(object_id id);

      uint16_t ref(object_id id);

      object_info get(object_id id);

      void print_stats();
      void validate(object_id i)
      {
         if (i.id > header()->max_allocated.id)
            throw std::runtime_error("invalid object id discovered: " + std::to_string(i.id));
      }

      // returns true if this is the first time the object has been retained
      // during this gc operation.
      bool gc_retain(object_id id);
      void gc_start();
      void gc_finish();

      bool                  pinned() const { return _region.pinned(); }
      std::span<const char> span() const
      {
         std::lock_guard l{_region_mutex};
         return {reinterpret_cast<const char*>(_region.data()), _region.size()};
      }

     private:
      static constexpr uint64_t ref_count_mask = (1ull << 15) - 1;

      // 0-14     ref_count
      // 15-16    type           or next_ptr
      // 17-18    cache          or next_ptr
      // 19-63    offset         or next_ptr

      // clang-format off
      static uint64_t    extract_next_ptr(uint64_t x)   { return x >> 15; }
      static uint64_t    create_next_ptr(uint64_t x)    { return x << 15; }
      // clang-format on

      static uint64_t obj_val(node_type type, uint16_t ref)
      {
         object_info result{0};
         // This is distinct from any valid offset
         result._offset = (1ull << 45) - 1;
         result.ref     = ref;
         result._type   = static_cast<std::uint64_t>(type);
         return result.to_int();
      }

      struct object_db_header
      {
         std::uint32_t              magic;
         std::atomic<std::uint32_t> flags;
         std::atomic<uint64_t>      first_free;       // free list
         object_id                  max_allocated;    // high water mark
         object_id                  max_unallocated;  // end of file

         std::atomic<uint64_t> objects[0];
      };

      static constexpr std::uint32_t running_gc_flag = (1 << 8);

      gc_queue&          _gc;
      mapping            _region;
      mutable std::mutex _region_mutex;
      mutex_group        _location_mutexes;

      object_db_header* header() { return reinterpret_cast<object_db_header*>(_region.data()); }

      void debug(uint64_t id, const char* msg)
      {
         if constexpr (debug_id)
         {
            auto obj = object_info{header()->objects[id].load()};
            std::cout << id << ": " << msg << ":"
                      << " ref=" << obj.ref << " type=" << obj._type << " cache=" << obj.cache
                      << " offset=" << obj.offset() << std::endl;
         }
      }
   };

   inline object_db::object_db(gc_queue&             gc,
                               std::filesystem::path idfile,
                               access_mode           mode,
                               bool                  allow_gc)
       : _gc(gc), _region(idfile, mode, true)
   {
      if (_region.size() == 0)
      {
         std::uint64_t max_id      = 1;
         auto          idfile_size = round_to_page(sizeof(object_db_header) + max_id * 8);

         _region.resize(round_to_page(idfile_size));

         new (_region.data()) object_db_header{
             .magic           = file_magic,
             .flags           = file_type_index,
             .first_free      = 0,
             .max_allocated   = {0},
             .max_unallocated = {(idfile_size - sizeof(object_db_header)) / 8 - 1}};
      }

      auto existing_size = _region.size();

      auto _header = header();

      if (_header->magic != file_magic)
         throw std::runtime_error("Not a triedent file: " + idfile.native());
      if ((_header->flags & file_type_mask) != file_type_index)
         throw std::runtime_error("Not a triedent obj_ids file: " + idfile.native());

      if (!allow_gc && mode == access_mode::read_write && (_header->flags.load() & running_gc_flag))
         throw std::runtime_error("garbage collection in progress");

      if (_header->max_unallocated.id > (existing_size - sizeof(object_db_header)) / 8 - 1)
         throw std::runtime_error("File size is smaller than required by the header: " +
                                  idfile.native());
   }

   inline object_id object_db::alloc(std::unique_lock<gc_session>& session, node_type type)
   {
      std::lock_guard l{_region_mutex};
      auto            _header = header();
      assert(!(_header->flags.load() & running_gc_flag));
      if (_header->first_free.load() == 0)
      {
         if (_header->max_allocated.id >= _header->max_unallocated.id)
         {
            auto new_size = _region.size() + round_to_page(_header->max_unallocated.id * 2);
            if constexpr (debug_id)
            {
               std::cout << "resize ids: " << new_size << std::endl;
            }
            auto cleanup                = _region.resize(new_size);
            _header                     = header();
            _header->max_unallocated.id = (new_size - sizeof(object_db_header)) / 8 - 1;
            if (cleanup)
            {
               relocker r{session};
               _gc.push(cleanup);
            }
         }
         ++_header->max_allocated.id;
         auto  r   = _header->max_allocated;
         auto& obj = _header->objects[r.id];
         obj.store(obj_val(type, 1));  // init ref count 1
         assert(r.id != 0);

         debug(r.id, "alloc");
         return r;
      }
      else
      {
         // This compare exchange loop only protects against
         // concurrent deallocation. It does not protect against
         // concurrent allocation.
         uint64_t ff = _header->first_free.load();
         while (not _header->first_free.compare_exchange_strong(
             ff, extract_next_ptr(_header->objects[ff].load())))
         {
         }
         _header->objects[ff].store(obj_val(type, 1));  // init ref count 1

         debug(ff, "alloc");
         return {ff};
      }
   }

   inline bool object_db::gc_retain(object_id id)
   {
      auto h = header();
      assert(h->flags.load() & running_gc_flag);
      if (id.id > h->max_allocated.id) [[unlikely]]
         throw std::runtime_error("invalid object id, outside allocated range");

      auto& obj       = h->objects[id.id];
      auto  ref_count = ref(id);
      if (ref_count == 0)
         throw std::runtime_error("reference to deleted object found");
      if (ref_count == ref_count_mask)
         throw std::runtime_error("too many references to object id");

      // This can set the reference count to ref_count_max, which is otherwise illegal
      obj.fetch_add(1);
      return ref_count == 1;
   }

   inline void object_db::gc_start()
   {
      auto h = header();
      h->flags.store(h->flags.load() | running_gc_flag);
      for (auto& o : std::span{h->objects + 1, h->max_allocated.id})
      {
         auto i = o.load();
         if (i & ref_count_mask)
         {
            o.store((i & ~ref_count_mask) | 1);
         }
      }
   }

   inline void object_db::gc_finish()
   {
      auto h = this->header();
      assert(h->flags.load() & running_gc_flag);
      // rebuild the free list with low ids at the top
      auto* last_free = &h->first_free;
      for (auto& o : std::span{h->objects + 1, h->max_allocated.id})
      {
         auto i = o.load();
         if ((i & ref_count_mask) > 1)
            o.store(i - 1);
         else
            last_free->store(create_next_ptr(&o - h->objects));
      }
      last_free->store(0);

      h->flags.store((h->flags.load() & ~running_gc_flag));
   }

   /**
    *  The object id was freed iff the ref count of the result is 0.
    */
   inline object_info object_db::release(object_id id)
   {
      debug(id.id, "about to release");

      auto _header = header();
      assert(!(_header->flags.load() & running_gc_flag));
      auto& obj       = _header->objects[id.id];
      auto  val       = obj.fetch_sub(1) - 1;
      auto  new_count = (val & ref_count_mask);

      assert(new_count != ref_count_mask);
      //   if( new_count == ref_count_mask )[[unlikely]] {
      //      TRIEDENT_WARN( "id: ", id.id );
      //      assert( !"somethign went wrong with ref, released ref count of 0" );
      //      throw std::runtime_error( "something went wrong with ref counts" );
      //   }
      if (new_count == 0)
      {
         // the invariant is first_free->object with id that points to next free
         // 1. update object to point to next free
         // 2. then attempt to update first free
         uint64_t ff;
         do
         {
            ff = _header->first_free.load();
            obj.store(create_next_ptr(ff));
         } while (not _header->first_free.compare_exchange_strong(ff, id.id));
      }

      debug(id.id, "release");
      return object_info{val};
   }

   inline uint16_t object_db::ref(object_id id)
   {
      return get(id).ref;
   }

   inline object_info object_db::get(object_id id)
   {
      return object_info{header()->objects[id.id].load()};
   }

   inline void object_db::print_stats()
   {
      auto     _header      = header();
      uint64_t zero_ref     = 0;
      uint64_t total        = 0;
      uint64_t non_zero_ref = 0;
      auto*    ptr          = _header->objects;
      auto*    end          = _header->objects + _header->max_unallocated.id;
      while (ptr != end)
      {
         zero_ref += 0 == (ptr->load() & ref_count_mask);
         ++total;
         ++ptr;
      }
      std::cerr << std::setw(10) << std::left << "obj ids"
                << "|";
      std::cerr << std::setw(12) << std::left << (" " + std::to_string(total - zero_ref)) << "|";
      std::cerr << std::setw(12) << std::left << (" " + std::to_string(zero_ref)) << "|";
      std::cerr << std::setw(12) << std::left << (" " + std::to_string(total)) << "|";
      std::cerr << std::endl;
      /*
      TRIEDENT_DEBUG("first unallocated  ", _header->max_allocated.id);
      TRIEDENT_DEBUG("total objects: ", total, " zero ref: ", zero_ref, "  non zero: ", total - zero_ref);
      */
   }

};  // namespace triedent
