#pragma once
#include <algorithm>
#include <arbtrie/arbtrie.hpp>
#include <arbtrie/root.hpp>
#include <arbtrie/seg_allocator.hpp>
#include <arbtrie/iterator.hpp>
#include <arbtrie/value_type.hpp>
#include <memory>
#include <optional>

namespace arbtrie
{
   using session_rlock = seg_allocator::session::read_lock;

   struct upsert_mode
   {
      enum type : int
      {
         shared        = 0,
         unique        = 1,  // ref count of all parent nodes and this is 1
         insert        = 2,  // fail if key does exist
         update        = 4,  // fail if key doesn't exist
         same_region   = 8,
         upsert        = insert | update,
         unique_upsert = unique | upsert,
         unique_insert = unique | insert,
         unique_update = unique | update,
         shared_upsert = shared | upsert,
         shared_insert = shared | insert,
         shared_update = shared | update
      };

      constexpr upsert_mode(upsert_mode::type t) : flags(t){};

      constexpr bool        is_unique() const { return flags & unique; }
      constexpr bool        is_shared() const { return not is_unique(); }
      constexpr bool        is_same_region() const { return flags & same_region; }
      constexpr upsert_mode make_shared() const { return {flags & ~unique}; }
      constexpr upsert_mode make_unique() const { return {flags | unique}; }
      constexpr upsert_mode make_same_region() const { return {flags | same_region}; }
      constexpr bool        may_insert() const { return flags & insert; }
      constexpr bool        may_update() const { return flags & insert; }
      constexpr bool        must_insert() const { return not (flags & update); }
      constexpr bool        must_update() const { return not (flags & insert); } 
      constexpr bool        is_upsert() const { return (flags & insert) and (flags & update); } 

     // private: structural types cannot have private members,
     // but the flags field is not meant to be used directly
      constexpr upsert_mode( int f ):flags(f){}
      int flags;
   };

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
      friend class iterator;
      friend class database;
      friend class root_data;
      friend class root;
      read_session(database& db);
      database& _db;

      int get(object_ref<node_header>& root, key_view key, auto callback);
      int get(object_ref<node_header>& root, const auto* inner, key_view key, auto callback);
      int get(object_ref<node_header>& root, const binary_node*, key_view key, auto callback);
      int get(object_ref<node_header>& root, const value_node*, key_view key, auto callback);

     public:
      iterator create_iterator( node_handle h ) { return iterator(*this, h); }
      node_handle adopt( const node_handle& h ) { return node_handle(*this,h.id()); }

      inline int get(const node_handle& r, key_view key, auto callback);
      // callback( key_view key, value_type )
      inline void lower_bound(const node_handle& r, key_view key, auto callback);

      // TODO make private
      seg_allocator::session _segas;

      // reads the last value called by 
      node_handle get_root();

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

      object_id upsert(session_rlock& state, object_id root, key_view key, const value_type& val);
      object_id insert(session_rlock& state, object_id root, key_view key, const value_type& val);
      object_id update(session_rlock& state, object_id root, key_view key, const value_type& val);

     public:
      ~write_session();

      /**
       *  Creates a new independent tree with no values on it,
       *  the tree will be deleted when the last node handle that
       *  references it goes out of scope. If node handle isn't
       *  saved via a call to set_root(), or storing it as a value
       *  associated with a key under the tree saved as set_root()
       *  it will not survivie the current process.
       *
       *  Each node handle is an immutable reference to the
       *  state of the tree so it is important to keep only
       *  one copy of it if you are wanting to update effeciently
       *  in place.
       */
      node_handle create_root() { return node_handle(*this); }

      // makes the passed node handle the official state of the
      // database and returns the old state so the caller can
      // choose when it gets released
      node_handle set_root(node_handle);

      /**
       * @return -1 on insert, otherwise the size of the old value
       */
      int upsert(node_handle& r, key_view key, value_view val);
      int insert(node_handle& r, key_view key, value_view val);
      int update(node_handle& r, key_view key, value_view val);

      int                        insert(node_handle& r, key_view key, node_handle subtree);
      std::optional<node_handle> upsert(node_handle& r, key_view key, node_handle subtree);
      node_handle                update(node_handle& r, key_view key, node_handle subtree);

      // return the number of keys removed
      int remove(node_handle& r, key_view key );
      // return the number of keys removed
      int remove(node_handle& r, key_view from, key_view to);

     private:
      template <upsert_mode mode, typename NodeType>
      object_id upsert(object_ref<NodeType>& root, key_view key, const value_type& val);
      template <upsert_mode mode, typename NodeType>
      object_id upsert(object_ref<NodeType>&& root, key_view key, const value_type& val);

      template <upsert_mode mode, typename NodeType>
      object_id upsert_inner(object_ref<node_header>& r, key_view key, const value_type& val);

      template <upsert_mode mode, typename NodeType>
      object_id upsert_inner(object_ref<node_header>&& r, key_view key, const value_type& val)
      {
         return upsert_inner<mode>(r, key, val);
      }

      template <upsert_mode mode>
      id_address upsert_value(object_ref<node_header>& root, const value_type& val);

      //=======================
      // binary_node operations
      // ======================
      object_id make_binary(id_region reg, session_rlock& state, key_view key, const value_type& val);

      template <upsert_mode mode>
      object_id upsert_binary(object_ref<node_header>& root, key_view key, const value_type& val);

      template <upsert_mode mode>
      object_id update_binary_key(object_ref<node_header>& root,
                                  const binary_node*       bn,
                                  uint16_t                 lb_idx,
                                  key_view                 key,
                                  const value_type&        val);
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
      void print_region_stats();

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

      auto n = r.header();
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

   inline int read_session::get(const node_handle& r, key_view key, auto callback)
   {
      auto state = _segas.lock();
      if (not r.id()) [[unlikely]]
      {
         callback(false, value_view());
         return false;
      }
      auto ref = state.get(r.id());
      return get(ref, key, std::forward<decltype(callback)>(callback));
   }

   int read_session::get(object_ref<node_header>& root, key_view key, auto callback)
   {
      return cast_and_call(root.header(), [&](const auto* n) { return get(root, n, key, callback); });
   }
   int read_session::get(object_ref<node_header>& root,
                         const auto*              inner,
                         key_view                 key,
                         auto                     callback)
   {
      if (key.size() == 0)
      {
         if (auto val_node_id = inner->get_branch(0))
         {
            auto vr = root.rlock().get(val_node_id);
            if (vr.type() == node_type::value)
            {
               callback(true, value_type(vr.template as<value_node>()->value()));
            }
            else
            {
               callback(true, value_type(val_node_id));
            }
            return 1;
         }
      }
      else
      {
         auto cpre = common_prefix( inner->get_prefix(), key );
         if( cpre == inner->get_prefix() ) {
            if( key.size() > cpre.size() ) {
               if (auto branch_id = inner->get_branch(char_to_branch(key[cpre.size()])) ) 
               {
                  auto bref = root.rlock().get(branch_id);
                  return get(bref, key.substr(cpre.size()+1), callback);
               }
            } else {
               if (auto branch_id = inner->get_branch(0) )
               {
                  auto bref = root.rlock().get(branch_id);
                  callback( true, bref.template as<value_node>()->value() );
                  return 1;
               }

            }
         }
      }
      callback(false, value_type());
      return 0;
   }

   int read_session::get(object_ref<node_header>& root,
                         const binary_node*       bn,
                         key_view                 key,
                         auto                     callback)
   {
      if (int idx = bn->find_key_idx(key, binary_node::key_hash(key)); idx >= 0)
      {
         // if( int idx = bn->find_key_idx( key ); idx >= 0 ) {
         auto kvp = bn->get_key_val_ptr(idx);
         if (bn->is_obj_id(idx))
         {
            callback(true, root.rlock().get(kvp->value_id()).template as<value_node>()->value());
         }
         else
         {
            callback(true, kvp->value());
         }
         return true;
      }
      callback(false, value_view());
      return 0;
   }
   int read_session::get(object_ref<node_header>& root,
                         const value_node*,
                         key_view key,
                         auto     callback)
   {
      return 0;
   }

}  // namespace arbtrie

#include <arbtrie/iterator_impl.hpp>
