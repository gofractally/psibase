#pragma once
#include <algorithm>
#include <boost/interprocess/sync/interprocess_sharable_mutex.hpp>
#include <trie/node.hpp>
#include <trie/ring_alloc.hpp>

namespace trie
{

   inline std::string from_key(std::string_view sv)
   {
      std::string out;
      out.reserve(sv.size());
      for (int i = 0; i < sv.size(); ++i)
         out += sv[i] + 62;
      return out;
   }

   struct write_access;
   struct read_access;

   template <typename T = node>
   struct deref;

   inline key_type from_key6(const key_view sixb);

   class database
   {
     public:
      struct config
      {
         uint64_t max_objects    = 1000 * 1000ull;
         uint64_t hot_pages      = 32;
         uint64_t warm_pages     = 32;
         uint64_t cool_pages     = 32;
         uint64_t cold_pages     = 32;
      };

      enum access_mode
      {
         read_only  = 0,
         read_write = 1
      };

      using string_view = std::string_view;
      using id          = object_id;
      database(std::filesystem::path dir, config, access_mode allow_write);
      ~database();

      void swap();
      void claim_free() const;
      inline void ensure_free_space();

      class session_base
      {
        public:
         id _session_root;
         /* auto inc id used to detect when we can modify in place*/
         uint64_t                      _version     = 0;
         mutable std::atomic<uint64_t> _hot_swap_p  = -1ull;
         mutable std::atomic<uint64_t> _warm_swap_p = -1ull;
         mutable std::atomic<uint64_t> _cool_swap_p = -1ull;
         mutable std::atomic<uint64_t> _cold_swap_p = -1ull;


         key_view to_key6(key_view v)const;
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
         using iterator_data = std::vector<std::pair<id,char>>;
         mutable std::vector<iterator_data> _iterators;
         mutable uint64_t                   _used_iterators = 0;
         inline uint64_t&                   used_iterators()const { return _used_iterators; }
         inline auto&                     iterators()const { return _iterators; }

        public:
         struct iterator
         {
            uint32_t    key_size() const;
            uint32_t    read_key(char* data, uint32_t data_len) const;
            string_view value() const;
            std::string key() const;
            iterator&   operator++();
            iterator&   operator--();
            bool        valid() const { return path().size() > 0; }

            explicit operator bool() const { return valid(); }

            ~iterator() { 
               path().clear();
               _session->used_iterators() ^= 1ull << _iter_num;
            }
           private:
            friend class session;
            iterator(const session& s) : _session(&s){
               _iter_num = std::countr_one( _session->_used_iterators );
               _session->used_iterators() ^= 1ull << _iter_num;
            };


            iterator_data& path()const { return _session->iterators()[_iter_num]; };

            uint32_t                       _iter_num;
            const session*                   _session;
         };

         /* makes this session read from the root revision */
         void get_root_revision();

         /* changes the root of the tree this session is reading */
         void set_session_revision(id r)
         {
            if (r != _session_root)
            {
               retain(r);
               release(_session_root);
               _session_root = r;
            }
         }

         /* returns the root of the tree this session is reading */
         id get_session_revision() { return _session_root; }

         inline id retain(id);

         /* decrements the revision ref count and frees if necessary */
         void release_revision(id i) { _db->release(i); }

         /* the root revision of this session */
         id revision() { return _session_root; }

         iterator                   first() const;
         iterator                   last() const;
         iterator                   find(string_view key) const;
         iterator                   lower_bound(string_view key) const;
         iterator                   last_with_prefix(string_view prefix) const;
         std::optional<string_view> get(string_view key) const;

         void print();
         void validate();
         ~session();

         session(database& db);

        protected:
         session(const session&) = delete;

         void                       validate(id);
         void                       next(iterator& itr) const;
         void                       prev(iterator& itr) const;
         iterator                   find(id n, string_view key) const;
         void                       print(id n, string_view prefix = "", std::string k = "");
         inline deref<node>         get(ring_allocator::id i) const;
         std::optional<string_view> get(id root, string_view key) const;

         inline void release(id);

         friend class database;
         database* _db;

         void lock_swap_p() const;
         void unlock_swap_p() const;

         struct swap_guard
         {
            swap_guard(const session& s) : _s(s) { _s.lock_swap_p(); }
            swap_guard(const session* s) : _s(*s) { _s.lock_swap_p(); }
            ~swap_guard() { _s.unlock_swap_p(); }
            const session& _s;
         };
      };
      using read_session = session<read_access>;

      class write_session : public read_session
      {
        public:
         bool upsert(string_view key, string_view val);
         bool remove(string_view key);
         id   fork(id from_version = id());
         id   fork();

         void set_root_revision(id);
         void clear();

         friend class database;
         write_session(database& db) : read_session(db) {}

        private:
         inline deref<value_node> make_value(string_view k, string_view v);
         inline deref<inner_node> make_inner(string_view pre, id val, uint64_t branches);
         inline deref<inner_node> make_inner(const inner_node& cpy,
                                             string_view       pre,
                                             id                val,
                                             uint64_t          branches);

         inline id add_child(id root, string_view key, string_view val, bool& inserted);
         inline id remove_child(id root, string_view key, bool& removed);

         inline id set_value(deref<node> n, string_view key, string_view val);
         inline id set_inner_value(deref<inner_node> n, string_view val);
         inline id combine_value_nodes(string_view k1,
                                       string_view v1,
                                       string_view k2,
                                       string_view v2);
      };

      std::shared_ptr<write_session> start_write_session();
      std::shared_ptr<read_session>  start_read_session();

      void print_stats();

      id get_root_revision() const;

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
         std::atomic<uint64_t> _root_revision;
         database_memory() {}
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
   };

   template <typename T>
   struct deref
   {
      using id   = object_id;
      using type = object_db::object_location::object_type;

      deref() = default;
      //deref(std::pair<id, char*> p) : _id(p.first), ptr(p.second) {}
      deref(std::pair<id, value_node*> p) : _id(p.first), ptr((char*)p.second), _type(type::leaf) {}
      deref(std::pair<id, inner_node*> p) : _id(p.first), ptr((char*)p.second), _type(type::inner)
      {
      }

      template <typename Other>
      deref(deref<Other> p) : _id(p._id), ptr((char*)p.ptr), _type(p._type)
      {
      }

      deref(id i, char* p, type t) : _id(i), ptr(p), _type(t) {}
      explicit inline operator bool() const { return bool(_id); }
      inline          operator id() const { return _id; }

      bool         is_leaf_node() const { return _type == object_db::object_location::leaf; }
      inline auto& as_value_node() { return *reinterpret_cast<value_node*>(ptr); }
      inline auto& as_inner_node() { return *reinterpret_cast<inner_node*>(ptr); }

      inline T*       operator->() { return reinterpret_cast<T*>(ptr); }
      inline const T* operator->() const { return reinterpret_cast<const T*>(ptr); }
      inline T&       operator*() { return *reinterpret_cast<T*>(ptr); }
      inline const T& operator*() const { return *reinterpret_cast<const T*>(ptr); }

      int64_t as_id() const { return _id.id; }

     private:
      template <typename Other>
      friend class deref;

      id    _id;
      char* ptr;
      type  _type;
   };

   inline void database::write_session::set_root_revision(id i)
   {
      std::lock_guard<std::mutex> lock(_db->_root_change_mutex);
      if (_db->_dbm->_root_revision != i.id)
      {
         retain(i);
         release({_db->_dbm->_root_revision.load(std::memory_order_relaxed)});
         _db->_dbm->_root_revision.store(i.id, std::memory_order_relaxed);
      }
   }

   inline database::id database::write_session::fork(id from_version)
   {
      swap_guard g(this);

      id new_root = from_version;
      _version    = 0;

      if (from_version)
      {
         auto n = get(from_version);
         if (n.is_leaf_node())
         {
            auto& vn = n.as_value_node();
            new_root = make_value(vn.key(), vn.data());
         }
         else
         {
            auto& in = n.as_inner_node();
            _version = in.version() + 1;
            new_root = make_inner(in, in.key(), in.value(), in.branches());
         }
      }

      release(_session_root);
      _session_root = new_root;
      return _session_root;
   }

   inline database::id database::write_session::fork() { return fork(_session_root); }

   inline database::id database::get_root_revision() const
   {
      std::lock_guard<std::mutex> lock(_root_change_mutex);
      _ring->retain({_dbm->_root_revision});
      return {_dbm->_root_revision};
   }

   template <typename AccessMode>
   inline void database::session<AccessMode>::lock_swap_p() const
   {
      auto sp = _db->_ring->get_swap_pos();
      _hot_swap_p.store(sp._swap_pos[0], std::memory_order_relaxed);
      _warm_swap_p.store(sp._swap_pos[1], std::memory_order_relaxed);
      _cool_swap_p.store(sp._swap_pos[2], std::memory_order_relaxed);
      _cold_swap_p.store(sp._swap_pos[3], std::memory_order_relaxed);
   }

   template <typename AccessMode>
   inline void database::session<AccessMode>::unlock_swap_p() const
   {
      _hot_swap_p.store(-1ull, std::memory_order_release);
      _warm_swap_p.store(-1ull, std::memory_order_release);
      _cool_swap_p.store(-1ull, std::memory_order_release);
      _cold_swap_p.store(-1ull, std::memory_order_release);
   }


   template <typename AccessMode>
   database::session<AccessMode>::session(database& db) : _db(&db)
   {
      _iterators.resize(64);
      std::lock_guard<std::mutex> lock(db._active_sessions_mutex);
      db._active_sessions.push_back(this);
   }
   template <typename AccessMode>
   database::session<AccessMode>::~session()
   {
      std::lock_guard<std::mutex> lock(_db->_active_sessions_mutex);

      auto itr = std::find(_db->_active_sessions.begin(), _db->_active_sessions.end(), this);

      _db->_active_sessions.erase(itr);
   }

   inline std::shared_ptr<database::read_session> database::start_read_session()
   {
      return std::make_shared<read_session>(std::ref(*this));
   }

   inline std::shared_ptr<database::write_session> database::start_write_session()
   {
      return std::make_shared<write_session>(std::ref(*this));
   }

   template <typename AccessMode>
   inline deref<node> database::session<AccessMode>::get(id i) const
   {
      auto r = _db->_ring->get_cache_with_type<std::is_same_v<AccessMode, write_access>>(i);
      return {i, r.first, r.second};
   }

   template <typename AccessMode>
   inline void database::session<AccessMode>::release(id obj)
   {
      _db->release(obj);
   }

   /* return true if the object was freed */
   inline void database::release(id obj)
   {
      if (not obj)
         return;

      auto ptr = _ring->release(obj);
      if (ptr.first and ptr.second == object_db::object_location::inner)
      //  if (ptr.first and not reinterpret_cast<node*>(ptr.first)->is_value_node())
      {
         //     if( ptr.second != object_db::object_location::inner ) {
         //        throw std::runtime_error( "unexpected leaf type" );
         //     }
         auto& in = *reinterpret_cast<inner_node*>(ptr.first);
         release(in.value());
         auto nb  = in.num_branches();
         auto pos = in.children();
         auto end = pos + nb;
         while (pos != end)
         {
            assert(*pos);
            release(*pos);
            ++pos;
         }
      }
      //  else if( ptr.first ) {
      //     if( ptr.second != object_db::object_location::leaf) {
      //        throw std::runtime_error( "unexpected inner type" );
      //     }
      //  }
   }

   template <typename AccessMode>
   inline database::id database::session<AccessMode>::retain(id obj)
   {
      if (not obj)
         return obj;

      _db->_ring->retain(obj);

      return obj;
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

   inline deref<value_node> database::write_session::make_value(string_view key, string_view val)
   {
      return deref<value_node>(value_node::make(*_db->_ring, key, val));
   }
   inline deref<inner_node> database::write_session::make_inner(string_view pre,
                                                                id          val,
                                                                uint64_t    branches)
   {
      return inner_node::make(*_db->_ring, pre, val, branches, _version);
   }

   inline deref<inner_node> database::write_session::make_inner(const inner_node& cpy,
                                                                string_view       pre,
                                                                id                val,
                                                                uint64_t          branches)
   {
      return inner_node::make(*_db->_ring, cpy, pre, val, branches, _version);
   }

   /**
    *  Given an existing value node and a new key/value to insert 
    */
   database::id database::write_session::combine_value_nodes(string_view k1,
                                                             string_view v1,
                                                             string_view k2,
                                                             string_view v2)
   {
      if (k1.size() > k2.size())
         return combine_value_nodes(k2, v2, k1, v1);

      //std::cerr << __func__ << ":" << __LINE__ << "\n";
      auto cpre = common_prefix(k1, k2);

      if (cpre == k1)
      {
         //  std::cerr << __func__ << ":" << __LINE__ << "\n";
         auto inner_value = make_value(string_view(), v1);
         auto k2sfx       = k2.substr(cpre.size());
         auto b2          = k2sfx.front();

         auto in = make_inner(cpre, id(), 1ull << b2);
         in->set_value(inner_value);

         in->branch(b2) = make_value(k2sfx.substr(1), v2);

         return in;
      }
      else
      {
         // std::cerr << __func__ << ":" << __LINE__ << "\n";
         auto b1sfx = k1.substr(cpre.size());
         auto b2sfx = k2.substr(cpre.size());
         auto b1    = b1sfx.front();
         auto b2    = b2sfx.front();
         auto b1v   = make_value(b1sfx.substr(1), v1);
         auto b2v   = make_value(b2sfx.substr(1), v2);

         //auto in        = make_inner(cpre, (1ull << b2) | (1ul << b1), _version);
         auto in        = make_inner(cpre, id(), inner_node::branches(b1, b2));
         in->branch(b1) = b1v;
         in->branch(b2) = b2v;

         return in;
      }
   }

   database::id database::write_session::set_value(deref<node> n, string_view key, string_view val)
   {
      if (not n)
         return make_value(key, val);

      assert(n.is_leaf_node());

      auto& vn = n.as_value_node();
      if (_db->_ring->ref(n) == 1 and vn.data_size() == val.size())
      {
         memcpy(vn.data_ptr(), val.data(), val.size());
         return n;
      }

      return make_value(key, val);
   }

   database::id database::write_session::set_inner_value(deref<inner_node> n, string_view val)
   {
      if (n->version() == _version)
      {
         if (n->value())
         {
            auto  v  = get(n->value());
            auto& vn = v.as_value_node();
            if (vn.data_size() == val.size())
            {
               memcpy(vn.data_ptr(), val.data(), val.size());
            }
            else
            {
               _db->_ring->release(n->value());
               n->set_value(make_value(string_view(), val));
            }
         }
         else
         {
            n->set_value(make_value(string_view(), val));
         }
         return n;
      }
      else
      {
         auto new_val = make_value(string_view(), val);
         return make_inner(*n, n->key(), new_val, n->branches());
      }
   }

   /**
    *  Given an existing tree node (root) add a new key/value under it and return the id
    *  of the new node if a new node had to be allocated. 
    */
   inline database::id database::write_session::add_child(id          root,
                                                          string_view key,
                                                          string_view val,
                                                          bool&       inserted)
   {
      if (not root)  // empty case
         return make_value(key, val);

      auto n = get(root);
      if (n.is_leaf_node())  // current root is value
      {
         auto& vn = n.as_value_node();
         if ((inserted = (vn.key() != key)))
         {  // with differnet keys

            return combine_value_nodes(vn.key(), vn.data(), key, val);
         }
         else
         {
            inserted = false;               // it updated in stead
            return set_value(n, key, val);  // with the same key
         }
      }

      // current root is an inner node
      auto& in     = n.as_inner_node();
      auto  in_key = in.key();
      if (in_key == key)  // whose prefix is same as key, therefore set the value
      {
         inserted = !in.value();
         return set_inner_value(n, val);
      }

      auto cpre = common_prefix(in_key, key);
      if (cpre == in_key)  // value is on child branch
      {
         auto b = key[cpre.size()];

         if (in.version() != _version or not in.has_branch(b))  // copy on write
         {
            auto  new_in = make_inner(in, in_key, retain(in.value()), in.branches() | 1ull << b);
            auto& cur_b  = new_in->branch(b);

            auto new_b = add_child(cur_b, key.substr(cpre.size() + 1), val, inserted);

            if (new_b != cur_b)
            {
               release(cur_b);
               cur_b = new_b;
            }

            return new_in;
         }  // else modify in place

         auto& cur_b = in.branch(b);
         auto  new_b = add_child(cur_b, key.substr(cpre.size() + 1), val, inserted);

         if (new_b != cur_b)
         {
            release(cur_b);
            cur_b = new_b;
         }
         return root;
      }
      else  // the current node needs to split and become a child of new parent
      {
         if (cpre == key)  // value is one new inner node
         {
            //std::cerr << __func__ << ":" << __LINE__ << "\n";
            auto b1    = in_key[cpre.size()];
            auto b1key = in_key.substr(cpre.size() + 1);
            auto b1val = make_inner(in, b1key, retain(in.value()), in.branches());
            auto b0val = make_value(string_view(), val);

            auto nin        = make_inner(cpre, b0val, inner_node::branches(b1));
            nin->branch(b1) = b1val;

            nin->set_value(b0val);
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
            nin->branch(b1) = make_value(b1key, val);
            auto sub        = make_inner(in, b2key, retain(in.value()), in.branches());
            assert(not nin->branch(b2));
            nin->branch(b2) = sub;

            return nin;
         }
      }
   }

   inline void database::write_session::clear()
   {
      swap_guard g(*this);
      release(_session_root);
      _session_root = id();
   }
   // return true on insert, false on update
   inline bool database::write_session::upsert(string_view key, string_view val)
   {
      _db->ensure_free_space();
      swap_guard g(*this);

      auto& ar = *_db->_ring;

      bool inserted = true;
      auto new_root = add_child(_session_root, to_key6(key), val, inserted);
      assert(new_root.id);
      //  std::cout << "new_root: " << new_root.id << "  old : " << rev._root.id << "\n";
      if (new_root != _session_root)
      {
         release(_session_root);
         _session_root = new_root;
      }
      return inserted;
   }

   template <typename AccessMode>
   typename database::session<AccessMode>::iterator&
   database::session<AccessMode>::iterator::operator++()
   {
      if constexpr( std::is_same_v<AccessMode,write_access> )
         _session->_db->ensure_free_space();
      swap_guard g(*_session);

      _session->next(*this);
      return *this;
   }
   template <typename AccessMode>
   typename database::session<AccessMode>::iterator&
   database::session<AccessMode>::iterator::operator--()
   {
      if constexpr( std::is_same_v<AccessMode,write_access> )
         _session->_db->ensure_free_space();
      swap_guard g(*_session);

      _session->prev(*this);
      return *this;
   }
   template <typename AccessMode>
   void database::session<AccessMode>::prev(iterator& itr) const
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
   void database::session<AccessMode>::next(iterator& itr) const
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
   std::string_view database::session<AccessMode>::iterator::value() const
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
   uint32_t database::session<AccessMode>::iterator::key_size() const
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
   uint32_t database::session<AccessMode>::iterator::read_key(char* data, uint32_t data_len) const
   {
      auto  key_len = std::min<uint32_t>(data_len, key_size());
      char* start   = data;

      for (auto& e : path())
      {
         auto n = _session->get(e.first);
         auto b = n->key_size();
         if (b > 0)
         {
            auto  part_len = std::min<uint32_t>(key_len, b);
            char* key_ptr;

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
   std::string database::session<AccessMode>::iterator::key() const
   {
      std::string result;
      result.resize(key_size());
      read_key(result.data(), result.size());
      return from_key6(result);
   }

   template <typename AccessMode>
   typename database::session<AccessMode>::iterator database::session<AccessMode>::first() const
   {


      id       root = _session_root;
      iterator result(*this);
      if (not root)
         return result;

      if constexpr( std::is_same_v<AccessMode,write_access> )
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
   typename database::session<AccessMode>::iterator database::session<AccessMode>::last() const
   {
      id       root = _session_root;
      iterator result(*this);
      if (not root)
         return result;

      if constexpr( std::is_same_v<AccessMode,write_access> )
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
   typename database::session<AccessMode>::iterator database::session<AccessMode>::find(
       string_view key) const
   {
      return find(_session_root, to_key6(key));
   }
   template <typename AccessMode>
   typename database::session<AccessMode>::iterator database::session<AccessMode>::last_with_prefix(
       string_view prefix) const
   {
      id       root = _session_root;
      iterator result(*this);

      if (not root)
         return result;

      prefix = to_key6(prefix);

      if constexpr( std::is_same_v<AccessMode,write_access> )
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
   typename database::session<AccessMode>::iterator database::session<AccessMode>::lower_bound(
       string_view key) const
   {
      id       root = _session_root;
      iterator result(*this);
      if (not root)
         return result;

      key = to_key6(key);

      if constexpr( std::is_same_v<AccessMode,write_access> )
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
   inline typename database::session<AccessMode>::iterator database::session<AccessMode>::find(
       id          root,
       string_view key) const
   {
      if (not root)
         return iterator(*this);

      iterator   result(*this);

      if constexpr( std::is_same_v<AccessMode,write_access> )
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
   std::optional<std::string_view> database::session<AccessMode>::get(string_view key) const
   {
      return get(_session_root, to_key6(key) );
   }
   template <typename AccessMode>
   std::optional<std::string_view> database::session<AccessMode>::get(id          root,
                                                                      string_view key) const
   {
      if (not root)
         return std::nullopt;

      if constexpr( std::is_same_v<AccessMode,write_access> )
         _db->ensure_free_space();

      swap_guard g(*this);
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

            if( not root ) 
               return std::nullopt;

            key  = string_view();
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

   inline bool database::write_session::remove(string_view key)
   {
      _db->ensure_free_space();
      swap_guard g(*this);
      bool       removed  = false;
      auto       new_root = remove_child(_session_root, to_key6(key), removed);
      if (new_root != _session_root)
      {
         release(_session_root);
         _session_root = new_root;
      }
      return removed;
   }
   inline database::id database::write_session::remove_child(id          root,
                                                             string_view key,
                                                             bool&       removed)
   {
      if (not root)
      {
         removed = false;
         return root;
      }

      auto n = get(root);
      if (n.is_leaf_node())  // current root is value
      {
         auto& vn = n.as_value_node();
         removed  = vn.key() == key;
         return id();
      }

      auto& in     = n.as_inner_node();
      auto  in_key = in.key();

      if (in_key.size() > key.size())
      {
         removed = false;
         return root;
      }

      if (in_key == key)
      {
         //      WARN( "key == in_key" );
         removed = bool(in.value());
         if (not removed)
            return root;

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
               return make_value(new_key, vn.data());
            }
            else
            {
               auto& bin = bn.as_inner_node();
               new_key += bin.key();
               //          DEBUG( "clone inner " );
               return make_inner(bin, new_key, retain(bin.value()), bin.branches());
            }
         }

         if (in.version() == _version)
         {
            release(in.value());
            in.set_value(id());
            return root;
         }
         else
            return make_inner(in, key, id(), in.branches());
      }

      auto b = key[in_key.size()];

      //    DEBUG( "prefix: '", from_key(in.key()), "' branch: ", char(b+62) );
      if (not in.has_branch(b))
      {
         //        WARN( "not has branch ", char(b+62) );
         removed = false;
         return root;
      }

      auto& cur_b = in.branch(b);

      auto new_b = remove_child(cur_b, key.substr(in_key.size() + 1), removed);
      if (new_b != cur_b)
      {
         if (new_b and in.version() == _version)
         {
            // WARN( "replacing existing branch" );
            release(cur_b);
            cur_b = new_b;
            return root;
         }
         if (new_b)  // update branch
         {
            // WARN( "copy in place, then replace existing branch" );
            auto  new_root = make_inner(in, in.key(), retain(in.value()), in.branches());
            auto& new_br   = new_root->branch(b);
            release(new_br);
            new_br = new_b;
            return new_br;
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

               std::string new_key;
               new_key += in.key();
               new_key += cv.key();
               return make_value(new_key, cv.data());
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
                  return make_value(new_key, cv.data());
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
   void database::session<AccessMode>::print()
   {
      print(_session_root, string_view(), "");
   }

   template <typename AccessMode>
   void database::session<AccessMode>::validate()
   {
      validate(_session_root);
   }

   template <typename AccessMode>
   void database::session<AccessMode>::print(id r, string_view prefix, std::string key)
   {
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
   }

   template <typename AccessMode>
   void database::session<AccessMode>::validate(id r)
   {
      if (not r)
         return;

      auto validate_id = [&](auto i)
      {
         assert(i.id < 1000000);
         assert(0 != _db->_ring->get_ref(r).first);
      };
      validate_id(r);

      auto dr = get(r);
      if (dr.is_leaf_node())
      {
         /*
         auto dat = dr.as_value_node().data();
         std::cerr << "'" << from_key(dr.as_value_node().key()) << "' => ";
         std::cerr << (dat.size() > 20 ? string_view("BIG DAT") : dat) << ": " << r.id << "  vr"
                   << _db->_ring->ref(r) << "\n";
                   */
      }
      else
      {
         auto& in = dr.as_inner_node();

         validate_id(in.value());

         for (char i = 0; i < 64; ++i)
         {
            if (in.has_branch(i))
            {
               validate(in.branch(i));
            }
         }
      }
   }

inline key_type from_key6(const key_view sixb)
{
   //  for( auto c : sixb ) {print6(c); std::cout <<" ";}
   //  std::cout <<"\n";
   std::string out;
   out.resize((sixb.size() * 6) / 8);

   const char* pos6     = sixb.data();
   const char* pos6_end = sixb.data() + sixb.size();
   char*       pos8     = out.data();

   while (pos6 + 4 <= pos6_end)
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
         pos8[2] = (pos6[2] << 6);                   // 2b + 6-0
         break;
      case 2:
         pos8[0] = (pos6[0] << 2) | (pos6[1] >> 4);  // 6 + 2t
         pos8[1] = (pos6[1] << 4);                   // 4b + 4-0
         break;
      case 1:
         pos8[0] = (pos6[0] << 2);  // 6 + 2-0
         break;
   }
   //   for( auto c : out ) { print8(c); std::cout <<" "; }
   //   std::cout << "from_key("<<out<<")\n";
   return out;
}
   inline key_view database::session_base::to_key6(key_view v)const
   {
      auto bits  = v.size() * 8;
      auto byte6 = (bits + 5) / 6;

      key_buf.resize(byte6);

      uint8_t*       pos6     = (uint8_t*)key_buf.data();
      const uint8_t* pos8     = (uint8_t*)v.data();
      const uint8_t* pos8_end = (uint8_t*)v.data() + v.size();

      while (pos8 + 3 <= pos8_end)
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
      return {key_buf.data(),key_buf.size()};
   }
   inline void database::ensure_free_space() {
      _ring->ensure_free_space(); 
   }

}  // namespace trie
