#pragma once
#include <algorithm>
#include <arbtrie/id_allocator.hpp>
#include <arbtrie/root.hpp>
#include <arbtrie/seg_allocator.hpp>
#include <arbtrie/arbtrie.hpp>
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
      database& _db;

     public:
      // TODO make private
      seg_allocator::session _segas;

      root get_root();
      /**
       * @return -1 if not found, otherwise the size of the value
       */
      int  get(root& r, key_view key, std::vector<char>* result = nullptr);
      bool validate(const root& r);
   };

   class write_session : public read_session
   {
      friend class database;
      write_session(database& db) : read_session(db) {}

      object_id upsert(session_rlock& state, object_id root, key_view key, value_view val);
      object_id insert(session_rlock& state, object_id root, key_view key, value_view val);

     public:
      ~write_session();

      node_handle create_root() { return node_handle(*this); }

      void set_root(const root&);

      bool remove(root& r, key_view key);
      bool remove(root& r, key_view from, key_view to);
      /**
             * @return -1 on insert, otherwise the size of the old value
             */
      int upsert(node_handle& r, key_view key, value_view val);
      int insert(node_handle& r, key_view key, value_view val);

      // r must not be a reference to subtree, but it can be
      // a reference to a copy of subtree
      int upsert(root& r, key_view key, root_ptr subtree);

     private:
      template <upsert_mode mode, typename NodeType>
      object_id upsert(object_ref<NodeType>& root, key_view key, value_view val);
      template <upsert_mode mode, typename NodeType>
      object_id upsert(object_ref<NodeType>&& root, key_view key, value_view val);

      template <upsert_mode mode, typename NodeType>
      object_id upsert_inner(object_ref<node_header>& r, key_view key, value_view val);

      template <upsert_mode mode, typename NodeType>
      object_id upsert_inner(object_ref<node_header>&& r, key_view key, value_view val) {
         return upsert_inner<mode>( r, key, val );
      }
      

      template <upsert_mode mode>
      object_id upsert_value(object_ref<node_header>& root, value_view val);

      //=======================
      // binary_node operations
      // ======================
      object_id make_binary( session_rlock& state, key_view key, is_value_type auto val );

      template <upsert_mode mode>
      object_id upsert_binary(object_ref<node_header>& root, key_view key, is_value_type auto val);
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
      void stop_compact_thread();
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


   template <typename NodeType>
   void retain_children(session_rlock& state, const NodeType* in);

   inline read_session::read_session(database& db) : _db(db), _segas(db._sega.start_session()) {}
   inline write_session::~write_session()
   {
      _db._have_write_session = false;
   }

   template <typename T>
   void release_node(object_ref<T>& r)
   {
      auto& state = r.rlock();

      auto release_id = [&](object_id b) { release_node(state.get(b)); };

      auto n = r.obj();
      if (r.release())
      {
         // if we don't know the type, dynamic dispatch
         if constexpr (std::is_same_v<T, node_header>)
            cast_and_call(n, [&](const auto* ptr) { ptr->visit_branches(release_id); });
         else  // we already know the type, yay!
            n->visit_branches(release_id);
      }
   }
   template <typename T>
   void release_node(object_ref<T>&& r)
   {
      release_node(r);
   }

}  // namespace arbtrie
