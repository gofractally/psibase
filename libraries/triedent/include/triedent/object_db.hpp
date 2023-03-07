#pragma once
#include <cassert>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <mutex>
#include <optional>
#include <span>
#include <vector>

#include <triedent/debug.hpp>
#include <triedent/file_fwd.hpp>
#include <triedent/gc_queue.hpp>
#include <triedent/mapping.hpp>
#include <triedent/object_fwd.hpp>

namespace triedent
{
   inline constexpr bool debug_id = false;

   struct object_info
   {
      explicit constexpr object_info(std::uint64_t x)
          : _offset(x >> 18),
            cache((x >> 16) & 3),
            type(static_cast<node_type>((x >> 14) & 3)),
            position_lock((x >> 13) & 1),
            ref(x & (0x1FFF))
      {
      }
      std::uint64_t          ref : 13;
      std::uint64_t          position_lock : 1;
      node_type              type : 2;
      std::uint64_t          cache : 2;
      std::uint64_t          _offset : 45;
      std::uint64_t          offset() const { return _offset * 8; }
      constexpr object_info& set_location(object_location loc)
      {
         cache   = loc.cache;
         _offset = loc.offset / 8;
         return *this;
      }
      constexpr std::uint64_t to_int() const
      {
         return ref | (position_lock << 13) | (static_cast<std::uint8_t>(type) << 14) |
                (cache << 16) | (_offset << 18);
      }
      constexpr operator object_location() const { return {.offset = _offset * 8, .cache = cache}; }
   };

   class object_db;

   class location_lock
   {
      friend object_db;

     private:
      object_db* db = nullptr;
      uint64_t   id = 0;
      void       unlock();

     public:
      location_lock()                     = default;
      location_lock(const location_lock&) = delete;
      location_lock(location_lock&& src) { *this = std::move(src); }
      ~location_lock() { unlock(); }

      location_lock& operator=(const location_lock&) = delete;
      location_lock& operator=(location_lock&& src)
      {
         unlock();
         db     = src.db;
         id     = src.id;
         src.db = nullptr;
         return *this;
      }

      object_id get_id() const { return {.id = id}; }

      void move(object_location loc) const;

      // Unlock and move ownership of id to caller. Doesn't modify reference count.
      object_id into_unlock_unchecked()
      {
         object_id result = {.id = id};
         unlock();
         db = nullptr;
         id = 0;
         return result;
      }
   };  // location_lock

   /**
    * Assignes unique ids to objects, tracks their reference counts,
    * and their location.
    */
   class object_db
   {
      friend location_lock;

     public:
      using object_id = triedent::object_id;

      object_db(gc_queue& gc, std::filesystem::path idfile, access_mode mode);
      static void create(std::filesystem::path idfile, uint64_t max_id);

      // Bumps the reference count by 1 if possible
      bool bump_count(object_id id)
      {
         auto& atomic = header()->objects[id.id];
         auto  obj    = atomic.load();
         do
         {
            // All 1's isn't used; that helps detect bugs (e.g. decrementing 0)
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
      std::optional<location_lock> try_lock(object_id id)
      {
         auto& atomic = header()->objects[id.id];
         auto  obj    = atomic.load();
         do
         {
            if (obj & position_lock_mask)
               return std::nullopt;
         } while (!atomic.compare_exchange_weak(obj, obj | position_lock_mask));

         location_lock lock;
         lock.db = this;
         lock.id = id.id;
         return lock;
      }

#if 0
      std::optional<location_lock> try_lock(object_id id, object_location loc)
      {
         if(std::unique_lock l{get_mutex(id), std::try_to_lock}; l.owns_lock())
         {
            if (object_info{header()->objects[id.id].load()} == loc)
            {
               return location_lock{std::move(l), this, id.id};
            }
         }
         return std::nullopt;
      }
#endif

      // Acquires the lock if another thread does not hold the lock and
      // id points to loc.
      std::optional<location_lock> try_lock(object_id id, object_location loc, bool* matched)
      {
         auto& atomic = header()->objects[id.id];
         auto  obj    = atomic.load();
         do
         {
            auto info = object_info{obj};
            if (info.ref == 0 || info != loc)
            {
               *matched = false;
               return std::nullopt;
            }
            if (info.position_lock)
            {
               *matched = true;
               return std::nullopt;
            }
         } while (!atomic.compare_exchange_weak(obj, obj | position_lock_mask));

         *matched = true;
         location_lock lock;
         lock.db = this;
         lock.id = id.id;
         return lock;
      }

      location_lock spin_lock(object_id id)
      {
         auto& atomic = header()->objects[id.id];
         auto  obj    = atomic.load();
         do
         {
            if (obj & position_lock_mask)
            {
               obj = atomic.load();
               continue;
            }
         } while (!atomic.compare_exchange_weak(obj, obj | position_lock_mask));

         location_lock lock;
         lock.db = this;
         lock.id = id.id;
         return lock;
      }

      static void move(const location_lock& lock, object_location loc)
      {
         auto& atomic = lock.db->header()->objects[lock.id];
         auto  obj    = atomic.load();
         while (!atomic.compare_exchange_weak(obj, object_info{obj}.set_location(loc).to_int()))
         {
         }
         lock.db->debug(lock.id, "move");
      }

     private:
      void unlock(uint64_t id) { header()->objects[id] &= ~position_lock_mask; }

     public:
      location_lock alloc(std::unique_lock<gc_session>&, node_type type);

      // TODO: remove
      void dangerous_retain(object_id id);

      object_info release(object_id id);

      uint16_t ref(object_id id);

      object_info get(object_id id);

      void print_stats();
      void validate(object_id i)
      {
         if (i.id > header()->first_unallocated.id)
            throw std::runtime_error("invalid object id discovered: " + std::to_string(i.id));
      }

      /**
       * Sets all non-zero refs to c
       */
      void reset_all_ref_counts(uint16_t c)
      {
         for (auto& o : std::span{header()->objects + 1, header()->first_unallocated.id})
         {
            auto i = o.load();
            if (i & ref_count_mask)
            {
               i &= ~ref_count_mask;
               i |= c & ref_count_mask;
               o.store(i);
            }
         }
      }
      void adjust_all_ref_counts(int16_t c)
      {
         for (auto& o : std::span{header()->objects + 1, header()->first_unallocated.id})
         {
            auto i = o.load();
            if (i & ref_count_mask)
               o.store(i + c);
         }
      }

      bool                  pinned() const { return _region.pinned(); }
      std::span<const char> span() const
      {
         std::lock_guard l{_region_mutex};
         return {reinterpret_cast<const char*>(_region.data()), _region.size()};
      }

     private:
      static constexpr uint64_t position_lock_mask = 1 << 13;
      static constexpr uint64_t ref_count_mask     = (1ull << 13) - 1;

      // 0-12     ref_count
      // 13       position_lock
      // 14-15    type           or next_ptr
      // 16-17    cache          or next_ptr
      // 18-63    offset         or next_ptr

      // clang-format off
      static uint64_t    extract_next_ptr(uint64_t x)   { return x >> 14; }
      static uint64_t    create_next_ptr(uint64_t x)    { return x << 14; }
      // clang-format on

      static uint64_t obj_val(node_type type, uint16_t ref)
      {
         object_info result{0};
         // This is distinct from any valid offset
         result._offset = (1ull << 45) - 1;
         result.ref     = ref;
         result.type    = type;
         return result.to_int();
      }

      // TODO: rename first_unallocated
      struct object_db_header
      {
         std::atomic<uint64_t> first_free;         // free list
         object_id             first_unallocated;  // high water mark
         object_id             max_unallocated;    // end of file

         std::atomic<uint64_t> objects[];
      };

      gc_queue&          _gc;
      mapping            _region;
      mutable std::mutex _region_mutex;

      object_db_header* header() { return reinterpret_cast<object_db_header*>(_region.data()); }

      void debug(uint64_t id, const char* msg)
      {
         if constexpr (debug_id)
         {
            auto obj = object_info{header()->objects[id].load()};
            std::cout << id << ": " << msg << ":"
                      << " ref=" << obj.ref << " type=" << (int)obj.type << " cache=" << obj.cache
                      << " offset=" << obj.offset() << std::endl;
         }
      }
   };

   inline void object_db::create(std::filesystem::path idfile, uint64_t max_id)
   {
      if (std::filesystem::exists(idfile))
         throw std::runtime_error("file already exists: " + idfile.generic_string());

      // std::cerr << "creating " << idfile << std::endl;
      auto idfile_size = sizeof(object_db_header) + max_id * 8;

      mapping mr(idfile, access_mode::read_write, false);
      mr.resize(idfile_size);

      auto header                  = reinterpret_cast<object_db_header*>(mr.data());
      header->first_unallocated.id = 0;
      header->first_free.store(0);
      header->max_unallocated.id = (idfile_size - sizeof(object_db_header)) / 8 - 1;
   }

   inline object_db::object_db(gc_queue& gc, std::filesystem::path idfile, access_mode mode)
       : _gc(gc), _region(idfile, mode, true)
   {
      if (_region.size() == 0)
      {
         std::uint64_t max_id      = 1;
         auto          idfile_size = round_to_page(sizeof(object_db_header) + max_id * 8);

         _region.resize(round_to_page(idfile_size));

         auto header                  = reinterpret_cast<object_db_header*>(_region.data());
         header->first_unallocated.id = 0;
         header->first_free.store(0);
         header->max_unallocated.id = (idfile_size - sizeof(object_db_header)) / 8 - 1;
      }

      auto existing_size = _region.size();

      // std::cerr << "mapping '" << idfile << "' in "  //
      //           << (allow_write ? "read/write" : "read only") << " mode\n";

      auto _header = header();

      if (_header->max_unallocated.id != (existing_size - sizeof(object_db_header)) / 8 - 1)
         throw std::runtime_error("file corruption detected: " + idfile.generic_string());

      // Objects may have been locked for move when process was SIGKILLed. If any objects
      // were locked because they were being written to, their root will not be reachable
      // from database_memory::_root_revision, and will be leaked. Mermaid can clean this
      // leak.
      for (uint64_t i = 0; i <= _header->first_unallocated.id; ++i)
         _header->objects[i] &= ~position_lock_mask;
   }

   inline location_lock object_db::alloc(std::unique_lock<gc_session>& session, node_type type)
   {
      std::lock_guard l{_region_mutex};
      auto            _header = header();
      if (_header->first_free.load() == 0)
      {
         if (_header->first_unallocated.id >= _header->max_unallocated.id)
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
         ++_header->first_unallocated.id;
         auto  r   = _header->first_unallocated;
         auto& obj = _header->objects[r.id];
         obj.store(obj_val(type, 1) | position_lock_mask);  // init ref count 1
         assert(r.id != 0);

         location_lock lock;
         lock.db = this;
         lock.id = r.id;
         debug(lock.id, "alloc");
         return lock;
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
         _header->objects[ff].store(obj_val(type, 1) | position_lock_mask);  // init ref count 1

         location_lock lock;
         lock.db = this;
         lock.id = ff;
         debug(lock.id, "alloc");
         return lock;
      }
   }

   inline void object_db::dangerous_retain(object_id id)
   {
      auto _header = header();
      assert(id.id <= _header->first_unallocated.id);
      if (id.id > _header->first_unallocated.id) [[unlikely]]
         throw std::runtime_error("invalid object id, outside allocated range");

      auto& obj = _header->objects[id.id];
      assert(ref(id) > 0);
      assert(ref(id) != ref_count_mask);

      /*
      auto cur_ref = obj.load() & ref_count_mask;

      if( cur_ref == 0 )[[unlikely]]  
         throw std::runtime_error( "cannot retain an object at 0" );
      
      if( cur_ref == ref_count_mask )[[unlikely]] 
         throw std::runtime_error( "too many references" );
         */

      obj.fetch_add(1);
   }

   /**
    *  The object id was freed iff the ref count of the result is 0.
    */
   inline object_info object_db::release(object_id id)
   {
      debug(id.id, "about to release");

      auto  _header   = header();
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
      TRIEDENT_DEBUG("first unallocated  ", _header->first_unallocated.id);
      TRIEDENT_DEBUG("total objects: ", total, " zero ref: ", zero_ref, "  non zero: ", total - zero_ref);
      */
   }

   inline void location_lock::move(object_location loc) const
   {
      object_db::move(*this, loc);
   }
   inline void location_lock::unlock()
   {
      if (db)
         db->unlock(id);
   }
};  // namespace triedent
