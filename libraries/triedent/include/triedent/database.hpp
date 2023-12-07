#pragma once

#include <algorithm>
#include <memory>
#include <optional>
#include <span>
#include <triedent/key6.hpp>
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
   struct mutable_deref;

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

      auto lock()const { return _session.lock(); }

     protected:
      explicit session_base(seg_allocator& a);
      operator seg_allocator::session&() const { return _session; }

     public:
      key_view to_key6(key_view v) const;

     private:
      mutable seg_allocator::session _session;  // or read_lock...?
      mutable key_type               key_buf;
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
                                           std::vector<std::shared_ptr<root>>* result_roots = nullptr) const;
      std::optional<std::vector<char>> get(const std::shared_ptr<root>& r,
                                           std::span<const char>        key) const;

      ///    Assume keys a-z
      ///
      ///    key = m
      ///
      ///    greater_equal is m, or if m isn't present then it is n
      ///    less_than is l
      ///    max is z
      ///    next = m+1 or n, if keys are strings then next is 'ma'
      /**
       *  TODO: verify these docs
       *  finds the first key greater than or equal to key, this can be used to find
       *  the first element by using an empty key()
       *
       *  ie. lower_bound
       */
      bool get_greater_equal(const std::shared_ptr<root>&        r,
                             std::span<const char>               key,
                             std::vector<char>*                  result_key,
                             std::vector<char>*                  result_bytes = nullptr,
                             std::vector<std::shared_ptr<root>>* result_roots = nullptr) const;

      /**
       *  TODO: verify these docs
       *  finds the largest key less than key
       */
      bool get_less_than(const std::shared_ptr<root>&        r,
                         std::span<const char>               key,
                         std::vector<char>*                  result_key,
                         std::vector<char>*                  result_bytes = nullptr,
                         std::vector<std::shared_ptr<root>>* result_roots = nullptr) const;
      /**
       *  TODO: verify these docs
       *  
       *  finds the largest key with the given prefix, this can be used to find
       *  the last key by using an empty prefix.
       */
      bool get_max(const std::shared_ptr<root>&        r,
                   std::span<const char>               prefix,
                   std::vector<char>*                  result_key,
                   std::vector<char>*                  result_bytes = nullptr,
                   std::vector<std::shared_ptr<root>>* result_roots = nullptr) const;

      void print(const std::shared_ptr<root>& r);
      void validate(const std::shared_ptr<root>& r);

      session(std::shared_ptr<database> db);
      ~session();

     protected:
      session(const session&) = delete;

      inline object_id   get_id(const std::shared_ptr<root>& r) const;
      void               validate(session_rlock& l, id);
      void               print(id n, string_view prefix = "", std::string k = "");
      inline deref<node> get_by_id(session_rlock& l, object_id i) const;
      inline deref<node> get_by_id(session_rlock& l, object_id i, bool& unique) const;

      bool unguarded_get(session_rlock&                                l,
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
          session_rlock&                                l,
          const std::shared_ptr<triedent::root>&        ancestor,
          object_id                                     root,
          std::string_view                              key,
          temp_key6&                                    result_key,
          std::vector<char>*                            result_bytes,
          std::vector<std::shared_ptr<triedent::root>>* result_roots) const;

      bool unguarded_get_less_than(
          session_rlock&                                l,
          const std::shared_ptr<triedent::root>&        ancestor,
          object_id                                     root,
          std::optional<std::string_view>               key,
          temp_key6&                                    result_key,
          std::vector<char>*                            result_bytes,
          std::vector<std::shared_ptr<triedent::root>>* result_roots) const;

      bool unguarded_get_max(session_rlock&                                l,
                             const std::shared_ptr<triedent::root>&        ancestor,
                             object_id                                     root,
                             std::string_view                              prefix_min,
                             std::string_view                              prefix_max,
                             temp_key6&                                    result_key,
                             std::vector<char>*                            result_bytes,
                             std::vector<std::shared_ptr<triedent::root>>* result_roots) const;

      inline id   retain(session_rlock&, id);   // bump or copy
      inline void release(session_rlock&, id);  // polymorphic release node

      friend class database;
      std::shared_ptr<database> _db;

      seg_allocator& sega() const;
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
      inline void update_root(session_rlock& l, std::shared_ptr<root>& r, object_id id);

      void recursive_retain(session_rlock& l, object_id id);

      mutable_deref<value_node> make_value(session_rlock& state,
                                           node_type      type,
                                           string_view    k,
                                           string_view    v);

      inline object_id make_value_id(session_rlock& state,
                                     node_type      type,
                                     string_view    k,
                                     string_view    v);

      mutable_deref<value_node> clone_value(session_rlock& state,
                                            object_id      origin,
                                            node_type      type,
                                            string_view    key,
                                            std::uint32_t  key_offset,
                                            string_view    val);

      // like clone_value but doesn't construct a mutable_deref which does
      // unnecessary locking
      inline object_id clone_value_id(session_rlock& state,
                                      object_id      origin,
                                      node_type      type,
                                      string_view    key,
                                      std::uint32_t  key_offset,
                                      string_view    val);

      inline mutable_deref<value_node> clone_value(session_rlock&     state,
                                                   object_id          origin,
                                                   node_type          type,
                                                   const std::string& key,
                                                   string_view        val);

      inline object_id clone_value_id(session_rlock&     state,
                                      object_id          origin,
                                      node_type          type,
                                      const std::string& key,
                                      string_view        val);

      inline mutable_deref<inner_node> make_inner(session_rlock& state,
                                                  string_view    pre,
                                                  id             val,
                                                  uint64_t       branches);

      inline object_id make_inner_id(session_rlock& state,
                                     string_view    pre,
                                     id             val,
                                     uint64_t       branches);

      inline mutable_deref<inner_node> clone_inner(session_rlock&    state,
                                                   object_id         id,
                                                   const inner_node& cpy,
                                                   string_view       pre,
                                                   std::uint32_t     offset,
                                                   object_id         val,
                                                   uint64_t          branches);
      inline mutable_deref<inner_node> clone_inner(session_rlock&     state,
                                                   object_id          id,
                                                   const inner_node&  cpy,
                                                   const std::string& pre,
                                                   object_id          val,
                                                   uint64_t           branches);

      inline object_id clone_inner_id(session_rlock&    state,
                                      object_id         id,
                                      const inner_node& cpy,
                                      string_view       pre,
                                      std::uint32_t     offset,
                                      object_id         val,
                                      uint64_t          branches);
      inline object_id clone_inner_id(session_rlock&     state,
                                      object_id          id,
                                      const inner_node&  cpy,
                                      const std::string& pre,
                                      object_id          val,
                                      uint64_t           branches);

      template <typename T>
      inline mutable_deref<T> lock(const deref<T>& obj);

      inline id add_child(session_rlock& state,
                          id             root,
                          bool           unique,
                          node_type      type,
                          string_view    key,
                          string_view    val,
                          int&           old_size);
      inline id remove_child(session_rlock& state,
                             id             root,
                             bool           unique,
                             string_view    key,
                             int&           removed_size);

      inline void modify_value(session_rlock&            state,
                               mutable_deref<value_node> mut,
                               string_view               val);
      inline id   set_value(session_rlock& state,
                            deref<node>    n,
                            bool           unique,
                            node_type      type,
                            string_view    key,
                            string_view    val);
      inline id   set_inner_value(session_rlock&    state,
                                  deref<inner_node> n,
                                  bool              unique,
                                  node_type         type,
                                  string_view       val);
      inline id   combine_value_nodes(session_rlock& state,
                                      node_type      t1,
                                      string_view    k1,
                                      string_view    v1,
                                      object_id      origin1,
                                      node_type      t2,
                                      string_view    k2,
                                      string_view    v2,
                                      object_id      origin2);
   };

   class database : public std::enable_shared_from_this<database>
   {
      template <typename AccessMode>
      friend class session;

      friend write_session;
      friend session_base;
      friend root;

     public:
      struct config
      {
      };
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

      // bool is_slow() const { return _ring.is_slow(); }
      // auto span() const { return _ring.span(); }

     private:
      inline void release(session_rlock& l, id);

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

      seg_allocator    _sega;
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
         auto                        state = db->_root_release_session.lock();
         db->release(state, id);
      }
   }

   inline session_base::session_base(seg_allocator& a) : _session(a.start_session()) {}

   template <typename AccessMode>
   inline seg_allocator& session<AccessMode>::sega() const
   {
      return _db->_sega;
   }

   template <typename AccessMode>
   session<AccessMode>::session(std::shared_ptr<database> db)
       : session_base{db->_sega}, _db(std::move(db))
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
   inline deref<node> session<AccessMode>::get_by_id(session_rlock& state, id i) const
   {
      return deref<node>(state.get(i, true));
      //    auto [ptr, type, ref] = ring().template get_cache<true>(l, i);
      //    return {i, ptr, type};
   }

   template <typename AccessMode>
   inline deref<node> session<AccessMode>::get_by_id(session_rlock& state, id i, bool& unique) const
   {
      auto ob = state.get(i);
      unique &= (ob.ref_count() == 1);
      return deref<node>(ob);
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
         auto id    = r->id;
         r->id      = {};
         auto state = lock();
         release(state, id);
      }
      r = {};
   }

   template <typename AccessMode>
   inline void session<AccessMode>::release(session_rlock& state, id obj)
   {
      _db->release(state, obj);
   }

   inline void database::release(session_rlock& state, id obj)
   {
      release_node(state, obj);
   }

   template <typename AccessMode>
   inline database::id session<AccessMode>::retain(session_rlock& state, id obj)
   {
      return bump_refcount_or_copy(state, obj);
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

      auto state = session_base::lock();
      id         = retain(state, {id}).id;
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

      auto state = session_base::lock();
      if constexpr (debug_roots)
         std::cout << id.id << ": set_top_root: old=" << current << std::endl;
      id = retain(state, id);
      _db->_dbm->top_root.store(id.id);
      release(state, {current});
   }

   inline bool write_session::get_unique(std::shared_ptr<root>& r)
   {
      // This doesn't check the refcount in object_db; that's checked elsewhere.
      return r && r->db && !r->ancestor && r.use_count() == 1;
   }

   inline void write_session::update_root(session_rlock& l, std::shared_ptr<root>& r, object_id id)
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

   inline mutable_deref<value_node> write_session::make_value(session_rlock& state,
                                                              node_type      type,
                                                              string_view    key,
                                                              string_view    val)
   {
      return {value_node::make(state, key, val, type)};
   }

   inline object_id write_session::make_value_id(session_rlock& state,
                                                 node_type      type,
                                                 string_view    key,
                                                 string_view    val)
   {
      return value_node::make(state, key, val, type).id();
   }

   inline object_id write_session::clone_value_id(session_rlock& state,
                                                  object_id      origin,
                                                  node_type      type,
                                                  string_view    key,
                                                  std::uint32_t  key_offset,
                                                  string_view    val)
   {
      return value_node::clone(state, origin, key, key_offset, val, type).id();
   }

   inline mutable_deref<value_node> write_session::clone_value(session_rlock&     state,
                                                               object_id          origin,
                                                               node_type          type,
                                                               const std::string& key,
                                                               string_view        val)
   {
      return {value_node::clone(state, origin, key, -1, val, type)};
   }
   inline object_id write_session::clone_value_id(session_rlock&     state,
                                                               object_id          origin,
                                                               node_type          type,
                                                               const std::string& key,
                                                               string_view        val)
   {
      return value_node::clone(state, origin, key, -1, val, type).id();
   }

   inline mutable_deref<inner_node> write_session::make_inner(session_rlock& state,
                                                              string_view    pre,
                                                              id             val,
                                                              uint64_t       branches)
   {
      return inner_node::make(state, pre, val, branches);
   }
   inline object_id write_session::make_inner_id(session_rlock& state,
                                                 string_view    pre,
                                                 id             val,
                                                 uint64_t       branches)
   {
      return inner_node::make(state, pre, val, branches).id();
   }

   inline mutable_deref<inner_node> write_session::clone_inner(session_rlock&    state,
                                                               object_id         id,
                                                               const inner_node& cpy,
                                                               string_view       pre,
                                                               std::uint32_t     offset,
                                                               object_id         val,
                                                               uint64_t          branches)
   {
      return inner_node::clone(state, id, &cpy, pre, offset, val, branches);
   }

   inline object_id write_session::clone_inner_id(session_rlock&    state,
                                                  object_id         id,
                                                  const inner_node& cpy,
                                                  string_view       pre,
                                                  std::uint32_t     offset,
                                                  object_id         val,
                                                  uint64_t          branches)
   {
      return inner_node::clone(state, id, &cpy, pre, offset, val, branches).id();
   }

   inline mutable_deref<inner_node> write_session::clone_inner(session_rlock&     state,
                                                               object_id          id,
                                                               const inner_node&  cpy,
                                                               const std::string& pre,
                                                               object_id          val,
                                                               uint64_t           branches)
   {
      return inner_node::clone(state, id, &cpy, pre, -1, val, branches);
   }
   inline object_id write_session::clone_inner_id(session_rlock&     state,
                                                  object_id          id,
                                                  const inner_node&  cpy,
                                                  const std::string& pre,
                                                  object_id          val,
                                                  uint64_t           branches)
   {
      return inner_node::clone(state, id, &cpy, pre, -1, val, branches).id();
   }

   template <typename T>
   inline mutable_deref<T> write_session::lock(const deref<T>& obj)
   {
      return {obj};
   }

   /**
    *  Given an existing value node and a new key/value to insert
    */
   database::id write_session::combine_value_nodes(session_rlock& state,
                                                   node_type      t1,
                                                   string_view    k1,
                                                   string_view    v1,
                                                   object_id      origin1,
                                                   node_type      t2,
                                                   string_view    k2,
                                                   string_view    v2,
                                                   object_id      origin2)
   {
      if (k1.size() > k2.size())
         return combine_value_nodes(state, t2, k2, v2, origin2, t1, k1, v1, origin1);

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
             [&] { return clone_value_id(state, origin1, t1, k1, k1.size(), v1); },
             [&] { return clone_value_id(state, origin2, t2, k2, cpre.size() + 1, v2); });

         // this usesthe non-locking deref because no alloc before return
         auto in = inner_node::make( state, cpre, id(), 1ull<<b2 );
         
         // Set value separately, because we don't want to increment its refcount
         in->set_value(inner_id);
         in->branch(b2) = branch_id;

         return in.id();
      }
      else
      {
         auto b1sfx        = k1.substr(cpre.size());
         auto b1           = b1sfx.front();
         auto [b1id, b2id] = build_children(
             [&] { return clone_value_id(state, origin1, t1, k1, cpre.size() + 1, v1); },
             [&] { return clone_value_id(state, origin2, t2, k2, cpre.size() + 1, v2); });

         // this usesthe non-locking deref because there are no alloc before return
         auto in        = inner_node::make(state, cpre, id(), inner_node::branches(b1, b2));
         in->branch(b1) = b1id;
         in->branch(b2) = b2id;

         return in.id();
      }
   }

   void write_session::modify_value(session_rlock&            l,
                                    mutable_deref<value_node> mut,
                                    string_view               val)
   {
      if (mut.type() == node_type::roots)
      {
         if constexpr (debug_roots)
         {
            std::cout << mut.id().id << ": modify_value; old:";
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
            std::cout << mut.id().id << ": modify_value; new:";
            for (unsigned i = 0; i < mut->num_roots(); ++i)
               std::cout << " " << mut->roots()[i].id;
            std::cout << std::endl;
         }
      }
      else
         memcpy(mut->data_ptr(), val.data(), val.size());
   }

   database::id write_session::set_value(session_rlock& state,
                                         deref<node>    n,
                                         bool           unique,
                                         node_type      type,
                                         string_view    key,
                                         string_view    val)
   {
      if (!n || !unique || type != n.type())
         return make_value_id(state, type, key, val);

      assert(n.is_leaf_node());

      auto& vn = n.as_value_node();
      if (vn.data_size() == val.size())
      {
         modify_value(state, deref<value_node>(n), val);
         return n.id();
      }

      return make_value_id(state, type, key, val);
   }

   database::id write_session::set_inner_value(session_rlock&    state,
                                               deref<inner_node> n,
                                               bool              unique,
                                               node_type         type,
                                               string_view       val)
   {
      if (unique)
      {
         if (auto old_value = n->value())
         {
            auto  v  = state.get(old_value, false);  // TODO copy to cache?
            auto& vn = v.as_value_node();
            if (v.type() == type && vn.data_size() == val.size() && v.ref_count() == 1)
            {
               modify_value(state, deref<value_node>(v), val);
               return n.id();
            }
            else
            {
               v.release();
            }
         }
         object_id val_id = make_value_id(state, type, string_view(), val);
         // This lock is necessary because we alloc above and n was deref
         // before
         lock(n)->set_value(val_id);
         return n.id();
      }
      else
      {
         object_id new_val = make_value_id(state, type, string_view(), val);

         auto result = inner_node::clone(state, n.id(), &*n, n->key(), 0, object_id{}, n->branches());
         result->set_value(new_val);
         return result.id();
      }
   }

   /**
    *  Given an existing tree node (root) add a new key/value under it and return the id
    *  of the new node if a new node had to be allocated.
    */
   inline database::id write_session::add_child(session_rlock& state,
                                                id             root,
                                                bool           unique,
                                                node_type      type,
                                                string_view    key,
                                                string_view    val,
                                                int&           old_size)
   {
      if (not root)  // empty case
         return make_value_id(state, type, key, val);

      auto n = get_by_id(state, root, unique);
      if (n.is_leaf_node())  // current root is value
      {
         auto& vn = n.as_value_node();
         if (vn.key() != key)
            return combine_value_nodes(state, n.type(), vn.key(), vn.data(), root, type, key, val,
                                       object_id{});
         else
         {
            old_size = vn.data_size();
            return set_value(state, n, unique, type, key, val);
         }
      }

      // current root is an inner node
      auto in     = deref<inner_node>{n};
      auto in_key = in->key();
      if (in_key == key)  // whose prefix is same as key, therefore set the value
      {
         if (in->value())
            old_size = state.get(in->value()).as_value_node().data_size();
         return set_inner_value(state, n, unique, type, val);
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
                add_child(state, cur_b, false, type, key.substr(cpre.size() + 1), val, old_size);

            auto new_in = inner_node::clone(state, root, &*in, in->key(), 0, in->value(),
                                      in->branches() | 1ull << b);

            if (new_b != cur_b)
            {
               new_in->branch(b) = new_b;
               release(state, cur_b);
            }

            return new_in.id();
         }  // else modify in place

         auto cur_b = in->branch(b);
         auto new_b =
             add_child(state, cur_b, unique, type, key.substr(cpre.size() + 1), val, old_size);

         if (new_b != cur_b)
         {
            lock(in)->branch(b) = new_b;
            release(state, cur_b);
         }
         return root;
      }
      else  // the current node needs to split and become a child of new parent
      {
         if (cpre == key)  // value needs to be on a new inner node
         {
            auto b1 = in_key[cpre.size()];
            // MUST convert to id to release the location_lock
            id b1val = clone_inner_id(state, in.id(), *in, in_key, cpre.size() + 1, in->value(),
                                      in->branches());
            id b0val = make_value_id(state, type, string_view(), val);

            auto nin = inner_node::make(state, cpre, object_id{}, inner_node::branches(b1));
            // Set separately because we don't need to inc ref
            nin->set_value(b0val);
            nin->branch(b1) = b1val;
            return nin.id();
         }
         else  // there are two branches
         {
            auto b1    = key[cpre.size()];
            auto b2    = in_key[cpre.size()];
            auto b1key = key.substr(cpre.size() + 1);
            // Handle sub first, because b2key is invalidated by allocation.
            // cpre and b1key are safe because they point into key, which is externally owned
            id sub   = clone_inner_id(state, in.id(), *in, in_key, cpre.size() + 1, in->value(),
                                      in->branches());
            id b1val = make_value_id(state, type, b1key, val);

            auto nin = inner_node::make(state, cpre, id(), inner_node::branches(b1, b2));

            assert(not nin->branch(b1));
            nin->branch(b1) = b1val;
            assert(not nin->branch(b2));
            nin->branch(b2) = sub;

            return nin.id();
         }
      }
   }  // write_session::add_child

   inline int write_session::upsert(std::shared_ptr<root>& r,
                                    std::span<const char>  key,
                                    std::span<const char>  val)
   {
      auto state = session_base::lock();

      int  old_size = -1;
      auto new_root =
          add_child(state, get_id(r), get_unique(r), node_type::bytes,
                    to_key6({key.data(), key.size()}), {val.data(), val.size()}, old_size);
      assert(new_root.id);
      update_root(state, r, new_root);
      return old_size;
   }

   inline int write_session::upsert(std::shared_ptr<root>&                 r,
                                    std::span<const char>                  key,
                                    std::span<const std::shared_ptr<root>> roots)
   {
      auto state = session_base::lock();

      std::vector<object_id> ids;
      ids.reserve(roots.size());
      for (auto& r : roots)
         ids.push_back(retain(state, get_id(r)));

      int  old_size = -1;
      auto new_root = add_child(
          state, get_id(r), get_unique(r), node_type::roots, to_key6({key.data(), key.size()}),
          {reinterpret_cast<const char*>(ids.data()), ids.size() * sizeof(object_id)}, old_size);
      assert(new_root.id);
      update_root(state, r, new_root);
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
      auto state = session_base::lock();
      return unguarded_get(state, r, get_id(r), to_key6({key.data(), key.size()}), result_bytes,
                           result_roots);
   }

   template <typename AccessMode>
   bool session<AccessMode>::unguarded_get(
       session_rlock&                                l,
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
      auto      state = session_base::lock();
      temp_key6 result_key6;
      if (!unguarded_get_greater_equal(state, r, get_id(r), to_key6({key.data(), key.size()}),
                                       result_key6, result_bytes, result_roots))
         return false;
      if (result_key)
      {
         from_key6({result_key6.data(), result_key6.size()}, *result_key);
      }
      return true;
   }

   template <typename AccessMode>
   bool session<AccessMode>::unguarded_get_greater_equal(
       session_rlock&                                state,
       const std::shared_ptr<triedent::root>&        ancestor,
       object_id                                     root,
       std::string_view                              key,
       temp_key6&                                    result_key,
       std::vector<char>*                            result_bytes,
       std::vector<std::shared_ptr<triedent::root>>* result_roots) const
   {
      if (!root)
         return false;
      auto n = state.get<node>(root);//get_by_id(l, root);
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
         auto  v  = state.get(in.value());//get_by_id(l, in.value());
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
         if (unguarded_get_greater_equal(state, ancestor, in.branch(b), key, result_key, result_bytes,
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
      temp_key6 result_key6;
      { // scope the lock as narrow as possible
         auto state = session_base::lock();
         if (!unguarded_get_less_than(state, r, get_id(r), to_key6({key.data(), key.size()}),
                                      result_key6, result_bytes, result_roots))
            return false;
      }
      if (result_key)
      {
         auto s = from_key6({result_key6.data(), result_key6.size()});
         result_key->assign(s.begin(), s.end());
      }
      return true;
   }

   template <typename AccessMode>
   bool session<AccessMode>::unguarded_get_less_than(
       session_rlock&                                l,
       const std::shared_ptr<triedent::root>&        ancestor,
       object_id                                     root,
       std::optional<std::string_view>               key,
       temp_key6&                                    result_key,
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
         //result_key.insert(result_key.end(), vn_key.begin(), vn_key.end());
         result_key.append(vn_key.begin(), vn_key.end());
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
      //result_key.insert(result_key.end(), in_key.begin(), in_key.end());
      result_key.append(in_key.begin(), in_key.end());
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
      auto       prefix_min = to_key6({prefix.data(), prefix.size()});
      auto       extra_bits = prefix_min.size() * 6 - prefix.size() * 8;
      auto       prefix_max = (std::string)prefix_min;
      if (!prefix_max.empty())
         prefix_max.back() |= (1 << extra_bits) - 1;
      temp_key6 result_key6;

      {
         auto state = session_base::lock();
         if (!unguarded_get_max(state, r, get_id(r), prefix_min, prefix_max, result_key6, result_bytes,
                                result_roots))
            return false;
      }
      if (result_key)
      {
         auto s = from_key6({result_key6.data(), result_key6.size()});
         result_key->assign(s.begin(), s.end());
      }
      return true;
   }

   template <typename AccessMode>
   bool session<AccessMode>::unguarded_get_max(
       session_rlock&                                l,
       const std::shared_ptr<triedent::root>&        ancestor,
       object_id                                     root,
       std::string_view                              prefix_min,
       std::string_view                              prefix_max,
       temp_key6&                                    result_key,
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
      int  removed_size = -1;
      auto state = session_base::lock();
      auto new_root = remove_child(state, get_id(r), get_unique(r), to_key6({key.data(), key.size()}),
                                   removed_size);
      update_root(state, r, new_root);
      return removed_size;
   }

   inline database::id write_session::remove_child(session_rlock& state,
                                                   id                            root,
                                                   bool                          unique,
                                                   string_view                   key,
                                                   int&                          removed_size)
   {
      if (not root)
         return root;

      auto n = get_by_id(state, root, unique);
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
         removed_size = get_by_id(state, iv).as_value_node().data_size();

         if (in->num_branches() == 1)
         {
            char        b  = std::countr_zero(in->branches());
            auto        bn = get_by_id(state, *in->children());
            std::string new_key;
            new_key += in_key;
            new_key += b;

            if (bn.is_leaf_node())
            {
               auto& vn = bn.as_value_node();
               new_key += vn.key();
               //           TRIEDENT_DEBUG( "clone value" );
               return clone_value_id(state, bn.id(), bn.type(), new_key, vn.data());
            }
            else
            {
               auto& bin = bn.as_inner_node();
               new_key += bin.key();
               //          TRIEDENT_DEBUG( "clone inner " );
               return clone_inner_id(state, bn.id(), bin, new_key, bin.value(), bin.branches());
            }
         }

         if (unique)
         {
            auto prev = in->value();
            lock(in)->set_value(id());
            release(state, prev);
            return root;
         }
         else
            return clone_inner_id(state, in.id(), *in, key, 0, id(), in->branches());
      }

      auto cpre = common_prefix(in_key, key);
      if (cpre != in_key)
         return root;

      auto b = key[in_key.size()];
      if (not in->has_branch(b))
         return root;

      object_id cur_b = in->branch(b);

      auto new_b =
          remove_child(state, cur_b, unique, key.substr(in_key.size() + 1), removed_size);
      if (new_b != cur_b)
      {
         if (new_b and unique)
         {
            lock(in)->branch(b) = new_b;
            release(state, cur_b);
            return root;
         }
         if (new_b)  // update branch
         {
            auto new_root =
                inner_node::clone(state, in.id(), &*in, in->key(), 0, in->value(), in->branches());
            auto& new_br = new_root->branch(b);
            release(state, new_br);
            new_br = new_b;
            return new_root.id();
         }
         else  // remove branch
         {
            auto new_branches = in->branches() & ~inner_node::branches(b);
            if (std::popcount(new_branches) + bool(in->value()) > 1)
            {  // multiple branches remain, nothing to merge up, just realloc without branch
               //   TRIEDENT_WARN( "clone without branch" );
               return clone_inner_id(state, in.id(), *in, in->key(), 0, in->value(), new_branches);
            }
            if (not new_branches)
            {
               //    TRIEDENT_WARN( "merge inner.key() + value.key() and return new value node" );
               // since we can only remove one item at a time, and this node exists
               // then it means it either had 2 branches before or 1 branch and a value
               // in this case, not branches means it must have a value
               assert(in->value() and "expected value because we removed a branch");

               auto  cur_v = state.get(in->value());//get_by_id(state, in->value());
               auto& cv    = cur_v.as_value_node();
               // make a copy because key and data come from different objects, which clone doesn't handle.
               std::string new_key{in->key()};
               return clone_value_id(state, cur_v.id(), cur_v.type(), new_key, cv.data());
            }
            else
            {  // there must be only 1 branch left
               //     TRIEDENT_WARN( "merge inner.key() + b + value.key() and return new value node" );

               auto  lb          = std::countr_zero(in->branches() ^ inner_node::branches(b));
               auto& last_branch = in->branch(lb);
               // the one branch is either a value or a inner node
               auto cur_v = get_by_id(state, last_branch);
               if (cur_v.is_leaf_node())
               {
                  auto&       cv = cur_v.as_value_node();
                  std::string new_key;
                  new_key += in->key();
                  new_key += char(lb);
                  new_key += cv.key();
                  return clone_value_id(state, cur_v.id(), cur_v.type(), new_key, cv.data());
               }
               else
               {
                  auto&       cv = cur_v.as_inner_node();
                  std::string new_key;
                  new_key += in->key();
                  new_key += char(lb);
                  new_key += cv.key();
                  return clone_inner_id(state, cur_v.id(), cv, new_key, cv.value(), cv.branches());
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
      auto state = session_base::lock();
      validate(state, get_id(r));
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
      auto state = session_base::lock();
      recursive_retain(state, id);
   }

   inline void write_session::recursive_retain(session_rlock& state, id r)
   {
      if (not r)
         return;


      auto dr = state.get(r);
      if( not dr.retain() )
         return;

      if (dr.type() == node_type::inner)
      {
         auto& in = dr.as_inner_node();
         recursive_retain(state, in.value());
         for (auto child : std::span{in.children(), in.num_branches()})
         {
            recursive_retain(state, child);
         }
      }
      else if (dr.type() == node_type::roots)
      {
         auto& rt = dr.as_value_node();
         for (auto child : std::span{rt.roots(), rt.num_roots()})
         {
            recursive_retain(state, child);
         }
      }
   }

   inline void write_session::start_collect_garbage()
   {
      throw std::runtime_error("not impl yet" );
      //ring().gc_start();
   }
   inline void write_session::end_collect_garbage()
   {
      throw std::runtime_error("not impl yet" );
      //ring().gc_finish();
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
   void session<AccessMode>::validate(session_rlock& state, id r)
   {
      if (not r)
         return;

      auto validate_id = [&](auto i)
      {
         auto rv = state.validate(r);
         if( 0 == rv.ref_count() )
            throw std::runtime_error("found reference to object with 0 ref count: " +
                                     std::to_string(r.id));
      };

      validate_id(r);

      auto dr = state.get(r);//get_by_id(state, r);
      if (not dr.is_leaf_node())
      {
         auto& in = dr.as_inner_node();
         validate(state, in.value());

         auto* c = in.children();
         auto* e = c + in.num_branches();
         while (c != e)
         {
            validate(state, *c);
            ++c;
         }
      }
   }

   inline key_view session_base::to_key6(key_view v) const
   {
      return triedent::to_key6(key_buf, v);
   }

}  // namespace triedent
