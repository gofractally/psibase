#include <arbtrie/arbtrie.hpp>
#include <arbtrie/binary_node.hpp>
#include <arbtrie/database.hpp>
#include <arbtrie/debug.hpp>
#include <arbtrie/file_fwd.hpp>

#include <utility>

void print(arbtrie::session_rlock& state, arbtrie::object_id i, int depth);
namespace arbtrie
{
   void release_node(object_ref<node_header>& r);
   inline void release_node(object_ref<value_node>& r) { release_node(reinterpret_cast<object_ref<node_header>&>(r)); }


   object_id upsert(object_ref<node_header>& root,
                    bool                     unique,
                    key_view                 key,
                    value_view               val,
                    int&                     old_size);

   database::database(std::filesystem::path dir, config cfg, access_mode mode)
       : _sega{dir}, _dbfile{dir / "db", mode}, _config(cfg)
   {
      if (_dbfile.size() == 0)
      {
         _dbfile.resize(sizeof(database_memory));
         new (_dbfile.data())
             database_memory{.magic = file_magic, .flags = file_type_database_root, .top_root = 0};
      }

      if (_dbfile.size() != sizeof(database_memory))
         throw std::runtime_error("Wrong size for file: " + (dir / "db").native());

      _dbm = reinterpret_cast<database_memory*>(_dbfile.data());

      if (_dbm->magic != file_magic)
         throw std::runtime_error("Not a arbtrie file: " + (dir / "db").native());
      //     if ((_dbm->flags & file_type_mask) != file_type_database_root)
      //        throw std::runtime_error("Not a arbtrie db file: " + (dir / "db").native());
      if (cfg.run_compact_thread)
         _sega.start_compact_thread();
   }

   database::~database() {}

   void database::create(std::filesystem::path dir, config cfg)
   {
      if (std::filesystem::exists(std::filesystem::symlink_status(dir / "db")) ||
          std::filesystem::exists(std::filesystem::symlink_status(dir / "data")))
         throw std::runtime_error("directory already exists: " + dir.generic_string());

      std::filesystem::create_directories(dir / "data");

      std::make_shared<database>(dir, cfg, access_mode::read_write);
   }

   void database::print_stats(std::ostream& os, bool detail)
   {
      _sega.dump();
   }
   bool database::compact_next_segment()
   {
      return _sega.compact_next_segment();
   }
   void database::start_compact_thread()
   {
      _sega.start_compact_thread();
   }

   void read_session::release(object_id oid)
   {
      TRIEDENT_WARN("TODO");
   }

   write_session database::start_write_session()
   {
      assert(not _have_write_session);
      _have_write_session = true;
      return write_session(*this);
   }

   object_id make_value(session_rlock& state, value_view val)
   {
      return state
          .alloc(sizeof(node_header) + val.size(), node_type::value,
                 [&](node_header* node) { memcpy(node->body(), val.data(), val.size()); })
          .id();
   }

   // allocates new data but reuses the existing id
   object_id remake_value(object_ref<value_node>& oref, const value_node* vn, value_view new_val)
   {
      assert(oref.ref() == 1);
      std::cerr << "TODO: remake_value()  new: '" << new_val << "'  old: '" << vn->value() << "'\n";
      return make_value(oref.rlock(), new_val);
      // reallocate the value and update where the oref points
   }

   object_id make_binary(session_rlock& state, key_view key, object_id val)
   {
      auto asize = sizeof(node_header) + sizeof(val) + key.size() + 1 + sizeof(uint16_t);
      return state
          .alloc(asize, node_type::binary,
                 [&](node_header* node)
                 {
                    new (node) node_header(asize, node_type::binary, 1 /*num_branch*/, 0);
                    binary_node* bn = node->as<binary_node>();

                    auto p            = bn->start_keys();
                    bn->key_offset(0) = bn->tail() - p;
                    bn->values()[0]   = val;
                    *p++              = key.size();
                    memcpy(p, key.data(), key.size());
                 })
          .id();
   }
   object_id make_binary(session_rlock& state, key_view key, value_view val)
   {
      return make_binary(state, key, make_value(state, val));
   }

   object_id make_setlist_node(session_rlock& state,
                               uint16_t       nbranch,
                               key_view       cpre,
                               bool           has_eof,
                               auto           init)
   {
      auto asize = setlist_node::calc_expected_size( cpre.size(),
                                                     nbranch, has_eof );
//      auto asize = sizeof(node_header) + 1 + cpre.size() + (nbranch - has_eof) +
//                   nbranch * (sizeof(object_id));
      return state
          .alloc(asize, node_type::setlist,
                 [&](node_header* node)
                 {
                    auto sln            = (setlist_node*)node;
                    sln->_has_eof_value = has_eof;
                    sln->_num_branches = nbranch; 
                    sln->_prefix_len = cpre.size();
                    sln->_prefix_truncate = 0;
                    assert( sln->check_size() );
                    memcpy(sln->prefix, cpre.data(), cpre.size());
                    init(sln);
                 })
          .id();
   }

   void retain_children(session_rlock& state, const setlist_node* bn)
   {
      auto       vp = bn->branches();
      const auto ep = vp + bn->num_branches();
      while (vp != ep)
      {
         state.get(*vp).retain();
         ++vp;
      }
   }

   void retain_children(session_rlock& state, const binary_node* bn)
   {
      std::cerr << "bn->num_branches: " << bn->num_branches() << "\n";
      auto       vp = bn->values();
      const auto ep = vp + bn->num_branches();
      while (vp != ep)
      {
         state.get(*vp).retain();
         ++vp;
      }
   }

   template <typename T>
   object_ref<T> clone_node(object_ref<T>& r, node_header* root)
   {
      assert(root->get_type() == r.type());
      return r.rlock().alloc(root->size(), root->get_type(),
                             [&](node_header* ptr)
                             {
                                memcpy(ptr->body(), root->body(), root->size());
                                ptr->_num_branches = root->_num_branches;
                                ptr->_unused       = 0;
                                ptr->_prefix_len   = root->_prefix_len;
                             });
   }

   object_id clone_binary_range(object_ref<node_header>& r,
                                const binary_node*       bn,
                                key_view                 minus_prefix,
                                int                      from,
                                int                      to)
   {
      const auto nbranch       = to - from;
      auto       key_data_size = nbranch;  // init with the size field of the keys
      for (int k = from; k < to; ++k)
         key_data_size += bn->get_key_size(k);
      key_data_size -= minus_prefix.size() * nbranch;
      const auto asize =
          sizeof(node_header) + nbranch * (sizeof(uint16_t) + sizeof(object_id)) + key_data_size;

      auto init = [&](node_header* nnh)
      {
         binary_node* nn   = (binary_node*)nnh;
         nn->_num_branches = nbranch;
         nn->_prefix_len   = 0;
         nn->_unused       = 0;

         // the caller is responsible for retaining the values, but because
         // this is called by refactor(), all values are moving to a new node
         // and therefore no retain/release overhead is required
         memcpy(nn->values(), &bn->value(from), nbranch * sizeof(object_id));

         auto  nntail  = nn->tail();
         char* key_pos = nn->start_keys();
         for (int i = 0; i < nbranch; ++i)
         {
            nn->key_offset(i) = nntail - key_pos;
            auto fk           = bn->get_key(from + i);
            auto nks          = fk.size() - minus_prefix.size();
            *key_pos++        = nks;
            //         std::cerr << "clone_range " << from << " -> " << to
            //                   << " i: " << i <<" '"<<fk<<"'"
            //                   << " prefix: '" << minus_prefix << "'\n";
            memcpy(key_pos, fk.data() + minus_prefix.size(), nks);
            key_pos += nks;
         }
      };
      return r.rlock().alloc(asize, node_type::binary, init).id();
   }

   object_id clone_setlist_add_eof(object_ref<node_header>& r,
                                   const setlist_node*      sl,
                                   object_id                eof_val,
                                   bool                     reuse_id)
   {
      assert(not sl->_has_eof_value);
      assert( sl->check_size() );
     // auto asize = sl->size() + sizeof(object_id) - sl->_prefix_truncate;
      auto asize = setlist_node::calc_expected_size( sl->prefix_size(),
                                                     sl->num_branches()+1,
                                                     true );

      auto init = [&](node_header* h)
      {
         auto sln              = (setlist_node*)h;
         sln->_has_eof_value   = true;
         sln->_num_branches    = sl->_num_branches + 1;
         sln->_prefix_len      = sl->_prefix_len - sl->_prefix_truncate;
         sln->_prefix_truncate = 0;
         assert( sln->check_size() );

         auto old_prefix = sl->get_prefix();
         memcpy(sln->prefix, old_prefix.data(), old_prefix.size() );

         memcpy(sln->setlist(), sl->setlist(), sl->num_branches());
         sln->branches()[0] = eof_val;
         memcpy(sln->branches() + 1, sl->branches(), sl->num_branches() * sizeof(object_id));

         assert(sln->get_prefix() == sl->get_prefix());
         assert(sln->get_setlist() == sl->get_setlist());
      };
      if (reuse_id)
         return r.rlock().realloc(r.id(), asize, node_type::setlist, init).id();
      else
         return r.rlock().alloc(asize, node_type::setlist, init).id();
   }

   object_id clone_setlist_add(bool                     reuse_id,
                               const setlist_node*      sl,
                               object_ref<node_header>& root,
                               char                     br,
                               object_id                val)
   {
      assert(not sl->get_branch(br));
      assert( sl->check_size() );
      //auto asize = sl->size() + 1 + sizeof(object_id) - sl->_prefix_truncate;
      auto asize = setlist_node::calc_expected_size( sl->prefix_size(),
                                                     sl->num_branches()+1,
                                                     sl->_has_eof_value );

      auto init = [&](node_header* h)
      {
         auto sln              = (setlist_node*)h;
         sln->_has_eof_value   = sl->_has_eof_value;
         sln->_num_branches    = sl->_num_branches + 1;
         sln->_prefix_len      = sl->prefix_size();
         sln->_prefix_truncate = 0;

         assert( sln->check_size() );
         auto old_prefix       = sl->get_prefix();
         memcpy(sln->prefix, old_prefix.data(), old_prefix.size());

         uint8_t*    new_setlp = sln->setlist();

         const uint8_t* setlp     = sl->setlist();
         const uint8_t* setle     = setlp + sl->num_branches() - sl->has_eof_value();
         while (setlp < setle)
         {
            if (*setlp > br)
               break;
            ++setlp;
         }
         auto offset = setlp - sl->setlist();

         // copy the old setlist from start to offset
         memcpy(new_setlp, sl->setlist(), offset);
         new_setlp += offset;

         // set the new branch in setlist
         *new_setlp = br;
         ++new_setlp;
//==============
//
//   setlist [0->offset) 
//   setlist [br]
//   setlist [offset+1 -> num_branches-eof]

         memcpy(new_setlp, sl->setlist() + offset, 
                sl->num_branches() - offset - sl->_has_eof_value);



         memcpy(sln->branches(), sl->branches(),
                (sln->_has_eof_value + offset) * sizeof(object_id));

         auto of = sl->_has_eof_value + offset;
         sln->branches()[of] = val;

         memcpy(sln->branches() + of+1, sl->branches() + of,
                (sl->num_branches() - of) * sizeof(object_id));

         assert( (char*)(sln->branches() + of +1) + ((sl->num_branches() - of) * sizeof(object_id)) <= sln->tail() );
         assert(sln->get_branch(br) and sln->get_branch(br) == val);
      };

      if (reuse_id)
         return root.rlock().realloc(root.id(), asize, node_type::setlist, init).id();
      else
         return root.rlock().alloc(asize, node_type::setlist, init).id();
   }

   object_id clone_binary_add(bool                     reuse_id,
                              const binary_node*       bn,
                              object_ref<node_header>& root,
                              key_view                 key,
                              object_id                val)
   {
      auto asize = bn->size() + sizeof(object_id) + sizeof(uint16_t) + 1 + key.size();
      auto init  = [&](node_header* h)
      {
         h->_num_branches = bn->num_branches() + 1;
         auto t           = h->as<binary_node>();

         auto lb = bn->lower_bound_idx(key);

         // insert the new offset
         memcpy(t->key_offsets(), bn->key_offsets(), lb * sizeof(uint16_t));
         t->key_offset(lb) = t->key_section_size();
         memcpy(&t->key_offset(lb + 1), &bn->key_offset(lb),
                sizeof(uint16_t) * (bn->num_branches() - lb));

         // insert the new value
         memcpy(t->values(), bn->values(), lb * sizeof(object_id));
         t->values()[lb] = val;
         memcpy(t->values() + lb + 1, bn->values() + lb,
                sizeof(object_id) * (bn->num_branches() - lb));

         // insert the new key
         auto start_key = t->start_keys();
         *start_key++   = key.size();
         memcpy(start_key, key.data(), key.size());
         start_key += key.size();

         // copy keys from this to new
         auto key_data_len = bn->key_section_size();
         assert(start_key == t->tail() - key_data_len);
         memcpy(start_key, bn->start_keys(), key_data_len);
      };

      if (reuse_id)
      {
         // TODO: mark old space as free
         // no need to retain children because we have reused the id
         return root.rlock().realloc(root.id(), asize, node_type::binary, init).id();
      }
      else
      {
         // we have created a new copy that needs its own ref counts
         retain_children(root.rlock(), bn);
         return root.rlock().alloc(asize, node_type::binary, init).id();
      }
   }

   int write_session::upsert(root& r, key_view key, value_view val)
   {
      auto state    = _segas.lock();
      int  old_size = -1;
      auto rlock    = _segas.lock();
      auto new_r    = upsert(rlock, r.id(), r.is_unique(), key, val, old_size);
      r.set_id(new_r);
      return old_size;
   }

   //================================
   //  upsert_value
   //================================
   object_id upsert_value(object_ref<value_node>& root, bool unique, value_view val, int& old_size)
   {
      unique &= root.ref() == 1;

      auto vn  = root.obj();
      old_size = vn->value_size();

      if (unique)
      {
         if (vn->value_size() == val.size())
         {
            std::unique_lock lock(root.get_mutex());
            memcpy(vn->body(), val.data(), val.size());
            return root.id();
         }
         return remake_value(root, vn, val);
      }
      return make_value(root.rlock(), val);
   }

   //================================================
   //  refactor
   //
   //  Given a binary node, turn it into a radix node
   //=================================================
   object_ref<node_header> refactor(object_ref<node_header>& r, const binary_node* root)
   {
   //   auto& state = r.rlock();
   //   ::print( state, r.id(), 1 );
      bool reuse_id = r.ref() == 1;

      assert(root->num_branches() > 1);
      auto first_key     = root->get_key(0);
      auto last_key      = root->get_key(root->num_branches() - 1);
      auto cpre          = common_prefix(first_key, last_key);
      bool has_eof_value = first_key.size() == cpre.size();

      uint16_t nbranch = has_eof_value;
      uint16_t freq_table[256];
      memset(freq_table, 0, sizeof(freq_table));

      const auto numb = root->num_branches();
      for (uint32_t i = has_eof_value; i < numb; ++i)
      {
         auto    k = root->get_key(i);
         uint8_t f = k[cpre.size()];
         nbranch += freq_table[f] == 0;
         freq_table[f]++;
      }

      // TODO: this assumes going to setlist, but depending upon nbranch
      // it might go to index or full

      // if unique, we can reuse r's id and avoid updating the parent!

      auto asize = setlist_node::calc_expected_size( cpre.size(), 
                                                     nbranch,
                                                     has_eof_value);
    //  auto asize = sizeof(node_header) + 1 + cpre.size() + nbranch - 1 +
    //               has_eof_value * sizeof(object_id) + nbranch * (sizeof(object_id));
      auto init = [&](node_header* h)
      {
         h->_num_branches      = nbranch;
         auto sln              = (setlist_node*)h;
         sln->_has_eof_value   = has_eof_value;
         sln->_prefix_len      = cpre.size();
         sln->_prefix_truncate = 0;
         memcpy(sln->prefix, cpre.data(), cpre.size());

         if (has_eof_value)
         {
            sln->set_eof_branch(root->value(0));
         }

         int slidx = 0;
         for (uint32_t from = has_eof_value; from < numb;)
         {
            const auto    k    = root->get_key(from);
            const uint8_t byte = k[cpre.size()];
            const int     to   = from + freq_table[byte];
            assert(freq_table[byte] > 0);

            auto new_child = clone_binary_range(r, root, k.substr(0, cpre.size() + 1), from, to);
            from           = to;
            sln->set_index(slidx++, byte, new_child);
         }
      };

      if (reuse_id)
      {
         // no need to retain children because we have reused the id
         return r.rlock().realloc(r.id(), asize, node_type::setlist, init);
      }
      else
      {
         // we have created a new copy that needs its own ref counts
         retain_children(r.rlock(), root);
         return r.rlock().alloc(asize, node_type::setlist, init);
      }
   }

   //================================
   //  upsert_setlist
   //================================
   object_id upsert_setlist(object_ref<node_header>& sln,
                            bool                     unique,
                            key_view                 key,
                            value_view               val,
                            int&                     old_size)
   {
      auto state = sln.rlock();

      auto root = sln.as<setlist_node>();

      auto rootpre = root->get_prefix();
      auto cpre    = common_prefix(rootpre, key);

      if (cpre.size() == root->get_prefix().size())
      {  // then we can recurse into the node

         if (cpre.size() == key.size())
         {
            if (root->has_eof_value())
            {
               if (unique)
               {
                  auto ob = root->get_eof_branch();
                  assert(ob and "root->has_eof_value() returned true!");

                  auto eof_oref = state.get<value_node>(*ob);
                  *ob           = upsert_value(eof_oref, unique, val, old_size);
                  if (*ob != eof_oref.id())
                     release_node(eof_oref);
                  return sln.id();
               }
               else
               {
                  auto cl = clone_node(sln, root);
                  retain_children(state, root);
                  return upsert_setlist(cl, true, key, val, old_size);
               }
            }
            else
            {
               if (not unique)
               {
                  // clone is making a copy, otherwise clone is just updating
                  // the existing object
                  retain_children(state, root);
               }
               return clone_setlist_add_eof(sln, root, make_value(state, val), unique);
            }
         }
         else if (cpre.size() < key.size())
         {
            auto bidx = key[cpre.size()];
            auto br   = root->get_branch(bidx);
            if (br)
            {
               auto old_br = state.get(br);
               auto new_br = upsert(old_br, unique, key.substr(cpre.size() + 1), val, old_size);
               if (unique)
               {
                  root->set_branch(bidx, new_br);
                  return sln.id();
               }
               else
               {  // not unique

                  auto cl = clone_node(sln, root);
                  retain_children(state, root);
                  cl.as<setlist_node>()->set_branch(bidx, new_br);

                  release_node(old_br);
                  return cl.id();
               }
            }
            else
            {
               return clone_setlist_add(unique, root, sln, bidx,
                                        make_binary(state, key.substr(cpre.size() + 1), val));
               // TODO: if unique, we can reuse root id so parent doesn't need to change!
               //  return root->clone_add(
               //      bidx, binary_node::make(key.substr(cpre.size() + 1), value_node::make(val)));
            }
         }
      }
      else  // key does not share the same prefix
      {
         // scenario
         // root 'a'
         // key  'eaberry'
         // cpre ''

         // the prefix of root is longer than the common prefix with key, therefore assume:
         //
         // root  abcde
         // key   abxyz
         // cpre  ab
         //
         // Create a new setlist node with prefix cpre (ab)
         // if unique, truncate root prefix length
         // else clone root with shorter prefix length
         // Create a new binary node off branch x with yz = val
         //

         if (unique)
            root->set_prefix(rootpre.substr(cpre.size() + 1));
         else
         {
            // TODO - for now we are only testing modify in place so this shouldn't be hit
            TRIEDENT_WARN("Unable to modify in place, we must clone root to truncate prefix");
         }

         bool has_eof_value = key.size() == cpre.size();
         // key is the eof value of

         if (not has_eof_value)
         {
            auto abx = make_binary(state, key.substr(cpre.size() + 1), val);

            return make_setlist_node(state, 2, cpre, has_eof_value,
                                     [&](setlist_node* new_sln)
                                     {
                                        auto order = key[cpre.size()] > rootpre[cpre.size()];
                                        new_sln->set_index(!order, key[cpre.size()], abx);
                                        new_sln->set_index(order, rootpre[cpre.size()], sln.id());
                                     });
         }
         else  // has eof_value
         {
            return make_setlist_node(state, 2, cpre, has_eof_value,
                                     [&](setlist_node* new_sln)
                                     {
                                        new_sln->set_eof_branch(make_value(state, val));
                                        new_sln->set_index(0, rootpre[cpre.size()], sln.id());
                                     });
         }
      }
      exit(1);
   }

   object_id upsert_binary(object_ref<node_header>& root,
                           bool                     unique,
                           key_view                 key,
                           value_view               val,
                           int&                     old_size)
   {
      auto& state = root.rlock();
      auto  bn    = root.as<binary_node>();
      auto  v     = bn->get_value(key);
      if (not v)
      {
         if (bn->size() + key.size() + sizeof(id_type) + sizeof(uint16_t) + 1 > 4096)
         {
            auto rid = refactor(root, bn);
            return upsert(rid, unique, key, val, old_size);
         }
         // TODO: maybe refactor to setlist if size would be too big

         return clone_binary_add(unique, bn, root, key, make_value(state, val));
      }
      assert(bn->get_key(bn->find_key_idx(key)) == key);

      auto vn         = state.get<value_node>(*v);
      auto new_val_id = upsert_value(vn, unique, val, old_size);

      // since the ID of the value changed, we have to update this
      // node which will involve cloning if not unique
      if (new_val_id != *v)
      {
         if (unique)
         {
            std::unique_lock lock(root.get_mutex());
            *v = new_val_id;
            return root.id();
         }
         auto nroot = root.clone(bn);
         retain_children(state, bn);

         bn                  = nroot.as<binary_node>();
         *bn->get_value(key) = new_val_id;

         // we retained the old value, an extra time during
         // retain_children, so we can release it after setting
         // the new value
         release_node(vn);
         return nroot.id();
      }
      return root.id();
   }

   object_id upsert(object_ref<node_header>& root,
                    bool                     unique,
                    key_view                 key,
                    value_view               val,
                    int&                     old_size)
   {
      unique &= root.ref() == 1;
      switch (root.type())
      {
         case node_type::binary:
            return upsert_binary(root, unique, key, val, old_size);
         case node_type::setlist:
            return upsert_setlist(root, unique, key, val, old_size);
         default:
            TRIEDENT_WARN("unhandled type in upsert");
      }
      return root.id();
   }

   object_id write_session::upsert(session_rlock& state,
                                   object_id      root,
                                   bool           unique,
                                   key_view       key,
                                   value_view     val,
                                   int&           old_size)
   {
      if (not root) [[unlikely]]
         return make_binary(state, key, make_value(state, val));

      auto oref = state.get(root);
      return arbtrie::upsert(oref, unique, key, val, old_size);
   }


   void release_binary_node(object_ref<node_header>& n)
   {
      auto&      state = n.rlock();
      const auto bn    = n.as<binary_node>();
      if (n.release())
      {
         auto pos = bn->values();
         auto end = pos + bn->num_branches();
         while (pos != end)
         {
            auto nr = state.get(*pos);
            release_node(nr);
            ++pos;
         }
      }
   }
   void release_setlist_node(object_ref<node_header>& n)
   {
      auto&      state = n.rlock();
      const auto sln   = n.as<setlist_node>();
      if (n.release())
      {
         auto pos = sln->branches();
         auto end = pos + sln->num_branches();
         while (pos != end)
         {
            auto nr = state.get(*pos);
            release_node(nr);
            ++pos;
         }
      }
   }

   void release_node(object_ref<node_header>& r)
   {
      switch (r.type())
      {
         case node_type::value:
            r.release();
            return;
         case node_type::binary:
            return release_binary_node(r);
         case node_type::setlist:
            return release_setlist_node(r);
         default:
            r.release();
            TRIEDENT_WARN("unhandled release node type!");
            assert(!"unhandled release node type");
      }
   }

}  // namespace arbtrie
