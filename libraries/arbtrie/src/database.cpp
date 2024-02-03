#include <arbtrie/arbtrie.hpp>
#include <arbtrie/database.hpp>
#include <arbtrie/debug.hpp>
#include <arbtrie/file_fwd.hpp>

#include <utility>

namespace arbtrie
{

   template <typename NodeType>
   object_ref<NodeType> make(id_region           reg,
                             session_rlock&      state,
                             const clone_config& cfg,
                             auto                uinit)
   {
      auto asize     = NodeType::alloc_size(cfg);
      auto make_init = [&](node_header* cl)
      {
         assert(cl->_nsize == asize);
         uinit(new (cl) NodeType(cl->_nsize, cl->address(), cfg));
      };
      return state.alloc(reg, asize, NodeType::type, make_init);
   }
   template <typename NodeType>
   object_ref<NodeType> remake(session_rlock&      state,
                               fast_meta_address   reuseid,
                               const clone_config& cfg,
                               auto                uinit)
   {
      auto asize     = NodeType::alloc_size(cfg);
      auto make_init = [&](node_header* cl)
      { uinit(new (cl) NodeType(asize, cl->address(), cfg)); };
      return state.realloc(reuseid, asize, NodeType::type, make_init);
   }

   //===============================================
   // clone
   //  - makes a copy of r according to the config which
   //  informs the allocator how much extra space needs to
   //  be allocated.
   //  - src must equal r.as<NodeType>(), it is passed separately
   //    to avoid another atomic load.
   //  - the default configuration is a simple memcpy
   //  - if mode.is_shared() any referenced IDs will
   //    be retained and a new ID will be allocated
   //  - if mode.is_unique() then this is a effectively
   //  a realloc and the cloned node will replace the src.
   //
   //  - space will be allocated according to NodeType::alloc_size( src, cfg, CArgs...)
   //  - the constructor NodeType::NodeType( src, cfg, CArgs... ) is called
   //  - after construction, uinit(NodeType*) is called
   //
   //  uinit( new (alloc(NodeType::alloc_size(src,cfg,cargs...))) NodeType( src,cfg,cargs ) );
   //
   //===============================================
   template <upsert_mode mode, typename ORefType, typename NodeType, typename... CArgs>
   object_ref<NodeType> clone_impl(id_region                      reg,
                                   object_ref<ORefType>&          r,
                                   const NodeType*                src,
                                   const clone_config&            cfg,
                                   std::invocable<NodeType*> auto uinit,
                                   CArgs&&... cargs)
   {
      assert(r.type() == src->get_type());
      // assert(r.template as<NodeType>() == src);

      if constexpr (mode.is_shared())
         retain_children(r.rlock(), src);

      auto asize = NodeType::alloc_size(src, cfg, cargs...);

      auto copy_init = [&](node_header* cl)
      { uinit(new (cl) NodeType(asize, cl->address(), src, cfg, std::forward<CArgs>(cargs)...)); };

      if constexpr (mode.is_unique() and mode.is_same_region())
      {
         return r.rlock().realloc(r.address(), asize, src->get_type(), copy_init);
      }
      return r.rlock().alloc(reg, asize, src->get_type(), copy_init);
   }

   template <upsert_mode mode, typename ORefType, typename NodeType>
   object_ref<NodeType> clone(
       object_ref<ORefType>&          r,
       const NodeType*                src,
       const clone_config&            cfg   = {},
       std::invocable<NodeType*> auto uinit = [](NodeType*) {})
   {
      return clone_impl<mode.make_same_region()>(r.address().region, r, src, cfg,
                                                 std::forward<decltype(uinit)>(uinit));
   }

   template <upsert_mode mode, typename ORefType, typename NodeType>
   object_ref<NodeType> clone(
       id_region                      reg,
       object_ref<ORefType>&          r,
       const NodeType*                src,
       const clone_config&            cfg   = {},
       std::invocable<NodeType*> auto uinit = [](NodeType*) {})
   {
      return clone_impl<mode>(reg, r, src, cfg, std::forward<decltype(uinit)>(uinit));
   }

   template <upsert_mode mode, typename ORefType, typename NodeType, typename... CArgs>
   object_ref<NodeType> clone(object_ref<ORefType>&          r,
                              const NodeType*                src,
                              const clone_config&            cfg,
                              std::invocable<NodeType*> auto uinit,
                              CArgs&&... cargs)
   {
      return clone_impl<mode.make_same_region()>(r.address()._region, r, src, cfg,
                                                 std::forward<decltype(uinit)>(uinit),
                                                 std::forward<CArgs>(cargs)...);
   }
   template <upsert_mode mode, typename ORefType, typename NodeType, typename... CArgs>
   object_ref<NodeType> clone(id_region                      reg,
                              object_ref<ORefType>&          r,
                              const NodeType*                src,
                              const clone_config&            cfg,
                              std::invocable<NodeType*> auto uinit,
                              CArgs&&... cargs)
   {
      return clone_impl<mode>(reg, r, src, cfg, std::forward<decltype(uinit)>(uinit),
                              std::forward<CArgs>(cargs)...);
   }

   template <upsert_mode mode, typename ORefType, typename NodeType, typename... CArgs>
   object_ref<NodeType> clone(object_ref<ORefType>& r,
                              const NodeType*       src,
                              const clone_config&   cfg,
                              CArgs&&... cargs)
   {
      return clone_impl<mode.make_same_region()>(
          r.address().region, r, src, cfg, [](auto) {}, std::forward<CArgs>(cargs)...);
   }

   template <upsert_mode mode, typename ORefType, typename NodeType, typename... CArgs>
   object_ref<NodeType> clone(id_region             reg,
                              object_ref<ORefType>& r,
                              const NodeType*       src,
                              const clone_config&   cfg,
                              CArgs&&... cargs)
   {
      return clone_impl<mode>(
          reg, r, src, cfg, [](auto) {}, std::forward<CArgs>(cargs)...);
   }

   uint32_t node_header::calculate_checksum() const
   {
      return cast_and_call(this, [&](const auto* t) { return t->calculate_checksum(); });
   }

   node_handle write_session::set_root(node_handle r)
   {
      uint64_t old_r;
      uint64_t new_r = r.address().to_int();
      {  // lock scope
         std::unique_lock lock(_db._root_change_mutex);
         old_r = _db._dbm->top_root.exchange(new_r, std::memory_order_relaxed);
      }
      return r.give(fast_meta_address::from_int(old_r));
   }
   node_handle read_session::get_root()
   {
      std::unique_lock lock(_db._root_change_mutex);
      return node_handle(
          *this, fast_meta_address::from_int(_db._dbm->top_root.load(std::memory_order_relaxed)));
   }

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

   void database::print_region_stats()
   {
      _sega.print_region_stats();
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

   write_session database::start_write_session()
   {
      //  assert(not _have_write_session);
      _have_write_session = true;
      return write_session(*this);
   }

   template <typename NodeType>
   void retain_children(session_rlock& state, const NodeType* in)
   {
      in->visit_branches([&](auto bid) { state.get(bid).retain(); });
   }

   fast_meta_address make_value(id_region reg, session_rlock& state, const value_type& val)
   {
      if (val.is_object_id())
         return val.id();
      auto v = val.view();
      return state
          .alloc(reg, sizeof(node_header) + v.size(), node_type::value,
                 [&](node_header* node)
                 {
                    node->set_type(node_type::value);
                    memcpy(node->body(), v.data(), v.size());
                 })
          .address();
   }

   // allocates new data but reuses the existing id
   fast_meta_address remake_value(object_ref<node_header>& oref,
                                  const value_node*        vn,
                                  value_view               new_val)
   {
      assert(oref.ref() == 1);
      std::cerr << "TODO: remake_value()  new: '" << new_val << "'  old: '" << vn->value() << "'\n";
      return make_value(oref.address().region, oref.rlock(), new_val);
      // reallocate the value and update where the oref points
   }

   int write_session::upsert(node_handle& r, key_view key, value_view val)
   {
      auto state = _segas.lock();

      r.give(upsert(state, r.take(), key, val));

      return 0;
   }
   int write_session::insert(node_handle& r, key_view key, value_view val)
   {
      auto state = _segas.lock();

      r.give(insert(state, r.take(), key, val));

      return 0;
   }
   int write_session::update(node_handle& r, key_view key, value_view val)
   {
      auto state = _segas.lock();

      r.give(update(state, r.take(), key, val));

      return 0;
   }
   int write_session::remove(node_handle& r, key_view key)
   {
      auto state = _segas.lock();
      r.give(remove(state, r.take(), key));
      return 0;
   }

   fast_meta_address write_session::upsert(session_rlock&    state,
                                           fast_meta_address root,
                                           key_view          key,
                                           const value_type& val)
   {
      if (not root) [[unlikely]]
         return make_binary(state.get_new_region(), state, key, val);
      return upsert<upsert_mode::unique_upsert>(state.get(root), key, val);
   }
   fast_meta_address write_session::insert(session_rlock&    state,
                                           fast_meta_address root,
                                           key_view          key,
                                           const value_type& val)
   {
      if (not root) [[unlikely]]
         return make_binary(state.get_new_region(), state, key, val);
      return upsert<upsert_mode::unique_insert>(state.get(root), key, val);
   }
   fast_meta_address write_session::update(session_rlock&    state,
                                           fast_meta_address root,
                                           key_view          key,
                                           const value_type& val)
   {
      if (not root) [[unlikely]]
         throw std::runtime_error("cannot update key that doesn't exist");
      return upsert<upsert_mode::unique_update>(state.get(root), key, val);
   }
   fast_meta_address write_session::remove(session_rlock&    state,
                                           fast_meta_address root,
                                           key_view          key)
   {
      if (not root) [[unlikely]]
         throw std::runtime_error("cannot remove key that doesn't exist");
      return upsert<upsert_mode::unique_remove>(state.get(root), key, value_type::remove());
   }

   template <upsert_mode mode, typename NodeType>
   fast_meta_address write_session::upsert(object_ref<NodeType>&& root,
                                           key_view               key,
                                           const value_type&      val)
   {
      return upsert<mode>(root, key, val);
   }
   /**
    *  Inserts key under root, if necessary 
    */
   template <upsert_mode mode, typename NodeType>
   fast_meta_address write_session::upsert(object_ref<NodeType>& root,
                                           key_view              key,
                                           const value_type&     val)
   {
      if constexpr (mode.is_unique())
      {
         if (root.ref() != 1)
         {
            return upsert<mode.make_shared()>(root, key, val);
         }
      }
      static_assert(std::is_same_v<NodeType, node_header>);

      fast_meta_address result;
      switch (root.type())
      {
         case node_type::binary:
            result = upsert_binary<mode>(root, key, val);
            break;
         case node_type::setlist:
            result = upsert_inner<mode, setlist_node>(root, key, val);
            break;
    //     case node_type::bitset:
     //       result = upsert_inner<mode, bitset_node>(root, key, val);
      //      break;
         case node_type::full:
            result = upsert_inner<mode, full_node>(root, key, val);
            break;
         default:
            throw std::runtime_error("unhandled type in upsert");
      }
      if constexpr (mode.is_remove())
      {
         if (result != root.address())
            release_node(root);
      } 
      else if constexpr (mode.is_shared())
      {
         assert((result != root.address()));
         release_node(root);
      }
      
      return result;
   }

   template <upsert_mode mode, typename NodeType>
   fast_meta_address upsert(object_ref<NodeType>&& root, key_view key, const value_type& val)
   {
      return upsert<mode>(root, key, val);
   }

   //================================
   //  upsert_value
   //================================
   template <upsert_mode mode>
   fast_meta_address write_session::upsert_value(object_ref<node_header>& root,
                                                 const value_type&        val)
   {
      if (val.is_object_id())
         return val.id();
      if constexpr (mode.is_shared())
         return make_value(root.address().region, root.rlock(), val.view());
      else if constexpr (mode.is_unique())
      {
         if (root.ref() != 1)
            return make_value(root.address().region, root.rlock(), val.view());

         auto vn = root.as<value_node>();
         if (vn->value_size() == val.size())
         {
            auto mod_lock = root.modify();
            auto mvn      = mod_lock.as<value_node>();
            auto vv       = val.view();
            memcpy(mvn->body(), vv.data(), vv.size());
            return root.address();
         }
         return remake_value(root, vn, val.view());
      }
   }

   fast_meta_address clone_binary_range(id_region                reg,
                                        object_ref<node_header>& r,
                                        const binary_node*       src,
                                        key_view                 minus_prefix,
                                        int                      from,
                                        int                      to)
   {
      auto nbranch       = to - from;
      int  total_kv_size = 0;
      for (auto i = from; i < to; ++i)
      {
         auto kvp = src->get_key_val_ptr(i);
         total_kv_size += kvp->total_size();
      }
      assert(total_kv_size > minus_prefix.size() * nbranch);
      total_kv_size -= minus_prefix.size() * nbranch;

      auto init_binary = [&](binary_node* bn)
      {
         for (int i = from; i < to; ++i)
         {
            auto kvp  = src->get_key_val_ptr(i);
            auto nkey = kvp->key().substr(minus_prefix.size());
            auto nkh  = binary_node::key_header_hash(binary_node::key_hash(nkey));

            bn->append(kvp, minus_prefix.size(), nkh, src->value_hashes()[i],
                       src->key_offsets()[i].val_type());
         }
      };
      return make<binary_node>(reg, r.rlock(), {.branch_cap = nbranch, .data_cap = total_kv_size},
                               init_binary)
          .address();
   }

   //================================================
   //  refactor
   //
   //  Given a binary node, if unique, turn it into a radix node,
   //  else return a clone
   //=================================================
   template <upsert_mode mode>
   object_ref<node_header> refactor(object_ref<node_header>& r, const binary_node* root)
   {
      //  TRIEDENT_WARN("REFACTOR! ", r.address());
      assert(root->num_branches() > 1);
      auto first_key     = root->get_key(0);
      auto last_key      = root->get_key(root->num_branches() - 1);
      auto cpre          = common_prefix(first_key, last_key);
      bool has_eof_value = first_key.size() == cpre.size();

      int_fast16_t nbranch = has_eof_value;
      int_fast16_t freq_table[256];
      memset(freq_table, 0, sizeof(freq_table));

      const auto numb = root->num_branches();
      for (uint32_t i = has_eof_value; i < numb; ++i)
      {
         auto k = root->get_key(i);
         assert(k.size() > cpre.size());
         uint8_t f = k[cpre.size()];
         nbranch += freq_table[f] == 0;
         freq_table[f]++;
      }

      auto              bregion = r.rlock().get_new_region();
      fast_meta_address eof_val;
      if (has_eof_value) [[unlikely]]
         eof_val = root->is_obj_id(0)
                       ? root->get_key_val_ptr(0)->value_id()
                       : make_value(bregion, r.rlock(), root->get_key_val_ptr(0)->value());

      std::pair<uint8_t, int> branches[nbranch - has_eof_value];
      auto*                   next_branch = branches;
      for (int from = has_eof_value; from < numb;)
      {
         const auto    k    = root->get_key(from);
         const uint8_t byte = k[cpre.size()];
         const int     to   = from + freq_table[byte];

         auto new_child =
             clone_binary_range(bregion, r, root, k.substr(0, cpre.size() + 1), from, to);
         from = to;

         assert(next_branch < branches + nbranch);
         *next_branch = {byte, new_child.index};
         ++next_branch;
         //fn->add_branch(uint16_t(byte) + 1, new_child);
      }
      //TRIEDENT_WARN( "next - start: ", next_branch - branches, "  nb: ", nbranch );

      if (nbranch > 128)
      {
         //     TRIEDENT_WARN("REFACTOR TO FULL");
         auto init_full = [&](full_node* fn)
         {
            fn->set_branch_region(bregion);
            fn->set_eof(eof_val);
            for (auto& p : branches)
               fn->add_branch(branch_index_type(p.first) + 1, fast_meta_address(bregion, p.second));
         };
         if constexpr (mode.is_unique())
         {
            return remake<full_node>(r.rlock(), root->address(), {.set_prefix = cpre}, init_full);
         }
         else
         {
            retain_children(r.rlock(), root);
            return make<full_node>(r.address().region, r.rlock(), {.set_prefix = cpre}, init_full);
         }
      }

      auto init_setlist = [&](setlist_node* sl)
      {
         //      TRIEDENT_WARN("REFACTOR TO SETLIST");
         sl->set_branch_region(bregion);
         assert(sl->_num_branches == 0);
         assert(sl->branch_capacity() >= nbranch - has_eof_value);

         sl->_num_branches = nbranch - has_eof_value;
         sl->set_eof(eof_val);

         int nb = sl->_num_branches;
         for (int i = 0; i < nb; ++i)
         {
            sl->set_index(i, branches[i].first, fast_meta_address(bregion, branches[i].second));
         }
         assert(sl->get_setlist_size() == nb);

         assert(sl->validate());
      };

      if constexpr (mode.is_unique())
      {
         return remake<setlist_node>(r.rlock(), root->address(),
                                     {.branch_cap = nbranch, .set_prefix = cpre}, init_setlist);
      }
      else
      {
         retain_children(r.rlock(), root);
         return make<setlist_node>(r.address().region, r.rlock(),
                                   {.branch_cap = nbranch, .set_prefix = cpre}, init_setlist);
      }
   }
   template <upsert_mode mode, typename NodeType>
   object_ref<full_node> refactor_to_full(object_ref<node_header>& r,
                                          const NodeType*          src,
                                          auto                     init)
   {
      auto init_fn = [&](full_node* fn)
      {
         //      fn->set_branch_region(r.rlock().get_new_region());
         fn->set_branch_region(src->branch_region());
         src->visit_branches_with_br(
             [&](short br, fast_meta_address oid)
             {
                fn->add_branch(br, oid);
                if constexpr (mode.is_shared())
                   r.rlock().get(oid).retain();
             });
         init(fn);
         assert(fn->num_branches() >= full_node_threshold);
      };
      if constexpr (mode.is_unique())
         return remake<full_node>(r.rlock(), r.address(), {.set_prefix = src->get_prefix()},
                                  init_fn);
      else
         return make<full_node>(r.address().region, r.rlock(), {.set_prefix = src->get_prefix()},
                                init_fn);
   }

   //=======================================
   // upsert
   //  - a templated upsert that works for all inner node types, but
   //  not binary_node or value_node
   //  - assumes nodes impliment the following api:
   //
   //    init( node_header* copy, clone_config )
   //    set_branch( index, id )
   //    add_branch( index, id )
   //    can_add_branch( index ) -> bool
   //    get_branch( index ) -> id
   //    get_prefix()
   //    visit_branches(auto)
   //    num_branches()
   //
   //  - returns the new ID for r if one was required, if it
   //  was able to modify in place then it will return the same
   //  id.
   //
   //  - mode tracks whether or not it is possible to modify in place
   //
   //========================================
   template <upsert_mode mode, typename NodeType>
   fast_meta_address write_session::upsert_inner(object_ref<node_header>& r,
                                                 key_view                 key,
                                                 const value_type&        val)
   {
      auto& state = r.rlock();
      auto  fn    = r.as<NodeType>();

      auto rootpre = fn->get_prefix();
      auto cpre    = common_prefix(rootpre, key);

      if (cpre.size() == rootpre.size()) [[likely]]
      {  // then recurse into this node

         // on any given node there is a 256/257 chance this is true
         // on any given path this will be true for all parent nodes
         if (cpre.size() < key.size()) [[likely]]
         {
            const auto bidx = char_to_branch(key[cpre.size()]);
            auto       br   = fn->get_branch(bidx);
            if (br)
            {  // existing branch
               //      TRIEDENT_WARN( "upserting into existing branch: ", br, " with ref: ",
               //                    state.get(br).ref() );
               auto brn = state.get(br);
               if constexpr (mode.is_unique())
               {
                  auto new_br = upsert<mode>(brn, key.substr(cpre.size() + 1), val);
                  if constexpr (mode.is_remove())
                  {
                     if (not new_br)
                     {
                        r.modify().as<NodeType>()->remove_branch(bidx);
                        if (fn->num_branches() + fn->has_eof_value() > 0)
                        {
                           //     TRIEDENT_DEBUG( "modify()->remove_branch( ", char(bidx-1), ") " );
                           return r.address();
                        }
                        else
                        {
                           //    TRIEDENT_DEBUG( "return null after removing all" );
                           return fast_meta_address();
                        }
                     }
                     if (br != new_br)
                        r.modify().as<NodeType>()->set_branch(bidx, new_br);
                     return r.address();
                  }
                  else
                  {
                     if (br != new_br)
                        r.modify().as<NodeType>()->set_branch(bidx, new_br);
                     return r.address();
                  }
               }
               else  // shared_node
               {     // if shared and we inserted then it had better be different!
                  if constexpr (mode.is_remove())
                  {
                 //    TRIEDENT_DEBUG( "remove key ", key );
                     brn.retain();  // because upsert will release() it
                     auto new_br = upsert<mode>(brn, key.substr(cpre.size() + 1), val);
                     assert(br != new_br);
                     if (not new_br)
                     {
                  //      TRIEDENT_DEBUG( "not new_br" );
                        if (fn->num_branches() + fn->has_eof_value() > 1)
                        {
                   //        TRIEDENT_DEBUG( "numbr + hasval " );
                           auto cl = clone<mode>(r, fn, {});
                           release_node(brn);  // because we retained before upsert(),
                                               // and retained again in clone
                           cl.modify().template as<NodeType>()->remove_branch(bidx);
                           return cl.address();
                        }
                        return fast_meta_address();
                     }
                     else
                     {
                   //     TRIEDENT_DEBUG( "updated new_br" );
                        auto cl = clone<mode>(r, fn, {});
                        release_node(brn);  // because we retained before upsert(),
                                            // and retained again in clone
                        assert(br != new_br);
                        cl.modify().template as<NodeType>()->set_branch(bidx, new_br);
                        return cl.address();
                     }
                  }
                  // must be update/insert or remove that didn't return null
                  // clone before upsert because upsert will release the branch when
                  // it returns the new one
                  auto cl     = clone<mode>(r, fn, {});
                  auto new_br = upsert<mode>(brn, key.substr(cpre.size() + 1), val);
                  assert(br != new_br);
                  cl.modify().template as<NodeType>()->set_branch(bidx, new_br);
                  return cl.address();
               }
            }
            else  // new branch
            {
               if constexpr (mode.must_remove())
                  throw std::runtime_error("unable to find key to remove it");
               else if constexpr (mode.is_remove())
                  return r.address();
               else if constexpr (mode.must_update())
                  throw std::runtime_error("unable to find key to update value");
               else
               {
                  auto new_bin =
                      make_binary(fn->branch_region(), state, key.substr(cpre.size() + 1), val);
                  if constexpr (mode.is_unique())
                  {
                     if (fn->can_add_branch())
                     {
                        r.modify().template as<NodeType>()->add_branch(bidx, new_bin);
                        return r.address();
                     }
                  }
                  if constexpr (not std::is_same_v<full_node, NodeType>)
                  {
                     if (fn->num_branches() + 1 >= full_node_threshold)
                     {
                        return refactor_to_full<mode>(
                                   r, fn, [&](auto fptr) { fptr->add_branch(bidx, new_bin); })
                            .address();
                     }
                  }

                  return clone<mode>(r, fn, {.branch_cap = fn->num_branches() + 1},
                                     [&](auto cptr) { cptr->add_branch(bidx, new_bin); })
                      .address();
               }
            }
         }
         else  // the key ends on this node, store value here
         {
            if constexpr (mode.is_remove())
            {
         //      TRIEDENT_DEBUG( "remove key ends on this node" );
               if (fn->has_eof_value())
               {
                  if constexpr (mode.is_unique())
                  {
                  //   TRIEDENT_DEBUG( "mode is unique?" );
                     release_node(state.get(fn->get_eof_value()));
                     r.modify().as<NodeType>()->set_eof({});

                     if (fn->num_branches() == 0)
                        return fast_meta_address();
                     return r.address();
                  }
                  else  // mode.is_shared()
                  {
                     //TRIEDENT_WARN("release eof value (shared)");
                     if (fn->num_branches() == 0)
                     {
                      //  TRIEDENT_DEBUG("  num_branch == 0, return null");
                        return fast_meta_address();
                     }
                     return clone<mode>(r, fn, {},
                                        [&](auto cl)
                                        {
          //                                 TRIEDENT_DEBUG("remove eof value from clone");
                                           release_node(state.get(cl->get_eof_value()));
                                           cl->set_eof({});
                                        })
                         .address();
                  }
               }
               if constexpr (mode.must_remove())
                  throw std::runtime_error("attempt to remove key that doesn't exist");
               else
                  return r.address();
            }
            else  // must be insert/update on this node
            {
               //  TRIEDENT_WARN("upsert value node on inner node");
               if (fn->has_eof_value())  //val_nid)
               {
                  fast_meta_address val_nid = fn->get_eof_value();
                  auto              old_val = state.get(val_nid);
                  if constexpr (mode.is_unique())
                  {
                     TRIEDENT_DEBUG("... upsert_value<mode>\n");
                     fast_meta_address new_id = upsert_value<mode>(old_val, val);
                     if (new_id != val_nid)
                     {
                        r.modify().as<NodeType>()->set_eof(new_id);
                        release_node(old_val);
                     }
                     return r.address();
                  }
                  else  // shared node
                  {
                     TRIEDENT_WARN("upsert value node on inner node");
                     auto new_id = upsert_value<mode>(old_val, val);
                     assert(new_id != val_nid);  // because shared state
                     release_node(old_val);
                     return clone<mode>(r, fn, {.branch_cap = 16},
                                        [&](auto cl) { cl->set_eof(new_id); })
                         .address();
                  }
               }
               else  // there is no value stored here
               {
                  fast_meta_address new_id = make_value(fn->branch_region(), state, val);

                  if constexpr (mode.is_unique())
                  {
                     if (fn->can_add_branch())
                     {
                        r.modify().template as<NodeType>()->set_eof(new_id);
                        return r.address();
                     }
                     else
                     {
                        // cloning unique reuses ID and bypasses need to
                        // retain/release all children
                        return clone<mode>(r, fn, {.branch_cap = 1},
                                           [&](auto cl) { cl->set_eof(new_id); })
                            .address();
                     }
                  }
                  else
                  {
                     TRIEDENT_DEBUG(" clone add new value to branch 0, val =", val);
                     return clone<mode>(r, fn, {.branch_cap = 16},
                                        [&](auto cl) { cl->set_eof(new_id); })
                         .address();
                  }
               }
            }
         }
      }
      else  // key does not share the same prefix!
      {
         if constexpr (mode.is_remove())
         {
            TRIEDENT_DEBUG( "remove key that doesn't share the same prefix" );
            if constexpr (mode.must_remove())
               throw std::runtime_error("attempt to remove key that does not exist");
            return r.address();
         }
         //   TRIEDENT_DEBUG("KEY DOESN'T SHARE PREFIX  node prelen: ", rootpre.size(), "  cprelen: ", cpre.size());
         //  TRIEDENT_WARN( "root prefix: ", to_hex( rootpre ) );
         //  TRIEDENT_WARN( "insert: ", to_hex(key) );

         // Example Transformation:
         //
         //  "prefix" ->  (in region R1 because parent needs it to be)
         //     (children in R3 because it must be different than R1)
         //     [1] ->
         //     [2] ->
         //     [3] ->
         //     [N] ->
         //
         //  insert "postfix" = "value"
         //
         //  "p" (setlist) (in R1 because it's parent needs it to be)
         //      (branches can be any region but R1 or R3)
         //     [r] -> "efix" [0-N] branches
         //           - if unique, reassign ID to R2 but don't move object
         //           - if shared, clone into R2
         //     [o] -> binarynode   (in R2) because cannot be same as parent)
         //           "stfix" = "value"
         //
         assert(cpre.size() < rootpre.size());

         auto new_reg = state.get_new_region();
         // TRIEDENT_DEBUG( "New Region: ", new_reg );
         while (new_reg == r.address().region or new_reg == fn->branch_region()) [[unlikely]]
            new_reg = state.get_new_region();

         // there is a chance that r.modify() will rewrite the data
         // pointed at by rootpre... so we should read what we need first
         char root_prebranch = rootpre[cpre.size()];

         fast_meta_address child_id;

         // the compactor needs to be smart enough to detect
         // when the node's address has changed before we can take
         // this path
         if constexpr (false and mode.is_unique())
         {
            // because the new setlist root must have a different branch region,
            // we need to reassign the meta_address for the current root, this is
            // safe because ref count is 1
            auto [meta, new_addr] = state.get_new_meta_node(new_reg);
            r.modify().as<NodeType>(
                [&](auto* n)
                {
                   meta.store(r.meta_data(), std::memory_order_relaxed);
                   n->set_prefix(rootpre.substr(cpre.size() + 1));
                   n->set_address(new_addr);
                });
            state.free_meta_node(r.address());
            child_id = new_addr;
         }
         else  // shared state
         {
            //     TRIEDENT_DEBUG(" moving root to child shared ");
            auto new_prefix = rootpre.substr(cpre.size() + 1);
            auto cl         = clone<mode.make_shared()>(new_reg, r, fn, {.set_prefix = new_prefix});
            child_id        = cl.address();
            if constexpr (mode.is_unique())
            {
               // TRIEDENT_WARN( "release old root if unique because it doesn't happen automatically for unique" );

               release_node(r);
            }
         }

         if (key.size() == cpre.size())
         {  // eof
            TRIEDENT_DEBUG("  value is on the node (EOF)");
            auto v = make_value(child_id.region, state, val);
            // must be same region as r because we can't cange the region our parent
            // put this node in.
            return make<setlist_node>(r.address().region, state,
                                      {.branch_cap = 2, .set_prefix = cpre},
                                      [&](setlist_node* sln)
                                      {
                                         TRIEDENT_WARN("CHILD ID REGION INSTEAD OF NEW?");
                                         sln->set_branch_region(child_id.region);
                                         sln->set_eof(v);
                                         sln->add_branch(char_to_branch(root_prebranch), child_id);
                                      })
                .address();
         }
         else
         {  // branch node
            //       TRIEDENT_DEBUG("  two branch child, cpre: ", to_hex(cpre), "  key: ", to_hex(key),
            //                     " rpre: ", to_hex(rootpre));
            auto abx = make_binary(child_id.region, state, key.substr(cpre.size() + 1), val);
            return make<setlist_node>(
                       r.address().region, state, {.branch_cap = 2, .set_prefix = cpre},
                       [&](setlist_node* sln)
                       {
                          sln->set_branch_region(new_reg);

                          std::pair<branch_index_type, fast_meta_address> brs[2];

                          auto order  = key[cpre.size()] < root_prebranch;  //rootpre[cpre.size()];
                          brs[order]  = {char_to_branch(key[cpre.size()]), abx};
                          brs[!order] = {char_to_branch(root_prebranch), child_id};
                          //                TRIEDENT_DEBUG( "abx: ", abx);
                          //               TRIEDENT_DEBUG( "child_id: ", child_id, " on branch: ", root_prebranch);
                          sln->add_branch(brs[0].first, brs[0].second);
                          sln->add_branch(brs[1].first, brs[1].second);
                       })
                .address();
         }
      }
   }  // end upsert<T>

   template <upsert_mode mode>
   fast_meta_address write_session::upsert_binary(object_ref<node_header>& root,
                                                  key_view                 key,
                                                  const value_type&        val)
   {
      auto bn = root.as<binary_node>();

      int_fast16_t lb_idx;
      uint64_t     key_hash  = binary_node::key_hash(key);
      bool         key_found = false;
      if constexpr (mode.must_insert())
      {
         // no need to test/search for existing node in hash list,
         // the caller already expects this to be an insert
         lb_idx = bn->lower_bound_idx(key);
         if (lb_idx < bn->num_branches())
            key_found = key == bn->get_key(lb_idx);

         // this is unlikey because the caller explictly told us
         // to perform an insert and not an update and we assume the
         // caller would call "upsert" if they didn't know if the key
         // existed or not.
         if (key_found)  //binary_node::key_not_found != key_idx)
            throw std::runtime_error("insert failed because key exists");
      }
      else if constexpr (mode.must_update())
      {
         // there must be a key key to update
         lb_idx    = bn->find_key_idx(key, key_hash);
         key_found = lb_idx != binary_node::key_not_found;
      }
      else  // we may insert or update
      {
         // optimistically search for key to update
         lb_idx    = bn->find_key_idx(key, key_hash);
         key_found = lb_idx != binary_node::key_not_found;

         // but fall back to the lower bound to insert
         if (not key_found)
            lb_idx = bn->lower_bound_idx(key);
      }

      //if (binary_node::key_not_found == key_idx)  // then insert a new value
      if (not key_found)  // then insert a new value
      {
         if constexpr (mode.must_update())
            throw std::runtime_error("update failed because key doesn't exist");

         if constexpr (mode.is_remove())
         {
            if constexpr (mode.must_remove())
               throw std::runtime_error("remove failed because key doesn't exist");
            return root.address();
         }

         if constexpr (mode.is_unique())
         {
            // assuming we allocate binary nodes with space and grow them
            // every time we have to clone them anyway, then this should be
            // true, especially because we are in the unique path.
            if (bn->can_insert(key, val)) [[likely]]
            {
               if (bn->can_inline(val))
                  root.modify().as<binary_node>()->insert(lb_idx, key, val);
               else
                  root.modify().as<binary_node>()->insert(
                      lb_idx, key, make_value(bn->branch_region(), root.rlock(), val));
               return root.address();
            }
         }

         // worst case keys are 1kb and this misses 25% of the time
         // best case keys are small and this misses <1% of the time
         if (bn->insert_requires_refactor(key, val)) [[unlikely]]
         {
            auto rid = refactor<mode>(root, bn);

            assert((mode.is_unique() and (rid.address() == root.address())) or
                   ((mode.is_shared()) and (rid.address() != root.address())));

            // if it wasn't unique before and the id changed then
            // it has become unique. If it was unique before, then
            // it remains unique now.
            return upsert<mode.make_unique()>(rid, key, val);
         }

         if (binary_node::can_inline(val))
            return clone<mode>(root, bn, {}, binary_node::clone_insert(lb_idx, key, val)).address();
         else
            return clone<mode>(root, bn, {},
                               binary_node::clone_insert(
                                   lb_idx, key, make_value(bn->branch_region(), root.rlock(), val)))
                .address();
      }
      return update_binary_key<mode>(root, bn, lb_idx, key, val);
   }  // upsert_binary

   /**
    *  update_binary_key
    *
    *  simple case:
    *     unique, same size -> update in place and return
    *  
    *
    *
    */
   template <upsert_mode mode>
   fast_meta_address write_session::update_binary_key(object_ref<node_header>& root,
                                                      const binary_node*       bn,
                                                      uint16_t                 lb_idx,
                                                      key_view                 key,
                                                      const value_type&        val)
   {
      auto kvp = bn->get_key_val_ptr(lb_idx);
      assert(kvp->key() == key);

      if constexpr (mode.is_remove())
      {
         if constexpr (mode.is_unique())
         {
            if (bn->is_obj_id(lb_idx))
               release_node(root.rlock().get(kvp->value_id()));

            root.modify().as<binary_node>([&](auto* b) { b->remove_value(lb_idx); });

            if (bn->num_branches() == 0)
               return fast_meta_address();

            return root.address();
         }
         else  // not unique, must clone to update it
         {
            if (bn->num_branches() > 1)
            {
               auto cl = clone<mode>(root, bn, {}, binary_node::clone_remove(lb_idx)).address();

               if (bn->is_obj_id(lb_idx))
                  release_node(root.rlock().get(kvp->value_id()));

               return cl;
            }
            return fast_meta_address();
         }
      }

      if (bn->update_requires_refactor(kvp, val))
      {
         auto rid = refactor<mode>(root, bn);

         assert((mode.is_unique() and (rid.address() == root.address())) or
                ((mode.is_shared()) and (rid.address() != root.address())));

         // if it wasn't unique before and the id changed then
         // it has become unique. If it was unique before, then
         // it remains unique now.
         return upsert<mode.make_unique()>(rid, key, val);
      }

      if constexpr (mode.is_unique())
      {
         if (bn->is_obj_id(lb_idx))
         {
            // if val.size() can inline then
            auto oldr = root.rlock().get(kvp->value_id());
            auto nid  = upsert_value<mode>(oldr, val);
            if (nid != oldr.address())
            {
               root.modify().as<binary_node>()->get_key_val_ptr(lb_idx)->value_id() =
                   nid.to_address();
               release_node(oldr);
            }
            return root.address();
         }
         else if (kvp->value_size() >= val.size())
         {
            root.modify().as<binary_node>()->set_value(lb_idx, val);
            return root.address();
         }
      }  // else mode is shared or needs a clone anyway

      fast_meta_address old_val_oid;
      if (bn->is_obj_id(lb_idx))
         old_val_oid = kvp->value_id();

      if (binary_node::can_inline(val))
      {
         // if val is an object id, the we must release_node
         // on the current object id, assuming it is different,
         // before we set the new object id, but we cannot release it
         // until *after* clone has retained everything it needs to,
         // so we should save the objid here... release it on the
         // other side of clone

         auto new_bin_node = clone<mode>(root, bn, {}, binary_node::clone_update(lb_idx, val));
         auto nkvp         = new_bin_node->get_key_val_ptr(lb_idx);
         if (old_val_oid and (not bn->is_obj_id(lb_idx) or nkvp->value_id() != old_val_oid))
            release_node(root.rlock().get(old_val_oid));
         return new_bin_node.address();
      }
      else
      {
         auto vid          = make_value(bn->branch_region(), root.rlock(), val);
         auto new_bin_node = clone<mode>(root, bn, {}, binary_node::clone_update(lb_idx, vid));

         auto nkvp = new_bin_node->get_key_val_ptr(lb_idx);
         if (old_val_oid and (not bn->is_obj_id(lb_idx) or nkvp->value_id() != old_val_oid))
            release_node(root.rlock().get(old_val_oid));

         return new_bin_node.address();
      }
   }

   fast_meta_address write_session::make_binary(id_region         reg,
                                                session_rlock&    state,
                                                key_view          key,
                                                const value_type& val)
   {
      //TODO: configure how much spare capacity goes into nodes as they are being
      //created.  Currently adding 128 (2 cachelines) + what ever ounding out to nearest
      // 64 bytes is already going on.
      auto ss = binary_node::calc_key_val_pair_size(key, val) + 128;
      return make<binary_node>(reg, state, {.branch_cap = 1, .data_cap = ss},
                               [&](binary_node* bn)
                               {
                                  if (val.is_object_id())
                                  {
                                     bn->insert(0, key, val.id());
                                  }
                                  else
                                  {
                                     auto vv = val.view();
                                     if (binary_node::can_inline(vv))
                                        bn->insert(0, key, vv);
                                     else
                                        bn->insert(0, key,
                                                   make_value(bn->branch_region(), state, vv));
                                  }
                               })
          .address();
   }

}  // namespace arbtrie

#include "iterator.cpp"
