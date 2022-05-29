#include <boost/interprocess/file_mapping.hpp>
#include <boost/interprocess/mapped_region.hpp>
#include <boost/interprocess/offset_ptr.hpp>
#include <boost/interprocess/sync/interprocess_sharable_mutex.hpp>
#include <trie/debug.hpp>
#include <trie/trie.hpp>

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

   namespace bip = boost::interprocess;
   template <typename T>
   using bip_offset_ptr = bip::offset_ptr<T>;

   struct revision
   {
      object_id                                        _root;
      boost::interprocess::interprocess_sharable_mutex _mutex;
   };

   struct database_memory
   {
      uint64_t _count = 0;
      revision _revisions[0xffff];
   };

   struct database_impl
   {
      //std::unique_ptr<object_arena>       _arena;
      std::unique_ptr<ring_allocator>     _ring;
      std::filesystem::path               _db_dir;
      std::unique_ptr<bip::file_mapping>  _file;
      std::unique_ptr<bip::mapped_region> _region;
      database_memory*                    _dbm;
   };

   database::database(std::filesystem::path dir, config cfg, access_mode allow_write)
       : my(new database_impl())
   {
      bool init = false;
      auto rev  = dir / "revisions";
      if (not std::filesystem::exists(dir))
      {
         if (not allow_write)
            throw std::runtime_error("directory does not exist: '" + dir.generic_string() + "'");
         std::filesystem::create_directories(dir);
      }
      if (not std::filesystem::exists(rev))
      {
         init = true;
         std::ofstream f(rev.generic_string(), std::ofstream::trunc);
         f.close();
         std::filesystem::resize_file(rev, sizeof(database_memory));
      }
      auto md     = allow_write == read_write ? bip::read_write : bip::read_only;
      my->_file   = std::make_unique<bip::file_mapping>(rev.generic_string().c_str(), md);
      my->_region = std::make_unique<bip::mapped_region>(*my->_file, md);
      if (init)
         my->_dbm = new (my->_region->get_address()) database_memory();
      else
         my->_dbm = reinterpret_cast<database_memory*>(my->_region->get_address());

      my->_ring.reset(new ring_allocator(dir/"ring", ring_allocator::read_write,
                                         {.max_ids    = cfg.max_objects,
                                          .hot_pages  = cfg.hot_pages,
                                          .warm_pages = cfg.hot_pages,
                                          .cool_pages = cfg.cold_pages,
                                          .cold_pages = cfg.cold_pages}));
      /*
      my->_arena.reset(new object_arena(
          dir / "arena", allow_write ? object_arena::read_write : object_arena::read_only,
          cfg.max_objects, 4096 * cfg.hot_pages, 4096 * cfg.cold_pages,
          cfg.big_hot_pages*4096, cfg.big_cold_pages*4096 ));
          */
   }
   database::~database() {}
   database::session::~session() { _db.my->_dbm->_revisions[uint16_t(_version)]._mutex.unlock(); }

   database::session database::start_revision(uint32_t new_rev, uint32_t prev_rev)
   {
   //   my->_dbm->_revisions[uint16_t(new_rev)]._mutex.lock();
      if (prev_rev != new_rev)
      {
         release(my->_dbm->_revisions[uint16_t(new_rev)]._root);
         //my->_arena->retain(my->_dbm->_revisions[uint16_t(prev_rev)]._root);
         my->_ring->retain(my->_dbm->_revisions[uint16_t(prev_rev)]._root);
         my->_dbm->_revisions[uint16_t(new_rev)]._root =
             my->_dbm->_revisions[uint16_t(prev_rev)]._root;
      }
      return session(*this, new_rev);
   }

   inline database::deref<node> database::session::get(id i) const
   {
      assert(!!i);
      return {i, _db.my->_ring->get(i)};
   }

   inline void database::session::release(id obj) { _db.release(obj); }

   inline void database::release(id obj)
   {
      if (not obj)
         return;

      auto gr = my->_ring->get_ref(obj);

      //      std::cout << "release: " << obj.id << "  pref: " << gr.first << "\n";
      if (gr.first == 1)
      {
         if (not reinterpret_cast<node*>(gr.second)->is_value_node())
         {
            auto& in = *reinterpret_cast<inner_node*>(gr.second);
            release(in.value());
            auto nb  = in.num_branches();
            auto pos = in.children();
            auto end = pos + nb;
            while (pos != end)
            {
               release(*pos);
               ++pos;
            }
         }
      }
      my->_ring->release(obj);
   }

   inline database::id database::session::retain(id obj)
   {
      if (obj)
         _db.my->_ring->retain(obj);
      return obj;
   }

   std::string_view common_prefix(std::string_view a, std::string_view b)
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

   inline void database::session::assign(object_id& to, object_id from)
   {
      release(to);
      to = from;
   }
   inline database::deref<value_node> database::session::make_value(string_view key,
                                                                    string_view val)
   {
      return value_node::make(*_db.my->_ring, key, val);
   }
   inline database::deref<inner_node> database::session::make_inner(string_view pre,
                                                                    id          val,
                                                                    uint64_t    branches)
   {
      return inner_node::make(*_db.my->_ring, pre, val, branches, _version);
   }
   inline database::deref<inner_node> database::session::make_inner(const inner_node& cpy,
                                                                    string_view       pre,
                                                                    id                val,
                                                                    uint64_t          branches)
   {
      auto r = inner_node::make(*_db.my->_ring, cpy, pre, val, branches, _version);

      deref<inner_node> in = r;
      auto*             c  = in->children();
      auto*             ce = c + in->num_branches();
      while (c != ce)
      {
         retain(*c);
         ++c;
      }
      return in;
   }

   /**
    *  Given an existing value node and a new key/value to insert 
    */
   database::id database::session::combine_value_nodes(string_view k1,
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

         //print(in, {});

         return in;
      }
   }

   database::id database::session::set_value(deref<node> n, string_view key, string_view val)
   {
      if (not n)
         return make_value(key, val);

      assert(n->is_value_node());

      /// TODO: if size would fall within the same bucket we can resize obj in place
      auto& vn = n.as<value_node>();
      if (_db.my->_ring->ref(n) == 1 and vn.data_size() == val.size())
      {
         memcpy(vn.data_ptr(), val.data(), val.size());
         return n;
      }

      return make_value(key, val);
   }

   database::id database::session::set_inner_value(deref<inner_node> n, string_view val)
   {
      if (n->version() == _version)
      {
         if (n->value())
            _db.my->_ring->release(n->value());
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
   inline database::id database::session::add_child(id          root,
                                                    string_view key,
                                                    string_view val,
                                                    bool&       inserted)
   {
      if (not root)  // empty case
      {
         inserted = true;
         return make_value(key, val);
      }

      auto n = get(root);
      if (n.as<node>().is_value_node())  // current root is value
      {
         auto& vn = n.as<value_node>();
         if ((inserted = (vn.key() != key)))  // with differnet keys
            return combine_value_nodes(vn.key(), vn.data(), key, val);
         else
            return set_value(n, key, val);  // with the same key
      }

      // current root is an inner node
      auto& in     = n.as<inner_node>();
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
               if (cur_b)
                  release(cur_b);
               cur_b = new_b;
            }

            return new_in;
         }  // else modify in place

         auto& cur_b = in.branch(b);

         auto new_b = add_child(cur_b, key.substr(cpre.size() + 1), val, inserted);

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
            inserted = true;
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

            inserted = true;
            return nin;
         }
      }
   }

   void database::session::clear()
   {
      auto& rev = _db.my->_dbm->_revisions[uint16_t(_version)];
      auto& ar  = *_db.my->_ring;
      if (rev._root)
         release(rev._root);
      rev._root.id = 0;
   }
   // return true on insert, false on update
   bool database::session::upsert(string_view key, string_view val)
   {
      auto& rev = _db.my->_dbm->_revisions[uint16_t(_version)];
      auto& ar  = *_db.my->_ring;

      bool inserted = false;
      auto new_root = add_child(rev._root, key, val, inserted);
      //  std::cout << "new_root: " << new_root.id << "  old : " << rev._root.id << "\n";
      if (new_root != rev._root)
      {
         release(rev._root);
         rev._root = new_root;
      }
      return inserted;
   }
   std::optional<std::string_view> database::session::get(string_view key) const
   {
      auto& rev = _db.my->_dbm->_revisions[uint16_t(_version)];
      return get(rev._root, key);
   }
   std::optional<std::string_view> database::session::get(id root, string_view key) const
   {
      while (root)
      {
         auto n = get(root);
         if (n->is_value_node())
         {
            auto& vn = n.as<value_node>();
            if (vn.key() == key)
               return vn.data();
            return std::nullopt;
         }
         auto& in     = n.as<inner_node>();
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

   bool database::session::remove(string_view key)
   {
      auto& rev      = _db.my->_dbm->_revisions[uint16_t(_version)];
      bool  removed  = false;
      auto  new_root = remove_child(rev._root, key, removed);
      if (new_root != rev._root)
      {
         release(rev._root);
         rev._root = new_root;
      }
      return removed;
   }
   inline database::id database::session::remove_child(id root, string_view key, bool& removed)
   {
      //SCOPE;
      // DEBUG( "key: ", from_key(key),  "  root: " , root.id );

      if (not root)
      {
         removed = false;
         return root;
      }

      auto n = get(root);
      if (n.as<node>().is_value_node())  // current root is value
      {
         //   WARN( "IS VALUE NODE" );
         auto& vn = n.as<value_node>();
         removed  = vn.key() == key;
         return id();
      }

      auto& in     = n.as<inner_node>();
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
               auto& vn = bn.as<value_node>();
               new_key += vn.key();
               //           DEBUG( "clone value" );
               return make_value(new_key, vn.data());
            }
            else
            {
               auto& bin = bn.as<inner_node>();
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
               auto& cv    = cur_v.as<value_node>();

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
                  auto&       cv = cur_v.as<value_node>();
                  std::string new_key;
                  new_key += in.key();
                  new_key += char(lb);
                  new_key += cv.key();
                  return make_value(new_key, cv.data());
               }
               else
               {
                  auto&       cv = cur_v.as<inner_node>();
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

   void database::session::print()
   {
      auto& rev = _db.my->_dbm->_revisions[uint16_t(_version)];
      print(rev._root, string_view());
   }

   void database::session::print(id r, string_view prefix)
   {
      if (not r)
      {
         std::cerr << "~\n";
         return;
      }

      auto dr = get(r);
      if (dr->is_value_node())
      {
         auto dat = dr.as<value_node>().data();
         std::cerr << "'" << from_key(dr.as<value_node>().key()) << "' => ";
         std::cerr << (dat.size() > 20 ? string_view("BIG DAT") : dat) << ": " << r.id << "  vr"
                   << _db.my->_ring->ref(r) << "\n";
      }
      else
      {
         auto& in = dr.as<inner_node>();
         std::cerr << " '" << from_key(in.key()) << "' = "
                   << (in.value().id ? get(in.value()).as<value_node>().data()
                                     : std::string_view("__null__"))
                   << ": " << in.value().id << "  vr" << _db.my->_ring->ref(in.value()) << "  nr"
                   << _db.my->_ring->ref(r) << "\n";

         //  std::cout <<"NUM BR: " << in.num_branches() <<"\n";
         for (char i = 0; i < 64; ++i)
         {
            if (in.has_branch(i))
            {
               std::cerr << prefix << "    " << from_key(string_view(&i, 1)) << " => ";
               std::string p(prefix);
               p += "    ";
               print(in.branch(i), p);
            }
         }
      }
   }

   void database::swap() {
      my->_ring->swap();
      my->_ring->claim_free();
   }
   void database::print_stats() { my->_ring->dump(); }
}  // namespace trie
