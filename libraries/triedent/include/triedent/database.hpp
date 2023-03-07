#pragma once

#include <algorithm>
#include <memory>
#include <span>
#include <triedent/node.hpp>

namespace triedent
{
   inline constexpr bool debug_roots = false;

   template <typename AccessMode>
   class session;

   class database;
   class shared_root;
   class write_session;

   struct write_access;
   struct read_access;

   template <typename T = node>
   struct deref;

   template <typename T = node>
   struct mutable_deref;

   inline key_type from_key6(const key_view sixb);

   // Write thread usage notes:
   // * To create a new tree, default-initialize a shared_ptr<root>
   // * To get the upper-most root, use write_session::get_top_root
   // * To set the upper-most root, use write_session::set_top_root
   // * Trees may store roots within their leaves. This makes it possible
   //   to have an outer tree which holds multiple revisions of inner trees
   //   within it. This can nest to any depth.
   // * Several methods take a non-const shared_ptr<root>&; they modify
   //   this shared_ptr.
   // * triedent uses a persistent data structure model; the changes that
   //   mutation functions make aren't reachable after shutdown unless you use
   //   set_top_root. They are reachable by other threads without using
   //   set_top_root if you pass an up-to-date copy of the shared_ptr<root>
   //   to the other threads.
   //
   // Read thread usage notes:
   // * The write thread should pass a copy of a shared_ptr<root> to the read threads.
   //   This may be the upper-most root, or the root(s) of any other tree(s).
   // * Read threads may use their shared_ptr<root> in combination with a
   //   read_session to query and iterate.
   // * Some queries return shared_ptr<root>; use this with any read_session to
   //   query and iterate this additional tree.
   // * Read threads never bump database refcounts; they only bump or release
   //   shared_ptr::use_count, which in turn may reduce database refcounts.
   //
   // Thread safety notes:
   // * If you share a read_session or write_session between threads, then you must
   //   synchronize access to it. Since a database only allows at most a single
   //   write_session at a time, only 1 thread at a time may write.
   // * Recommendation: only have a single write thread and give each read thread
   //   its own read_session.
   // * If you share any std::shared_ptr between threads, then you must synchronize
   //   access to it. e.g. don't pass a non-const reference to std::shared_ptr to
   //   any functions in this library if that shared_ptr is currently being used by
   //   any other threads. Instead, copy the shared_ptr between threads. Nothing new
   //   here; this is a rule from the C++ standard library.
   // * database::start_write_session and database::start_read_session have internal
   //   synchronization; you don't need to synchronize access to these functions.
   // * If `p` is a `shared_ptr<root>`, then it's usually best to never use `*p`
   //   or `p->` outside of the code within this file. Especially never use
   //   `*p = ...` or `std::move(*p)` outside of this file. If you do, you'll have
   //   additional synchronization and iterator rules to deal with which aren't
   //   explained here.
   class root
   {
      template <typename AccessMode>
      friend class session;

      friend shared_root;
      friend write_session;

     private:
      // If db == nullptr, then the other fields don't matter. There are 3
      // ways to represent an empty tree:
      //    shared_ptr<root>  == nullptr ||     // Default-initialized shared_ptr
      //    root::db          == nullptr ||     // Moved-from or default-initialized root
      //    root::id          == {}             // Result of removing from an almost-empty tree
      //
      // If ancestor == nullptr, then id (if not 0) has a refcount on it which will be
      // decremented within ~root(). If this fails to happen (SIGKILL), then the refcount
      // will leak; mermaid can clean this up. If id is referenced within a leaf, or there
      // are any other root instances pointing at it, then its refcount will be greater
      // than 1, preventing its node from being dropped or edited in place. If
      // shared_ptr<root>::use_count is greater than 1, then it also won't be dropped or
      // edited in place. This limits edit-in-place to nodes which aren't reachable by
      // other threads.
      //
      // If ancestor != nullptr, then id doesn't have a refcount on it. ancestor
      // keeps ancestor's id alive. ancestor's id keeps this id alive. If ancestor is
      // held anywhere else, then either its shared_ptr::use_count or its storage
      // refcount will be greater than 1, preventing it from being dropped or edited
      // in place, which in turn keeps this id and the node it references safe.

      std::shared_ptr<database> db;
      std::shared_ptr<root>     ancestor;
      object_id                 id;

      root(std::shared_ptr<database> db, std::shared_ptr<root> ancestor, object_id id)
          : db(std::move(db)), ancestor(std::move(ancestor)), id(id)
      {
         if constexpr (debug_roots)
            if (db)
               std::cout << id.id << ": root(): ancestor=" << (ancestor ? ancestor->id.id : 0)
                         << std::endl;
      }

     public:
      root()            = default;
      root(const root&) = delete;
      root(root&&)      = default;
      ~root();

      root& operator=(const root&) = delete;
      root& operator=(root&&)      = default;
   };  // root

   class session_base
   {
      friend database;
      friend root;

     public:
      using string_view = std::string_view;
      using id          = object_id;

     protected:
      using swap_guard = std::lock_guard<gc_session>;
      explicit session_base(cache_allocator& a);
      operator gc_session&() const { return _session; }

     public:
      key_view to_key6(key_view v) const;

     private:
      mutable gc_session _session;
      mutable key_type   key_buf;
   };

   /**
    *  Write access mode may modify in place and updates
    *  the object locations in cache, a read_access mode will
    *  not move objects in cache.
    */
   template <typename AccessMode = write_access>
   class session : public session_base
   {
      using iterator_data = std::vector<std::pair<id, char>>;
      mutable std::vector<iterator_data> _iterators;
      mutable uint64_t                   _used_iterators = 0;
      inline uint64_t&                   used_iterators() const { return _used_iterators; }
      inline auto&                       iterators() const { return _iterators; }

     public:
      // Caution: as long as an iterator is in use:
      // * The session which created it must be alive
      // * The root which created it must be alive and unchanged.
      //   To meet this requirement, don't drop or modify the root
      //   shared_ptr, or pass it by non-const ref to any functions
      //   in this library. You may modify copies of the shared_ptr.
      // * Don't compare iterators created by different sessions or
      //   different roots.
      //
      // TODO: iterator implementation isn't complete; multiple functions
      //       need to be fixed
#if 0
      struct iterator
      {
         uint32_t    key_size() const;
         uint32_t    read_key(char* data, uint32_t data_len) const;
         std::string key() const;
         iterator&   operator++();
         iterator&   operator--();
         bool        valid() const { return path().size() > 0; }

         explicit operator bool() const { return valid(); }

         ~iterator()
         {
            if (_iter_num != -1)
            {
               path().clear();
               _session->used_iterators() ^= 1ull << _iter_num;
            }
         }

         iterator(const iterator& c) : _session(c._session)
         {
            // TODO: detect none available; currently causes UB
            _iter_num = std::countr_one(_session->_used_iterators);
            _session->used_iterators() ^= 1ull << _iter_num;
            path() = c.path();
         }
         iterator(iterator&& c) : _session(c._session), _iter_num(c._iter_num) { c._iter_num = -1; }

         // TODO: ==, !=

         void value(std::string& v) const;

         std::string value() const
         {
            std::string r;
            value(r);
            return r;
         }

        private:
         friend class session;

         string_view unguarded_value() const;
         uint32_t    unguarded_key_size() const;
         uint32_t    unguarded_read_key(char* data, uint32_t data_len) const;
         iterator(const session& s) : _session(&s)
         {
            // TODO: detect none available; currently causes UB
            _iter_num = std::countr_one(_session->_used_iterators);
            _session->used_iterators() ^= 1ull << _iter_num;
         };

         iterator_data& path() const { return _session->iterators()[_iter_num]; };

         uint32_t       _iter_num;
         const session* _session;
      };
#endif

      // This is more efficient than simply dropping r since it
      // doesn't usually lock a mutex. However, like dropping r,
      // it still recurses, so there may be an advantage to
      // calling this from a dedicated cleanup thread.
      void release(std::shared_ptr<root>& r);

      // iterator first(const std::shared_ptr<root>& r) const;
      // iterator last(const std::shared_ptr<root>& r) const;
      // iterator find(const std::shared_ptr<root>& r, string_view key) const;
      // iterator lower_bound(const std::shared_ptr<root>& r, string_view key) const;
      // iterator last_with_prefix(const std::shared_ptr<root>& r, string_view prefix) const;

      bool                             get(const std::shared_ptr<root>&        r,
                                           std::span<const char>               key,
                                           std::vector<char>*                  result_bytes,
                                           std::vector<std::shared_ptr<root>>* result_roots) const;
      std::optional<std::vector<char>> get(const std::shared_ptr<root>& r,
                                           std::span<const char>        key) const;

      bool get_greater_equal(const std::shared_ptr<root>&        r,
                             std::span<const char>               key,
                             std::vector<char>*                  result_key,
                             std::vector<char>*                  result_bytes,
                             std::vector<std::shared_ptr<root>>* result_roots) const;
      bool get_less_than(const std::shared_ptr<root>&        r,
                         std::span<const char>               key,
                         std::vector<char>*                  result_key,
                         std::vector<char>*                  result_bytes,
                         std::vector<std::shared_ptr<root>>* result_roots) const;
      bool get_max(const std::shared_ptr<root>&        r,
                   std::span<const char>               prefix,
                   std::vector<char>*                  result_key,
                   std::vector<char>*                  result_bytes,
                   std::vector<std::shared_ptr<root>>* result_roots) const;

      void print(const std::shared_ptr<root>& r);
      void validate(const std::shared_ptr<root>& r);

      session(std::shared_ptr<database> db);
      ~session();

     protected:
      session(const session&) = delete;

      inline object_id get_id(const std::shared_ptr<root>& r) const;
      void             validate(session_lock_ref<> l, id);
      // void                       next(iterator& itr) const;
      // void                       prev(iterator& itr) const;
      // iterator                   find(id n, string_view key) const;
      void               print(id n, string_view prefix = "", std::string k = "");
      inline deref<node> get_by_id(session_lock_ref<> l, object_id i) const;
      inline deref<node> get_by_id(session_lock_ref<> l, object_id i, bool& unique) const;

      bool unguarded_get(session_lock_ref<>                            l,
                         const std::shared_ptr<triedent::root>&        ancestor,
                         object_id                                     root,
                         std::string_view                              key,
                         std::vector<char>*                            result_bytes,
                         std::vector<std::shared_ptr<triedent::root>>* result_roots) const;

      bool fill_result(const std::shared_ptr<root>&        ancestor,
                       const value_node&                   vn,
                       node_type                           type,
                       std::vector<char>*                  result_bytes,
                       std::vector<std::shared_ptr<root>>* result_roots) const;

      bool unguarded_get_greater_equal(
          session_lock_ref<>                            l,
          const std::shared_ptr<triedent::root>&        ancestor,
          object_id                                     root,
          std::string_view                              key,
          std::vector<char>&                            result_key,
          std::vector<char>*                            result_bytes,
          std::vector<std::shared_ptr<triedent::root>>* result_roots) const;

      bool unguarded_get_less_than(
          session_lock_ref<>                            l,
          const std::shared_ptr<triedent::root>&        ancestor,
          object_id                                     root,
          std::optional<std::string_view>               key,
          std::vector<char>&                            result_key,
          std::vector<char>*                            result_bytes,
          std::vector<std::shared_ptr<triedent::root>>* result_roots) const;

      bool unguarded_get_max(session_lock_ref<>                            l,
                             const std::shared_ptr<triedent::root>&        ancestor,
                             object_id                                     root,
                             std::string_view                              prefix_min,
                             std::string_view                              prefix_max,
                             std::vector<char>&                            result_key,
                             std::vector<char>*                            result_bytes,
                             std::vector<std::shared_ptr<triedent::root>>* result_roots) const;

      inline id   retain(std::unique_lock<gc_session>&, id);
      inline void release(id);

      friend class database;
      std::shared_ptr<database> _db;

      cache_allocator& ring() const;
   };
   using read_session = session<read_access>;

   class write_session : public read_session
   {
     public:
      write_session(std::shared_ptr<database> db) : read_session(db) {}

      std::shared_ptr<root> get_top_root();
      void                  set_top_root(const std::shared_ptr<root>& r);

      int upsert(std::shared_ptr<root>& r, std::span<const char> key, std::span<const char> val);

      // Caution: r (the reference) must not reference any of the shared_ptrs
      //          within roots. It may be a copy of a shared_ptr within roots.
      //          The latter case won't create a loop; instead it will create a
      //          newer tree which references an older tree in one of its leaves.
      //          The newer tree will still have structural sharing with the older
      //          tree.
      int upsert(std::shared_ptr<root>&                 r,
                 std::span<const char>                  key,
                 std::span<const std::shared_ptr<root>> roots);

      int remove(std::shared_ptr<root>& r, std::span<const char> key);

      /**
          *  These methods are used to recover the database after a crash,
          *  start_collect_garbage resets all non-zero refcounts to 1,
          *  then you can call recursve retain for all root nodes that need
          *  to be kept.
          */
      ///@{
      void start_collect_garbage();
      void recursive_retain();
      void end_collect_garbage();
      ///@}

     private:
      inline bool get_unique(std::shared_ptr<root>& r);
      inline void update_root(std::shared_ptr<root>& r, object_id id);

      void recursive_retain(session_lock_ref<> l, object_id id);

      mutable_deref<value_node> make_value(std::unique_lock<gc_session>& session,
                                           node_type                     type,
                                           string_view                   k,
                                           string_view                   v);
      mutable_deref<value_node> clone_value(std::unique_lock<gc_session>& session,
                                            object_id                     origin,
                                            node_type                     type,
                                            string_view                   key,
                                            std::uint32_t                 key_offset,
                                            string_view                   val);

      mutable_deref<value_node>        clone_value(std::unique_lock<gc_session>& session,
                                                   object_id                     origin,
                                                   node_type                     type,
                                                   const std::string&            key,
                                                   string_view                   val);
      inline mutable_deref<inner_node> make_inner(std::unique_lock<gc_session>& session,
                                                  string_view                   pre,
                                                  id                            val,
                                                  uint64_t                      branches);
      inline mutable_deref<inner_node> clone_inner(std::unique_lock<gc_session>& session,
                                                   object_id                     id,
                                                   const inner_node&             cpy,
                                                   string_view                   pre,
                                                   std::uint32_t                 offset,
                                                   object_id                     val,
                                                   uint64_t                      branches);
      inline mutable_deref<inner_node> clone_inner(std::unique_lock<gc_session>& session,
                                                   object_id                     id,
                                                   const inner_node&             cpy,
                                                   const std::string&            pre,
                                                   object_id                     val,
                                                   uint64_t                      branches);

      template <typename T>
      inline mutable_deref<T> lock(const deref<T>& obj);

      inline id add_child(std::unique_lock<gc_session>& session,
                          id                            root,
                          bool                          unique,
                          node_type                     type,
                          string_view                   key,
                          string_view                   val,
                          int&                          old_size);
      inline id remove_child(std::unique_lock<gc_session>& session,
                             id                            root,
                             bool                          unique,
                             string_view                   key,
                             int&                          removed_size);

      inline void modify_value(mutable_deref<value_node> mut, string_view val);
      inline id   set_value(std::unique_lock<gc_session>& session,
                            deref<node>                   n,
                            bool                          unique,
                            node_type                     type,
                            string_view                   key,
                            string_view                   val);
      inline id   set_inner_value(std::unique_lock<gc_session>& session,
                                  deref<inner_node>             n,
                                  bool                          unique,
                                  node_type                     type,
                                  string_view                   val);
      inline id   combine_value_nodes(std::unique_lock<gc_session>& session,
                                      node_type                     t1,
                                      string_view                   k1,
                                      string_view                   v1,
                                      object_id                     origin1,
                                      node_type                     t2,
                                      string_view                   k2,
                                      string_view                   v2,
                                      object_id                     origin2);
   };

   class database : public std::enable_shared_from_this<database>
   {
      template <typename AccessMode>
      friend class session;

      friend write_session;
      friend session_base;
      friend root;

     public:
      // TODO: rename *_pages
      struct config
      {
         uint64_t max_objects = 1000 * 1000ull;
         uint64_t hot_pages   = 32;
         uint64_t warm_pages  = 32;
         uint64_t cool_pages  = 32;
         uint64_t cold_pages  = 32;
      };
      static constexpr auto read_write = access_mode::read_write;
      static constexpr auto read_only  = access_mode::read_only;

      using string_view = std::string_view;
      using id          = object_id;

      database(const std::filesystem::path& dir, const config& cfg, access_mode allow_write);
      database(const std::filesystem::path& dir, access_mode allow_write);
      ~database();

      static void create(std::filesystem::path dir, config);

      std::shared_ptr<write_session> start_write_session();
      std::shared_ptr<read_session>  start_read_session();

      void print_stats(bool detail = false);

      bool is_slow() const { return _ring.is_slow(); }
      auto span() const { return _ring.span(); }

     private:
      inline void release(id);
      inline void ensure_free_space();

      struct revision
      {
         object_id _root;

         // incremented when read session created, decremented when read session completes
         std::atomic<uint32_t> _active_sessions;
      };

      struct database_memory
      {
         // top_root is protected by _root_change_mutex to prevent race conditions
         // which involve loading or storing top_root, bumping refcounts, decrementing
         // refcounts, cloning, and cleaning up node children when the refcount hits 0.
         // Since it's protected by a mutex, it normally wouldn't need to be atomic.
         // However, making it atomic hopefully aids SIGKILL behavior, which is impacted
         // by instruction reordering and multi-instruction non-atomic writes.
         std::atomic<uint64_t> top_root;

         database_memory() { top_root.store(0); }
      };

      cache_allocator  _ring;
      mapping          _file;
      database_memory* _dbm;

      mutable std::mutex _root_change_mutex;
      bool               _have_write_session;

      std::mutex   _root_release_session_mutex;
      session_base _root_release_session;
   };

   inline root::~root()
   {
      if constexpr (debug_roots)
         if (db && id)
            std::cout << id.id << ": ~root(): ancestor=" << (ancestor ? ancestor->id.id : 0)
                      << std::endl;
      if (db && id && !ancestor)
      {
         std::lock_guard<std::mutex> lock(db->_root_release_session_mutex);
         session_base::swap_guard    guard(db->_root_release_session);
         db->release(id);
      }
   }

   template <typename T>
   struct deref
   {
      using id = object_id;

      deref(std::pair<id, value_node*> p, node_type t)
          : _id(p.first), ptr((char*)p.second), _type(t)
      {
      }
      deref(std::pair<id, inner_node*> p)
          : _id(p.first), ptr((char*)p.second), _type(node_type::inner)
      {
      }
      template <typename Other>
      deref(deref<Other> p) : _id(p._id), ptr((char*)p.ptr), _type(p._type)
      {
      }
      deref(id i, void* p, node_type t) : _id(i), ptr(p), _type(t) {}

      explicit inline operator bool() const { return bool(_id); }
      inline          operator id() const { return _id; }

      auto         type() const { return _type; }
      bool         is_leaf_node() const { return _type != node_type::inner; }
      inline auto& as_value_node() const { return *reinterpret_cast<const value_node*>(ptr); }
      inline auto& as_inner_node() const { return *reinterpret_cast<const inner_node*>(ptr); }

      inline const T* operator->() const { return reinterpret_cast<const T*>(ptr); }
      inline const T& operator*() const { return *reinterpret_cast<const T*>(ptr); }

      int64_t as_id() const { return _id.id; }

      // Allocation invalidates pointers. reload will make the deref object
      // valid again after an allocation.
      void reload(cache_allocator& a, session_lock_ref<> session)
      {
         auto [p, type, ref] = a.get_cache<false>(session, _id);
         ptr                 = p;
      }

     protected:
      template <typename Other>
      friend class deref;

      id        _id;
      void*     ptr;
      node_type _type;
   };  // deref

   template <typename T>
   struct mutable_deref : deref<T>
   {
      mutable_deref() = default;
      mutable_deref(std::pair<location_lock, value_node*> p, node_type type)
          : deref<T>{{p.first.get_id(), p.second}, type}, lock{std::move(p.first)}
      {
      }
      mutable_deref(std::pair<location_lock, inner_node*> p)
          : deref<T>{{p.first.get_id(), p.second}}, lock{std::move(p.first)}
      {
      }
      mutable_deref(location_lock lock, const deref<T>& src) : lock{std::move(lock)}, deref<T>{src}
      {
      }

      inline auto& as_value_node() const { return *reinterpret_cast<value_node*>(this->ptr); }
      inline auto& as_inner_node() const { return *reinterpret_cast<inner_node*>(this->ptr); }

      inline T* operator->() const { return reinterpret_cast<T*>(this->ptr); }
      inline T& operator*() const { return *reinterpret_cast<T*>(this->ptr); }

      auto get_id() { return lock.get_id(); }

     private:
      location_lock lock;
   };  // mutable_deref

   inline session_base::session_base(cache_allocator& a) : _session(a.start_session()) {}

   template <typename AccessMode>
   inline cache_allocator& session<AccessMode>::ring() const
   {
      return _db->_ring;
   }

   template <typename AccessMode>
   session<AccessMode>::session(std::shared_ptr<database> db)
       : session_base{db->_ring}, _db(std::move(db))
   {
      _iterators.resize(64);
   }
   template <typename AccessMode>
   session<AccessMode>::~session()
   {
   }

   inline std::shared_ptr<read_session> database::start_read_session()
   {
      return std::make_shared<read_session>(shared_from_this());
   }

   inline std::shared_ptr<write_session> database::start_write_session()
   {
      return std::make_shared<write_session>(shared_from_this());
   }

   template <typename AccessMode>
   inline deref<node> session<AccessMode>::get_by_id(session_lock_ref<> l, id i) const
   {
      auto [ptr, type, ref] =
          ring().template get_cache<std::is_same_v<AccessMode, write_access>>(l, i);
      return {i, ptr, type};
   }

   template <typename AccessMode>
   inline deref<node> session<AccessMode>::get_by_id(session_lock_ref<> l, id i, bool& unique) const
   {
      auto [ptr, type, ref] =
          ring().template get_cache<std::is_same_v<AccessMode, write_access>>(l, i);
      unique &= ref == 1;
      return {i, ptr, type};
   }

   template <typename AccessMode>
   inline void session<AccessMode>::release(std::shared_ptr<root>& r)
   {
      if constexpr (debug_roots)
         if (r.use_count() == 1 && r->db && r->id)
            std::cout << r->id.id
                      << ": release(root): ancestor=" << (r->ancestor ? r->ancestor->id.id : 0)
                      << std::endl;
      if (r.use_count() == 1 && r->db && !r->ancestor && r->id)
      {
         auto id = r->id;
         r->id   = {};
         swap_guard g(*this);
         release(id);
      }
      r = {};
   }

   template <typename AccessMode>
   inline void session<AccessMode>::release(id obj)
   {
      _db->release(obj);
   }

   inline void database::release(id obj)
   {
      release_node(_ring, obj);
   }

   template <typename AccessMode>
   inline database::id session<AccessMode>::retain(std::unique_lock<gc_session>& session, id obj)
   {
      return bump_refcount_or_copy(ring(), session, obj);
   }

   // This always returns a view into the first argument
   inline std::string_view common_prefix(std::string_view a, std::string_view b)
   {
      return {a.begin(), std::mismatch(a.begin(), a.end(), b.begin(), b.end()).first};
   }

   inline std::shared_ptr<root> write_session::get_top_root()
   {
      _db->ensure_free_space();
      std::lock_guard<std::mutex> lock(_db->_root_change_mutex);
      auto                        id = _db->_dbm->top_root.load();
      if (!id)
         return {};

      std::unique_lock<gc_session> l(*this);
      id = retain(l, {id}).id;
      return std::make_shared<root>(root{_db, nullptr, {id}});
   }

   inline void write_session::set_top_root(const std::shared_ptr<root>& r)
   {
      _db->ensure_free_space();
      std::lock_guard<std::mutex> lock(_db->_root_change_mutex);
      auto                        current = _db->_dbm->top_root.load();
      auto                        id      = get_id(r);
      if (current == id.id)
      {
         if constexpr (debug_roots)
            std::cout << id.id << ": set_top_root: already matches" << std::endl;
         return;
      }

      std::unique_lock<gc_session> l(*this);
      if constexpr (debug_roots)
         std::cout << id.id << ": set_top_root: old=" << current << std::endl;
      id = retain(l, id);
      _db->_dbm->top_root.store(id.id);
      release({current});
   }

   inline bool write_session::get_unique(std::shared_ptr<root>& r)
   {
      // This doesn't check the refcount in object_db; that's checked elsewhere.
      return r && r->db && !r->ancestor && r.use_count() == 1;
   }

   inline void write_session::update_root(std::shared_ptr<root>& r, object_id id)
   {
      if (r && r->db && r->id == id)
      {
         // Either there was no change, or it was edited in place (but only if
         // unique). For either case, the refcount wasn't bumped and it doesn't
         // need to be bumped.
         if constexpr (debug_roots)
            std::cout << id.id << ": update_root keep" << std::endl;
         return;
      }
      else if (get_unique(r))
      {
         // Even though it is unique, it wasn't edited in place (r->id != id).
         // The new id (if not 0) has a refcount of 1, so doesn't need to be
         // bumped.
         if constexpr (debug_roots)
            std::cout << id.id << ": update_root replacing:" << r->id.id << std::endl;
         release(r->id);
         r->id = id;
      }
      else
      {
         if constexpr (debug_roots)
            if (r == nullptr)
            {
               std::cout << id.id << ": update_root original was nullptr" << std::endl;
            }
            else
            {
               std::cout << id.id << ": update_root replacing as new root:" << r->id.id
                         << std::endl;
            }
         r = std::make_shared<root>(root{_db, nullptr, id});
      }
   }

   inline mutable_deref<value_node> write_session::make_value(std::unique_lock<gc_session>& session,
                                                              node_type                     type,
                                                              string_view                   key,
                                                              string_view                   val)
   {
      return {value_node::make(ring(), session, key, val, type), type};
   }

   inline mutable_deref<value_node> write_session::clone_value(
       std::unique_lock<gc_session>& session,
       object_id                     origin,
       node_type                     type,
       string_view                   key,
       std::uint32_t                 key_offset,
       string_view                   val)
   {
      return {value_node::clone(ring(), session, origin, key, key_offset, val, type), type};
   }

   inline mutable_deref<value_node> write_session::clone_value(
       std::unique_lock<gc_session>& session,
       object_id                     origin,
       node_type                     type,
       const std::string&            key,
       string_view                   val)
   {
      return {value_node::clone(ring(), session, origin, key, -1, val, type), type};
   }

   inline mutable_deref<inner_node> write_session::make_inner(std::unique_lock<gc_session>& session,
                                                              string_view                   pre,
                                                              id                            val,
                                                              uint64_t branches)
   {
      return inner_node::make(ring(), session, pre, val, branches);
   }

   inline mutable_deref<inner_node> write_session::clone_inner(
       std::unique_lock<gc_session>& session,
       object_id                     id,
       const inner_node&             cpy,
       string_view                   pre,
       std::uint32_t                 offset,
       object_id                     val,
       uint64_t                      branches)
   {
      return inner_node::clone(ring(), session, id, &cpy, pre, offset, val, branches);
   }

   inline mutable_deref<inner_node> write_session::clone_inner(
       std::unique_lock<gc_session>& session,
       object_id                     id,
       const inner_node&             cpy,
       const std::string&            pre,
       object_id                     val,
       uint64_t                      branches)
   {
      return inner_node::clone(ring(), session, id, &cpy, pre, -1, val, branches);
   }

   template <typename T>
   inline mutable_deref<T> write_session::lock(const deref<T>& obj)
   {
      return {ring().lock(obj), obj};
   }

   /**
    *  Given an existing value node and a new key/value to insert
    */
   database::id write_session::combine_value_nodes(std::unique_lock<gc_session>& session,
                                                   node_type                     t1,
                                                   string_view                   k1,
                                                   string_view                   v1,
                                                   object_id                     origin1,
                                                   node_type                     t2,
                                                   string_view                   k2,
                                                   string_view                   v2,
                                                   object_id                     origin2)
   {
      if (k1.size() > k2.size())
         return combine_value_nodes(session, t2, k2, v2, origin2, t1, k1, v1, origin1);

      //std::cerr << __func__ << ":" << __LINE__ << "\n";
      auto cpre = common_prefix(k1, k2);

      // make_value invalidates pointers. Construct the node that is a copy
      // before the node that references external memory.  Also, ensure that
      // we release the lock on each location before the next allocation.
      auto build_children = [&](auto&& make1, auto&& make2)
      {
         object_id r1, r2;
         if (origin1)
         {
            assert(!origin2);
            cpre = k2.substr(0, cpre.size());
            r1   = make1();
            r2   = make2();
         }
         else
         {
            cpre = k1.substr(0, cpre.size());
            r2   = make2();
            r1   = make1();
         }
         return std::pair{r1, r2};
      };

      auto b2sfx = k2.substr(cpre.size());
      auto b2    = b2sfx.front();
      if (cpre == k1)
      {
         auto [inner_id, branch_id] = build_children(
             [&] { return clone_value(session, origin1, t1, k1, k1.size(), v1); },
             [&] { return clone_value(session, origin2, t2, k2, cpre.size() + 1, v2); });

         auto in = make_inner(session, cpre, id(), 1ull << b2);
         // Set value separately, because we don't want to increment its refcount
         in->set_value(inner_id);
         in->branch(b2) = branch_id;

         return in;
      }
      else
      {
         auto b1sfx        = k1.substr(cpre.size());
         auto b1           = b1sfx.front();
         auto [b1id, b2id] = build_children(
             [&] { return clone_value(session, origin1, t1, k1, cpre.size() + 1, v1); },
             [&] { return clone_value(session, origin2, t2, k2, cpre.size() + 1, v2); });

         auto in        = make_inner(session, cpre, id(), inner_node::branches(b1, b2));
         in->branch(b1) = b1id;
         in->branch(b2) = b2id;

         return in;
      }
   }

   void write_session::modify_value(mutable_deref<value_node> mut, string_view val)
   {
      if (mut.type() == node_type::roots)
      {
         if constexpr (debug_roots)
         {
            std::cout << mut.get_id().id << ": modify_value; old:";
            for (unsigned i = 0; i < mut->num_roots(); ++i)
               std::cout << " " << mut->roots()[i].id;
            std::cout << std::endl;
         }

         auto* src  = reinterpret_cast<const object_id*>(val.data());
         auto* dest = mut->roots();
         auto  n    = mut->num_roots();
         while (n--)
         {
            auto prev = *dest;
            *dest++   = *src++;
            release(prev);
         }

         if constexpr (debug_roots)
         {
            std::cout << mut.get_id().id << ": modify_value; new:";
            for (unsigned i = 0; i < mut->num_roots(); ++i)
               std::cout << " " << mut->roots()[i].id;
            std::cout << std::endl;
         }
      }
      else
         memcpy(mut->data_ptr(), val.data(), val.size());
   }

   database::id write_session::set_value(std::unique_lock<gc_session>& session,
                                         deref<node>                   n,
                                         bool                          unique,
                                         node_type                     type,
                                         string_view                   key,
                                         string_view                   val)
   {
      if (!n || !unique || type != n.type())
         return make_value(session, type, key, val);

      assert(n.is_leaf_node());

      auto& vn = n.as_value_node();
      if (vn.data_size() == val.size())
      {
         modify_value(lock(deref<value_node>(n)), val);
         return n;
      }

      return make_value(session, type, key, val);
   }

   database::id write_session::set_inner_value(std::unique_lock<gc_session>& session,
                                               deref<inner_node>             n,
                                               bool                          unique,
                                               node_type                     type,
                                               string_view                   val)
   {
      if (unique)
      {
         if (auto old_value = n->value())
         {
            auto  v  = get_by_id(session, old_value);
            auto& vn = v.as_value_node();
            if (v.type() == type && vn.data_size() == val.size() && ring().ref(old_value) == 1)
            {
               modify_value(lock(deref<value_node>(v)), val);
               return n;
            }
            else
            {
               ring().release(old_value);
            }
         }
         object_id val_id = make_value(session, type, string_view(), val);
         n.reload(ring(), session);
         auto locked = lock(n);
         locked->set_value(val_id);
         return n;
      }
      else
      {
         object_id new_val = make_value(session, type, string_view(), val);
         n.reload(ring(), session);
         auto result = clone_inner(session, n, *n, n->key(), 0, object_id{}, n->branches());
         result->set_value(new_val);
         return result;
      }
   }

   /**
    *  Given an existing tree node (root) add a new key/value under it and return the id
    *  of the new node if a new node had to be allocated.
    */
   inline database::id write_session::add_child(std::unique_lock<gc_session>& session,
                                                id                            root,
                                                bool                          unique,
                                                node_type                     type,
                                                string_view                   key,
                                                string_view                   val,
                                                int&                          old_size)
   {
      if (not root)  // empty case
         return make_value(session, type, key, val);

      auto n = get_by_id(session, root, unique);
      if (n.is_leaf_node())  // current root is value
      {
         auto& vn = n.as_value_node();
         if (vn.key() != key)
            return combine_value_nodes(session, n.type(), vn.key(), vn.data(), root, type, key, val,
                                       object_id{});
         else
         {
            old_size = vn.data_size();
            return set_value(session, n, unique, type, key, val);
         }
      }

      // current root is an inner node
      auto in     = deref<inner_node>{n};
      auto in_key = in->key();
      if (in_key == key)  // whose prefix is same as key, therefore set the value
      {
         if (in->value())
            old_size = get_by_id(session, in->value()).as_value_node().data_size();
         return set_inner_value(session, n, unique, type, val);
      }

      // key should be the first argument, because (unlike in_key)
      // it cannot be invalidated by allocation.
      auto cpre = common_prefix(key, in_key);
      if (cpre == in_key)  // value is on child branch
      {
         auto b = key[cpre.size()];

         if (!unique or not in->has_branch(b))  // copy on write
         {
            object_id cur_b = in->has_branch(b) ? in->branch(b) : object_id{};
            auto      new_b =
                add_child(session, cur_b, false, type, key.substr(cpre.size() + 1), val, old_size);
            in.reload(ring(), session);
            auto new_in = clone_inner(session, root, *in, in->key(), 0, in->value(),
                                      in->branches() | 1ull << b);

            if (new_b != cur_b)
            {
               release(cur_b);
               new_in->branch(b) = new_b;
            }

            return new_in;
         }  // else modify in place

         auto cur_b = in->branch(b);
         auto new_b =
             add_child(session, cur_b, unique, type, key.substr(cpre.size() + 1), val, old_size);

         if (new_b != cur_b)
         {
            in.reload(ring(), session);
            lock(in)->branch(b) = new_b;
            release(cur_b);
         }
         return root;
      }
      else  // the current node needs to split and become a child of new parent
      {
         if (cpre == key)  // value needs to be on a new inner node
         {
            auto b1 = in_key[cpre.size()];
            // MUST convert to id to release the location_lock
            id b1val =
                clone_inner(session, in, *in, in_key, cpre.size() + 1, in->value(), in->branches());
            id b0val = make_value(session, type, string_view(), val);

            auto nin = make_inner(session, cpre, object_id{}, inner_node::branches(b1));
            // Set separately because we don't need to inc ref
            nin->set_value(b0val);
            nin->branch(b1) = b1val;
            return nin;
         }
         else  // there are two branches
         {
            auto b1    = key[cpre.size()];
            auto b2    = in_key[cpre.size()];
            auto b1key = key.substr(cpre.size() + 1);
            // Handle sub first, because b2key is invalidated by allocation.
            // cpre and b1key are safe because they point into key, which is externally owned
            id sub =
                clone_inner(session, in, *in, in_key, cpre.size() + 1, in->value(), in->branches());
            id   b1val = make_value(session, type, b1key, val);
            auto nin   = make_inner(session, cpre, id(), inner_node::branches(b1, b2));

            assert(not nin->branch(b1));
            nin->branch(b1) = b1val;
            assert(not nin->branch(b2));
            nin->branch(b2) = sub;

            return nin;
         }
      }
   }  // write_session::add_child

   inline int write_session::upsert(std::shared_ptr<root>& r,
                                    std::span<const char>  key,
                                    std::span<const char>  val)
   {
      _db->ensure_free_space();
      std::unique_lock<gc_session> l(*this);

      int  old_size = -1;
      auto new_root =
          add_child(l, get_id(r), get_unique(r), node_type::bytes,
                    to_key6({key.data(), key.size()}), {val.data(), val.size()}, old_size);
      assert(new_root.id);
      update_root(r, new_root);
      return old_size;
   }

   inline int write_session::upsert(std::shared_ptr<root>&                 r,
                                    std::span<const char>                  key,
                                    std::span<const std::shared_ptr<root>> roots)
   {
      _db->ensure_free_space();
      std::unique_lock<gc_session> l(*this);

      std::vector<object_id> ids;
      ids.reserve(roots.size());
      for (auto& r : roots)
         ids.push_back(retain(l, get_id(r)));

      int  old_size = -1;
      auto new_root = add_child(
          l, get_id(r), get_unique(r), node_type::roots, to_key6({key.data(), key.size()}),
          {reinterpret_cast<const char*>(ids.data()), ids.size() * sizeof(object_id)}, old_size);
      assert(new_root.id);
      update_root(r, new_root);
      return old_size;
   }

#if 0
   template <typename AccessMode>
   typename session<AccessMode>::iterator& session<AccessMode>::iterator::operator++()
   {
      if constexpr (std::is_same_v<AccessMode, write_access>)
         _session->_db->ensure_free_space();
      swap_guard g(*_session);

      _session->next(*this);
      return *this;
   }
   template <typename AccessMode>
   typename session<AccessMode>::iterator& session<AccessMode>::iterator::operator--()
   {
      if constexpr (std::is_same_v<AccessMode, write_access>)
         _session->_db->ensure_free_space();
      swap_guard g(*_session);

      _session->prev(*this);
      return *this;
   }
   template <typename AccessMode>
   void session<AccessMode>::prev(iterator& itr) const
   {
      for (;;)
      {
         if (not itr.path().size())
            return;

         auto& c = itr.path().back();
         auto  n = get_by_id(session, c.first);

         if (c.second <= 0)
         {
            if (c.second == 0 and n.as_inner_node().value())
            {
               c.second = -1;
               return;
            }
         }
         else
         {
            auto& in = n.as_inner_node();
            c.second = in.reverse_lower_bound(c.second - 1);

            if (c.second >= 0)
               break;

            if (in.value())
               return;
         }
         itr.path().pop_back();
      }

      // find last
      for (;;)
      {
         auto& c = itr.path().back();
         auto  n = get_by_id(session, c.first);

         if (n.is_leaf_node())
            return;

         auto& in = n.as_inner_node();
         auto  b  = in.branch(c.second);
         auto  bi = get_by_id(session, b);

         if (bi.is_leaf_node())
         {
            itr.path().emplace_back(b, -1);
            return;
         }
         auto& bin = bi.as_inner_node();
         itr.path().emplace_back(b, bin.reverse_lower_bound(63));
      }
   }
   template <typename AccessMode>
   void session<AccessMode>::next(iterator& itr) const
   {
      while (itr.path().size())
      {
         auto& c = itr.path().back();

         auto n = get_by_id(session, c.first);

         if (not n.is_leaf_node())
         {
            auto& in = n.as_inner_node();
            c.second = in.lower_bound(c.second + 1);

            if (c.second <= 63)
            {
               // find first
               for (;;)
               {
                  auto n = get_by_id(session, itr.path().back().first);
                  if (n.is_leaf_node())
                     return;

                  auto& in = n.as_inner_node();

                  auto  b   = in.branch(itr.path().back().second);
                  auto  bi  = get_by_id(session, b);
                  auto& bin = bi.as_inner_node();

                  if (bin.value())
                  {
                     itr.path().emplace_back(b, -1);
                     return;
                  }

                  itr.path().emplace_back(b, bin.lower_bound(0));
               }
            }
         }

         itr.path().pop_back();
      }
   }

   template <typename AccessMode>
   void session<AccessMode>::iterator::value(std::string& val) const
   {
      if constexpr (std::is_same_v<AccessMode, write_access>)
         _session->_db->ensure_free_space();
      swap_guard g(*_session);

      auto dat = unguarded_value();
      val.resize(dat.size());
      memcpy(val.data(), dat.data(), dat.size());
   }

   template <typename AccessMode>
   std::string_view session<AccessMode>::iterator::unguarded_value(session_lock_ref<> l) const
   {
      if (path().size() == 0)
         return std::string_view();
      auto n = _session->get_by_id(l, path().back().first);
      if (n.is_leaf_node())
      {
         return n.as_value_node().data();
      }
      else
      {
         return _session->get_by_id(l, n.as_inner_node().value()).as_value_node().data();
      }
   }

   template <typename AccessMode>
   uint32_t session<AccessMode>::iterator::key_size() const
   {
      if constexpr (std::is_same_v<AccessMode, write_access>)
         _session->_db->ensure_free_space();
      swap_guard g(*_session);

      return unguarded_key_size();
   }

   template <typename AccessMode>
   uint32_t session<AccessMode>::iterator::unguarded_key_size() const
   {
      if (path().size() == 0)
         return 0;
      int s = path().size() - 1;

      for (auto& e : path())
      {
         auto n = _session->get_by_id(e.first);
         s += n->key_size();
      }
      return s;
   }

   template <typename AccessMode>
   uint32_t session<AccessMode>::iterator::read_key(char* data, uint32_t data_len) const
   {
      if constexpr (std::is_same_v<AccessMode, write_access>)
         _session->_db->ensure_free_space();
      swap_guard g(*_session);

      return unguarded_read_key(data, data_len);
   }

   template <typename AccessMode>
   uint32_t session<AccessMode>::iterator::unguarded_read_key(char* data, uint32_t data_len) const
   {
      auto  key_len = std::min<uint32_t>(data_len, key_size());
      char* start   = data;

      for (auto& e : path())
      {
         auto n = _session->get_by_id(e.first);
         auto b = n->key_size();
         if (b > 0)
         {
            auto        part_len = std::min<uint32_t>(key_len, b);
            const char* key_ptr;

            if (n.is_leaf_node())
            {
               key_ptr = n.as_value_node().key_ptr();
            }
            else
            {
               key_ptr = n.as_inner_node().key_ptr();
            }
            memcpy(data, key_ptr, part_len);
            key_len -= part_len;
            data += part_len;
         }

         if (key_len == 0)
            return data - start;

         *data = e.second;
         ++data;
         --key_len;

         if (key_len == 0)
            return data - start;
      }
      return data - start;
   }

   template <typename AccessMode>
   std::string session<AccessMode>::iterator::key() const
   {
      if constexpr (std::is_same_v<AccessMode, write_access>)
         _session->_db->ensure_free_space();
      swap_guard g(*_session);

      std::string result;
      result.resize(unguarded_key_size());
      unguarded_read_key(result.data(), result.size());
      return from_key6(result);
   }

   template <typename AccessMode>
   typename session<AccessMode>::iterator session<AccessMode>::first(
       const std::shared_ptr<root>& r) const
   {
      id       root = get_id(r);
      iterator result(*this);
      if (not root)
         return result;

      if constexpr (std::is_same_v<AccessMode, write_access>)
         _db->ensure_free_space();

      swap_guard g(*this);

      for (;;)
      {
         auto n = get_by_id(root);
         if (n.is_leaf_node())
         {
            result.path().emplace_back(root, -1);
            return result;
         }
         auto& in = n.as_inner_node();
         if (in.value())
         {
            result.path().emplace_back(root, -1);
            return result;
         }
         auto lb = in.lower_bound(0);
         result.path().emplace_back(root, lb);
         root = in.branch(lb);
      }
   }
   template <typename AccessMode>
   typename session<AccessMode>::iterator session<AccessMode>::last(
       const std::shared_ptr<root>& r) const
   {
      id       root = get_id(r);
      iterator result(*this);
      if (not root)
         return result;

      if constexpr (std::is_same_v<AccessMode, write_access>)
         _db->ensure_free_space();

      swap_guard g(*this);

      for (;;)
      {
         auto n = get_by_id(root);
         if (n.is_leaf_node())
         {
            result.path().emplace_back(root, -1);
            return result;
         }

         auto& in  = n.as_inner_node();
         auto  rlb = in.reverse_lower_bound(63);
         result.path().emplace_back(root, rlb);

         if (rlb < 0) [[unlikely]]  // should be impossible until keys > 128b are supported
            return result;

         root = in.branch(rlb);
      }
      return result;
   }

   template <typename AccessMode>
   typename session<AccessMode>::iterator session<AccessMode>::find(const std::shared_ptr<root>& r,
                                                                    string_view key) const
   {
      return find(r, to_key6(key));
   }
   template <typename AccessMode>
   typename session<AccessMode>::iterator session<AccessMode>::last_with_prefix(
       const std::shared_ptr<root>& r,
       string_view                  prefix) const
   {
      id       root = get_id(r);
      iterator result(*this);

      if (not root)
         return result;

      prefix = to_key6(prefix);

      if constexpr (std::is_same_v<AccessMode, write_access>)
         _db->ensure_free_space();
      swap_guard g(*this);

      for (;;)
      {
         auto n = get_by_id(root);
         if (n.is_leaf_node())
         {
            auto& vn = n.as_value_node();

            auto pre = common_prefix(vn.key(), prefix);

            if (pre == prefix)
            {
               result.path().emplace_back(root, -1);
               return result;
            }
            return iterator(*this);
         }

         auto& in     = n.as_inner_node();
         auto  in_key = in.key();

         if (in_key == prefix)
         {
            for (;;)  // find last
            {
               auto n = get_by_id(root);

               if (n.is_leaf_node())
               {
                  result.path().emplace_back(root, -1);
                  return result;
               }

               auto& in = n.as_inner_node();
               auto  b  = in.reverse_lower_bound(63);

               if (b == -1) [[unlikely]]
               {  /// this should be impossible in well formed tree
                  result.path().emplace_back(root, -1);
                  return result;
               }

               result.path().emplace_back(root, b);
               root = in.branch(b);
            }
            return result;
         }

         auto cpre = common_prefix(in_key, prefix);
         if (in_key.size() > prefix.size())
         {
            if (cpre == prefix)
            {
               result.path().emplace_back(root, -1);
               return result;
            }
            return iterator(*this);
         }
         if (cpre != in_key)
            break;

         auto b = in.lower_bound(prefix[cpre.size()]);
         root   = in.branch(b);
         prefix = prefix.substr(cpre.size() + 1);
      }
      return iterator(*this);
   }
   template <typename AccessMode>
   typename session<AccessMode>::iterator session<AccessMode>::lower_bound(
       const std::shared_ptr<root>& r,
       string_view                  key) const
   {
      id       root = get_id(r);
      iterator result(*this);
      if (not root)
         return result;

      key = to_key6(key);

      if constexpr (std::is_same_v<AccessMode, write_access>)
         _db->ensure_free_space();
      swap_guard g(*this);
      for (;;)
      {
         auto n = get_by_id(g, root);
         if (n.is_leaf_node())
         {
            auto& vn = n.as_value_node();

            result.path().emplace_back(root, -1);

            if (vn.key() < key)
               next(result);

            return result;
         }

         auto& in     = n.as_inner_node();
         auto  in_key = in.key();

         if (in_key >= key)
         {
            result.path().emplace_back(root, -1);
            if (not in.value())
               next(result);
            return result;
         }

         auto cpre = common_prefix(key, in_key);
         if (key <= cpre)
         {
            result.path().emplace_back(root, -1);
            if (not in.value())
               next(result);
            return result;
         }

         // key > cpre

         auto b = in.lower_bound(key[cpre.size()]);
         if (b < 64)
         {
            result.path().emplace_back(root, b);
            root = in.branch(b);
            key  = key.substr(cpre.size() + 1);
            continue;
         }

         return result;
      }
   }

   template <typename AccessMode>
   inline typename session<AccessMode>::iterator session<AccessMode>::find(id          root,
                                                                           string_view key) const
   {
      if (not root)
         return iterator(*this);

      iterator result(*this);

      if constexpr (std::is_same_v<AccessMode, write_access>)
         _db->ensure_free_space();

      swap_guard g(*this);
      for (;;)
      {
         auto n = get_by_id(root);
         if (n.is_leaf_node())
         {
            auto& vn = n.as_value_node();
            if (vn.key() == key)
            {
               result.path().emplace_back(root, -1);
               return result;
            }
            break;
         }

         auto& in     = n.as_inner_node();
         auto  in_key = in.key();

         if (key.size() < in_key.size())
            break;

         if (key == in_key)
         {
            if (not in.value())
               break;

            //result.path().emplace_back(root, -1);
            root = in.value();
            key  = string_view();
            continue;
         }

         auto cpre = common_prefix(key, in_key);
         if (cpre != in_key)
            break;

         auto b = key[cpre.size()];

         if (not in.has_branch(b))
            break;

         result.path().emplace_back(root, b);
         key  = key.substr(cpre.size() + 1);
         root = in.branch(b);
      }
      return iterator(*this);
   }
#endif

   template <typename AccessMode>
   std::optional<std::vector<char>> session<AccessMode>::get(const std::shared_ptr<root>& r,
                                                             std::span<const char>        key) const
   {
      std::vector<char> result;
      if (get(r, key, &result, nullptr))
         return std::optional(std::move(result));
      return std::nullopt;
   }

   template <typename AccessMode>
   bool session<AccessMode>::get(const std::shared_ptr<root>&        r,
                                 std::span<const char>               key,
                                 std::vector<char>*                  result_bytes,
                                 std::vector<std::shared_ptr<root>>* result_roots) const
   {
      if constexpr (std::is_same_v<AccessMode, write_access>)
         _db->ensure_free_space();
      swap_guard g(*this);
      return unguarded_get(g, r, get_id(r), to_key6({key.data(), key.size()}), result_bytes,
                           result_roots);
   }

   template <typename AccessMode>
   bool session<AccessMode>::unguarded_get(
       session_lock_ref<>                            l,
       const std::shared_ptr<triedent::root>&        ancestor,
       object_id                                     root,
       std::string_view                              key,
       std::vector<char>*                            result_bytes,
       std::vector<std::shared_ptr<triedent::root>>* result_roots) const
   {
      if (not root)
         return false;

      for (;;)
      {
         auto n = get_by_id(l, root);
         if (n.is_leaf_node())
         {
            auto& vn = n.as_value_node();
            if (vn.key() == key)
               return fill_result(ancestor, vn, n.type(), result_bytes, result_roots);
            return false;
         }
         auto& in     = n.as_inner_node();
         auto  in_key = in.key();

         if (key.size() < in_key.size())
            return false;

         if (key == in_key)
         {
            root = in.value();

            if (not root)
               return false;

            key = string_view();
            continue;
         }

         auto cpre = common_prefix(key, in_key);
         if (cpre != in_key)
            return false;

         auto b = key[cpre.size()];

         if (not in.has_branch(b))
            return false;

         key  = key.substr(cpre.size() + 1);
         root = in.branch(b);
      }
      return false;
   }

   template <typename AccessMode>
   bool session<AccessMode>::fill_result(const std::shared_ptr<root>&        ancestor,
                                         const value_node&                   vn,
                                         node_type                           type,
                                         std::vector<char>*                  result_bytes,
                                         std::vector<std::shared_ptr<root>>* result_roots) const
   {
      if (result_bytes)
      {
         auto sz = vn.data_size();
         result_bytes->resize(sz);
         memcpy(result_bytes->data(), vn.data_ptr(), sz);
      }
      if (result_roots)
      {
         if (type == node_type::roots)
         {
            auto  nr  = vn.num_roots();
            auto* src = vn.roots();
            result_roots->resize(nr);
            for (uint32_t i = 0; i < nr; ++i)
               (*result_roots)[i] = std::make_shared<root>(root{_db, ancestor, src[i]});
         }
         else
            result_roots->clear();
      }
      return true;
   }

   template <typename AccessMode>
   bool session<AccessMode>::get_greater_equal(
       const std::shared_ptr<root>&        r,
       std::span<const char>               key,
       std::vector<char>*                  result_key,
       std::vector<char>*                  result_bytes,
       std::vector<std::shared_ptr<root>>* result_roots) const
   {
      if constexpr (std::is_same_v<AccessMode, write_access>)
         _db->ensure_free_space();
      swap_guard        g(*this);
      std::vector<char> result_key6;
      if (!unguarded_get_greater_equal(g, r, get_id(r), to_key6({key.data(), key.size()}),
                                       result_key6, result_bytes, result_roots))
         return false;
      if (result_key)
      {
         auto s = from_key6({result_key6.data(), result_key6.size()});
         result_key->assign(s.begin(), s.end());
      }
      return true;
   }

   template <typename AccessMode>
   bool session<AccessMode>::unguarded_get_greater_equal(
       session_lock_ref<>                            l,
       const std::shared_ptr<triedent::root>&        ancestor,
       object_id                                     root,
       std::string_view                              key,
       std::vector<char>&                            result_key,
       std::vector<char>*                            result_bytes,
       std::vector<std::shared_ptr<triedent::root>>* result_roots) const
   {
      if (!root)
         return false;
      auto n = get_by_id(l, root);
      if (n.is_leaf_node())
      {
         auto& vn     = n.as_value_node();
         auto  vn_key = vn.key();
         if (vn_key < key)
            return false;
         result_key.insert(result_key.end(), vn_key.begin(), vn_key.end());
         return fill_result(ancestor, vn, n.type(), result_bytes, result_roots);
      }
      auto& in     = n.as_inner_node();
      auto  in_key = in.key();
      auto  cpre   = common_prefix(in_key, key);
      if (cpre == in_key)
         key = key.substr(cpre.size());
      else if (in_key < key)
         return false;
      else
         key = {};
      result_key.insert(result_key.end(), in_key.begin(), in_key.end());
      uint8_t start_b = 0;
      if (!key.empty())
      {
         start_b = key[0];
         key     = key.substr(1);
      }
      else if (in.value())
      {
         auto  v  = get_by_id(l, in.value());
         auto& vn = v.as_value_node();
         return fill_result(ancestor, vn, v.type(), result_bytes, result_roots);
      }
      auto b = in.lower_bound(start_b);
      if (b > start_b)
         key = {};
      while (true)
      {
         if (b >= 64)
            return false;
         auto rk = result_key.size();
         result_key.push_back(b);
         if (unguarded_get_greater_equal(l, ancestor, in.branch(b), key, result_key, result_bytes,
                                         result_roots))
            return true;
         result_key.resize(rk);
         b   = in.lower_bound(b + 1);
         key = {};
      }
   }  // unguarded_get_greater_equal

   template <typename AccessMode>
   bool session<AccessMode>::get_less_than(const std::shared_ptr<root>&        r,
                                           std::span<const char>               key,
                                           std::vector<char>*                  result_key,
                                           std::vector<char>*                  result_bytes,
                                           std::vector<std::shared_ptr<root>>* result_roots) const
   {
      if constexpr (std::is_same_v<AccessMode, write_access>)
         _db->ensure_free_space();
      swap_guard        g(*this);
      std::vector<char> result_key6;
      if (!unguarded_get_less_than(g, r, get_id(r), to_key6({key.data(), key.size()}), result_key6,
                                   result_bytes, result_roots))
         return false;
      if (result_key)
      {
         auto s = from_key6({result_key6.data(), result_key6.size()});
         result_key->assign(s.begin(), s.end());
      }
      return true;
   }

   template <typename AccessMode>
   bool session<AccessMode>::unguarded_get_less_than(
       session_lock_ref<>                            l,
       const std::shared_ptr<triedent::root>&        ancestor,
       object_id                                     root,
       std::optional<std::string_view>               key,
       std::vector<char>&                            result_key,
       std::vector<char>*                            result_bytes,
       std::vector<std::shared_ptr<triedent::root>>* result_roots) const
   {
      if (!root)
         return false;
      auto n = get_by_id(l, root);
      if (n.is_leaf_node())
      {
         auto& vn     = n.as_value_node();
         auto  vn_key = vn.key();
         if (key && vn_key >= *key)
            return false;
         result_key.insert(result_key.end(), vn_key.begin(), vn_key.end());
         return fill_result(ancestor, vn, n.type(), result_bytes, result_roots);
      }
      auto&   in     = n.as_inner_node();
      auto    in_key = in.key();
      uint8_t last_b = 63;
      if (key)
      {
         if (in_key >= *key)
            return false;
         auto cpre = common_prefix(in_key, *key);
         if (cpre == in_key)
         {
            last_b = (*key)[cpre.size()];
            key    = key->substr(cpre.size() + 1);
         }
         else
            key = std::nullopt;
      }
      result_key.insert(result_key.end(), in_key.begin(), in_key.end());
      auto b = in.reverse_lower_bound(last_b);
      if (b < last_b)
         key = std::nullopt;
      while (b >= 0)
      {
         auto rk = result_key.size();
         result_key.push_back(b);
         if (unguarded_get_less_than(l, ancestor, in.branch(b), key, result_key, result_bytes,
                                     result_roots))
            return true;
         result_key.resize(rk);
         if (b < 1)
            break;
         b   = in.reverse_lower_bound(b - 1);
         key = std::nullopt;
      }
      if (in.value())
      {
         auto  v  = get_by_id(l, in.value());
         auto& vn = v.as_value_node();
         return fill_result(ancestor, vn, v.type(), result_bytes, result_roots);
      }
      return false;
   }  // unguarded_get_less_than

   template <typename AccessMode>
   bool session<AccessMode>::get_max(const std::shared_ptr<root>&        r,
                                     std::span<const char>               prefix,
                                     std::vector<char>*                  result_key,
                                     std::vector<char>*                  result_bytes,
                                     std::vector<std::shared_ptr<root>>* result_roots) const
   {
      if constexpr (std::is_same_v<AccessMode, write_access>)
         _db->ensure_free_space();
      swap_guard g(*this);
      auto       prefix_min = to_key6({prefix.data(), prefix.size()});
      auto       extra_bits = prefix_min.size() * 6 - prefix.size() * 8;
      auto       prefix_max = (std::string)prefix_min;
      if (!prefix_max.empty())
         prefix_max.back() |= (1 << extra_bits) - 1;
      std::vector<char> result_key6;
      if (!unguarded_get_max(g, r, get_id(r), prefix_min, prefix_max, result_key6, result_bytes,
                             result_roots))
         return false;
      if (result_key)
      {
         auto s = from_key6({result_key6.data(), result_key6.size()});
         result_key->assign(s.begin(), s.end());
      }
      return true;
   }

   template <typename AccessMode>
   bool session<AccessMode>::unguarded_get_max(
       session_lock_ref<>                            l,
       const std::shared_ptr<triedent::root>&        ancestor,
       object_id                                     root,
       std::string_view                              prefix_min,
       std::string_view                              prefix_max,
       std::vector<char>&                            result_key,
       std::vector<char>*                            result_bytes,
       std::vector<std::shared_ptr<triedent::root>>* result_roots) const
   {
      if (!root)
         return false;

      while (true)
      {
         auto n = get_by_id(l, root);
         if (n.is_leaf_node())
         {
            auto& vn     = n.as_value_node();
            auto  vn_key = vn.key();
            if (vn_key.size() < prefix_min.size() ||
                memcmp(vn_key.data(), prefix_min.data(), prefix_min.size()) < 0 ||
                memcmp(vn_key.data(), prefix_max.data(), prefix_max.size()) > 0)
               return false;
            result_key.insert(result_key.end(), vn_key.begin(), vn_key.end());
            return fill_result(ancestor, vn, n.type(), result_bytes, result_roots);
         }

         auto& in     = n.as_inner_node();
         auto  in_key = in.key();
         auto  l      = std::min(in_key.size(), prefix_min.size());
         if (memcmp(in_key.data(), prefix_min.data(), l) < 0 ||
             memcmp(in_key.data(), prefix_max.data(), l) > 0)
            return false;

         result_key.insert(result_key.end(), in_key.begin(), in_key.end());
         prefix_min = prefix_min.substr(l);
         prefix_max = prefix_max.substr(l);

         int8_t first_b = 0;
         int8_t last_b  = 63;
         if (!prefix_min.empty())
         {
            first_b    = prefix_min[0];
            last_b     = prefix_max[0];
            prefix_min = prefix_min.substr(1);
            prefix_max = prefix_max.substr(1);
         }

         auto b = in.reverse_lower_bound(last_b);
         if (b < first_b)
            return false;
         result_key.push_back(b);
         root = in.branch(b);
      }
   }  // unguarded_get_max

   inline int write_session::remove(std::shared_ptr<root>& r, std::span<const char> key)
   {
      _db->ensure_free_space();
      std::unique_lock<gc_session> l(*this);

      int  removed_size = -1;
      auto new_root = remove_child(l, get_id(r), get_unique(r), to_key6({key.data(), key.size()}),
                                   removed_size);
      update_root(r, new_root);
      return removed_size;
   }

   inline database::id write_session::remove_child(std::unique_lock<gc_session>& session,
                                                   id                            root,
                                                   bool                          unique,
                                                   string_view                   key,
                                                   int&                          removed_size)
   {
      if (not root)
         return root;

      auto n = get_by_id(session, root, unique);
      if (n.is_leaf_node())  // current root is value
      {
         auto& vn = n.as_value_node();
         if (vn.key() == key)
         {
            removed_size = vn.data_size();
            return id();
         }
         return root;
      }

      deref<inner_node> in{n};
      auto              in_key = in->key();

      if (in_key.size() > key.size())
         return root;

      if (in_key == key)
      {
         auto iv = in->value();
         if (not iv)
            return root;
         removed_size = get_by_id(session, iv).as_value_node().data_size();

         if (in->num_branches() == 1)
         {
            char        b  = std::countr_zero(in->branches());
            auto        bn = get_by_id(session, *in->children());
            std::string new_key;
            new_key += in_key;
            new_key += b;

            if (bn.is_leaf_node())
            {
               auto& vn = bn.as_value_node();
               new_key += vn.key();
               //           TRIEDENT_DEBUG( "clone value" );
               return clone_value(session, bn, bn.type(), new_key, vn.data());
            }
            else
            {
               auto& bin = bn.as_inner_node();
               new_key += bin.key();
               //          TRIEDENT_DEBUG( "clone inner " );
               return clone_inner(session, bn, bin, new_key, bin.value(), bin.branches());
            }
         }

         if (unique)
         {
            auto locked = lock(in);
            release(locked->value());
            locked->set_value(id());
            return root;
         }
         else
            return clone_inner(session, in, *in, key, 0, id(), in->branches());
      }

      auto cpre = common_prefix(in_key, key);
      if (cpre != in_key)
         return root;

      auto b = key[in_key.size()];
      if (not in->has_branch(b))
         return root;

      object_id cur_b = in->branch(b);

      auto new_b =
          remove_child(session, cur_b, unique, key.substr(in_key.size() + 1), removed_size);
      if (new_b != cur_b)
      {
         in.reload(ring(), session);
         if (new_b and unique)
         {
            release(cur_b);
            lock(in)->branch(b) = new_b;
            return root;
         }
         if (new_b)  // update branch
         {
            auto new_root =
                clone_inner(session, in, *in, in->key(), 0, in->value(), in->branches());
            auto& new_br = new_root->branch(b);
            release(new_br);
            new_br = new_b;
            return new_root;
         }
         else  // remove branch
         {
            auto new_branches = in->branches() & ~inner_node::branches(b);
            if (std::popcount(new_branches) + bool(in->value()) > 1)
            {  // multiple branches remain, nothing to merge up, just realloc without branch
               //   TRIEDENT_WARN( "clone without branch" );
               return clone_inner(session, in, *in, in->key(), 0, in->value(), new_branches);
            }
            if (not new_branches)
            {
               //    TRIEDENT_WARN( "merge inner.key() + value.key() and return new value node" );
               // since we can only remove one item at a time, and this node exists
               // then it means it either had 2 branches before or 1 branch and a value
               // in this case, not branches means it must have a value
               assert(in->value() and "expected value because we removed a branch");

               auto  cur_v = get_by_id(session, in->value());
               auto& cv    = cur_v.as_value_node();
               // make a copy because key and data come from different objects, which clone doesn't handle.
               std::string new_key{in->key()};
               return clone_value(session, cur_v, cur_v.type(), new_key, cv.data());
            }
            else
            {  // there must be only 1 branch left
               //     TRIEDENT_WARN( "merge inner.key() + b + value.key() and return new value node" );

               auto  lb          = std::countr_zero(in->branches() ^ inner_node::branches(b));
               auto& last_branch = in->branch(lb);
               // the one branch is either a value or a inner node
               auto cur_v = get_by_id(session, last_branch);
               if (cur_v.is_leaf_node())
               {
                  auto&       cv = cur_v.as_value_node();
                  std::string new_key;
                  new_key += in->key();
                  new_key += char(lb);
                  new_key += cv.key();
                  return clone_value(session, cur_v, cur_v.type(), new_key, cv.data());
               }
               else
               {
                  auto&       cv = cur_v.as_inner_node();
                  std::string new_key;
                  new_key += in->key();
                  new_key += char(lb);
                  new_key += cv.key();
                  return clone_inner(session, cur_v, cv, new_key, cv.value(), cv.branches());
               }
            }
         }
      }
      return root;
   }

   template <typename AccessMode>
   void session<AccessMode>::print(const std::shared_ptr<root>& r)
   {
      print(get_id(r), string_view(), "");
   }

   template <typename AccessMode>
   void session<AccessMode>::validate(const std::shared_ptr<root>& r)
   {
      swap_guard l{*this};
      validate(l, get_id(r));
   }

   template <typename AccessMode>
   void session<AccessMode>::print(id r, string_view prefix, std::string key)
   {
      /*
      auto print_key = [](std::string k)
      { std::cerr << std::right << std::setw(30) << from_key(k) << ": "; };
      if (not r)
      {
         std::cerr << "~\n";
         return;
      }

      auto dr = get_by_id(r);
      if (dr.is_leaf_node())
      {
         auto dat = dr.as_value_node().data();
         std::cerr << "'" << from_key(dr.as_value_node().key()) << "' => ";
         std::cerr << (dat.size() > 20 ? string_view("BIG DAT") : dat) << ": " << r.id << "  vr"
                   << _db->_ring->ref(r) << "   ";
         print_key(key + std::string(dr.as_value_node().key()));
         std::cerr << "\n";
      }
      else
      {
         auto& in = dr.as_inner_node();
         std::cerr << " '" << from_key(in.key()) << "' = "
                   << (in.value().id ? get_by_id(in.value()).as_value_node().data()
                                     : std::string_view("''"))
                   << ": i# " << r.id << " v#" << in.value().id << "  vr"
                   << _db->_ring->ref(in.value()) << "  nr" << _db->_ring->ref(r) << "   ";
         print_key(key + std::string(in.key()));
         std::cerr << "\n";

         //  std::cout <<"NUM BR: " << in.num_branches() <<"\n";
         for (char i = 0; i < 64; ++i)
         {
            if (in.has_branch(i))
            {
               std::cerr << prefix << "    " << from_key(string_view(&i, 1)) << " => ";
               std::string p(prefix);
               p += "    ";
               print(in.branch(i), p, key + std::string(in.key()) + char(i));
            }
         }
      }
      */
   }

   /*
    * visit every node in the tree and retain it. This is used in garbage collection
    * after a crash.
    */
   inline void write_session::recursive_retain()
   {
      object_id id;
      {
         std::lock_guard<std::mutex> lock(_db->_root_change_mutex);
         id = {_db->_dbm->top_root.load()};
      }
      swap_guard l{*this};
      recursive_retain(l, id);
   }

   inline void write_session::recursive_retain(session_lock_ref<> l, id r)
   {
      if (not r)
         return;
      int cur_ref_count = ring().ref(r);

      // TODO: rework recursive_retain to fix up overflow; will require
      //       cloning nodes and tracking the clones. Or just detect
      //       and give up.
      ring().dangerous_retain(r);

      if (cur_ref_count > 1)  // 1 is the default ref when resetting all
         return;              // retaining this node indirectly retains all children

      auto dr = get_by_id(l, r);
      if (not dr.is_leaf_node())
      {
         auto& in = dr.as_inner_node();

         recursive_retain(l, in.value());

         auto* c = in.children();
         auto* e = c + in.num_branches();
         while (c != e)
         {
            recursive_retain(l, *c);
            ++e;
         }
      }

      // TODO: leaves which point to roots
   }

   inline void write_session::start_collect_garbage()
   {
      ring().reset_all_ref_counts(1);
   }
   inline void write_session::end_collect_garbage()
   {
      ring().adjust_all_ref_counts(-1);
      // TODO: Counts fell to 0 without being added to free list.
      //       Since there might be cases where SIGKILL also cause
      //       this, we probably need to rebuild the free list
      //       from scratch.
   }

   template <typename AccessMode>
   inline object_id session<AccessMode>::get_id(const std::shared_ptr<root>& r) const
   {
      if (!r || !r->db)
         return {};
      if (r->db != _db)
         throw std::runtime_error("root is from a different database");
      return r->id;
   }

   template <typename AccessMode>
   void session<AccessMode>::validate(session_lock_ref<> l, id r)
   {
      if (not r)
         return;

      auto validate_id = [&](auto i)
      {
         ring().validate(r);
         if (0 == ring().ref(r))
            throw std::runtime_error("found reference to object with 0 ref count: " +
                                     std::to_string(r.id));
      };

      validate_id(r);

      auto dr = get_by_id(l, r);
      if (not dr.is_leaf_node())
      {
         auto& in = dr.as_inner_node();
         validate(l, in.value());

         auto* c = in.children();
         auto* e = c + in.num_branches();
         while (c != e)
         {
            validate(l, *c);
            ++c;
         }
      }
   }

   inline key_type from_key6(const key_view sixb)
   {
      std::string out;
      out.resize((sixb.size() * 6) / 8);

      const uint8_t* pos6     = (uint8_t*)sixb.data();
      const uint8_t* pos6_end = (uint8_t*)sixb.data() + sixb.size();
      uint8_t*       pos8     = (uint8_t*)out.data();

      while (pos6_end - pos6 >= 4)
      {
         pos8[0] = (pos6[0] << 2) | (pos6[1] >> 4);  // 6 + 2t
         pos8[1] = (pos6[1] << 4) | (pos6[2] >> 2);  // 4b + 4t
         pos8[2] = (pos6[2] << 6) | pos6[3];         // 2b + 6
         pos6 += 4;
         pos8 += 3;
      }
      switch (pos6_end - pos6)
      {
         case 3:
            pos8[0] = (pos6[0] << 2) | (pos6[1] >> 4);  // 6 + 2t
            pos8[1] = (pos6[1] << 4) | (pos6[2] >> 2);  // 4b + 4t
            //    pos8[2] = (pos6[2] << 6);                   // 2b + 6-0
            break;
         case 2:
            pos8[0] = (pos6[0] << 2) | (pos6[1] >> 4);  // 6 + 2t
            //     pos8[1] = (pos6[1] << 4);                   // 4b + 4-0
            break;
         case 1:
            pos8[0] = (pos6[0] << 2);  // 6 + 2-0
            break;
      }
      return out;
   }
   inline key_view to_key6(key_type& key_buf, key_view v)
   {
      uint32_t bits  = v.size() * 8;
      uint32_t byte6 = (bits + 5) / 6;

      key_buf.resize(byte6);

      uint8_t*       pos6     = (uint8_t*)key_buf.data();
      const uint8_t* pos8     = (uint8_t*)v.data();
      const uint8_t* pos8_end = (uint8_t*)v.data() + v.size();

      while (pos8_end - pos8 >= 3)
      {
         pos6[0] = pos8[0] >> 2;
         pos6[1] = (pos8[0] & 0x3) << 4 | pos8[1] >> 4;
         pos6[2] = (pos8[1] & 0xf) << 2 | (pos8[2] >> 6);
         pos6[3] = pos8[2] & 0x3f;
         pos8 += 3;
         pos6 += 4;
      }

      switch (pos8_end - pos8)
      {
         case 2:
            pos6[0] = pos8[0] >> 2;
            pos6[1] = (pos8[0] & 0x3) << 4 | pos8[1] >> 4;
            pos6[2] = (pos8[1] & 0xf) << 2;
            break;
         case 1:
            pos6[0] = pos8[0] >> 2;
            pos6[1] = (pos8[0] & 0x3) << 4;
            break;
         default:
            break;
      }
      return {key_buf.data(), key_buf.size()};
   }
   inline key_view session_base::to_key6(key_view v) const
   {
      return triedent::to_key6(key_buf, v);
   }
   // TODO: Remove this as it isn't needed anymore and never quite
   // worked correctly anyway.
   inline void database::ensure_free_space()
   {
      //_ring->ensure_free_space();
   }

}  // namespace triedent
