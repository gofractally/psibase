#pragma once

#include <algorithm>
#include <boost/interprocess/sync/interprocess_sharable_mutex.hpp>
#include <memory>
#include <span>
#include <triedent/node.hpp>

namespace triedent
{
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
      }

     public:
      root()            = default;
      root(const root&) = delete;
      root(root&&)      = default;
      ~root()
      {
         if (db && id && !ancestor)
         {
            // TODO
         }
      }

      root& operator=(const root&) = delete;
      root& operator=(root&&)      = default;
   };  // root

   class session_base
   {
      friend database;

     public:
      using string_view = std::string_view;
      using id          = object_id;

     protected:
      /* auto inc id used to detect when we can modify in place*/
      mutable std::atomic<uint64_t> _hot_swap_p  = -1ull;
      mutable std::atomic<uint64_t> _warm_swap_p = -1ull;
      mutable std::atomic<uint64_t> _cool_swap_p = -1ull;
      mutable std::atomic<uint64_t> _cold_swap_p = -1ull;

      void lock_swap_p(database& db) const;
      void unlock_swap_p() const;

      struct swap_guard
      {
         swap_guard(database& db, const session_base& s) : _s(s) { _s.lock_swap_p(db); }
         ~swap_guard() { _s.unlock_swap_p(); }
         const session_base& _s;
      };

     public:
      key_view to_key6(key_view v) const;

     private:
      mutable key_type key_buf;
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
         // ungaurded access
         string_view _value() const;
         friend class session;
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

      // This is more efficient than simply dropping r since it
      // doesn't usually lock a mutex. However, like dropping r,
      // it still recurses, so there may be an advantage to
      // calling this from a dedicated cleanup thread.
      void release(std::shared_ptr<root>& r);

      iterator first(const std::shared_ptr<root>& r) const;
      iterator last(const std::shared_ptr<root>& r) const;
      iterator find(const std::shared_ptr<root>& r, string_view key) const;
      iterator lower_bound(const std::shared_ptr<root>& r, string_view key) const;
      iterator last_with_prefix(const std::shared_ptr<root>& r, string_view prefix) const;
      bool     get(const std::shared_ptr<root>& r, string_view key, std::string& result) const;
      std::optional<std::string> get(const std::shared_ptr<root>& r, string_view key) const;

      void print(const std::shared_ptr<root>& r);
      void validate(const std::shared_ptr<root>& r);

      session(std::shared_ptr<database> db);
      ~session();

     protected:
      session(const session&) = delete;

      inline object_id           get_id(const std::shared_ptr<root>& r) const;
      void                       validate(id);
      void                       next(iterator& itr) const;
      void                       prev(iterator& itr) const;
      iterator                   find(id n, string_view key) const;
      void                       print(id n, string_view prefix = "", std::string k = "");
      inline deref<node>         get(ring_allocator::id i) const;
      inline deref<node>         get(ring_allocator::id i, bool& unique) const;
      std::optional<string_view> get(id root, string_view key) const;

      inline id   retain(id);
      inline void release(id);

      friend class database;
      std::shared_ptr<database> _db;

      auto& ring();

      struct swap_guard : session_base::swap_guard
      {
         swap_guard(const session& s) : session_base::swap_guard(*s._db, s) {}
         swap_guard(const session* s) : session_base::swap_guard(*s->_db, *s) {}
      };
   };
   using read_session = session<read_access>;

   class write_session : public read_session
   {
     public:
      write_session(std::shared_ptr<database> db) : read_session(db) {}

      std::shared_ptr<root> get_top_root();
      void                  set_top_root(const std::shared_ptr<root>& r);

      int upsert(std::shared_ptr<root>& r, string_view key, string_view val);

      // Caution: r (the reference) must not reference any of the shared_ptrs
      //          within roots. It may be a copy of a shared_ptr within roots.
      //          The latter case won't create a loop; instead it will create a
      //          newer tree which references an older tree in one of its leaves.
      //          The newer tree will still have structural sharing with the older
      //          tree.
      int upsert(std::shared_ptr<root>&                 r,
                 string_view                            key,
                 std::span<const std::shared_ptr<root>> roots);

      int remove(std::shared_ptr<root>& r, string_view key);

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

      void recursive_retain(object_id id);

      inline mutable_deref<value_node> make_value(node_type type, string_view k, string_view v);
      inline mutable_deref<inner_node> make_inner(string_view pre, id val, uint64_t branches);
      inline mutable_deref<inner_node> make_inner(const inner_node& cpy,
                                                  string_view       pre,
                                                  id                val,
                                                  uint64_t          branches);

      template <typename T>
      inline mutable_deref<T> lock(const deref<T>& obj);

      inline id add_child(id          root,
                          bool        unique,
                          node_type   type,
                          string_view key,
                          string_view val,
                          int&        old_size);
      inline id remove_child(id root, bool unique, string_view key, int& removed_size);

      inline void modify_value(mutable_deref<value_node> mut, string_view val);
      inline id   set_value(deref<node> n,
                            bool        unique,
                            node_type   type,
                            string_view key,
                            string_view val);
      inline id set_inner_value(deref<inner_node> n, bool unique, node_type type, string_view val);
      inline id combine_value_nodes(node_type   t1,
                                    string_view k1,
                                    string_view v1,
                                    node_type   t2,
                                    string_view k2,
                                    string_view v2);
   };

   class database : public std::enable_shared_from_this<database>
   {
      template <typename AccessMode>
      friend class session;

      friend write_session;
      friend session_base;

     public:
      struct config
      {
         uint64_t max_objects = 1000 * 1000ull;
         uint64_t hot_pages   = 32;
         uint64_t warm_pages  = 32;
         uint64_t cool_pages  = 32;
         uint64_t cold_pages  = 32;
      };

      enum access_mode
      {
         read_only  = 0,
         read_write = 1
      };

      using string_view = std::string_view;
      using id          = object_id;

      database(std::filesystem::path dir, access_mode allow_write);
      ~database();

      inline void swap();
      inline void claim_free() const;
      inline void ensure_free_space();
      static void create(std::filesystem::path dir, config);

      std::shared_ptr<write_session> start_write_session();
      std::shared_ptr<read_session>  start_read_session();

      void print_stats(bool detail = false);

     private:
      inline void release(id);

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

      static std::atomic<int>      _read_thread_number;
      static thread_local uint32_t _thread_num;
      static std::atomic<uint32_t> _write_thread_rev;

      std::unique_ptr<ring_allocator>     _ring;
      std::filesystem::path               _db_dir;
      std::unique_ptr<bip::file_mapping>  _file;
      std::unique_ptr<bip::mapped_region> _region;
      database_memory*                    _dbm;

      mutable std::mutex         _root_change_mutex;
      mutable std::mutex         _active_sessions_mutex;
      std::vector<session_base*> _active_sessions;
      bool                       _have_write_session;
   };

   template <typename T>
   struct deref
   {
      using id = object_id;

      deref() = default;
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
      deref(id i, char* p, node_type t) : _id(i), ptr(p), _type(t) {}

      explicit inline operator bool() const { return bool(_id); }
      inline          operator id() const { return _id; }

      auto         type() const { return _type; }
      bool         is_leaf_node() const { return _type != node_type::inner; }
      inline auto& as_value_node() const { return *reinterpret_cast<const value_node*>(ptr); }
      inline auto& as_inner_node() const { return *reinterpret_cast<const inner_node*>(ptr); }

      inline const T* operator->() const { return reinterpret_cast<const T*>(ptr); }
      inline const T& operator*() const { return *reinterpret_cast<const T*>(ptr); }

      int64_t as_id() const { return _id.id; }

     protected:
      template <typename Other>
      friend class deref;

      id        _id;
      char*     ptr;
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

     private:
      location_lock lock;
   };  // mutable_deref

   template <typename AccessMode>
   inline auto& session<AccessMode>::ring()
   {
      return *_db->_ring;
   }

   inline void session_base::lock_swap_p(database& db) const
   {
      auto sp = db._ring->get_swap_pos();
      _hot_swap_p.store(sp._swap_pos[0]);
      _warm_swap_p.store(sp._swap_pos[1]);
      _cool_swap_p.store(sp._swap_pos[2]);
      _cold_swap_p.store(sp._swap_pos[3]);
   }

   inline void session_base::unlock_swap_p() const
   {
      _hot_swap_p.store(-1ull);
      _warm_swap_p.store(-1ull);
      _cool_swap_p.store(-1ull);
      _cold_swap_p.store(-1ull);
   }

   template <typename AccessMode>
   session<AccessMode>::session(std::shared_ptr<database> db) : _db(std::move(db))
   {
      _iterators.resize(64);

      std::lock_guard<std::mutex> lock(_db->_active_sessions_mutex);

      if (std::is_same_v<AccessMode, write_access> && _db->_have_write_session)
         throw std::runtime_error("Only 1 write session may be active");

      _db->_active_sessions.push_back(this);

      if constexpr (std::is_same_v<AccessMode, write_access>)
         _db->_have_write_session = true;
   }
   template <typename AccessMode>
   session<AccessMode>::~session()
   {
      std::lock_guard<std::mutex> lock(_db->_active_sessions_mutex);

      auto itr = std::find(_db->_active_sessions.begin(), _db->_active_sessions.end(), this);
      _db->_active_sessions.erase(itr);

      if constexpr (std::is_same_v<AccessMode, write_access>)
         _db->_have_write_session = false;
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
   inline deref<node> session<AccessMode>::get(id i) const
   {
      auto [ptr, type, ref] = _db->_ring->get_cache<std::is_same_v<AccessMode, write_access>>(i);
      return {i, ptr, type};
   }

   template <typename AccessMode>
   inline deref<node> session<AccessMode>::get(id i, bool& unique) const
   {
      auto [ptr, type, ref] = _db->_ring->get_cache<std::is_same_v<AccessMode, write_access>>(i);
      unique &= ref == 1;
      return {i, ptr, type};
   }

   template <typename AccessMode>
   inline void session<AccessMode>::release(std::shared_ptr<root>& r)
   {
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
      release_node(*_ring, obj);
   }

   template <typename AccessMode>
   inline database::id session<AccessMode>::retain(id obj)
   {
      return bump_refcount_or_copy(*_db->_ring, obj);
   }

   inline std::string_view common_prefix(std::string_view a, std::string_view b)
   {
      if (a.size() > b.size())
         std::swap(a, b);

      auto itr = b.begin();
      for (auto& c : a)
      {
         if (c != *itr)
            return std::string_view(b.begin(), itr - b.begin());
         ++itr;
      }
      return a;
   }

   inline std::shared_ptr<root> write_session::get_top_root()
   {
      _db->ensure_free_space();
      std::lock_guard<std::mutex> lock(_db->_root_change_mutex);
      auto                        id = _db->_dbm->top_root.load();
      if (!id)
         return {};

      swap_guard g(*this);
      id = retain({id}).id;
      return std::make_shared<root>(root{_db, nullptr, {id}});
   }

   inline void write_session::set_top_root(const std::shared_ptr<root>& r)
   {
      _db->ensure_free_space();
      std::lock_guard<std::mutex> lock(_db->_root_change_mutex);
      auto                        current = _db->_dbm->top_root.load();
      auto                        id      = get_id(r);
      if (current == id.id)
         return;

      swap_guard g(*this);
      id = retain(id);
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
         return;
      }
      else if (get_unique(r))
      {
         // Even though it is unique, it wasn't edited in place (r->id != id).
         // The new id (if not 0) has a refcount of 1, so doesn't need to be
         // bumped.
         release(r->id);
         r->id = id;
      }
      else
      {
         r = std::make_shared<root>(root{_db, nullptr, id});
      }
   }

   inline mutable_deref<value_node> write_session::make_value(node_type   type,
                                                              string_view key,
                                                              string_view val)
   {
      return {value_node::make(*_db->_ring, key, val, type, false), type};
   }

   inline mutable_deref<inner_node> write_session::make_inner(string_view pre,
                                                              id          val,
                                                              uint64_t    branches)
   {
      return inner_node::make(*_db->_ring, pre, val, branches);
   }

   inline mutable_deref<inner_node> write_session::make_inner(const inner_node& cpy,
                                                              string_view       pre,
                                                              id                val,
                                                              uint64_t          branches)
   {
      return inner_node::make(*_db->_ring, cpy, pre, val, branches);
   }

   template <typename T>
   inline mutable_deref<T> write_session::lock(const deref<T>& obj)
   {
      return {_db->_ring->spin_lock(obj), obj};
   }

   /**
    *  Given an existing value node and a new key/value to insert
    */
   database::id write_session::combine_value_nodes(node_type   t1,
                                                   string_view k1,
                                                   string_view v1,
                                                   node_type   t2,
                                                   string_view k2,
                                                   string_view v2)
   {
      if (k1.size() > k2.size())
         return combine_value_nodes(t2, k2, v2, t1, k1, v1);

      //std::cerr << __func__ << ":" << __LINE__ << "\n";
      auto cpre = common_prefix(k1, k2);

      if (cpre == k1)
      {
         //  std::cerr << __func__ << ":" << __LINE__ << "\n";
         auto inner_value = make_value(t1, string_view(), v1);
         auto k2sfx       = k2.substr(cpre.size());
         auto b2          = k2sfx.front();

         auto in = make_inner(cpre, id(), 1ull << b2);
         in->set_value(inner_value);

         in->branch(b2) = make_value(t2, k2sfx.substr(1), v2);

         return in;
      }
      else
      {
         // std::cerr << __func__ << ":" << __LINE__ << "\n";
         auto b1sfx = k1.substr(cpre.size());
         auto b2sfx = k2.substr(cpre.size());
         auto b1    = b1sfx.front();
         auto b2    = b2sfx.front();
         auto b1v   = make_value(t1, b1sfx.substr(1), v1);
         auto b2v   = make_value(t2, b2sfx.substr(1), v2);

         //auto in        = make_inner(cpre, (1ull << b2) | (1ul << b1), _version);
         auto in        = make_inner(cpre, id(), inner_node::branches(b1, b2));
         in->branch(b1) = b1v;
         in->branch(b2) = b2v;

         return in;
      }
   }

   void write_session::modify_value(mutable_deref<value_node> mut, string_view val)
   {
      if (mut.type() == node_type::roots)
      {
         auto* src  = reinterpret_cast<const object_id*>(val.data());
         auto* dest = mut->roots();
         auto  n    = mut->num_roots();
         while (n--)
         {
            auto prev = *dest;
            *dest++   = *src++;
            release(prev);
         }
      }
      else
         memcpy(mut->data_ptr(), val.data(), val.size());
   }

   database::id write_session::set_value(deref<node> n,
                                         bool        unique,
                                         node_type   type,
                                         string_view key,
                                         string_view val)
   {
      if (!n || !unique || type != n.type())
         return make_value(type, key, val);

      assert(n.is_leaf_node());

      auto& vn = n.as_value_node();
      if (vn.data_size() == val.size())
      {
         modify_value(lock(deref<value_node>(n)), val);
         return n;
      }

      return make_value(type, key, val);
   }

   database::id write_session::set_inner_value(deref<inner_node> n,
                                               bool              unique,
                                               node_type         type,
                                               string_view       val)
   {
      if (unique)
      {
         auto locked = lock(n);
         if (locked->value())
         {
            auto  v  = get(locked->value());
            auto& vn = v.as_value_node();
            if (v.type() == type && vn.data_size() == val.size() &&
                _db->_ring->ref(locked->value()) == 1)
            {
               modify_value(lock(deref<value_node>(v)), val);
            }
            else
            {
               _db->_ring->release(locked->value());
               locked->set_value(make_value(type, string_view(), val));
            }
         }
         else
         {
            locked->set_value(make_value(type, string_view(), val));
         }
         return locked;
      }
      else
      {
         auto new_val = make_value(type, string_view(), val);
         return make_inner(*n, n->key(), new_val, n->branches());
      }
   }

   /**
    *  Given an existing tree node (root) add a new key/value under it and return the id
    *  of the new node if a new node had to be allocated.
    */
   inline database::id write_session::add_child(id          root,
                                                bool        unique,
                                                node_type   type,
                                                string_view key,
                                                string_view val,
                                                int&        old_size)
   {
      if (not root)  // empty case
         return make_value(type, key, val);

      auto n = get(root, unique);
      if (n.is_leaf_node())  // current root is value
      {
         auto& vn = n.as_value_node();
         if (vn.key() != key)
            return combine_value_nodes(n.type(), vn.key(), vn.data(), type, key, val);
         else
         {
            old_size = vn.data_size();
            return set_value(n, unique, type, key, val);
         }
      }

      // current root is an inner node
      auto& in     = n.as_inner_node();
      auto  in_key = in.key();
      if (in_key == key)  // whose prefix is same as key, therefore set the value
      {
         if (in.value())
            old_size = get(in.value()).as_value_node().data_size();
         return set_inner_value(n, unique, type, val);
      }

      auto cpre = common_prefix(in_key, key);
      if (cpre == in_key)  // value is on child branch
      {
         auto b = key[cpre.size()];

         if (!unique or not in.has_branch(b))  // copy on write
         {
            auto  new_in = make_inner(in, in_key, retain(in.value()), in.branches() | 1ull << b);
            auto& cur_b  = new_in->branch(b);

            auto new_b = add_child(cur_b, false, type, key.substr(cpre.size() + 1), val, old_size);

            if (new_b != cur_b)
            {
               release(cur_b);
               cur_b = new_b;
            }

            return new_in;
         }  // else modify in place

         auto cur_b = in.branch(b);
         auto new_b = add_child(cur_b, unique, type, key.substr(cpre.size() + 1), val, old_size);

         if (new_b != cur_b)
         {
            auto  locked = lock(n);
            auto& cur_b  = locked.as_inner_node().branch(b);
            release(cur_b);
            cur_b = new_b;
         }
         return root;
      }
      else  // the current node needs to split and become a child of new parent
      {
         if (cpre == key)  // value needs to be on a new inner node
         {
            //std::cerr << __func__ << ":" << __LINE__ << "\n";
            auto b1    = in_key[cpre.size()];
            auto b1key = in_key.substr(cpre.size() + 1);
            auto b1val = make_inner(in, b1key, retain(in.value()), in.branches());
            auto b0val = make_value(type, string_view(), val);

            auto nin        = make_inner(cpre, b0val, inner_node::branches(b1));
            nin->branch(b1) = b1val;
            return nin;
         }
         else  // there are two branches
         {
            //std::cerr << __func__ << ":" << __LINE__ << "\n";
            auto b1    = key[cpre.size()];
            auto b2    = in_key[cpre.size()];
            auto b1key = key.substr(cpre.size() + 1);
            auto b2key = in_key.substr(cpre.size() + 1);
            auto nin   = make_inner(cpre, id(), inner_node::branches(b1, b2));

            assert(not nin->branch(b1));
            nin->branch(b1) = make_value(type, b1key, val);
            auto sub        = make_inner(in, b2key, retain(in.value()), in.branches());
            assert(not nin->branch(b2));
            nin->branch(b2) = sub;

            return nin;
         }
      }
   }  // write_session::add_child

   inline int write_session::upsert(std::shared_ptr<root>& r, string_view key, string_view val)
   {
      _db->ensure_free_space();
      swap_guard g(*this);
      auto&      ar = *_db->_ring;

      int  old_size = -1;
      auto new_root =
          add_child(get_id(r), get_unique(r), node_type::bytes, to_key6(key), val, old_size);
      assert(new_root.id);
      update_root(r, new_root);
      return old_size;
   }

   inline int write_session::upsert(std::shared_ptr<root>&                 r,
                                    string_view                            key,
                                    std::span<const std::shared_ptr<root>> roots)
   {
      _db->ensure_free_space();
      swap_guard g(*this);
      auto&      ar = *_db->_ring;

      std::vector<object_id> ids;
      ids.reserve(roots.size());
      for (auto& r : roots)
         ids.push_back(retain(get_id(r)));

      int  old_size = -1;
      auto new_root = add_child(
          get_id(r), get_unique(r), node_type::roots, to_key6(key),
          {reinterpret_cast<const char*>(ids.data()), ids.size() * sizeof(object_id)}, old_size);
      assert(new_root.id);
      update_root(r, new_root);
      return old_size;
   }

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
         auto  n = get(c.first);

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
         auto  n = get(c.first);

         if (n.is_leaf_node())
            return;

         auto& in = n.as_inner_node();
         auto  b  = in.branch(c.second);
         auto  bi = get(b);

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

         auto n = get(c.first);

         if (not n.is_leaf_node())
         {
            auto& in = n.as_inner_node();
            c.second = in.lower_bound(c.second + 1);

            if (c.second <= 63)
            {
               // find first
               for (;;)
               {
                  auto n = get(itr.path().back().first);
                  if (n.is_leaf_node())
                     return;

                  auto& in = n.as_inner_node();

                  auto  b   = in.branch(itr.path().back().second);
                  auto  bi  = get(b);
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

      auto dat = _value();
      val.resize(dat.size());
      memcpy(val.data(), dat.data(), dat.size());
   }

   template <typename AccessMode>
   std::string_view session<AccessMode>::iterator::_value() const
   {
      if (path().size() == 0)
         return std::string_view();
      auto n = _session->get(path().back().first);
      if (n.is_leaf_node())
      {
         return n.as_value_node().data();
      }
      else
      {
         return _session->get(n.as_inner_node().value()).as_value_node().data();
      }
   }
   template <typename AccessMode>
   uint32_t session<AccessMode>::iterator::key_size() const
   {
      if (path().size() == 0)
         return 0;
      int s = path().size() - 1;

      for (auto& e : path())
      {
         auto n = _session->get(e.first);
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

      auto  key_len = std::min<uint32_t>(data_len, key_size());
      char* start   = data;

      for (auto& e : path())
      {
         auto n = _session->get(e.first);
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
      std::string result;
      result.resize(key_size());
      read_key(result.data(), result.size());
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
         auto n = get(root);
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
         auto n = get(root);
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
         auto n = get(root);
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
               auto n = get(root);

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
         auto n = get(root);
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
         auto n = get(root);
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

   template <typename AccessMode>
   std::optional<std::string> session<AccessMode>::get(const std::shared_ptr<root>& r,
                                                       string_view                  key) const
   {
      std::string result;
      if (get(r, key, result))
         return std::optional(std::move(result));
      return std::nullopt;
   }

   template <typename AccessMode>
   bool session<AccessMode>::get(const std::shared_ptr<root>& r,
                                 string_view                  key,
                                 std::string&                 result) const
   {
      if constexpr (std::is_same_v<AccessMode, write_access>)
         _db->ensure_free_space();

      auto       k6 = to_key6(key);
      swap_guard g(*this);

      auto v = get(get_id(r), k6);
      if (v)
      {
         result.resize(v->size());
         memcpy(result.data(), v->data(), v->size());
         return true;
      }
      else
      {
         result.resize(0);
         return false;
      }
   }

   template <typename AccessMode>
   std::optional<std::string_view> session<AccessMode>::get(id root, string_view key) const
   {
      if (not root)
         return std::nullopt;

      for (;;)
      {
         auto n = get(root);
         if (n.is_leaf_node())
         {
            auto& vn = n.as_value_node();
            if (vn.key() == key)
               return vn.data();
            return std::nullopt;
         }
         auto& in     = n.as_inner_node();
         auto  in_key = in.key();

         if (key.size() < in_key.size())
            return std::nullopt;

         if (key == in_key)
         {
            root = in.value();

            if (not root)
               return std::nullopt;

            key = string_view();
            continue;
         }

         auto cpre = common_prefix(key, in_key);
         if (cpre != in_key)
            return std::nullopt;

         auto b = key[cpre.size()];

         if (not in.has_branch(b))
            return std::nullopt;

         key  = key.substr(cpre.size() + 1);
         root = in.branch(b);
      }
      return std::nullopt;
   }

   inline int write_session::remove(std::shared_ptr<root>& r, string_view key)
   {
      _db->ensure_free_space();
      swap_guard g(*this);
      int        removed_size = -1;
      auto       new_root     = remove_child(get_id(r), get_unique(r), to_key6(key), removed_size);
      update_root(r, new_root);
      return removed_size;
   }

   inline database::id write_session::remove_child(id          root,
                                                   bool        unique,
                                                   string_view key,
                                                   int&        removed_size)
   {
      if (not root)
         return root;

      auto n = get(root, unique);
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

      auto& in     = n.as_inner_node();
      auto  in_key = in.key();

      if (in_key.size() > key.size())
         return root;

      if (in_key == key)
      {
         auto iv = in.value();
         if (not iv)
            return root;
         removed_size = get(iv).as_value_node().data_size();

         if (in.num_branches() == 1)
         {
            char        b  = std::countr_zero(in.branches());
            auto        bn = get(*in.children());
            std::string new_key;
            new_key += in_key;
            new_key += b;

            if (bn.is_leaf_node())
            {
               auto& vn = bn.as_value_node();
               new_key += vn.key();
               //           DEBUG( "clone value" );
               return make_value(bn.type(), new_key, vn.data());
            }
            else
            {
               auto& bin = bn.as_inner_node();
               new_key += bin.key();
               //          DEBUG( "clone inner " );
               return make_inner(bin, new_key, retain(bin.value()), bin.branches());
            }
         }

         if (unique)
         {
            auto  locked = lock(n);
            auto& in     = locked.as_inner_node();
            release(in.value());
            in.set_value(id());
            return root;
         }
         else
            return make_inner(in, key, id(), in.branches());
      }

      auto cpre = common_prefix(in_key, key);
      if (cpre != in_key)
         return root;

      auto b = key[in_key.size()];
      if (not in.has_branch(b))
         return root;

      auto& cur_b = in.branch(b);

      auto new_b = remove_child(cur_b, unique, key.substr(in_key.size() + 1), removed_size);
      if (new_b != cur_b)
      {
         if (new_b and unique)
         {
            auto  locked = lock(n);
            auto& cur_b  = locked.as_inner_node().branch(b);
            release(cur_b);
            cur_b = new_b;
            return root;
         }
         if (new_b)  // update branch
         {
            auto  new_root = make_inner(in, in.key(), retain(in.value()), in.branches());
            auto& new_br   = new_root->branch(b);
            release(new_br);
            new_br = new_b;
            return new_root;
         }
         else  // remove branch
         {
            auto new_branches = in.branches() & ~inner_node::branches(b);
            if (std::popcount(new_branches) + bool(in.value()) > 1)
            {  // multiple branches remain, nothing to merge up, just realloc without branch
               //   WARN( "clone without branch" );
               return make_inner(in, in.key(), retain(in.value()), new_branches);
            }
            if (not new_branches)
            {
               //    WARN( "merge inner.key() + value.key() and return new value node" );
               // since we can only remove one item at a time, and this node exists
               // then it means it either had 2 branches before or 1 branch and a value
               // in this case, not branches means it must have a value
               assert(in.value() and "expected value because we removed a branch");

               auto  cur_v = get(in.value());
               auto& cv    = cur_v.as_value_node();
               return make_value(cur_v.type(), in_key, cv.data());
            }
            else
            {  // there must be only 1 branch left
               //     WARN( "merge inner.key() + b + value.key() and return new value node" );

               auto  lb          = std::countr_zero(in.branches() ^ inner_node::branches(b));
               auto& last_branch = in.branch(lb);
               // the one branch is either a value or a inner node
               auto cur_v = get(last_branch);
               if (cur_v.is_leaf_node())
               {
                  auto&       cv = cur_v.as_value_node();
                  std::string new_key;
                  new_key += in.key();
                  new_key += char(lb);
                  new_key += cv.key();
                  return make_value(cur_v.type(), new_key, cv.data());
               }
               else
               {
                  auto&       cv = cur_v.as_inner_node();
                  std::string new_key;
                  new_key += in.key();
                  new_key += char(lb);
                  new_key += cv.key();
                  return make_inner(cv, new_key, retain(cv.value()), cv.branches());
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
      validate(get_id(r));
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

      auto dr = get(r);
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
                   << (in.value().id ? get(in.value()).as_value_node().data()
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
      recursive_retain(id);
   }

   inline void write_session::recursive_retain(id r)
   {
      if (not r)
         return;
      int cur_ref_count = _db->_ring->ref(r);

      // TODO: rework recursive_retain to fix up overflow; will require
      //       cloning nodes and tracking the clones. Or just detect
      //       and give up.
      _db->_ring->dangerous_retain(r);

      if (cur_ref_count > 1)  // 1 is the default ref when resetting all
         return;              // retaining this node indirectly retains all children

      auto dr = get(r);
      if (not dr.is_leaf_node())
      {
         auto& in = dr.as_inner_node();

         recursive_retain(in.value());

         auto* c = in.children();
         auto* e = c + in.num_branches();
         while (c != e)
         {
            recursive_retain(*c);
            ++e;
         }
      }

      // TODO: leaves which point to roots
   }

   inline void write_session::start_collect_garbage()
   {
      _db->_ring->reset_all_ref_counts(1);
   }
   inline void write_session::end_collect_garbage()
   {
      _db->_ring->adjust_all_ref_counts(-1);
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
   void session<AccessMode>::validate(id r)
   {
      if (not r)
         return;

      auto validate_id = [&](auto i)
      {
         _db->_ring->validate(r);
         if (0 == _db->_ring->ref(r))
            throw std::runtime_error("found reference to object with 0 ref count: " +
                                     std::to_string(r.id));
      };

      validate_id(r);

      auto dr = get(r);
      if (not dr.is_leaf_node())
      {
         auto& in = dr.as_inner_node();
         validate(in.value());

         auto* c = in.children();
         auto* e = c + in.num_branches();
         while (c != e)
         {
            validate(*c);
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
   inline key_view session_base::to_key6(key_view v) const
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
   inline void database::ensure_free_space()
   {
      _ring->ensure_free_space();
   }

   inline void database::claim_free() const
   {
      ring_allocator::swap_position sp;
      {
         std::lock_guard<std::mutex> lock(_active_sessions_mutex);
         for (auto s : _active_sessions)
         {
            sp._swap_pos[0] = std::min<uint64_t>(s->_hot_swap_p.load(), sp._swap_pos[0]);
            sp._swap_pos[1] = std::min<uint64_t>(s->_warm_swap_p.load(), sp._swap_pos[1]);
            sp._swap_pos[2] = std::min<uint64_t>(s->_cool_swap_p.load(), sp._swap_pos[2]);
            sp._swap_pos[3] = std::min<uint64_t>(s->_cold_swap_p.load(), sp._swap_pos[3]);
         }
      }
      _ring->claim_free(sp);
   }

}  // namespace triedent
