#pragma once
#include <filesystem>
#include <fstream>
#include <iostream>
#include <vector>

#include <boost/interprocess/file_mapping.hpp>
#include <boost/interprocess/mapped_region.hpp>
#include <triedent/debug.hpp>

namespace triedent
{
   namespace bip = boost::interprocess;

   struct object_id
   {
      uint64_t    id : 40 = 0;  // obj id
      explicit    operator bool() const { return id != 0; }
      friend bool operator==(object_id a, object_id b) { return a.id == b.id; }
      friend bool operator!=(object_id a, object_id b) { return a.id != b.id; }
   } __attribute__((packed)) __attribute((aligned(1)));
   static_assert(sizeof(object_id) == 5, "unexpected padding");

   struct object_header
   {
      // size might not be a multiple of 8, next object is at data() + (size+7)&-8
      uint64_t size : 24;  // bytes of data, not including header
      uint64_t id : 40;

      inline bool     is_free_area() const { return size == 0; }
      inline uint64_t free_area_size() const { return id; }
      inline uint64_t data_size() const { return size; }
      inline uint32_t data_capacity() const { return (size + 7) & -8; }
      inline char*    data() const { return (char*)(this + 1); }
      inline void     set_free_area_size(uint64_t s) { size = s, id = 0; }
      inline void     set(object_id i, uint32_t numb) { size = numb, id = i.id; }
   };
   static_assert(sizeof(object_header) == 8, "unexpected padding");

   // Not stored
   struct object_location
   {
      // TODO: offset should be multiplied by 8 before use and divided by 8 before stored,
      // this will allow us to maintain a full 48 bit address space
      uint64_t offset : 46  = 0;
      uint64_t cache : 2    = 0;
      uint64_t is_value : 1 = 0;

      friend bool operator!=(const object_location& a, const object_location& b)
      {
         return a.offset != b.offset || (a.cache != b.cache | a.is_value != b.is_value);
      }
   };

   class object_db;
   class location_lock;
   class location_lock2;

   class shared_id
   {
      friend object_db;
      friend location_lock;
      friend location_lock2;

     private:
      object_db* db    = nullptr;
      uint64_t   id    = 0;
      bool       owner = false;  // Does this shared_id own a reference count?

      // note: This leaks children. Fixing this here could create a circular dependency
      //       with ring_alloc. Leaving as is for now since an owned shared_id
      //       (when it has children) is always wrapped in a maybe_owned or a mutating,
      //       which prevent leaking children.
      void unref();

     public:
      shared_id() = default;
      shared_id(shared_id&& src) { *this = std::move(src); }
      ~shared_id() { unref(); }

      // can't support because of potential overflow
      shared_id(const shared_id&) = delete;

      // can't support because of potential overflow
      shared_id& operator=(const shared_id&) = delete;

      shared_id& operator=(shared_id&& src)
      {
         if (&src == this)
            return *this;
         unref();
         db        = src.db;
         id        = src.id;
         owner     = src.owner;
         src.db    = nullptr;
         src.id    = 0;
         src.owner = false;
         return *this;
      }

      object_db* get_db() const { return db; }
      object_id  get_id() const { return {.id = id}; }
      bool       get_owner() const { return owner; }

      // Try moving ownership of id to caller. Bump reference count
      // if needed (!owner).
      //
      // If successful, clear shared_id. If not successful (ref count would
      // overflow), leave shared_id intact.
      std::optional<object_id> try_into();

      // Try moving ownership of id to caller. Doesn't modify
      // reference count.
      std::optional<object_id> try_into_if_owned()
      {
         if (owner)
            return into_unchecked();
         else
            return std::nullopt;
      }

      // Try moving exclusive ownership of id to caller. Doesn't modify
      // reference count.
      //
      // If shared_id is owned, and the reference count is 1, then clears
      // shared_id and returns the id. Else leaves shared_id intact and
      // returns nullopt.
      // TODO: remove if not needed
      std::optional<object_id> try_into_exclusive();

      // Move ownership (if any) of id to caller (unchecked); this
      // clears shared_id. The caller is responsible for knowing if owner
      // was set.
      object_id into_unchecked()
      {
         object_id result = {.id = id};
         db               = nullptr;
         id               = 0;
         owner            = false;
         return result;
      }
   };  // shared_id

   // TODO: Rename to location_lock after phasing out 1
   class location_lock2
   {
      friend object_db;
      friend location_lock;

     private:
      shared_id shared;
      void      unlock();

     public:
      location_lock2()                      = default;
      location_lock2(const location_lock2&) = delete;
      location_lock2(location_lock2&& src) { *this = std::move(src); }
      ~location_lock2() { unlock(); }

      location_lock2& operator=(const location_lock2&) = delete;
      location_lock2& operator=(location_lock2&& src)
      {
         if (&src == this)
            return *this;
         unlock();
         shared = std::move(src.shared);
         return *this;
      }

      object_id get_id() const { return shared.get_id(); }

      // Unlock and convert to shared_id
      shared_id into_unlock()
      {
         unlock();
         return std::move(shared);
      }
   };  // location_lock2

   // TODO: Phase out this version
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

      // Unlock and move ownership of id to caller. Doesn't modify reference count.
      object_id into_unlock_unchecked()
      {
         object_id result = {.id = id};
         unlock();
         db = nullptr;
         id = 0;
         return result;
      }

      // Convert to an owned location_lock2. Caution: only use with lock returned by alloc().
      location_lock2 into_lock2_alloced_unchecked()
      {
         location_lock2 result;
         result.shared.db    = db;
         result.shared.id    = id;
         result.shared.owner = true;
         db                  = nullptr;
         id                  = 0;
         return result;
      }

      // Convert to an unowned location_lock2. Caution: only use with lock returned by spin_*().
      location_lock2 into_lock2_editing_unchecked()
      {
         location_lock2 result;
         result.shared.db    = db;
         result.shared.id    = id;
         result.shared.owner = false;
         db                  = nullptr;
         id                  = 0;
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
      friend location_lock2;

     public:
      using object_id = triedent::object_id;

      object_db(std::filesystem::path idfile, bool allow_write);
      static void create(std::filesystem::path idfile, uint64_t max_id);

      // Bumps the reference count by 1 if possible. shared_id will
      // reduce it by 1 at destruction.
      std::optional<shared_id> bump_count(object_id id)
      {
         auto& atomic = _header->objects[id.id];
         auto  obj    = atomic.load();
         do
         {
            if ((obj & ref_count_mask) == ref_count_mask)
               return std::nullopt;
         } while (!atomic.compare_exchange_weak(obj, obj + 1));

         shared_id result;
         result.db    = this;
         result.id    = id.id;
         result.owner = true;
         return result;
      }

      // Doesn't bump the reference count. shared_id won't
      // reduce the count at destruction.
      shared_id preserve_count(object_id id)
      {
         shared_id result;
         if (id)
            result.db = this;
         result.id    = id.id;
         result.owner = false;
         return result;
      }

      // A thread which holds a location_lock may:
      // * Move the object to another location
      // * Modify the object if it's not already exposed to reader threads
      std::optional<location_lock> try_lock(object_id id)
      {
         auto& atomic = _header->objects[id.id];
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

      location_lock spin_lock(object_id id)
      {
         auto& atomic = _header->objects[id.id];
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

      static void move(const location_lock& lock, uint8_t cache, uint64_t offset)
      {
         auto& atomic = lock.db->_header->objects[lock.id];
         auto  obj    = atomic.load();
         while (!atomic.compare_exchange_weak(
             obj, obj_val({.offset = offset, .cache = cache, .is_value = extract_is_value(obj)},
                          extract_ref(obj)) |
                      position_lock_mask))
         {
         }
      }

     private:
      void unlock(uint64_t id) { _header->objects[id] &= ~position_lock_mask; }

     public:
      location_lock alloc(bool is_value);

      void                                 retain(object_id id);
      std::pair<object_location, uint16_t> release(object_id id);

      uint16_t ref(object_id id);

      object_location get(object_id id);
      object_location get(object_id id, uint16_t& ref);

      void print_stats();
      void validate(object_id i)
      {
         if (i.id > _header->first_unallocated.id)
            throw std::runtime_error("invalid object id discovered: " + std::to_string(i.id));
      }

      /**
       * Sets all non-zero refs to c
       */
      void reset_all_ref_counts(uint16_t c)
      {
         for (auto& o : _header->objects)
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
         for (auto& o : _header->objects)
         {
            auto i = o.load();
            if (i & ref_count_mask)
               o.store(i + c);
         }
      }

     private:
      static constexpr uint64_t position_lock_mask = 1 << 14;
      static constexpr uint64_t ref_count_mask     = (1ull << 14) - 1;

      // 0-13     ref_count
      // 14       position_lock
      // 15       is_value       or next_ptr
      // 16-17    cache          or next_ptr
      // 18-63    offset         or next_ptr

      // clang-format off
      static uint64_t extract_offset(uint64_t x)     { return x >> 18; }
      static uint64_t extract_cache(uint64_t x)      { return (x >> 16) & 0x3; }
      static uint64_t extract_is_value(uint64_t x)   { return (x >> 15) & 1; }
      static uint64_t extract_ref(uint64_t x)        { return x & ref_count_mask; }
      static uint64_t extract_next_ptr(uint64_t x)   { return x >> 15; }
      static uint64_t create_next_ptr(uint64_t x)    { return x << 15; }
      // clang-format on

      static uint64_t obj_val(object_location loc, uint16_t ref)
      {
         return uint64_t(loc.offset << 18) | (uint64_t(loc.cache) << 16) |
                (uint64_t(loc.is_value) << 15) | int64_t(ref);
      }

      // TODO: rename first_unallocated
      struct object_db_header
      {
         std::atomic<uint64_t> first_free;         // free list
         object_id             first_unallocated;  // high water mark
         object_id             max_unallocated;    // end of file

         std::atomic<uint64_t> objects[1];
      };

      std::unique_ptr<bip::file_mapping>  _file;
      std::unique_ptr<bip::mapped_region> _region;

      object_db_header* _header;
   };

   inline void object_db::create(std::filesystem::path idfile, uint64_t max_id)
   {
      if (std::filesystem::exists(idfile))
         throw std::runtime_error("file already exists: " + idfile.generic_string());

      std::cerr << "creating " << idfile << std::endl;
      {
         std::ofstream out(idfile.generic_string(), std::ofstream::trunc);
         out.close();
      }
      auto idfile_size = sizeof(object_db_header) + max_id * 8;
      std::filesystem::resize_file(idfile, idfile_size);

      bip::file_mapping  fm(idfile.generic_string().c_str(), bip::read_write);
      bip::mapped_region mr(fm, bip::read_write, 0, sizeof(object_db_header));

      auto header                  = reinterpret_cast<object_db_header*>(mr.get_address());
      header->first_unallocated.id = 0;
      header->first_free.store(0);
      header->max_unallocated.id = (idfile_size - sizeof(object_db_header)) / 8;
   }

   inline object_db::object_db(std::filesystem::path idfile, bool allow_write)
   {
      if (not std::filesystem::exists(idfile))
         throw std::runtime_error("file does not exist: " + idfile.generic_string());

      auto existing_size = std::filesystem::file_size(idfile);

      std::cerr << "mapping '" << idfile << "' in "  //
                << (allow_write ? "read/write" : "read only") << " mode\n";

      auto mode = allow_write ? bip::read_write : bip::read_only;

      _file = std::make_unique<bip::file_mapping>(  //
          idfile.generic_string().c_str(), mode);

      _region = std::make_unique<bip::mapped_region>(*_file, mode);

      if (mlock(_region->get_address(), existing_size) < 0)
         throw std::runtime_error("unable to lock memory for " + idfile.generic_string());

      _header = reinterpret_cast<object_db_header*>(_region->get_address());

      if (_header->max_unallocated.id != (existing_size - sizeof(object_db_header)) / 8)
         throw std::runtime_error("file corruption detected: " + idfile.generic_string());

      // Objects may have been locked for move when process was SIGKILLed. If any objects
      // were locked because they were being written to, their root will not be reachable
      // from database_memory::_root_revision, and will be leaked. TODO: make this be true.
      for (uint64_t i = 0; i <= _header->first_unallocated.id; ++i)
         _header->objects[i] &= ~position_lock_mask;
   }

   inline location_lock object_db::alloc(bool is_value)
   {
      if (_header->first_free.load() == 0)
      {
         if (_header->first_unallocated.id >= _header->max_unallocated.id)
            throw std::runtime_error("no more object ids");
         ++_header->first_unallocated.id;
         auto  r   = _header->first_unallocated;
         auto& obj = _header->objects[r.id];
         obj.store(obj_val({.is_value = is_value}, 1) | position_lock_mask);  // init ref count 1
         assert(r.id != 0);

         location_lock lock;
         lock.db = this;
         lock.id = r.id;
         return lock;
      }
      else
      {
         uint64_t ff = _header->first_free.load();
         while (not _header->first_free.compare_exchange_strong(
             ff, extract_next_ptr(_header->objects[ff].load())))
         {
         }
         _header->objects[ff].store(obj_val({.is_value = is_value}, 1) |
                                    position_lock_mask);  // init ref count 1

         location_lock lock;
         lock.db = this;
         lock.id = ff;
         return lock;
      }
   }
   inline void object_db::retain(object_id id)
   {
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
    *  Return null object_location if not released, othewise returns the location
    *  that was freed
    */
   inline std::pair<object_location, uint16_t> object_db::release(object_id id)
   {
      auto& obj       = _header->objects[id.id];
      auto  val       = obj.fetch_sub(1) - 1;
      auto  new_count = (val & ref_count_mask);

      assert(new_count != ref_count_mask);
      //   if( new_count == ref_count_mask )[[unlikely]] {
      //      WARN( "id: ", id.id );
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
      return {object_location{.offset   = extract_offset(val),
                              .cache    = extract_cache(val),
                              .is_value = extract_is_value(val)},
              new_count};
   }

   inline uint16_t object_db::ref(object_id id)
   {
      return _header->objects[id.id].load() & ref_count_mask;
   }

   inline object_location object_db::get(object_id id)
   {
      auto val = _header->objects[id.id].load();
      //    std::atomic_thread_fence(std::memory_order_acquire);

      assert((val & ref_count_mask) or !"expected positive ref count");
      if (not(val & ref_count_mask)) [[unlikely]]  // TODO: remove in release
         throw std::runtime_error("expected positive ref count");
      object_location r;
      r.cache    = extract_cache(val);
      r.offset   = extract_offset(val);
      r.is_value = extract_is_value(val);
      //  std::atomic_thread_fence(std::memory_order_acquire);
      return r;
   }

   inline object_location object_db::get(object_id id, uint16_t& ref)
   {
      auto val = _header->objects[id.id].load();

      // if( not (val & ref_count_mask) ) // TODO: remove in release
      //    throw std::runtime_error("expected positive ref count");

      //  std::atomic_thread_fence(std::memory_order_acquire);
      // assert((val & 0xffff) or !"expected positive ref count");
      object_location r;
      r.cache    = extract_cache(val);
      r.offset   = extract_offset(val);
      r.is_value = extract_is_value(val);
      ref        = extract_ref(val);
      //  std::atomic_thread_fence(std::memory_order_acquire);
      return r;
   }

   inline void object_db::print_stats()
   {
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
      DEBUG("first unallocated  ", _header->first_unallocated.id);
      DEBUG("total objects: ", total, " zero ref: ", zero_ref, "  non zero: ", total - zero_ref);
      */
   }

   inline void shared_id::unref()
   {
      if (owner)
         db->release({.id = id});
   }

   inline std::optional<object_id> shared_id::try_into()
   {
      if (owner)
      {
         object_id result = {.id = id};
         db               = nullptr;
         id               = 0;
         owner            = false;
         return result;
      }
      if (!db)
         return std::nullopt;
      if (auto other = db->bump_count({.id = id}))
      {
         object_id result = {.id = id};
         db               = nullptr;
         id               = 0;
         owner            = false;
         other->owner     = false;
         return result;
      }
      return std::nullopt;
   }

   inline std::optional<object_id> shared_id::try_into_exclusive()
   {
      if (!owner)
         return std::nullopt;
      if (db->ref({.id = id}) != 1)
         return std::nullopt;
      object_id result = {.id = id};
      db               = nullptr;
      id               = 0;
      owner            = false;
      return result;
   }

   inline void location_lock::unlock()
   {
      if (db)
         db->unlock(id);
   }

   inline void location_lock2::unlock()
   {
      if (shared.db)
         shared.db->unlock(shared.id);
   }
};  // namespace triedent
