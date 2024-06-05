#pragma once

#include <algorithm>
#include <memory>
#include <optional>
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
   inline key_view to_key6(key_type& key_buf, key_view v);

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
     public:
      // This is more efficient than simply dropping r since it
      // doesn't usually lock a mutex. However, like dropping r,
      // it still recurses, so there may be an advantage to
      // calling this from a dedicated cleanup thread.
      void release(std::shared_ptr<root>& r);

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

      // Returns true iff r does not have any keys in the range [lower, upper)
      //
      // If upper is empty, it is considered greater than any key.
      bool is_empty(const std::shared_ptr<root>& r,
                    std::span<const char>        lower,
                    std::span<const char>        upper) const;

      // Returns true if r1 and r2 have a common ancestor and the sequence
      //   of operations used to create r1 and r2 from the nearest common ancestor
      //   did not modify any keys in the range [lower, upper)
      // Returns false if r1 and r2 are different over the range [lower, upper)
      // Otherwise the result is unspecified
      //
      // If upper is empty it is considered greater than any key.
      bool is_equal_weak(const std::shared_ptr<root>& r1,
                         const std::shared_ptr<root>& r2,
                         std::span<const char>        lower,
                         std::span<const char>        upper) const;

      void print(const std::shared_ptr<root>& r);
      void validate(const std::shared_ptr<root>& r);

      session(std::shared_ptr<database> db);
      ~session();

      inline deref<node> get_by_id(session_lock_ref<> l, object_id i) const;
      inline deref<node> get_by_id(session_lock_ref<> l, object_id i, bool& unique) const;
      inline id          retain(std::unique_lock<gc_session>&, id);
      inline void        release(session_lock_ref<> l, id);
      cache_allocator&   ring() const;

     protected:
      session(const session&) = delete;

      inline object_id get_id(const std::shared_ptr<root>& r) const;
      void             validate(session_lock_ref<> l, id);
      void             print(id n, string_view prefix = "", std::string k = "");

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

      friend class database;
      std::shared_ptr<database> _db;
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

      // removes all elements of r outside [lower, upper)
      // if upper is empty it is considered higher than any key
      void take(std::shared_ptr<root>& r, std::span<const char> lower, std::span<const char> upper);

      // replaces the range [lower, upper) in r1 with the same range from r2.
      //
      // r1 = r1(-inf, lower) + r2[lower, upper) + r1[upper, inf)
      inline void splice(std::shared_ptr<root>&       r1,
                         const std::shared_ptr<root>& r2,
                         std::span<const char>        lower,
                         std::span<const char>        upper);

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
      inline void update_root(session_lock_ref<> l, std::shared_ptr<root>& r, object_id id);

      void recursive_retain(session_lock_ref<> l, object_id id);

     public:
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

     private:
      template <typename T>
      inline mutable_deref<T> lock(const deref<T>& obj, session_lock_ref<> session);

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

      inline void modify_value(session_lock_ref<>        l,
                               mutable_deref<value_node> mut,
                               string_view               val);
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
      using config                     = cache_allocator::config;
      static constexpr auto read_write = access_mode::read_write;
      static constexpr auto read_only  = access_mode::read_only;

      using string_view = std::string_view;
      using id          = object_id;

      database(const std::filesystem::path& dir,
               const config&                cfg,
               access_mode                  mode,
               bool                         allow_gc = false);
      database(const std::filesystem::path& dir, access_mode mode, bool allow_gc = false);
      ~database();

      static void create(std::filesystem::path dir, config);

      std::shared_ptr<write_session> start_write_session();
      std::shared_ptr<read_session>  start_read_session();

      void print_stats(std::ostream& os, bool detail = false);

      bool is_slow() const { return _ring.is_slow(); }
      auto span() const { return _ring.span(); }

      // returns true if there are no allocated nodes.
      bool is_empty() const { return _ring.is_empty(); }

     private:
      inline void release(session_lock_ref<> l, id);

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
         db->release(guard, id);
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

      std::string_view get_key() const
      {
         return is_leaf_node() ? as_value_node().key() : as_inner_node().key();
      }
      id branch(std::uint8_t b) const { return is_leaf_node() ? id{} : as_inner_node().branch(b); }
      id value() const { return is_leaf_node() ? _id : as_inner_node().value(); }
      auto branches() const { return is_leaf_node() ? 0 : as_inner_node().branches(); }
      id   maybe_branch(std::uint8_t b) const
      {
         return is_leaf_node() ? id{} : as_inner_node().maybe_branch(b);
      }

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
      mutable_deref(location_lock l, void* p, node_type t)
          : deref<T>{l.get_id(), p, t}, lock{std::move(l)}
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
      auto [ptr, type, ref] = ring().template get_cache<true>(l, i);
      return {i, ptr, type};
   }

   template <typename AccessMode>
   inline deref<node> session<AccessMode>::get_by_id(session_lock_ref<> l, id i, bool& unique) const
   {
      auto [ptr, type, ref] = ring().template get_cache<true>(l, i);
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
         release(g, id);
      }
      r = {};
   }

   template <typename AccessMode>
   inline void session<AccessMode>::release(session_lock_ref<> l, id obj)
   {
      _db->release(l, obj);
   }

   inline void database::release(session_lock_ref<> l, id obj)
   {
      release_node(l, _ring, obj);
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
      std::lock_guard<std::mutex> lock(_db->_root_change_mutex);
      auto                        id = _db->_dbm->top_root.load();
      if (!id)
         return {};

      if (_db->_file.mode() == access_mode::read_only)
      {
         // If the file was opened in read_only mode, the root cannot be
         // changed, so we don't need to increment the refcount.
         auto result = std::make_shared<root>(root{_db, nullptr, {id}});
         // Prevent ~root from decrementing the refcount
         result->ancestor = std::shared_ptr<root>{std::shared_ptr<void>{}, result.get()};
         return result;
      }

      std::unique_lock<gc_session> l(*this);
      id = retain(l, {id}).id;
      return std::make_shared<root>(root{_db, nullptr, {id}});
   }

   inline void write_session::set_top_root(const std::shared_ptr<root>& r)
   {
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
      release(l, {current});
   }

   inline bool write_session::get_unique(std::shared_ptr<root>& r)
   {
      // This doesn't check the refcount in object_db; that's checked elsewhere.
      return r && r->db && !r->ancestor && r.use_count() == 1;
   }

   inline void write_session::update_root(session_lock_ref<>     l,
                                          std::shared_ptr<root>& r,
                                          object_id              id)
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
         release(l, r->id);
         r->id = id;
      }
      else
      {
         if constexpr (debug_roots)
         {
            if (r == nullptr)
            {
               std::cout << id.id << ": update_root original was nullptr" << std::endl;
            }
            else
            {
               std::cout << id.id << ": update_root replacing as new root:" << r->id.id
                         << std::endl;
            }
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
   inline mutable_deref<T> write_session::lock(const deref<T>& obj, session_lock_ref<> session)
   {
      cache_allocator& r = ring();
      auto             l = r.lock(obj);
      // We MUST get an updated pointer after acquiring the lock, because if the
      // object has moved, modifications made to the old location will be lost.
      auto [p, type, ref] = r.get_cache<false>(session, obj);
      return {std::move(l), p, type};
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

   void write_session::modify_value(session_lock_ref<>        l,
                                    mutable_deref<value_node> mut,
                                    string_view               val)
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
            release(l, prev);
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
         modify_value(session, lock(deref<value_node>(n), session), val);
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
               modify_value(session, lock(deref<value_node>(v), session), val);
               return n;
            }
            else
            {
               ring().release(session, old_value);
            }
         }
         object_id val_id = make_value(session, type, string_view(), val);
         n.reload(ring(), session);
         auto locked = lock(n, session);
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
               new_in->branch(b) = new_b;
               release(session, cur_b);
            }

            return new_in;
         }  // else modify in place

         auto cur_b = in->branch(b);
         auto new_b =
             add_child(session, cur_b, unique, type, key.substr(cpre.size() + 1), val, old_size);

         if (new_b != cur_b)
         {
            in.reload(ring(), session);
            lock(in, session)->branch(b) = new_b;
            release(session, cur_b);
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
      std::unique_lock<gc_session> l(*this);

      int  old_size = -1;
      auto new_root =
          add_child(l, get_id(r), get_unique(r), node_type::bytes,
                    to_key6({key.data(), key.size()}), {val.data(), val.size()}, old_size);
      assert(new_root.id);
      update_root(l, r, new_root);
      return old_size;
   }

   inline int write_session::upsert(std::shared_ptr<root>&                 r,
                                    std::span<const char>                  key,
                                    std::span<const std::shared_ptr<root>> roots)
   {
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
      update_root(l, r, new_root);
      return old_size;
   }

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

   namespace detail
   {

      struct static_key_base
      {
         bool starts_with(const std::string_view&) const { return false; }
         char operator[](std::size_t) const
         {
            assert(!"operator[] should be gated on starts_with");
            __builtin_unreachable();
         }
         void remove_prefix(std::size_t) const
         {
            assert(!"remove_prefix should be gated on starts_with");
            __builtin_unreachable();
         }
         std::string_view substr(std::size_t, std::size_t = 0) const
         {
            assert(!"substr should be gated on starts_with");
            __builtin_unreachable();
         }
      };

      struct lowest_key : static_key_base
      {
      };
      inline auto operator<=>(const lowest_key&, const std::string_view&)
      {
         return std::strong_ordering::less;
      }
      struct highest_key : static_key_base
      {
      };
      inline auto operator<=>(const highest_key&, const std::string_view&)
      {
         return std::strong_ordering::greater;
      }

      template <typename T>
      concept extended_key_type = std::same_as<T, std::string_view> ||
                                  std::same_as<T, lowest_key> || std::same_as<T, highest_key>;

      inline bool is_empty_in_range(const read_session&    session,
                                    session_lock_ref<>     l,
                                    database::id           id,
                                    extended_key_type auto lower,
                                    extended_key_type auto upper);

      // key represents the key of in. key, lower, and upper should all start
      // at the same position.
      inline bool is_empty_in_range(const read_session&    session,
                                    session_lock_ref<>     l,
                                    const inner_node&      in,
                                    std::string_view       key,
                                    extended_key_type auto lower,
                                    extended_key_type auto upper)
      {
         if (key >= upper)
         {
            return true;
         }
         if (key >= lower)
         {
            if (in.value())
               return false;
            if (upper.starts_with(key))
            {
               upper.remove_prefix(key.size());
               if (in.branches() & inner_node::mask_lt(upper[0]))
                  return false;
               return !in.has_branch(upper[0]) || is_empty_in_range(session, l, in.branch(upper[0]),
                                                                    lowest_key{}, upper.substr(1));
            }
            else
            {
               return false;
            }
         }
         if (lower.starts_with(key))
         {
            if (upper.starts_with(key))
            {
               lower.remove_prefix(key.size());
               upper.remove_prefix(key.size());
               if (upper[0] == lower[0])
               {
                  return !in.has_branch(lower[0]) ||
                         is_empty_in_range(session, l, in.branch(lower[0]), lower.substr(1),
                                           upper.substr(1));
               }
               else
               {
                  if (in.branches() & inner_node::mask_gt(lower[0]) & inner_node::mask_lt(upper[0]))
                     return false;
                  if (in.has_branch(lower[0]) && !is_empty_in_range(session, l, in.branch(lower[0]),
                                                                    lower.substr(1), highest_key{}))
                     return false;
                  if (in.has_branch(upper[0]) && !is_empty_in_range(session, l, in.branch(upper[0]),
                                                                    lowest_key{}, upper.substr(1)))
                     return false;
                  return true;
               }
            }
            else
            {
               lower.remove_prefix(key.size());
               if (in.branches() & inner_node::mask_gt(lower[0]))
                  return false;
               return !in.has_branch(lower[0]) || is_empty_in_range(session, l, in.branch(lower[0]),
                                                                    lower.substr(1), highest_key{});
            }
         }
         else
         {
            return true;
         }
      }

      inline bool is_empty_in_range(const read_session&    session,
                                    session_lock_ref<>     l,
                                    database::id           id,
                                    extended_key_type auto lower,
                                    extended_key_type auto upper)
      {
         if (!id)
            return true;
         auto n = session.get_by_id(l, id);
         if (n.is_leaf_node())
         {
            auto key = n.as_value_node().key();
            return key < lower || key >= upper;
         }
         else
         {
            auto& in  = n.as_inner_node();
            auto  key = in.key();
            return is_empty_in_range(session, l, in, key, lower, upper);
         }
      }

   }  // namespace detail

   template <typename AccessMode>
   bool session<AccessMode>::is_empty(const std::shared_ptr<root>& r,
                                      std::span<const char>        lower,
                                      std::span<const char>        upper) const
   {
      swap_guard g(*this);
      auto       lower6 = to_key6({lower.data(), lower.size()});
      if (upper.empty())
      {
         return detail::is_empty_in_range(*this, g, get_id(r), lower6, detail::highest_key{});
      }
      key_type upper_buf;
      auto     upper6 = triedent::to_key6(upper_buf, {upper.data(), upper.size()});
      return detail::is_empty_in_range(*this, g, get_id(r), lower6, upper6);
   }

   namespace detail
   {
      // represents a subtree with a specific prefix
      // The prefix might not correspond exactly to a node due to prefix compression
      struct subtree_t
      {
         database::id id;
         std::size_t  skip_prefix = 0;
         explicit     operator bool() const { return static_cast<bool>(id); }
         // returns the value node at key or an empty tree
         subtree_t value(const read_session& session, session_lock_ref<> l, std::string_view key)
         {
            if (!id)
               return {};
            auto n = session.get_by_id(l, id);
            if (n.is_leaf_node())
            {
               auto& vn     = n.as_value_node();
               auto  vn_key = vn.key().substr(skip_prefix);
               if (vn_key == key)
               {
                  return *this;
               }
               else
               {
                  return {};
               }
            }
            else
            {
               auto& in     = n.as_inner_node();
               auto  in_key = in.key().substr(skip_prefix);
               if (key == in_key)
               {
                  return {in.value()};
               }
               else if (key.starts_with(in_key))
               {
                  key.remove_prefix(in_key.size());
                  return subtree_t{in.maybe_branch(key[0])}.value(session, l, key.substr(1));
               }
               else
               {
                  return {};
               }
            }
         }
         // returns false if there were keys in [lower, upper) that do not start with prefix
         bool set_subtree(const read_session&    session,
                          session_lock_ref<>     l,
                          std::string_view       prefix,
                          extended_key_type auto lower,
                          extended_key_type auto upper)
         {
            assert(prefix < upper);
            assert(prefix >= lower || lower.starts_with(prefix));
            if (!id)
               return true;
            auto n = session.get_by_id(l, id);
            if (n.is_leaf_node())
            {
               auto& vn     = n.as_value_node();
               auto  vn_key = vn.key().substr(skip_prefix);
               if (vn_key.starts_with(prefix))
               {
                  skip_prefix += prefix.size();
                  return true;
               }
               else
               {
                  *this = {};
                  return vn_key < lower || vn_key >= upper;
               }
            }
            else
            {
               auto& in     = n.as_inner_node();
               auto  in_key = in.key().substr(skip_prefix);
               if (in_key.size() >= prefix.size())  // prefix is fully consumed
               {
                  if (in_key.starts_with(prefix))
                  {
                     skip_prefix += prefix.size();
                     return true;
                  }
                  else
                  {
                     *this = {};
                     return detail::is_empty_in_range(session, l, in, in_key, lower, upper);
                  }
               }
               else  // recurse to use the rest of the prefix
               {
                  if (prefix.starts_with(in_key))
                  {
                     prefix.remove_prefix(in_key.size());
                     return set_subtree(session, l, in, in_key, prefix, lower, upper);
                  }
                  else
                  {
                     *this = {};
                     return detail::is_empty_in_range(session, l, in, in_key, lower, upper);
                  }
               }
            }
         }
         // in_key, lower, and upper start at the same point
         // prefix starts at the end of in_key.
         bool set_subtree(const read_session&    session,
                          session_lock_ref<>     l,
                          const inner_node&      in,
                          std::string_view       in_key,
                          std::string_view       prefix,
                          extended_key_type auto lower,
                          extended_key_type auto upper)
         {
            assert(!prefix.empty());
            assert(lower <= in_key || lower.starts_with(in_key));
            assert(upper > in_key);
            // check lower bound
            bool has_lower = false;
            if (lower <= in_key)
            {
               if (in.value())
                  return false;
               if (in.branches() & inner_node::mask_lt(prefix[0]))
                  return false;
            }
            else
            {
               lower.remove_prefix(in_key.size());
               if (lower[0] == prefix[0])
                  has_lower = true;
               else
               {
                  if (in.branches() & inner_node::mask_gt(lower[0]) &
                      inner_node::mask_lt(prefix[0]))
                     return false;
                  if (!detail::is_empty_in_range(session, l, in.maybe_branch(lower[0]),
                                                 lower.substr(1), highest_key{}))
                     return false;
               }
            }
            // check upper bound
            bool has_upper = false;
            if (upper.starts_with(in_key))
            {
               upper.remove_prefix(in_key.size());
               if (upper[0] == prefix[0])
                  has_upper = true;
               else
               {
                  if (in.branches() & inner_node::mask_lt(upper[0]) &
                      inner_node::mask_gt(prefix[0]))
                     return false;
                  if (!detail::is_empty_in_range(session, l, in.maybe_branch(upper[0]),
                                                 lowest_key{}, upper.substr(1)))
                     return false;
               }
            }
            else
            {
               if (in.branches() & inner_node::mask_gt(prefix[0]))
                  return false;
            }

            *this = {in.maybe_branch(prefix[0])};
            if (has_lower && has_upper)
               return set_subtree(session, l, prefix.substr(1), lower.substr(1), upper.substr(1));
            else if (has_lower && !has_upper)
               return set_subtree(session, l, prefix.substr(1), lower.substr(1), highest_key{});
            else if (!has_lower && has_upper)
               return set_subtree(session, l, prefix.substr(1), lowest_key{}, upper.substr(1));
            else /*(!has_lower && !has_upper)*/
               return set_subtree(session, l, prefix.substr(1), lowest_key{}, highest_key{});
         }
      };
      inline bool operator==(const subtree_t& lhs, const database::id& rhs)
      {
         return lhs.id == rhs && lhs.skip_prefix == 0;
      }

      struct subtree_deref
      {
         subtree_deref(write_session& session, std::unique_lock<gc_session>& l, const subtree_t& t)
             : impl(session.get_by_id(l, t.id)), skip_prefix(t.skip_prefix)
         {
         }
         void reload(write_session& session, std::unique_lock<gc_session>& l)
         {
            impl.reload(session.ring(), l);
         }
         subtree_t maybe_branch(std::uint8_t b) const
         {
            if (impl->key_size() == skip_prefix)
            {
               return {impl.maybe_branch(b)};
            }
            else if (static_cast<std::uint8_t>(impl.get_key()[skip_prefix]) == b)
            {
               return {impl, skip_prefix + 1};
            }
            else
            {
               return {};
            }
         }
         auto branches() const
         {
            if (impl->key_size() == skip_prefix)
            {
               return impl.branches();
            }
            else
            {
               return inner_node::mask_eq(impl.get_key()[skip_prefix]);
            }
         }
         auto         get_key() const { return impl.get_key().substr(skip_prefix); }
         database::id value() const
         {
            if (impl->key_size() == skip_prefix)
            {
               return impl.value();
            }
            else
            {
               return {};
            }
         }
         deref<node> impl;
         std::size_t skip_prefix = 0;
      };

      inline database::id clone_with_prefix(write_session&                session,
                                            std::unique_lock<gc_session>& l,
                                            database::id                  id,
                                            auto&&... prefix)
      {
         auto        n = session.get_by_id(l, id);
         std::string new_key;
         ((new_key += prefix), ...);

         if (n.is_leaf_node())
         {
            auto& vn = n.as_value_node();
            new_key += vn.key();
            return session.clone_value(l, n, n.type(), new_key, vn.data());
         }
         else
         {
            auto& in = n.as_inner_node();
            new_key += in.key();
            return session.clone_inner(l, n, in, new_key, in.value(), in.branches());
         }
      }

      inline database::id clone_remove_prefix(write_session&                session,
                                              std::unique_lock<gc_session>& l,
                                              database::id                  id,
                                              std::size_t                   prefix_len)
      {
         if (prefix_len == 0)
            return bump_refcount_or_copy(session.ring(), l, id);
         auto n = session.get_by_id(l, id);
         if (n.is_leaf_node())
         {
            auto& vn = n.as_value_node();
            return session.clone_value(l, n, n.type(), vn.key(), prefix_len, vn.data());
         }
         else
         {
            auto& in = n.as_inner_node();
            return session.clone_inner(l, n, in, in.key(), prefix_len, in.value(), in.branches());
         }
      }

      template <typename T>
      concept node_child_builder = requires(const T&                      t,
                                            write_session&                session,
                                            std::unique_lock<gc_session>& l,
                                            std::string_view              key,
                                            database::id                  child) {
         {
            t.branches()
         } -> std::same_as<std::uint64_t>;
         {
            t.children()
         } -> std::ranges::input_range;
         t.clone_child(session, l, child);
         t.clone_child_with_prefix(session, l, key, child);
      };

      // Component for building a new node. Selects a range of children from a node
      struct node_children
      {
         template <typename T>
         node_children(const deref<T>& n, std::uint64_t mask)
         {
            assert(std::popcount(((mask - 1) | mask) + 1) <= 1 && "mask must not have gaps");
            if (n.is_leaf_node())
            {
               _branches = 0;
               _children = {};
            }
            else
            {
               auto& in           = n.as_inner_node();
               _branches          = in.branches() & mask;
               std::size_t offset = std::popcount(in.branches() & (((mask - 1) ^ mask) >> 1));
               std::size_t count  = std::popcount(_branches);
               _children          = {in.children() + offset, count};
            }
         }
         auto                          branches() const { return _branches; }
         std::span<const database::id> children() const { return _children; }
         auto                          clone_child(write_session&                session,
                                                   std::unique_lock<gc_session>& l,
                                                   object_id                     child) const
         {
            return bump_refcount_or_copy(session.ring(), l, child);
         }
         auto clone_child_with_prefix(write_session&                session,
                                      std::unique_lock<gc_session>& l,
                                      std::string_view              key,
                                      database::id                  child) const
         {
            return clone_with_prefix(session, l, child, key,
                                     static_cast<char>(std::countr_zero(_branches)));
         }
         std::span<const database::id> _children;
         std::uint64_t                 _branches;
      };

      // Component for building a new node. Selects a range of children from a subtree
      struct subtree_children
      {
         subtree_children(const subtree_children&) = delete;
         subtree_children(const subtree_deref& t, std::uint64_t mask)
         {
            assert(std::popcount(((mask - 1) | mask) + 1) <= 1 && "mask must not have gaps");
            if (t.skip_prefix == t.impl->key_size())
            {
               if (t.impl.is_leaf_node())
               {
                  _branches    = 0;
                  _children    = {};
                  _skip_prefix = 0;
               }
               else
               {
                  auto& in           = t.impl.as_inner_node();
                  _branches          = in.branches() & mask;
                  std::size_t offset = std::popcount(in.branches() & (((mask - 1) ^ mask) >> 1));
                  std::size_t count  = std::popcount(_branches);
                  _children          = {in.children() + offset, count};
                  _skip_prefix       = 0;
               }
            }
            else
            {
               _branches = mask & inner_node::mask_eq(t.impl.get_key()[t.skip_prefix]);
               if (_branches)
               {
                  _child       = t.impl;
                  _children    = {&_child, 1};
                  _skip_prefix = t.skip_prefix + 1;
               }
               else
               {
                  _children    = {};
                  _skip_prefix = 0;
               }
            }
         }
         std::span<const object_id> _children;
         object_id                  _child;
         std::uint64_t              _branches;
         std::size_t                _skip_prefix;
         auto                       branches() const { return _branches; }
         auto                       children() const { return _children; }
         auto                       clone_child(write_session&                session,
                                                std::unique_lock<gc_session>& l,
                                                object_id                     child) const
         {
            return clone_remove_prefix(session, l, child, _skip_prefix);
         }
         auto clone_child_with_prefix(write_session&                session,
                                      std::unique_lock<gc_session>& l,
                                      std::string_view              key,
                                      database::id                  child) const
         {
            if (_skip_prefix == 0)
            {
               return clone_with_prefix(session, l, child, key,
                                        static_cast<char>(std::countr_zero(_branches)));
            }
            else if (key.size() <= _skip_prefix - 1)
            {
               return clone_remove_prefix(session, l, child, _skip_prefix - key.size() - 1);
            }
            else
            {
               key.remove_suffix(_skip_prefix - 1);
               return clone_with_prefix(session, l, child, key);
            }
         }
      };

      // Utility for building a new node. Represents a single child.
      // If clone is true, then the child is part of another tree and
      // will be cloned. If clone is false, then the child is owned
      // by this object and will be moved into the new node. id can
      // be null in which case this object will not create a child
      // in the new node.
      struct maybe_clone_one
      {
         object_id     id;
         std::uint8_t  b;
         bool          clone = true;
         std::uint64_t branches() const
         {
            if (id)
               return inner_node::mask_eq(b);
            else
               return 0;
         }
         std::span<const database::id> children() const
         {
            if (id)
               return {&id, 1};
            else
               return {};
         }

         auto clone_child(write_session&                session,
                          std::unique_lock<gc_session>& l,
                          database::id                  child) const
         {
            if (clone)
               return bump_refcount_or_copy(session.ring(), l, child);
            else
               return child;
         }
         auto clone_child_with_prefix(write_session&                session,
                                      std::unique_lock<gc_session>& l,
                                      std::string_view              key,
                                      database::id                  child) const
         {
            auto result = clone_with_prefix(session, l, child, key, b);
            if (!clone)
            {
               session.release(l, child);
            }
            return result;
         }
      };

      void do_clone_children(write_session&                session,
                             std::unique_lock<gc_session>& l,
                             auto&                         r,
                             std::span<object_id>          children)
      {
         for (database::id& child : children)
         {
            child = r.clone_child(session, l, child);
         }
      }

      // Constructs a node from its key prefix and children.
      // Handles all combinations that require the node to be compressed.
      //
      // If key points to the key of any node, then id and key_offset must
      // indicate the node.
      //
      // If key points to non-database owned memory (external or on the stack),
      // then key_offset should be set to 0xffffffff. id will be ignored.
      //
      // children must be non-overlapping and in order.
      database::id build_node(write_session&                session,
                              std::unique_lock<gc_session>& l,
                              key_builder auto              key,
                              object_id                     val,
                              bool                          always_clone_value,
                              node_child_builder auto&&... children)
      {
         auto              branches = (children.branches() | ...);
         const std::size_t n        = std::popcount(branches);
         // Handle cases that cause this node to be compressed
         if (branches == 0)
         {
            if (!val)
            {
               return database::id{};
            }
            else
            {
               auto  n  = session.get_by_id(l, val);
               auto& vn = n.as_value_node();
               if (key.size() == vn.key_size())
               {
                  if (always_clone_value)
                     return bump_refcount_or_copy(session.ring(), l, val);
                  else
                     return val;
               }
               return session.clone_value(l, n, n.type(), key, -1, vn.data());
            }
         }
         else if (n == 1 && !val)
         {
            bool         found = false;
            database::id result;
            // find the child that is actually present, and extend its prefix
            (((!found && children.branches() != 0)
                  ? (void)(result = children.clone_child_with_prefix(session, l, key,
                                                                     children.children()[0]),
                           found  = true)
                  : (void)0),
             ...);
            return result;
         }
         // collect children in a temporary buffer
         object_id   children_buf[n];
         object_id*  positions[sizeof...(children)];
         object_id** pos = positions;
         object_id*  out = children_buf;
         ((out = *pos++ = std::ranges::copy(children.children(), out).out), ...);
         // clone children (once we start this, children.children() is not safe to use)
         if (always_clone_value)
         {
            val = bump_refcount_or_copy(session.ring(), l, val);
         }
         else
         {
            // val might have a key, which we need to strip off
            auto n = session.get_by_id(l, val);
            if (n->key_size() != 0)
            {
               val = session.clone_value(l, n, n.type(), "", -1, n.as_value_node().data());
            }
            else
            {
               val = bump_refcount_or_copy(session.ring(), l, val);
            }
         }
         out = children_buf;
         pos = positions;
         ((detail::do_clone_children(session, l, children, std::span{out, *pos}), out = *pos++),
          ...);

         return inner_node::make(session.ring(), l, key, val, branches, children_buf)
             .first.get_id();
      }

      inline bool is_empty_in_range(const read_session&    session,
                                    session_lock_ref<>     l,
                                    subtree_t              tree,
                                    extended_key_type auto lower,
                                    extended_key_type auto upper)
      {
         if (!tree.id)
            return true;
         auto n = session.get_by_id(l, tree.id);
         if (n.is_leaf_node())
         {
            auto key = n.as_value_node().key().substr(tree.skip_prefix);
            return key < lower || key >= upper;
         }
         else
         {
            auto& in  = n.as_inner_node();
            auto  key = in.key().substr(tree.skip_prefix);
            return detail::is_empty_in_range(session, l, in, key, lower, upper);
         }
      }

      inline bool is_equal_in_range_weak(const read_session&    session,
                                         session_lock_ref<>     l,
                                         database::id           original,
                                         subtree_t              expected,
                                         extended_key_type auto lower,
                                         extended_key_type auto upper);

      // Does not handle the case of lower[0] == upper[0]
      inline bool is_equal_children_in_range_weak(const read_session&    session,
                                                  session_lock_ref<>     l,
                                                  const inner_node&      lhs,
                                                  const inner_node&      rhs,
                                                  extended_key_type auto lower,
                                                  extended_key_type auto upper)
      {
         constexpr bool has_lower = !std::is_same_v<decltype(lower), lowest_key>;
         constexpr bool has_upper = !std::is_same_v<decltype(upper), highest_key>;
         // check child containing lower bound
         if (has_lower &&
             !is_equal_in_range_weak(session, l, lhs.maybe_branch(lower[0]),
                                     {rhs.maybe_branch(lower[0])}, lower.substr(1), highest_key{}))
            return false;
         // check child containing upper bound
         if (has_upper &&
             !is_equal_in_range_weak(session, l, lhs.maybe_branch(upper[0]),
                                     {rhs.maybe_branch(upper[0])}, lowest_key{}, upper.substr(1)))
            return false;
         // check branches between bounds
         auto lmask = has_lower ? inner_node::mask_gt(lower[0]) : ~0ull;
         auto umask = has_upper ? inner_node::mask_lt(upper[0]) : ~0ull;
         auto mask  = lmask & umask;
         if ((lhs.branches() & mask) != (rhs.branches() & mask))
            return false;
         auto        lhs_offset = std::popcount(lhs.branches() & ~lmask);
         auto        rhs_offset = std::popcount(rhs.branches() & ~lmask);
         std::size_t count      = std::popcount(lhs.branches() & mask);
         if constexpr (!has_lower)
         {
            if (count == 0)
            {
               // This could be transformed into a value node and back,
               // so we need to compare the value, not just the pointers
               if (lhs.value() && rhs.value())
               {
                  if (session.get_by_id(l, lhs.value()).as_value_node().data() !=
                      session.get_by_id(l, rhs.value()).as_value_node().data())
                     return false;
               }
               else if (lhs.value() != rhs.value())
               {
                  return false;
               }
            }
            else
            {
               if (lhs.value() != rhs.value())
                  return false;
            }
         }
         if (count == 1)
         {
            // special case because changes to children ouside [lower, upper) can
            // remove and re-add this node, which will create new child nodes.
            return is_equal_in_range_weak(session, l, lhs.children()[lhs_offset],
                                          {rhs.children()[rhs_offset]}, lowest_key{},
                                          highest_key{});
         }
         return std::ranges::equal(std::span{lhs.children() + lhs_offset, count},
                                   std::span{rhs.children() + rhs_offset, count});
      }

      inline bool is_equal_in_range_weak(const read_session&    session,
                                         session_lock_ref<>     l,
                                         database::id           original,
                                         subtree_t              expected,
                                         extended_key_type auto lower,
                                         extended_key_type auto upper)
      {
         if (original == expected)
            return true;

         if (!original)
            return detail::is_empty_in_range(session, l, expected, lower, upper);

         auto n_orig = session.get_by_id(l, original);
         if (n_orig.is_leaf_node())
         {
            auto& vn     = n_orig.as_value_node();
            auto  vn_key = vn.key();
            if (vn_key < lower || vn_key >= upper)
            {
               return is_empty_in_range(session, l, expected, lower, upper);
            }
            else
            {
               if (!expected.set_subtree(session, l, vn_key, lower, upper))
                  return false;
               if (!expected.id)
                  return false;
               auto n_expected = session.get_by_id(l, expected.id);
               // Check that the key matches exactly
               if (n_expected->key_size() != expected.skip_prefix)
                  return false;
               if (n_expected.is_leaf_node())
               {
                  return vn.data() == n_expected.as_value_node().data();
               }
               else
               {
                  auto& in = n_expected.as_inner_node();
                  // check value
                  if (object_id v = in.value())
                  {
                     if (session.get_by_id(l, v).as_value_node().data() != vn.data())
                        return false;
                  }
                  else
                  {
                     return false;
                  }
                  // check that there are no children below the upper bound
                  if (upper.starts_with(vn_key))
                  {
                     upper.remove_prefix(vn_key.size());
                     if (in.branches() & inner_node::mask_lt(upper[0]))
                     {
                        return false;
                     }
                     return detail::is_empty_in_range(session, l, in.maybe_branch(upper[0]),
                                                      lowest_key{}, upper.substr(1));
                  }
                  else
                  {
                     return false;
                  }
               }
            }
         }
         else
         {
            auto& in     = n_orig.as_inner_node();
            auto  in_key = in.key();
            if ((in_key < lower && !lower.starts_with(in_key)) || in_key >= upper)
            {
               // The subtree is entirely outside [lower, upper)
               return detail::is_empty_in_range(session, l, expected, lower, upper);
            }
            else
            {
               if (!expected.set_subtree(session, l, in_key, lower, upper))
                  return false;
               if (!expected.id)
               {
                  return detail::is_empty_in_range(session, l, in, in_key, lower, upper);
               }
               auto n_expected = session.get_by_id(l, expected.id);
               // if original and expected do not have nodes with same prefix, leap frog until they do
               if (n_expected->key_size() > expected.skip_prefix)
               {
                  auto prefix = n_expected.get_key().substr(expected.skip_prefix);
                  bool in_range;
                  bool has_lower = false;
                  // check if the subtree at in_key+prefix intersects the range [lower, upper)
                  if (lower.starts_with(in_key))
                  {
                     auto lower_rest = lower.substr(in_key.size());
                     if (lower_rest.starts_with(prefix))
                        in_range = has_lower = true;
                     else
                        in_range = prefix >= lower_rest;
                  }
                  else
                  {
                     in_range = lower < in_key;
                  }
                  bool has_upper = false;
                  if (in_range)
                  {
                     if (upper.starts_with(in_key))
                     {
                        auto upper_rest = upper.substr(in_key.size());
                        has_upper       = upper_rest.starts_with(prefix);
                        in_range        = prefix < upper_rest;
                     }
                     else
                     {
                        in_range = in_key < upper;
                     }
                  }
                  if (!in_range)
                     return detail::is_empty_in_range(session, l, in, in_key, lower, upper);
                  subtree_t original_subtree{};
                  if (!original_subtree.set_subtree(session, l, in, in_key, prefix, lower, upper))
                     return false;
                  auto prefix_consumed = prefix.size() - original_subtree.skip_prefix;
                  expected.skip_prefix += prefix_consumed;
                  auto bounds_consumed = in_key.size() + prefix_consumed;
                  if (has_lower && has_upper)
                     return is_equal_in_range_weak(session, l, original_subtree.id, expected,
                                                   lower.substr(bounds_consumed),
                                                   upper.substr(bounds_consumed));
                  else if (has_lower && !has_upper)
                     return is_equal_in_range_weak(session, l, original_subtree.id, expected,
                                                   lower.substr(bounds_consumed), highest_key{});
                  else if (!has_lower && has_upper)
                     return is_equal_in_range_weak(session, l, original_subtree.id, expected,
                                                   lowest_key{}, upper.substr(bounds_consumed));
                  else /* !has_lower && !has_upper */
                     return is_equal_in_range_weak(session, l, original_subtree.id, expected,
                                                   lowest_key{}, highest_key{});
               }
               // The two nodes have the same prefix
               if (lower <= in_key)
               {
                  if (upper.starts_with(in_key))
                  {
                     upper.remove_prefix(in_key.size());
                     if (n_expected.is_leaf_node())
                     {
                        if (in.branches() & inner_node::mask_lt(upper[0]))
                           return false;
                        if (!is_empty_in_range(session, l, in.maybe_branch(upper[0]), lowest_key{},
                                               upper.substr(1)))
                           return false;
                        auto val = in.value();
                        if (!val)
                           return false;
                        return session.get_by_id(l, val).as_value_node().data() ==
                               n_expected.as_value_node().data();
                     }
                     else
                     {
                        auto& in_expected = n_expected.as_inner_node();
                        return is_equal_children_in_range_weak(session, l, in, in_expected,
                                                               lowest_key{}, upper);
                     }
                  }
                  else
                  {
                     // nodes must be equal except that their prefixes might
                     // start at different places
                     if (n_expected.is_leaf_node())
                        return false;
                     auto& in_expected = n_expected.as_inner_node();
                     return detail::is_equal_children_in_range_weak(session, l, in, in_expected,
                                                                    lowest_key{}, highest_key{});
                  }
               }
               else  // in_key is a prefix of lower
               {
                  // If expected is a leaf node, it corresponds to in_key, which is excluded because in_key < lower
                  if (n_expected.is_leaf_node())
                     return is_empty_in_range(session, l, original, lower, upper);
                  lower.remove_prefix(in_key.size());
                  auto& in_expected = n_expected.as_inner_node();
                  if (upper.starts_with(in_key))
                  {
                     upper.remove_prefix(in_key.size());
                     if (lower[0] == upper[0])
                     {
                        return is_equal_in_range_weak(session, l, in.maybe_branch(lower[0]),
                                                      {in_expected.maybe_branch(lower[0])},
                                                      lower.substr(1), upper.substr(1));
                     }
                     else
                     {
                        return is_equal_children_in_range_weak(session, l, in, in_expected, lower,
                                                               upper);
                     }
                  }
                  else  // lower bound only
                  {
                     return is_equal_children_in_range_weak(session, l, in, in_expected, lower,
                                                            highest_key{});
                  }
               }
            }
         }
      }

   }  // namespace detail
   template <typename AccessMode>
   bool session<AccessMode>::is_equal_weak(const std::shared_ptr<root>& r1,
                                           const std::shared_ptr<root>& r2,
                                           std::span<const char>        lower,
                                           std::span<const char>        upper) const
   {
      swap_guard g(*this);
      auto       lower6 = to_key6({lower.data(), lower.size()});
      if (upper.empty())
      {
         return detail::is_equal_in_range_weak(*this, g, get_id(r1), {get_id(r2)}, lower6,
                                               detail::highest_key{});
      }
      key_type upper_buf;
      auto     upper6 = triedent::to_key6(upper_buf, {upper.data(), upper.size()});
      return detail::is_equal_in_range_weak(*this, g, get_id(r1), {get_id(r2)}, lower6, upper6);
   }

   inline int write_session::remove(std::shared_ptr<root>& r, std::span<const char> key)
   {
      std::unique_lock<gc_session> l(*this);

      int  removed_size = -1;
      auto new_root = remove_child(l, get_id(r), get_unique(r), to_key6({key.data(), key.size()}),
                                   removed_size);
      update_root(l, r, new_root);
      return removed_size;
   }

   namespace detail
   {
      inline void set_branch(write_session&                session,
                             std::unique_lock<gc_session>& l,
                             mutable_deref<inner_node>&    result,
                             std::uint8_t                  b,
                             database::id                  id)
      {
         auto& new_br = result->branch(b);
         session.release(l, new_br);
         new_br = id;
      }

      struct range_info
      {
         bool intersects;
         bool has_lower;
         bool has_upper;
      };

      inline range_info prefix_overlap(std::string_view       prefix,
                                       extended_key_type auto lower,
                                       extended_key_type auto upper,
                                       std::size_t            offset = 0)
      {
         if constexpr (std::is_same_v<decltype(lower), std::string_view>)
            lower.remove_prefix(offset);
         if constexpr (std::is_same_v<decltype(upper), std::string_view>)
            upper.remove_prefix(offset);
         if (prefix < lower && !lower.starts_with(prefix) || prefix >= upper)
            return {false, false, false};
         range_info result = {true};
         if (prefix < lower)
            result.has_lower = true;
         if (upper.starts_with(prefix))
            result.has_upper = true;
         return result;
      }

      // lower and upper are only used to derive the key prefix
      inline database::id take_all(write_session&                session,
                                   std::unique_lock<gc_session>& l,
                                   database::id                  id,
                                   extended_key_type auto        lower,
                                   extended_key_type auto        upper,
                                   std::size_t                   offset,
                                   std::size_t                   skip_prefix)
      {
         if (offset == skip_prefix)
            return id;
         // Check whether the desired prefix is completely contained in the original key
         if (skip_prefix >= offset)
            return clone_remove_prefix(session, l, id, skip_prefix - offset);
         // the prefix is from either upper or lower
         auto prefix = !std::is_same_v<decltype(lower), lowest_key>
                           ? lower.substr(0, offset - skip_prefix)
                           : upper.substr(0, offset - skip_prefix);
         return clone_with_prefix(session, l, id, prefix);
      }

      inline database::id take_range(write_session&                session,
                                     std::unique_lock<gc_session>& l,
                                     database::id                  id,
                                     extended_key_type auto        lower,
                                     extended_key_type auto        upper,
                                     std::size_t                   offset      = 0,
                                     std::size_t                   skip_prefix = 0)
      {
         if (!id)
            return {};
         auto n                                  = session.get_by_id(l, id);
         auto key                                = n.get_key().substr(skip_prefix);
         auto [intersects, has_lower, has_upper] = prefix_overlap(key, lower, upper, offset);
         if (!intersects)
            return {};
         if (!has_lower && !has_upper)
            return take_all(session, l, id, lower, upper, offset, skip_prefix);

         offset += key.size();
         if (has_lower && has_upper && lower[offset] == upper[offset])
         {
            return take_range(session, l, n.maybe_branch(lower[offset]), lower, upper, offset + 1);
         }
         else
         {
            auto lmask      = has_lower ? inner_node::mask_gt(lower[offset]) : ~0ull;
            auto umask      = has_upper ? inner_node::mask_lt(upper[offset]) : ~0ull;
            auto mask       = lmask & umask;
            auto outer_mask = (has_lower ? inner_node::mask_lt(lower[offset]) : 0ull) |
                              (has_upper ? inner_node::mask_gt(upper[offset]) : 0ull);
            auto lower_child = has_lower ? n.maybe_branch(lower[offset]) : database::id{};
            auto upper_child = has_upper ? n.maybe_branch(upper[offset]) : database::id{};
            auto branches    = n.branches() & mask;
            // Try to short circuit if we know that there is only one child. This
            // avoids repeatedly cloning the same node with successively longer prefixes.
            //
            // Try upper first because n.value() needs to be tested before n is invalidated
            if (upper_child && !branches && !lower_child && (has_lower || !n.value()))
               return take_range(session, l, upper_child, lowest_key{}, upper, offset + 1);
            auto new_upper_child = upper_child ? take_range(session, l, upper_child, lowest_key{},
                                                            upper.substr(offset + 1))
                                               : database::id{};
            if (lower_child && !branches && !new_upper_child)
               return take_range(session, l, lower_child, lower, highest_key{}, offset + 1);
            auto new_lower_child = lower_child ? take_range(session, l, lower_child,
                                                            lower.substr(offset + 1), highest_key{})
                                               : database::id{};
            // If we constructed any nodes, n is no longer valid
            n.reload(session.ring(), l);
            // check whether we can return the original node
            if (offset == key.size() && skip_prefix == 0 && (n.branches() & outer_mask) == 0 &&
                (!has_lower || !n.value()) && new_lower_child == lower_child &&
                new_upper_child == upper_child)
               return id;
            // determine the branches in the result
            if (new_lower_child)
               branches |= inner_node::mask_eq(lower[offset]);
            if (new_upper_child)
               branches |= inner_node::mask_eq(upper[offset]);
            auto count = std::popcount(branches) + (!has_lower && n.value());
            if (count == 0)
            {
               return {};
            }
            else if (count == 1)
            {
               // find which child we have and clone it with a longer prefix
               if (!has_lower && n.value())
               {
                  auto prefix = upper.substr(0, offset);
                  auto vn     = session.get_by_id(l, n.value());
                  return session.clone_value(l, vn, vn.type(), prefix, -1,
                                             vn.as_value_node().data());
               }
               else if (new_lower_child)
               {
                  auto result =
                      clone_with_prefix(session, l, new_lower_child, lower.substr(0, offset + 1));
                  if (new_lower_child != lower_child)
                     session.release(l, new_lower_child);
                  return result;
               }
               else if (new_upper_child)
               {
                  auto result =
                      clone_with_prefix(session, l, new_upper_child, upper.substr(0, offset + 1));
                  if (new_upper_child != upper_child)
                     session.release(l, new_upper_child);
                  return result;
               }
               else
               {
                  auto prefix = has_lower ? lower.substr(0, offset) : upper.substr(0, offset);
                  auto b      = std::countr_zero(branches);
                  return clone_with_prefix(session, l, n.branch(b), prefix, static_cast<char>(b));
               }
            }
            else
            {
               // Make sure that the child refcounts are incremented
               if (new_lower_child && new_lower_child == lower_child)
                  new_lower_child = bump_refcount_or_copy(session.ring(), l, new_lower_child);
               if (new_upper_child && new_upper_child == upper_child)
                  new_upper_child = bump_refcount_or_copy(session.ring(), l, new_upper_child);
               // clone the node and replace upper child and lower child if needed
               auto  prefix = has_lower ? lower.substr(0, offset) : upper.substr(0, offset);
               auto& in     = n.as_inner_node();
               auto  result = session.clone_inner(l, id, in, prefix, -1,
                                                 has_lower ? database::id{} : in.value(), branches);
               if (new_lower_child)
                  set_branch(session, l, result, lower[offset], new_lower_child);
               if (new_upper_child)
                  set_branch(session, l, result, upper[offset], new_upper_child);
               return result;
            }
         }
      }

      inline database::id take_range(write_session&                session,
                                     std::unique_lock<gc_session>& l,
                                     subtree_t                     id,
                                     extended_key_type auto        lower,
                                     extended_key_type auto        upper,
                                     std::size_t                   offset = 0)
      {
         return take_range(session, l, id.id, lower, upper, offset, id.skip_prefix);
      }

      inline database::id remove_range(write_session&                session,
                                       std::unique_lock<gc_session>& l,
                                       database::id                  id,
                                       extended_key_type auto        lower,
                                       extended_key_type auto        upper,
                                       std::size_t                   offset      = 0,
                                       std::size_t                   skip_prefix = 0)
      {
         if (!id)
            return {};
         auto n                                  = session.get_by_id(l, id);
         auto key                                = n.get_key().substr(skip_prefix);
         auto [intersects, has_lower, has_upper] = prefix_overlap(key, lower, upper, offset);
         if (!intersects)
            return take_all(session, l, id, lower, upper, offset, skip_prefix);

         if (!has_lower && !has_upper)
            return {};

         offset += key.size();

         auto lmask             = has_lower ? inner_node::mask_gt(lower[offset]) : ~0ull;
         auto umask             = has_upper ? inner_node::mask_lt(upper[offset]) : ~0ull;
         auto inner_mask        = lmask & umask;
         auto before_lower_mask = has_lower ? inner_node::mask_lt(lower[offset]) : 0ull;
         auto after_upper_mask  = has_upper ? inner_node::mask_gt(upper[offset]) : 0ull;
         auto outer_mask        = before_lower_mask | after_upper_mask;

         auto branches = n.branches() & outer_mask;

         database::id lower_child{};
         database::id upper_child{};
         database::id new_lower_child{};
         database::id new_upper_child{};
         auto         value = has_lower ? n.value() : database::id{};
         if (has_lower)
            lower_child = n.maybe_branch(lower[offset]);
         if (has_lower && has_upper && lower[offset] == upper[offset])
         {
            new_lower_child = remove_range(session, l, lower_child, lower.substr(offset + 1),
                                           upper.substr(offset + 1));
         }
         else
         {
            if (has_upper)
            {
               upper_child = n.maybe_branch(upper[offset]);
               if (!branches && !value && !lower_child)
               {
                  return remove_range(session, l, upper_child, lowest_key{}, upper, offset + 1);
               }
               new_upper_child =
                   remove_range(session, l, upper_child, lowest_key{}, upper.substr(offset + 1));
            }
            if (lower_child)
            {
               if (!branches && !value && !new_upper_child)
               {
                  return remove_range(session, l, lower_child, lower, highest_key{}, offset + 1);
               }
               new_lower_child =
                   remove_range(session, l, lower_child, lower.substr(offset + 1), highest_key{});
            }
         }
         n.reload(session.ring(), l);
         // check whether we can return the original node
         if (offset == 0 && skip_prefix == 0 && (has_lower || !n.value()) &&
             lower_child == new_lower_child && upper_child == new_upper_child &&
             !(n.branches() & inner_mask))
            return id;

         std::uint8_t lower_b = has_lower ? lower[offset] : 0;
         std::uint8_t upper_b = has_upper ? upper[offset] : 0;

         auto prefix = has_lower ? lower.substr(0, offset) : upper.substr(0, offset);
         return detail::build_node(
             session, l, prefix, value, value != id, node_children{n, before_lower_mask},
             maybe_clone_one{new_lower_child, lower_b, new_lower_child == lower_child},
             maybe_clone_one{new_upper_child, upper_b, new_upper_child == upper_child},
             node_children{n, after_upper_mask});
      }

      inline database::id remove_range(write_session&                session,
                                       std::unique_lock<gc_session>& l,
                                       subtree_t                     id,
                                       extended_key_type auto        lower,
                                       extended_key_type auto        upper,
                                       std::size_t                   offset = 0)
      {
         return remove_range(session, l, id.id, lower, upper, offset, id.skip_prefix);
      }

      inline database::id splice_range(write_session&                session,
                                       std::unique_lock<gc_session>& l,
                                       subtree_t                     dest,
                                       subtree_t                     src,
                                       extended_key_type auto        lower,
                                       extended_key_type auto        upper,
                                       std::size_t                   offset = 0)
      {
         if (!dest.id)
            return take_range(session, l, src, lower, upper, offset);
         if (!src.id)
            return remove_range(session, l, dest, lower, upper, offset);
         // find common prefix
         auto n_dest                             = subtree_deref{session, l, dest};
         auto n_src                              = subtree_deref{session, l, src};
         auto dest_key                           = n_dest.get_key();
         auto src_key                            = n_src.get_key();
         auto prefix                             = common_prefix(dest_key, src_key);
         auto [intersects, has_lower, has_upper] = prefix_overlap(prefix, lower, upper, offset);
         if (!intersects)
            return take_all(session, l, dest.id, lower, upper, offset, dest.skip_prefix);

         if (!has_lower && !has_upper)
            return take_all(session, l, src.id, lower, upper, offset, src.skip_prefix);

         n_dest.skip_prefix += prefix.size();
         n_src.skip_prefix += prefix.size();
         offset += prefix.size();

         auto lmask             = has_lower ? inner_node::mask_gt(lower[offset]) : ~0ull;
         auto umask             = has_upper ? inner_node::mask_lt(upper[offset]) : ~0ull;
         auto inner_mask        = lmask & umask;
         auto before_lower_mask = has_lower ? inner_node::mask_lt(lower[offset]) : 0ull;
         auto after_upper_mask  = has_upper ? inner_node::mask_gt(upper[offset]) : 0ull;
         auto outer_mask        = before_lower_mask | after_upper_mask;

         // < lower from dest
         // lower recurse
         // >lower, <upper from src
         // upper recurse
         // > upper from dest
         auto branches = (n_dest.branches() & outer_mask) | (n_src.branches() & inner_mask);
         auto value    = has_lower ? n_dest.value() : n_src.value();

         subtree_t    lower_child_src{};
         subtree_t    lower_child_dest{};
         subtree_t    upper_child_src{};
         subtree_t    upper_child_dest{};
         database::id new_lower_child{};
         database::id new_upper_child{};
         if (has_lower)
         {
            lower_child_dest = n_dest.maybe_branch(lower[offset]);
            lower_child_src  = n_src.maybe_branch(lower[offset]);
         }
         if (has_lower && has_upper && lower[offset] == upper[offset])
         {
            if ((n_dest.branches() & ~inner_node::mask_eq(lower[offset])) || value)
            {
               new_lower_child = splice_range(session, l, lower_child_dest, lower_child_src,
                                              lower.substr(offset + 1), upper.substr(offset + 1));
               if (offset == dest.skip_prefix + prefix.size() &&
                   new_lower_child == lower_child_dest.id)
               {
                  return dest.id;
               }
            }
            else
            {
               return splice_range(session, l, lower_child_dest, lower_child_src, lower, upper,
                                   offset + 1);
            }
         }
         else
         {
            if (has_upper)
            {
               upper_child_src  = n_src.maybe_branch(upper[offset]);
               upper_child_dest = n_dest.maybe_branch(upper[offset]);
               if (!branches && !value && !lower_child_src && !lower_child_dest)
               {
                  return splice_range(session, l, upper_child_dest, upper_child_src, lowest_key{},
                                      upper, offset + 1);
               }
               new_upper_child = splice_range(session, l, upper_child_dest, upper_child_src,
                                              lowest_key{}, upper.substr(offset + 1));
            }
            if (has_lower)
            {
               if (!branches && !value && !new_upper_child)
               {
                  return splice_range(session, l, lower_child_dest, lower_child_src, lower,
                                      highest_key{}, offset + 1);
               }
               new_lower_child = splice_range(session, l, lower_child_dest, lower_child_src,
                                              lower.substr(offset + 1), highest_key{});
            }
         }

         if (new_lower_child)
            branches |= inner_node::mask_eq(lower[offset]);
         if (new_upper_child)
            branches |= inner_node::mask_eq(upper[offset]);

         n_src.reload(session, l);
         n_dest.reload(session, l);

         // check whether the result is equivalent to one of the inputs
         if (offset == src.skip_prefix + prefix.size() && n_src.branches() == branches &&
             !(branches & outer_mask) && value == n_src.value() &&
             new_lower_child == lower_child_src && new_upper_child == upper_child_src)
            return src.id;
         if (offset == dest.skip_prefix + prefix.size() && n_dest.branches() == branches &&
             !(branches & inner_mask) && value == n_dest.value() &&
             new_lower_child == lower_child_dest && new_upper_child == upper_child_dest)
            return dest.id;

         bool lower_unchanged =
             new_lower_child == lower_child_src || new_lower_child == lower_child_dest;
         bool upper_unchanged =
             new_upper_child == upper_child_src || new_upper_child == upper_child_dest;
         std::uint8_t lower_b = has_lower ? lower[offset] : 0;
         std::uint8_t upper_b = has_upper ? upper[offset] : 0;

         auto result_prefix = has_lower ? lower.substr(0, offset) : upper.substr(0, offset);
         return detail::build_node(session, l, result_prefix, value, value != src && value != dest,
                                   subtree_children{n_dest, before_lower_mask},
                                   maybe_clone_one{new_lower_child, lower_b, lower_unchanged},
                                   subtree_children{n_src, inner_mask},
                                   maybe_clone_one{new_upper_child, upper_b, upper_unchanged},
                                   subtree_children{n_dest, after_upper_mask});
      }
   }  // namespace detail

   inline void write_session::take(std::shared_ptr<root>& r,
                                   std::span<const char>  lower,
                                   std::span<const char>  upper)
   {
      std::unique_lock<gc_session> l(*this);

      auto lower6 = to_key6({lower.data(), lower.size()});
      id   new_root;
      if (upper.empty())
      {
         new_root = detail::take_range(*this, l, get_id(r), lower6, detail::highest_key{});
      }
      else
      {
         key_type upper_buf;
         auto     upper6 = triedent::to_key6(upper_buf, {upper.data(), upper.size()});
         new_root        = detail::take_range(*this, l, get_id(r), lower6, upper6);
      }
      update_root(l, r, new_root);
   }

   inline void write_session::splice(std::shared_ptr<root>&       r1,
                                     const std::shared_ptr<root>& r2,
                                     std::span<const char>        lower,
                                     std::span<const char>        upper)
   {
      std::unique_lock<gc_session> l(*this);

      auto lower6 = to_key6({lower.data(), lower.size()});
      id   new_root;
      if (upper.empty())
      {
         new_root = detail::splice_range(*this, l, {get_id(r1)}, {get_id(r2)}, lower6,
                                         detail::highest_key{});
      }
      else
      {
         key_type upper_buf;
         auto     upper6 = triedent::to_key6(upper_buf, {upper.data(), upper.size()});
         new_root = detail::splice_range(*this, l, {get_id(r1)}, {get_id(r2)}, lower6, upper6);
      }

      // new_root == r2 need its refcount bumped
      if (r1 != r2 && r2 && r2->db && r2->id == new_root)
         new_root = bump_refcount_or_copy(ring(), l, new_root);
      update_root(l, r1, new_root);
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
            auto prev = in->value();
            lock(in, session)->set_value(id());
            release(session, prev);
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
            lock(in, session)->branch(b) = new_b;
            release(session, cur_b);
            return root;
         }
         if (new_b)  // update branch
         {
            auto new_root =
                clone_inner(session, in, *in, in->key(), 0, in->value(), in->branches());
            auto& new_br = new_root->branch(b);
            release(session, new_br);
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

      if (!ring().gc_retain(r))
         return;  // retaining this node indirectly retains all children

      auto dr = get_by_id(l, r);
      if (dr.type() == node_type::inner)
      {
         auto& in = dr.as_inner_node();
         recursive_retain(l, in.value());
         for (auto child : std::span{in.children(), in.num_branches()})
         {
            recursive_retain(l, child);
         }
      }
      else if (dr.type() == node_type::roots)
      {
         auto& rt = dr.as_value_node();
         for (auto child : std::span{rt.roots(), rt.num_roots()})
         {
            recursive_retain(l, child);
         }
      }
   }

   inline void write_session::start_collect_garbage()
   {
      ring().gc_start();
   }
   inline void write_session::end_collect_garbage()
   {
      ring().gc_finish();
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

}  // namespace triedent
