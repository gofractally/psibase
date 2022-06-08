#pragma once
#include <algorithm>
#include <boost/interprocess/sync/interprocess_sharable_mutex.hpp>
#include <trie/node.hpp>
#include <trie/ring_alloc.hpp>

namespace trie
{
   struct write_access;
   struct read_access;

   class database
   {
     public:
      struct config
      {
         uint64_t max_objects    = 1000 * 1000ull;
         uint64_t hot_pages      = 1000 * 1000ull;
         uint64_t cold_pages     = 4000 * 1000ull;
         uint64_t big_hot_pages  = 1 * 1000ull;
         uint64_t big_cold_pages = 4 * 1000ull;
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

      inline void release(id);

      void swap();
      void claim_free()const;

      template <typename T = node>
      struct deref
      {
         deref() = default;
         deref(std::pair<id, char*> p) : _id(p.first), ptr(p.second) {}
         deref(std::pair<id, value_node*> p) : _id(p.first), ptr((char*)p.second) {}
         deref(std::pair<id, inner_node*> p) : _id(p.first), ptr((char*)p.second) {}

         template <typename Other>
         deref(deref<Other> p) : _id(p._id), ptr((char*)p.ptr)
         {
         }

         deref(id i, char* p) : _id(i), ptr(p) {}
         explicit inline operator bool() const { return bool(_id); }
         inline          operator id() const { return _id; }

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
      };

      class session_base {
         public:
         mutable std::atomic<uint64_t> _hot_swap_p = -1ull;
         mutable std::atomic<uint64_t> _warm_swap_p = -1ull;
         mutable std::atomic<uint64_t> _cool_swap_p = -1ull;
         mutable std::atomic<uint64_t> _cold_swap_p = -1ull;
      };

      template <typename AccessMode = write_access>
      class session : public session_base
      {
        public:
         struct iterator
         {
            uint32_t    key_size() const;
            uint32_t    read_key(char* data, uint32_t data_len) const;
            string_view value() const;
            std::string key() const;
            iterator&   operator++();
            iterator&   operator--();
            bool        valid() const { return path.size() > 0; }

            explicit operator bool()const { return valid(); }

           private:
            friend class session;
            iterator(const session& s) : _session(&s){};
            std::vector<std::pair<id, char>> path;
            const session*                   _session;
         };

         iterator                   first() const;
         iterator                   last() const;
         iterator                   find(string_view key) const;
         iterator                   lower_bound(string_view key) const;
         iterator                   last_with_prefix(string_view prefix) const;
         bool                       upsert(string_view key, string_view val);
         bool                       remove(string_view key);
         std::optional<string_view> get(string_view key) const;

         void print();
         void validate();
         ~session();

         void clear();

         session(database& db, uint32_t version);
        private:
         session( const session& ) = delete;

         void                       validate(id);
         void                       next(iterator& itr) const;
         void                       prev(iterator& itr) const;
         iterator                   find(id n, string_view key) const;
         void                       print(id n, string_view prefix = "", std::string k = "");
         inline deref<node>         get(ring_allocator::id i) const;
         std::optional<string_view> get(id root, string_view key) const;
         inline id                  set_value(deref<node> n, string_view key, string_view val);
         inline id                  set_inner_value(deref<inner_node> n, string_view val);
         inline id                  combine_value_nodes(string_view k1,
                                                        string_view v1,
                                                        string_view k2,
                                                        string_view v2);

         inline id add_child(id root, string_view key, string_view val, bool& inserted);
         inline id remove_child(id root, string_view key, bool& removed);
         inline deref<value_node> make_value(string_view k, string_view v);
         inline deref<inner_node> make_inner(string_view pre, id val, uint64_t branches);
         inline deref<inner_node> make_inner(const inner_node& cpy,
                                             string_view       pre,
                                             id                val,
                                             uint64_t          branches);
         inline void              release(id);
         inline id                retain(id);

         friend class database;
         database* _db;
         uint32_t  _version;

         inline void reset_read_buffer()const
         {
            if constexpr (std::is_same_v<AccessMode, read_access>)
            {
               read_buffer.resize(0);
            }
         }

         void lock_swap_p()const;
         void unlock_swap_p()const;

         struct swap_guard {
            swap_guard( const session& s ):_s(s){ _s.lock_swap_p(); }
            ~swap_guard() { _s.unlock_swap_p(); }
            const session& _s;
         };



         // tempoary location to store objects read when AccessMode == read_access
         mutable std::vector<char>     read_buffer;
      };

      std::unique_ptr<session<write_access>> start_write_revision(uint32_t new_rev, uint32_t prev_rev);
      std::unique_ptr<session<read_access>>  start_read_revision(uint32_t new_rev);

      void print_stats();

     private:
      struct revision
      {
         object_id _root;

         // incremented when read session created, decremented when read session completes
         std::atomic<uint32_t> _active_read_sessions;
      };

      struct database_memory
      {
         uint64_t              _count = 0;
         revision              _revisions[0xffff];
         std::atomic<uint64_t> _revision_alloc_p;     // abs position of next session state
         std::atomic<uint64_t> _revision_end_free_p;  // 0xffff after the last completed session
         std::atomic<uint64_t> _revision_oldest_session_p;  // _end_free - 0xffff

         /**
          *  When each read session completes, it decrements the revision::_active_read_sessions
          *  and if the version < oldest_start_read_version and the count goes to 0 then it
          *  scans all revision::_active_read_sessions between _oldest_active_read_version and 
          *  _oldest_start_read_version to find the newest active read version with a refcount of 0 and
          *  then updates the newest completed read version.
          *  
          *  The version-gc thread will the release any versions between _oldest_active_read_version and
          *  _newest_completed_read_version and update _oldest_active_read_version to be equal to
          *  the _oldest_active_read_version after freing _oldest_active_read_version.
          *
          * The oldest version which has not yet been released.
          */
         std::atomic<uint32_t> _oldest_active_read_version;

         /** The newest revesion less than _oldest_start_read_version which has
          * 0 _active_read_sessions, 
          */
         std::atomic<uint32_t> _newest_completed_read_version;

         /**
          * New read sessions are not allowed to start prior to
          * this version, always greater than _newest_completed_read_version 
          */
         std::atomic<uint32_t> _oldest_start_read_version;

         database_memory() { memset(_revisions, 0, sizeof(_revisions)); }
      };

      static std::atomic<int>      _read_thread_number;
      static thread_local uint32_t _thread_num;
      static std::atomic<uint32_t> _write_thread_rev;

      struct alignas(64) read_thread_swap_pos
      {
         std::atomic<uint64_t> swap_pos[4];
         std::atomic<uint64_t> read_version;
      };

      std::unique_ptr<ring_allocator>     _ring;
      std::filesystem::path               _db_dir;
      std::unique_ptr<bip::file_mapping>  _file;
      std::unique_ptr<bip::mapped_region> _region;
      database_memory*                    _dbm;

      mutable std::mutex                          _active_read_sessions_mutex;
      std::vector<session_base*>  _active_read_sessions;
      //std::unique_ptr<struct database_impl> my;
   };
   template <typename AccessMode>
   inline void database::session<AccessMode>::lock_swap_p()const {
      auto sp = _db->_ring->get_swap_pos();
      _hot_swap_p.store( sp._swap_pos[0] , std::memory_order_relaxed );
      _warm_swap_p.store( sp._swap_pos[1] , std::memory_order_relaxed );
      _cool_swap_p.store( sp._swap_pos[2] , std::memory_order_relaxed );
      _cold_swap_p.store( sp._swap_pos[3] , std::memory_order_relaxed );
   }
   template <typename AccessMode>
   inline void database::session<AccessMode>::unlock_swap_p()const {
      _hot_swap_p.store( -1ull , std::memory_order_relaxed );
      _warm_swap_p.store( -1ull , std::memory_order_relaxed );
      _cool_swap_p.store( -1ull , std::memory_order_relaxed );
      _cold_swap_p.store( -1ull , std::memory_order_relaxed );
   }

   template <typename AccessMode>
   database::session<AccessMode>::session(database& db, uint32_t version)
       : _db(&db), _version(version)
   {
     // if constexpr (std::is_same_v<AccessMode, read_access>)
      {
         std::lock_guard<std::mutex> lock( db._active_read_sessions_mutex );
         db._active_read_sessions.push_back(this);
      }
   }
   template <typename AccessMode>
   database::session<AccessMode>::~session()
   {
     // if constexpr (std::is_same_v<AccessMode, read_access>)
      {
         std::lock_guard<std::mutex> lock( _db->_active_read_sessions_mutex );
         auto itr = std::find( _db->_active_read_sessions.begin(), _db->_active_read_sessions.end(), this );
         _db->_active_read_sessions.erase(itr);
      }
      //db._read_pos[database::_thread_num].read_version.store(-1, std::memory_order_relaxed);
   }

   inline std::unique_ptr<database::session<read_access>> database::start_read_revision(uint32_t new_rev)
   {
      return std::make_unique<session<read_access>>( std::ref(*this), new_rev);
   }

   inline std::unique_ptr<database::session<write_access>> database::start_write_revision(uint32_t new_rev,
                                                                         uint32_t prev_rev)
   {
      //   _dbm->_revisions[uint16_t(new_rev)]._mutex.lock();
      if (prev_rev != new_rev)
      {
         if (_dbm->_revisions[uint16_t(new_rev)]._root.id)
         {
            //  if (new_rev > 440)
            //     WARN("RELEASING PRIOR REV IN NEW SLOT REVISION ", prev_rev);
            release(_dbm->_revisions[uint16_t(new_rev)]._root);
         }

         if (_dbm->_revisions[uint16_t(prev_rev)]._root.id)
         {
            //  if (new_rev > 440)
            //     DEBUG("RETAINING REVISION WE COPY TO NEW SLOT ", prev_rev, " ", uint16_t(prev_rev));
            _ring->retain(_dbm->_revisions[uint16_t(prev_rev)]._root);
         }

         _dbm->_revisions[uint16_t(new_rev)]._root = _dbm->_revisions[uint16_t(prev_rev)]._root;
      }
      return std::make_unique<session<write_access>>(std::ref(*this), new_rev);
   }

   template <typename AccessMode>
   inline database::deref<node> database::session<AccessMode>::get(id i) const
   {
      if constexpr (std::is_same_v<AccessMode, write_access>)
      {
         assert(!!i);
         return {i, _db->_ring->get_cache<true>(i)};
      }
      else
      {
         return {i, _db->_ring->get_cache<false>(i)};//, read_buffer)};
      }
   }

   template <typename AccessMode>
   inline void database::session<AccessMode>::release(id obj)
   {
      _db->release(obj);
   }

   inline void database::release(id obj)
   {
      if (not obj)
         return;

      auto gr = _ring->get_ref_no_cache(obj);

      //      std::cout << "release: " << obj.id << "  pref: " << gr.first << "\n";
      if (gr.first == 1)
      {
         if (not reinterpret_cast<node*>(gr.second)->is_value_node())
         {
            // DEBUG( "releasing children of: ", obj.id );
            auto& in = *reinterpret_cast<inner_node*>(gr.second);
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
            // DEBUG( "done releasing children of: ", obj.id );
         }
      }
      _ring->release(obj);
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

   template <typename AccessMode>
   inline database::deref<value_node> database::session<AccessMode>::make_value(string_view key,
                                                                                string_view val)
   {
      return value_node::make(*_db->_ring, key, val);
   }
   template <typename AccessMode>
   inline database::deref<inner_node> database::session<AccessMode>::make_inner(string_view pre,
                                                                                id          val,
                                                                                uint64_t branches)
   {
      return inner_node::make(*_db->_ring, pre, val, branches, _version);
   }

   template <typename AccessMode>
   inline database::deref<inner_node> database::session<AccessMode>::make_inner(
       const inner_node& cpy,
       string_view       pre,
       id                val,
       uint64_t          branches)
   {
      return inner_node::make(*_db->_ring, cpy, pre, val, branches, _version);
   }

   /**
    *  Given an existing value node and a new key/value to insert 
    */
   template <typename AccessMode>
   database::id database::session<AccessMode>::combine_value_nodes(string_view k1,
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

   template <typename AccessMode>
   database::id database::session<AccessMode>::set_value(deref<node> n,
                                                         string_view key,
                                                         string_view val)
   {
      if (not n)
         return make_value(key, val);

      assert(n->is_value_node());

      auto& vn = n.as_value_node();
      if (_db->_ring->ref(n) == 1 and vn.data_size() == val.size())
      {
         memcpy(vn.data_ptr(), val.data(), val.size());
         return n;
      }

      return make_value(key, val);
   }

   template <typename AccessMode>
   database::id database::session<AccessMode>::set_inner_value(deref<inner_node> n, string_view val)
   {
      if (n->version() == _version)
      {
         if (n->value())
            _db->_ring->release(n->value());
         n->set_value(make_value(string_view(), val));
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
   template <typename AccessMode>
   inline database::id database::session<AccessMode>::add_child(id          root,
                                                                string_view key,
                                                                string_view val,
                                                                bool&       inserted)
   {
      //SCOPE;
      if (not root)  // empty case
         return make_value(key, val);

      auto n = get(root);
      if (n->is_value_node())  // current root is value
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

   template <typename AccessMode>
   void database::session<AccessMode>::clear()
   {
      auto& rev = _db->_dbm->_revisions[uint16_t(_version)];
      auto& ar  = *_db->_ring;
      if (rev._root)
         release(rev._root);
      rev._root.id = 0;
   }
   // return true on insert, false on update
   template <typename AccessMode>
   bool database::session<AccessMode>::upsert(string_view key, string_view val)
   {
      swap_guard g(*this);

      auto& rev = _db->_dbm->_revisions[uint16_t(_version)];
      auto& ar  = *_db->_ring;

      bool inserted = true;
      auto new_root = add_child(rev._root, key, val, inserted);
      assert(new_root.id);
      //  std::cout << "new_root: " << new_root.id << "  old : " << rev._root.id << "\n";
      if (new_root != rev._root)
      {
         release(rev._root);
         rev._root = new_root;
      }
      return inserted;
   }

   template <typename AccessMode>
   typename database::session<AccessMode>::iterator&
   database::session<AccessMode>::iterator::operator++()
   {
      _session->next(*this);
      return *this;
   }
   template <typename AccessMode>
   typename database::session<AccessMode>::iterator&
   database::session<AccessMode>::iterator::operator--()
   {
      _session->prev(*this);
      return *this;
   }
   template <typename AccessMode>
   void database::session<AccessMode>::prev(iterator& itr) const
   {
      swap_guard g(*this);
      read_buffer.resize(0);
      while (itr.path.size())
      {
         auto& c = itr.path.back();
         auto  n = get(c.first);

         if (c.second <= 0)
         {
            /*
            if (c.second == -1)
            {
               itr.path.pop_back();
               continue;
            }
            */

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
         itr.path.pop_back();
      }

      // find last
      for (;;)
      {
         auto& c = itr.path.back();
         auto  n = get(c.first);

         if (n->is_value_node())
            return;

         auto& in = n.as_inner_node();
         auto  b  = in.branch(c.second);
         auto  bi = get(b);

         if (bi->is_value_node())
         {
            itr.path.emplace_back(b, -1);
            return;
         }
         auto& bin = bi.as_inner_node();
         itr.path.emplace_back(b, bin.reverse_lower_bound(63));
      }
   }
   template <typename AccessMode>
   void database::session<AccessMode>::next(iterator& itr) const
   {
      swap_guard g(*this);
      read_buffer.resize(0);
      //      WARN( "start key: ", from_key(itr.key()) );
      //      auto print_path = [&]() {
      //     for( auto x : itr.path ) {
      //       std::cerr << "#" << x.first.id << "->" << char(x.second + 62) <<"["<<int(x.second)<<"] ";
      //   }
      //  std::cerr<<"\n";
      // };
      //     print_path();

      while (itr.path.size())
      {
         auto& c = itr.path.back();

         auto n = get(c.first);

         if (not n->is_value_node())
         {
            auto& in = n.as_inner_node();
            c.second = in.lower_bound(c.second + 1);

            if (c.second <= 63)
               break;
         }

         itr.path.pop_back();
      }
      // find first
      for (;;)
      {
         auto n = get(itr.path.back().first);
         if (n->is_value_node())
            return;

         auto& in = n.as_inner_node();

         auto  b   = in.branch(itr.path.back().second);
         auto  bi  = get(b);
         auto& bin = bi.as_inner_node();

         if (bin.value())
         {
            itr.path.emplace_back(b, -1);
            return;
         }

         itr.path.emplace_back(b, bin.lower_bound(0));
      }
   }

   template <typename AccessMode>
   std::string_view database::session<AccessMode>::iterator::value() const
   {
      if (path.size() == 0)
         return std::string_view();
      auto n = _session->get(path.back().first);
      if (n->is_value_node())
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
      if (path.size() == 0)
         return 0;
      int s = path.size() - 1;

      for (auto& e : path)
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

      for (auto& e : path)
      {
         auto n = _session->get(e.first);
         auto b = n->key_size();
         if (b > 0)
         {
            auto  part_len = std::min<uint32_t>(key_len, b);
            char* key_ptr;

            if (n->is_value_node())
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
      return result;
   }

   template <typename AccessMode>
   typename database::session<AccessMode>::iterator database::session<AccessMode>::first() const
   {
      id       root = _db->_dbm->_revisions[uint16_t(_version)]._root;
      iterator result(*this);
      if (not root)
         return result;

      for (;;)
      {
         reset_read_buffer();
         auto n = get(root);
         if (n->is_value_node())
         {
            result.path.emplace_back(root, -1);
            return result;
         }
         auto& in = n.as_inner_node();
         if (in.value())
         {
            result.path.emplace_back(root, -1);
            return result;
         }
         auto lb = in.lower_bound(0);
         result.path.emplace_back(root, lb);
         root = in.branch(lb);
      }
   }
   template <typename AccessMode>
   typename database::session<AccessMode>::iterator database::session<AccessMode>::last() const
   {
      id       root = _db->_dbm->_revisions[uint16_t(_version)]._root;
      iterator result(*this);
      if (not root)
         return result;

      for (;;)
      {
         reset_read_buffer();
         auto n = get(root);
         if (n->is_value_node())
         {
            result.path.emplace_back(root, -1);
            return result;
         }

         auto& in  = n.as_inner_node();
         auto  rlb = in.reverse_lower_bound(63);
         result.path.emplace_back(root, rlb);

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
      return find(_db->_dbm->_revisions[uint16_t(_version)]._root, key);
   }
   template <typename AccessMode>
   typename database::session<AccessMode>::iterator database::session<AccessMode>::last_with_prefix(
       string_view prefix) const
   {
      id       root = _db->_dbm->_revisions[uint16_t(_version)]._root;
      iterator result(*this);
      if (not root)
         return result;

      swap_guard g(*this);
      for (;;)
      {
         reset_read_buffer();
         auto n = get(root);
         if (n->is_value_node())
         {
            auto& vn = n.as_value_node();

            auto pre = common_prefix(vn.key(), prefix);

            if (pre == prefix)
            {
               result.path.emplace_back(root, -1);
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

               if (n->is_value_node())
               {
                  result.path.emplace_back(root, -1);
                  return result;
               }

               auto& in = n.as_inner_node();
               auto  b  = in.reverse_lower_bound(63);

               if (b == -1) [[unlikely]]
               {  /// this should be impossible in well formed tree
                  result.path.emplace_back(root, -1);
                  return result;
               }

               result.path.emplace_back(root, b);
               root = in.branch(b);
            }
            return result;
         }

         auto cpre = common_prefix(in_key, prefix);
         if (in_key.size() > prefix.size())
         {
            if (cpre == prefix)
            {
               result.path.emplace_back(root, -1);
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
      id       root = _db->_dbm->_revisions[uint16_t(_version)]._root;
      iterator result(*this);
      if (not root)
         return result;

      swap_guard g(*this);
      for (;;)
      {
         reset_read_buffer();
         auto n = get(root);
         if (n->is_value_node())
         {
            auto& vn = n.as_value_node();

            result.path.emplace_back(root, -1);

            if (vn.key() < key)
               next(result);

            return result;
         }

         auto& in     = n.as_inner_node();
         auto  in_key = in.key();

         if (in_key >= key)
         {
            result.path.emplace_back(root, -1);
            if (not in.value())
               next(result);
            return result;
         }

         auto cpre = common_prefix(key, in_key);
         if (key <= cpre)
         {
            result.path.emplace_back(root, -1);
            if (not in.value())
               next(result);
            return result;
         }

         // key > cpre

         auto b = in.lower_bound(key[cpre.size()]);
         if (b < 64)
         {
            result.path.emplace_back(root, b);
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

      iterator result(*this);
      swap_guard g(*this);
      for (;;)
      {
         reset_read_buffer();
         auto n = get(root);
         if (n->is_value_node())
         {
            auto& vn = n.as_value_node();
            if (vn.key() == key)
            {
               result.path.emplace_back(root, -1);
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

            //result.path.emplace_back(root, -1);
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

         result.path.emplace_back(root, b);
         key  = key.substr(cpre.size() + 1);
         root = in.branch(b);
      }
      return iterator(*this);
   }

   template <typename AccessMode>
   std::optional<std::string_view> database::session<AccessMode>::get(string_view key) const
   {
      auto& rev = _db->_dbm->_revisions[uint16_t(_version)];
      return get(rev._root, key);
   }
   template <typename AccessMode>
   std::optional<std::string_view> database::session<AccessMode>::get(id          root,
                                                                      string_view key) const
   {
      if (not root)
         return std::nullopt;
      swap_guard g(*this);
      for (;;)
      {
         reset_read_buffer();
         auto n = get(root);
         if (n->is_value_node())
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

   template <typename AccessMode>
   bool database::session<AccessMode>::remove(string_view key)
   {
      swap_guard g(*this);
      auto& rev      = _db->_dbm->_revisions[uint16_t(_version)];
      bool  removed  = false;
      auto  new_root = remove_child(rev._root, key, removed);
      if (new_root != rev._root)
      {
         release(rev._root);
         rev._root = new_root;
      }
      return removed;
   }
   template <typename AccessMode>
   inline database::id database::session<AccessMode>::remove_child(id          root,
                                                                   string_view key,
                                                                   bool&       removed)
   {
      //SCOPE;
      // DEBUG( "key: ", from_key(key),  "  root: " , root.id );

      if (not root)
      {
         removed = false;
         return root;
      }

      auto n = get(root);
      if (n->is_value_node())  // current root is value
      {
         //   WARN( "IS VALUE NODE" );
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

            if (bn->is_value_node())
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
               if (cur_v->is_value_node())
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
      auto& rev = _db->_dbm->_revisions[uint16_t(_version)];
      print(rev._root, string_view(), "");
   }

   template <typename AccessMode>
   void database::session<AccessMode>::validate()
   {
      auto& rev = _db->_dbm->_revisions[uint16_t(_version)];
      validate(rev._root);
   }

   inline std::string from_key(std::string_view sv)
   {
      std::string out;
      out.reserve(sv.size());
      for (int i = 0; i < sv.size(); ++i)
         out += sv[i] + 62;
      return out;
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
      if (dr->is_value_node())
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
      if (dr->is_value_node())
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

}  // namespace trie
