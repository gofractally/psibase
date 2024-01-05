#include <arbtrie/arbtrie.hpp>
#include <arbtrie/binary_node.hpp>
#include <arbtrie/database.hpp>
#include <arbtrie/debug.hpp>
#include <arbtrie/file_fwd.hpp>

#include <utility>

uint64_t bswap(uint64_t x);
void     print(arbtrie::session_rlock& state, arbtrie::object_id i, int depth);
namespace arbtrie
{
   void write_session::set_root(const root& r)
   {
      std::cerr << " set root segas lock\n";
      _segas.lock().get(r.id()).retain();
   }

   void        release_node(object_ref<node_header>& r);
   inline void release_node(object_ref<value_node>& r)
   {
      release_node(reinterpret_cast<object_ref<node_header>&>(r));
   }

   object_id upsert(object_ref<node_header>& root,
                    bool                     unique,
                    key_view                 key,
                    value_view               val,
                    int&                     old_size);

   object_id upsert_binary(object_ref<node_header>& root,
                           bool                     unique,
                           key_view                 key,
                           value_view               val,
                           int&                     old_size);

   object_id upsert_setlist(object_ref<node_header>& sln,
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
   void database::stop_compact_thread()
   {
      _sega.stop_compact_thread();
   }

   /*
   void read_session::release(object_id oid)
   {
      TRIEDENT_WARN("TODO");
   }
   */

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

   object_id make_binary(session_rlock& state, key_view key, value_view val)
   {
      auto asize = sizeof(binary_node) + binary_node::calc_key_val_pair_size(key, val);
      // auto asize = 4080; //sizeof(binary_node) + binary_node::calc_key_val_pair_size(key, val) + 4096;

      return state
          .alloc(asize, node_type::binary,
                 [&](node_header* node)
                 {
                    new (node) node_header(asize, node_type::binary, 1 /*num_branch*/, 0);
                    binary_node* bn = node->as<binary_node>();

                    bool can_inline = binary_node::can_inline(val);
                    auto kvs = 2 + key.size() + (can_inline ? val.size() : sizeof(object_id));

                    bn->_start_key_pos = kvs;

                    auto p            = bn->start_keys();
                    bn->key_offset(0) = bn->tail() - (char*)p;

                    auto kvp       = bn->get_key_val_ptr(0);
                    kvp->_key_size = key.size();
                    memcpy(kvp->key_ptr(), key.data(), key.size());

                    if (can_inline)
                    {
                       kvp->_val_size = val.size();
                       memcpy(kvp->val_ptr(), val.data(), val.size());
                    }
                    else
                    {
                       kvp->_val_size                = binary_node::value_node_flag;
                       *((object_id*)kvp->val_ptr()) = make_value(state, val);
                    }
                    assert(bn->validate());
                    assert(bn->get_key_val_ptr(0)->key() == key);
                 })
          .id();
   }

   object_id make_setlist_node(session_rlock& state,
                               uint16_t       nbranch,
                               key_view       cpre,
                               bool           has_eof,
                               auto           init)
   {
      auto asize = setlist_node::calc_expected_size(cpre.size(), nbranch, has_eof);
      return state
          .alloc(asize, node_type::setlist,
                 [&](node_header* node)
                 {
                    auto sln              = (setlist_node*)node;
                    sln->_has_eof_value   = has_eof;
                    sln->_num_branches    = nbranch;
                    sln->_prefix_len      = cpre.size();
                    sln->_prefix_truncate = 0;
                    sln->_spare_capacity  = 0;
                    assert(sln->check_size());
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
      const auto nb = bn->num_branches();
      for (int i = 0; i < nb; ++i)
      {
         if (auto vid = bn->get_key_val_ptr(i)->value_id())
         {
            state.get(*vid).retain();
         }
      }
   }

   template <typename T>
   object_ref<T> clone_node(object_ref<T>& r, const node_header* root)
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
      const auto nbranch = to - from;
      assert(nbranch > 0);
      assert(bn->validate());

      int32_t asize = sizeof(binary_node);
      asize += nbranch * (sizeof(uint16_t) + sizeof(binary_node::key_val_pair));  // offsets

      //    std::cerr << "clone binary range...\n";
      for (auto i = 0; i < nbranch; ++i)
      {
         auto kvp = bn->get_key_val_ptr(from + i);
         assert(kvp->value_size() > 0);  // TODO: remove
         asize += kvp->key_size() + kvp->value_size();
      }
      assert(asize > minus_prefix.size() * nbranch);
      asize -= minus_prefix.size() * nbranch;

      auto dsize = std::min(4096, 2 * asize);
      asize      = std::max(asize, dsize);

      auto init = [&](node_header* nnh)
      {
         binary_node* nn    = (binary_node*)nnh;
         nn->_num_branches  = nbranch;
         nn->_prefix_len    = 0;
         nn->_unused        = 0;
         nn->_start_key_pos = 0;

         for (int i = 0; i < nbranch; ++i)
         {
            auto fkvp  = bn->get_key_val_ptr(from + i);
            auto space = fkvp->key_size() - minus_prefix.size() + fkvp->value_size() + 2;
            nn->_start_key_pos += space;
            assert(nn->spare_capacity() >= 0);

            nn->key_offset(i) = nn->_start_key_pos;
            auto nnkvp        = nn->get_key_val_ptr(i);
            nnkvp->_key_size  = fkvp->key_size() - minus_prefix.size();
            nnkvp->_val_size  = fkvp->_val_size;

            memcpy(nnkvp->key_ptr(), fkvp->key_ptr() + minus_prefix.size(),
                   nnkvp->_key_size + nnkvp->value_size());
         }

         /*
         auto  nntail  = nn->tail();
         auto* key_pos = nn->start_keys();
         for (int i = 0; i < nbranch; ++i)
         {
            nn->key_offset(i)  = nntail - (char*)key_pos;
            auto fkvp          = bn->get_key_val_ptr(from + i);
            key_pos->_key_size = fkvp->key_size() - minus_prefix.size();
            key_pos->_val_size = fkvp->_val_size;

            auto next = key_pos->next();

            // use the delta in pointers to avoid duplicate work (branch) in calculating
            // the next() and calculating the bytes to be copied.
            memcpy(key_pos->key_ptr(), fkvp->key_ptr() + minus_prefix.size(),
                   (uint8_t*)next - key_pos->key_ptr());

            key_pos = next;
         }
         */
         assert(nn->validate());
      };
      return r.rlock().alloc(asize, node_type::binary, init).id();
   }

   object_id clone_setlist_add_eof(object_ref<node_header>& r,
                                   const setlist_node*      sl,
                                   object_id                eof_val,
                                   bool                     reuse_id)
   {
      TRIEDENT_WARN(__func__);
      assert(not sl->_has_eof_value);
      assert(sl->check_size());
      // auto asize = sl->size() + sizeof(object_id) - sl->_prefix_truncate;
      auto asize =
          setlist_node::calc_expected_size(sl->prefix_size(), sl->num_branches() + 1, true);

      auto init = [&](node_header* h)
      {
         auto sln              = (setlist_node*)h;
         sln->_spare_capacity  = 0;
         sln->_has_eof_value   = true;
         sln->_num_branches    = sl->_num_branches + 1;
         sln->_prefix_len      = sl->_prefix_len - sl->_prefix_truncate;
         sln->_prefix_truncate = 0;
         assert(sln->check_size());

         auto old_prefix = sl->get_prefix();
         memcpy(sln->prefix, old_prefix.data(), old_prefix.size());

         memcpy(sln->setlist(), sl->setlist(), sl->num_branches());
         sln->branches()[0] = eof_val;
         memcpy(sln->branches() + 1, sl->branches(), sl->num_branches() * sizeof(object_id));

         assert(sln->get_prefix() == sl->get_prefix());
         assert(sln->get_setlist() == sl->get_setlist());
      };
      if (reuse_id)
      {
         return r.rlock().realloc(r.id(), asize, node_type::setlist, init).id();
      }
      else
      {
         retain_children(r.rlock(), sl);
         return r.rlock().alloc(asize, node_type::setlist, init).id();
      }
   }

   object_id clone_setlist_add(bool                     reuse_id,
                               const setlist_node*      sl,
                               object_ref<node_header>& root,
                               char                     br,
                               object_id                val)
   {
      assert(not sl->get_branch(br));
      assert(sl->check_size());
      //auto asize = sl->size() + 1 + sizeof(object_id) - sl->_prefix_truncate;
      auto asize = setlist_node::calc_expected_size(sl->prefix_size(), sl->num_branches() + 1,
                                                    sl->_has_eof_value);

      auto init = [&](node_header* h)
      {
         auto sln              = (setlist_node*)h;
         sln->_has_eof_value   = sl->_has_eof_value;
         sln->_num_branches    = sl->_num_branches + 1;
         sln->_prefix_len      = sl->prefix_size();
         sln->_prefix_truncate = 0;
         sln->_spare_capacity  = 0;

         assert(sln->check_size());
         auto old_prefix = sl->get_prefix();
         memcpy(sln->prefix, old_prefix.data(), old_prefix.size());

         uint8_t* new_setlp = sln->setlist();

         const uint8_t* setlp = sl->setlist();
         const uint8_t* setle = setlp + sl->num_branches() - sl->has_eof_value();
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

         auto of             = sl->_has_eof_value + offset;
         sln->branches()[of] = val;

         memcpy(sln->branches() + of + 1, sl->branches() + of,
                (sl->num_branches() - of) * sizeof(object_id));

         assert((char*)(sln->branches() + of + 1) +
                    ((sl->num_branches() - of) * sizeof(object_id)) <=
                sln->tail());
         assert(sln->get_branch(br) and sln->get_branch(br) == val);
      };

      if (reuse_id)
      {
         return root.rlock().realloc(root.id(), asize, node_type::setlist, init).id();
      }
      else
      {
         retain_children(root.rlock(), sl);
         return root.rlock().alloc(asize, node_type::setlist, init).id();
      }
   }

   object_id binary_add(binary_node*             bn,
                        object_ref<node_header>& root,
                        key_view                 key,
                        value_view               val)
   {
      auto space_required = binary_node::space_required(key, val);
      assert(bn->spare_capacity() >= space_required);

      // find the index location
      auto lb = bn->lower_bound_idx(key);

      // move everything after it up by 2
      memmove(&bn->_key_offsets[lb + 1], &bn->_key_offsets[lb],
              sizeof(uint16_t) * (bn->_num_branches - lb));

      bn->_num_branches++;
      bn->_start_key_pos += space_required - 2;  // sub 2 for index
      // set the offset of the insert to the new start_key_pos
      bn->_key_offsets[lb] = bn->_start_key_pos;

      auto kvp       = bn->get_key_val_ptr(lb);
      kvp->_key_size = key.size();

      memcpy(kvp->key_ptr(), key.data(), key.size());

      if (binary_node::can_inline(val))
      {
         kvp->_val_size = val.size();
         memcpy(kvp->val_ptr(), val.data(), val.size());
      }
      else
      {
         kvp->_val_size   = binary_node::value_node_flag;
         *kvp->value_id() = make_value(root.rlock(), val);
      }

      assert(bn->validate());

      return root.id();
   }

   object_id clone_binary_add(bool                     reuse_id,
                              const binary_node*       bn,
                              object_ref<node_header>& root,
                              key_view                 key,
                              value_view               val)
   {
      assert(bn->validate());
      auto asize = bn->size();

      auto space_required = binary_node::space_required(key, val);
      if (bn->spare_capacity() < space_required)
         asize += space_required - bn->spare_capacity();

      auto dsize = std::min(uint32_t(4 * 1024), bn->size() * 2);
      asize      = std::max(asize, dsize);

      auto init = [&](node_header* h)
      {
         auto t            = h->as<binary_node>();
         t->_prefix_len    = bn->_prefix_len;
         t->_num_branches  = bn->num_branches() + 1;
         t->_start_key_pos = bn->_start_key_pos;

         // copy all the existing key/value data
         memcpy(t->start_keys(), bn->start_keys(), t->_start_key_pos);

         // find the index location
         auto lb = bn->lower_bound_idx(key);

         // insert the new offset
         memcpy(t->key_offsets(), bn->key_offsets(), lb * sizeof(uint16_t));

         t->_start_key_pos += space_required - 2;
         t->_key_offsets[lb] = t->_start_key_pos;
         memcpy(&t->_key_offsets[lb + 1], &bn->_key_offsets[lb],
                sizeof(uint16_t) * (bn->num_branches() - lb));

         // insert the new key
         auto start_key       = t->get_key_val_ptr(lb);
         start_key->_key_size = key.size();
         memcpy(start_key->key_ptr(), key.data(), key.size());

         if (binary_node::can_inline(val))
         {
            start_key->_val_size = val.size();
            memcpy(start_key->val_ptr(), val.data(), val.size());
         }
         else
         {
            start_key->_val_size   = binary_node::value_node_flag;
            *start_key->value_id() = make_value(root.rlock(), val);
         }
         assert(t->get_key_val_ptr(lb)->key() == key);
         assert(bn->validate());
         assert(t->validate());
         assert(t->spare_capacity() >= 0);
      };
      //     std:: cerr << "reuse: " << reuse_id <<" id: " << bn->id()<<" == " << root.id()<<"\n";

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

   int write_session::upsert(node_handle& r, key_view key, value_view val)
   {
      auto state = _segas.lock();
      int  old_size = -1;

      r.give( upsert(state, r.take(), key, val, old_size));

      return old_size;
   }

   object_id write_session::upsert(session_rlock& state,
                                   object_id      root,
                                   key_view       key,
                                   value_view     val,
                                   int&           old_size)
   {
      if (not root) [[unlikely]]
         return make_binary(state, key, val);

      auto oref = state.get(root);
      return arbtrie::upsert(oref, oref.ref() == 1, key, val, old_size);
   }

   /**
    *  Inserts key under root, if necessary 
    */
   object_id upsert(object_ref<node_header>& root,
                    bool                     unique,
                    key_view                 key,
                    value_view               val,
                    int&                     old_size)
   {
      unique &= root.ref() == 1;
      object_id result;
      switch (root.type())
      {
         case node_type::binary:
            result = upsert_binary(root, unique, key, val, old_size);
            break;
         case node_type::setlist:
            result = upsert_setlist(root, unique, key, val, old_size);
            break;
         default:
            TRIEDENT_WARN("unhandled type in upsert: ", node_type_names[root.type()]);
            assert(!"unhandled type in upsert");
      }
      //TRIEDENT_WARN( " rootid: ", root.id(), "  return: ", result );
      assert(unique or (result != root.id()));
      if( result != root.id() )  {
       //  TRIEDENT_WARN( "release old root because it was unique" );
         release_node( root );
      }
      return result;
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
            auto mod_lock = root.modify();
            auto mvn      = mod_lock.as<value_node>();
            memcpy(mvn->body(), val.data(), val.size());
            return root.id();
         }
         return remake_value(root, vn, val);
      }
      return make_value(root.rlock(), val);
   }

   //================================================
   //  refactor
   //
   //  Given a binary node, if unique, turn it into a radix node,
   //  else return a clone
   //=================================================
   object_ref<node_header> refactor(object_ref<node_header>& r,
                                    const binary_node*       root,
                                    bool                     unique)
   {
      bool reuse_id = unique;

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

      auto asize = setlist_node::calc_expected_size(cpre.size(), nbranch, has_eof_value);
      //  auto asize = sizeof(node_header) + 1 + cpre.size() + nbranch - 1 +
      //               has_eof_value * sizeof(object_id) + nbranch * (sizeof(object_id));
      auto init = [&](node_header* h)
      {
         h->_num_branches      = nbranch;
         auto sln              = (setlist_node*)h;
         sln->_has_eof_value   = has_eof_value;
         sln->_prefix_len      = cpre.size();
         sln->_prefix_truncate = 0;
         sln->_spare_capacity  = 0;
         memcpy(sln->prefix, cpre.data(), cpre.size());

         if (has_eof_value)
         {
            auto ptr = root->get_key_val_ptr(0);
            if (auto val_id = ptr->value_id())
            {
               sln->set_eof_branch(*val_id);
            }
            else
            {
               sln->set_eof_branch(make_value(r.rlock(), ptr->value()));
            }
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
         // no need to retain children because we have reused the id and
         // retainership of all children passed to the new nodes
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
      auto& state = sln.rlock();
      assert(sln.ref());

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
                  auto mroot    = sln.as<setlist_node>();

                  auto ob = mroot->get_eof_branch();
                  assert(ob and "root->has_eof_value() returned true!");

                  auto eof_oref = state.get<value_node>(*ob);
                  auto new_id   = upsert_value(eof_oref, unique, val, old_size);
                  if( new_id != *ob ) {
                     auto mod_lock = sln.modify();
                     *(mod_lock.as<setlist_node>()->get_eof_branch()) = new_id;
                  }

                  if (*ob != eof_oref.id())
                  {
                     release_node(eof_oref);
                  }
                  return sln.id();
               }
               else
               {
                  auto cl = clone_node(sln, root);
                  retain_children(state, root);
                  auto result = upsert_setlist(cl, true, key, val, old_size);
                  assert(result != sln.id());  // because not unique
                  return result;
               }
            }
            else
            {
               if (not unique)
               {
                  // clone is making a copy, otherwise clone is just updating
                  // the existing object
                  TRIEDENT_WARN(__func__, "eof retain children");
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

               if( not unique ) {
                  auto cl = clone_node(sln, root);
                  retain_children(state, root);
                  auto new_br = upsert(old_br, unique, key.substr(cpre.size() + 1), val, old_size);
                  if( br != new_br )
                     cl.modify().as<setlist_node>()->set_branch(bidx, new_br);
                  return cl.id();
               }
               else {
                  auto new_br = upsert(old_br, unique, key.substr(cpre.size() + 1), val, old_size);
                  if( br != new_br )
                     sln.modify().as<setlist_node>()->set_branch(bidx, new_br);
                  return sln.id();
               }
            }
            else
            {
               return clone_setlist_add(unique, root, sln, bidx,
                                        make_binary(state, key.substr(cpre.size() + 1), val));
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

         //TRIEDENT_WARN( "key does not share same prefix: ", sln.id() );
         auto child_id = sln.id();
         if (unique)
         {
            // because we are not returning sln.id() the caller will
            // end up releasing it... but we must moved it to a lower level
            // in the tree and therefore need to hold on to it.
            sln.retain();
            sln.modify().as<setlist_node>()->set_prefix(rootpre.substr(cpre.size() + 1));
         }
         else
         {
            // TODO: trim the extra space from the prefix
            //auto cl = clone_node( sln, root );
            auto cl = clone_node(sln, root);
            assert(cl.ref() == 1);

            auto clsl = cl.as<setlist_node>();
            retain_children(state, clsl);
            cl.modify().as<setlist_node>()->set_prefix(rootpre.substr(cpre.size() + 1));
            child_id = cl.id();
            // TODO - for now we are only testing modify in place so this shouldn't be hit
             TRIEDENT_WARN("Unable to modify in place, we must clone root to truncate prefix");
         }

         bool has_eof_value = key.size() == cpre.size();
         // key is the eof value of

         if (not has_eof_value)
         {
            auto abx = make_binary(state, key.substr(cpre.size() + 1), val);
            auto result = make_setlist_node(state, 2, cpre, has_eof_value,
                                     [&](setlist_node* new_sln)
                                     {
                                        auto order = key[cpre.size()] > rootpre[cpre.size()];
                                        new_sln->set_index(!order, key[cpre.size()], abx);
                                        new_sln->set_index(order, rootpre[cpre.size()], child_id);
                                     });
            return result;
         }
         else  // has eof_value
         {
//            TRIEDENT_WARN( "HAS EOF BRANCH" );
            return make_setlist_node(state, 2, cpre, has_eof_value,
                                     [&](setlist_node* new_sln)
                                     {
                                        new_sln->set_eof_branch(make_value(state, val));
                                        new_sln->set_index(0, rootpre[cpre.size()], child_id);
                                     });
         }
      }
      TRIEDENT_WARN("unreachable was reached");
      abort();
   }

   // there are several possible cases:
   //    1. the existing value is not inlined and the new value will not be inlined
   //    2. the existing value is not inlined and the new value could be inlined
   //         - we could just update the non-inlined value (likely faster)
   //         - or we could keep things canonical and reallocate binary node
   //    3. the existing value is inlined and the new value is not inlined
   //    4. the existing value is inlined and the new value is inined
   //         - they could be the same size
   //         - they could be different sizes
   //
   //  two cases allow update in place
   //    - old and new are both the same size and inlined
   //    - old and new are both not inlined
   object_id update_binary(object_ref<node_header>& root,
                           binary_node*             bn,
                           bool                     unique,
                           int                      key_index,
                           value_view               val,
                           int&                     old_size)
   {
      TRIEDENT_WARN("value: ", val);
      assert(!"update not implemented yet");
      // TODO: update not working yet
      old_size = val.size();
      return root.id();
#if 0
      assert(key_idx >= 0 and key_idx < bn->num_branches());

      bool can_il = binary_node::can_inline(val);

      auto v = bn->get_key_ptr(key_idx);
      if (unique) // shortcut cases
      {
         if (v->is_value_node() and not can_il )
         {
            auto new_val_id = upsert_value(*vid, unique, val, old_size);
            if (new_val_id == *vid)
               return root.id();  // nothing changed in this node

            release_node(root.rlock().get(*vid));

            {  // TODO: lock only if node is not safely in alloc segment
               std::unique_lock lock(root.get_mutex());
               *vid = new_val_id;
            }
            return root.id();
         }
         else if (v->value_size() == val.size())
         {
            old_size = val.size();
            // TODO: lock, only if node is not safely in alloc segment
            memcpy(v->val_ptr(), val.data(), val.size());
            return root.id();
         }
      }
      return clone_binary_resize( root, bn, key_index, val );

      //  two cases allow update in place if we just cloned to make unique
      //    - old and new are both the same size and inlined
      //    - old and new are both not inlined
      if ((can_il and not v->is_value_node() and val.size() == v->_val_size) or
          (not can_il and v->is_value_node())

      )
      {
         auto nroot = root.clone(bn);
         retain_children(state, bn);
         return update_binary(nroot, nroot.as<binary_node>(), true, key_index, val, old_size);
      }
      if (auto vid = v->value_id())
      {
         else
         {
            auto nroot = root.clone(bn);
            retain_children(state, bn);

            bn                                 = nroot.as<binary_node>();
            *bn->find_key_val(key)->value_id() = new_val_id;
            release_node(state.get(*vid));
            return nroot.id();
         }
      }

      // since the ID of the value changed, we have to update this
      // node which will involve cloning if not unique
      if (new_val_id != *v)
      {
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
#endif

      // if same size, clone then recall with unique
   }

   object_id upsert_binary(object_ref<node_header>& root,
                           bool                     unique,
                           key_view                 key,
                           value_view               val,
                           int&                     old_size)
   {
      //TRIEDENT_DEBUG( root.id() );

      auto  bn      = root.as<binary_node>();
      auto  key_idx = bn->find_key_idx(key);
      if (-1 == key_idx)  // then insert a new value
      {
         auto space_req = binary_node::calc_key_val_pair_size(key, val);
         if (unique and space_req < bn->spare_capacity())
         {
            auto mod_lock = root.modify();
            return binary_add(mod_lock.as<binary_node>(), root, key, val);
         }
         if (bn->size() - bn->spare_capacity() + space_req > 4096)
         {
            // TODO: maybe refactor to setlist if size would be too big
            auto rid = refactor(root, bn, unique);

            assert((unique and (rid.id() == root.id())) or
                   ((not unique) and (rid.id() != root.id())));

            // if it wasn't unique before and the id changed then
            // it has become unique. If it was unique before, then
            // it remains unique now.

            return upsert(rid, unique |= rid.id() != root.id(), key, val, old_size);
         }
         return clone_binary_add(unique, bn, root, key, val);
      }
      assert(bn->get_key(bn->find_key_idx(key)) == key);
      throw std::runtime_error("not implimented yet");
      //return update_binary(root, bn, unique, key_idx, val, old_size);
   }



   void release_binary_node(object_ref<node_header>& n)
   {
      auto&      state = n.rlock();
      const auto bn    = n.as<binary_node>();
      if (n.release())
      {
        // TRIEDENT_WARN( "      releasing binary children" );
         const auto nb = bn->num_branches();
         for (int i = 0; i < nb; ++i)
         {
            if (auto vid = bn->get_key_val_ptr(i)->value_id())
            {
               auto vn = state.get(*vid);
               release_node(vn);
            }
         }
      }
   }
   void release_setlist_node(object_ref<node_header>& n)
   {
      auto&      state = n.rlock();
      const auto sln   = n.as<setlist_node>();
      if (n.release())
      {
        // TRIEDENT_WARN( "     releasing " , sln->num_branches() ," setlist children" );
         auto pos = sln->branches();
         auto end = pos + sln->num_branches();
         while (pos != end)
         {
            auto nr = state.get(*pos);
            release_node(nr);
            ++pos;
         }
        // TRIEDENT_WARN( "     ^^^^^^^^^^^^^^^^^^^^" );
      }
   }
   void release_node(object_ref<node_header>& r)
   {
      // TODO: dec ref count before switching to release data based on type
      //      std::cout << "release node: " << r.id() <<" type: " << node_type_names[r.type()] <<"\n";
      switch (r.type())
      {
         case node_type::freelist:
            TRIEDENT_WARN("double free detected! id: ", r.id());
            abort();
            assert(!"attempting to release id already in free list");
            return;
         case node_type::value:
            r.release();
            return;
         case node_type::binary:
            return release_binary_node(r);
         case node_type::setlist:
            return release_setlist_node(r);
         default:
            TRIEDENT_WARN("unhandled release node type!");
            assert(!"unhandled release node type");
      }
   }

   bool validate(session_rlock& state, object_id id);
   bool validate(session_rlock& state, const binary_node* bn)
   {
      assert(bn->num_branches() <= 511);
      if (bn->num_branches() > 257)
         return false;
      for (int i = 0; i < bn->num_branches(); ++i)
      {
         auto kvp = bn->get_key_val_ptr(i);
         auto oid = kvp->value_id();
         if (oid)
         {
            if (not validate(state, *oid))
               return false;
         }
      }
      return true;
   }

   bool validate(session_rlock& state, const setlist_node* sln)
   {
      assert(sln->num_branches() <= 257);
      if (sln->num_branches() > 257)
         return false;

      for (int i = 0; i < sln->num_branches()-sln->has_eof_value(); ++i)
      {
         auto bid = sln->get_by_index(i);
         if (not validate(state, bid.second))
            return false;
      }
      return true;
   }

   bool validate(session_rlock& state, object_id id)
   {
      assert(id.id != 0);
      if (id.id == 0)
         return false;

      auto r = state.get(id);

      if (r.ref() == 0)
      {
         assert(!"object with 0 ref found");
         return false;
      }

      switch (r.type())
      {
         case node_type::value:
            return true;
         case node_type::binary:
            return validate(state, r.as<binary_node>());
         case node_type::setlist:
            return validate(state, r.as<setlist_node>());
         default:
            TRIEDENT_WARN("unknown type: ", r.type());
            return false;
      }
   }
   bool read_session::validate(const root& r)
   {
      auto state = _segas.lock();
      return arbtrie::validate(state, r.id());
   }

}  // namespace arbtrie

