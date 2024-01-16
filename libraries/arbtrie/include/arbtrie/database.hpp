#pragma once
#include <algorithm>
#include <arbtrie/arbtrie.hpp>
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

   /**
    *   An iterator grabs a read-only snapshot of the database
    *   and provides a consistent view.
    */
   class iterator
   {
      friend class read_session;
      iterator(read_session& s, node_handle r) : _rs(s),_root(std::move(r)) {}

     public:
      // return the root this iterator is based on
      node_handle get_root()const { return _root; }

      bool next();  // moves to next key, return valid()
      bool prev();  // moves to the prv key, return valid()
                    
      // moves to the first key >= search, return valid()
      bool lower_bound(key_view search);

      // moves to the first key > search, return valid()
      bool upper_bound(key_view search);

      // moves to the first key with prefix, return valid()
      bool first(key_view prefix = {});

      // moves to the last key with prefix, return valid()
      bool last(key_view prefix = {});

      // moves to the key(), return valid()
      bool get(key_view key);

      // true if the iterator points to a key/value pair
      bool valid() const { return _path.size() > 0; }

      // the key the iterator is currently pointing to
      key_view key() const { return key_view((char*)_branches.data(), _branches.size()); }

      // if the value is a subtree, return an iterator into that subtree
      iterator    sub_iterator() const;
      bool        is_node() const;
      bool        is_data() const;

      // return -1 if no
      int32_t value_size() const { return _size; }

      // resizes v to the and copies the value into it
      int32_t read_value(std::vector<char>&);

      // copies the value into [s,s+s_len) and returns the
      // number of bytes copied
      int32_t read_value(char* s, uint32_t s_len);

     private:
      // path[0] = root
      // branch[0] eq the branch taken from root,
      //    branch.size() then the value is on the node path[branches.size()]
      // if branches.size() >= path.size() surplus bytes in branches represent
      //    the key into the binary node and path.back() should be a binary node.
      std::vector<uint8_t>   _branches;
      std::vector<object_id> _path;  // path[0]
      int                    _binary_index;
      int                    _size; // -1 if unknown
      object_id              _oid;
      read_session&          _rs;
      node_handle            _root;
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
      iterator create_iterator() { return iterator(*this, get_root()); }

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
      object_id upsert_value(object_ref<node_header>& root, const value_type& val);

      //=======================
      // binary_node operations
      // ======================
      object_id make_binary(session_rlock& state, key_view key, const value_type& val);

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
      auto r = root.obj();
      return cast_and_call(root.obj(), [&](const auto* n) { return get(root, n, key, callback); });
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
         if (auto branch_id = inner->get_branch(uint_fast16_t(uint8_t(key[0])) + 1))
         {
            auto bref = root.rlock().get(branch_id);
            return get(bref, key.substr(1), callback);
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
