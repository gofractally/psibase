#pragma once
#include <algorithm>
#include <arbtrie/id_allocator.hpp>
#include <arbtrie/root.hpp>
#include <arbtrie/seg_allocator.hpp>
#include <memory>
#include <optional>

namespace arbtrie
{
   using session_rlock = seg_allocator::session::read_lock;
   struct config
   {
      /**
          *  Read threads can move the accessed data into
          *  a warm cache to improve cache locality and separate
          *  infrequently used data from frequently used data.
          *
          *  If used with anything other than sync_type::none, this
          *  will produce write amplification somewhat less than
          *  the total data read because on sync() the moved cache
          *  values must be flushed to disk.
          */
      bool cache_on_read = false;

      /**
          * By default triedent starts a background thread which
          * will compact data ones a segment 
          */
      bool run_compact_thread = true;

      /**
          * The max amount of a segment that is allowed to be empty
          * before the compactor thread will move the remaining contents
          * to a new segment. 
          *
          * Lower values save space, but produce more write amplification when
          * using sync_type other than none.  Lower values improve cache
          * locality and reduce page misses by keeping the data denser.
          */
      int compact_empty_threshold_percent = 20;

      /**
          * Triedent will discourage the OS from swapping out 
          * the most recently used segments by using mlock(),
          * may want a higher compaction threshold if using mlock()
          */
      uint64_t max_pinnable_segments = 64;

      sync_type sync_mode = sync_type::none;
   };

   class read_session
   {
     protected:
      friend class database;
      friend class root_data;
      friend class root;
      read_session(database& db);
      database&              _db;

      void release( object_id id);

     public:
      // TODO make private
      seg_allocator::session _segas;

      root get_root();
      /**
             * @return -1 if not found, otherwise the size of the value
             */
      int get(root& r, key_view key, std::vector<char>* result = nullptr);
   };

   class write_session : public read_session
   {
      friend class database;
      write_session(database& db) : read_session(db) {}

      object_id upsert(session_rlock& state,
                       object_id   root,
                       bool        unique,
                       key_view    key,
                       value_view  val,
                       int&        old_size);

     public:
      ~write_session();

      root create_root() { return root(*this); }

      void set_root(const root&);

      bool remove(root& r, key_view key);
      bool remove(root& r, key_view from, key_view to);
      /**
             * @return -1 on insert, otherwise the size of the old value
             */
      int upsert(root& r, key_view key, value_view val);

      // r must not be a reference to subtree, but it can be
      // a reference to a copy of subtree
      int upsert(root& r, key_view key, root_ptr subtree);
   };

   class database
   {
     public:
      static constexpr auto read_write = access_mode::read_write;
      static constexpr auto read_only  = access_mode::read_only;

      database(std::filesystem::path dir, config = {}, access_mode = read_write);
      ~database();

      static void create(std::filesystem::path dir, config = {});

      write_session start_write_session();
      read_session  start_read_session();

      void start_compact_thread();
      bool compact_next_segment();

      void print_stats(std::ostream& os, bool detail = false);

     private:
      friend class write_session;
      friend class read_session;

      struct database_memory
      {
         std::uint32_t magic;
         std::uint32_t flags;
         // top_root is protected by _root_change_mutex to prevent race conditions
         // which involve loading or storing top_root, bumping refcounts, decrementing
         // refcounts, cloning, and cleaning up node children when the refcount hits 0.
         // Since it's protected by a mutex, it normally wouldn't need to be atomic.
         // However, making it atomic hopefully aids SIGKILL behavior, which is impacted
         // by instruction reordering and multi-instruction non-atomic writes.
         std::atomic<uint64_t> top_root;
      };
      mutable std::mutex _root_change_mutex;
      bool               _have_write_session;

      seg_allocator    _sega;
      mapping          _dbfile;
      database_memory* _dbm;
      config           _config;
   };

   inline read_session::read_session(database& db) : _db(db), _segas(db._sega.start_session()) {}

   inline write_session::~write_session() { _db._have_write_session = false; }
}  // namespace arbtrie
