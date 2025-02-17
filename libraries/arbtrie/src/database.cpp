#include <arbtrie/arbtrie.hpp>
#include <arbtrie/database.hpp>
#include <arbtrie/debug.hpp>
#include <arbtrie/file_fwd.hpp>

#include <utility>

namespace arbtrie
{
   template <typename NodeType, typename... CArgs>
   object_ref make(id_region                        reg,
                   session_rlock&                   state,
                   std::invocable<NodeType*> auto&& uinit,
                   CArgs&&... cargs)
   {
      auto asize     = NodeType::alloc_size(cargs...);
      auto make_init = [&](node_header* cl)
      {
         assert(cl->_nsize == asize);
         uinit(new (cl) NodeType(cl->_nsize, cl->address(), cargs...));
      };
      return state.alloc(reg, asize, NodeType::type, make_init);
   }
   template <typename NodeType, typename... CArgs>
   object_ref make(id_region reg, session_rlock& state, CArgs&&... cargs)
   {
      return make<NodeType>(
          reg, state, [](auto&&) {}, std::forward<CArgs>(cargs)...);
   }

   template <typename NodeType, typename... CArgs>
   object_ref remake(object_ref& r, std::invocable<NodeType*> auto&& uinit, CArgs&&... cargs)
   {
      auto asize     = NodeType::alloc_size(cargs...);
      auto make_init = [&](node_header* cl)
      { uinit(new (cl) NodeType(asize, cl->address(), cargs...)); };

      auto modlock = r.modify();
      return r.rlock().realloc(r, asize, NodeType::type, make_init);
   }
   template <typename NodeType, typename... CArgs>
   object_ref remake(object_ref& r, CArgs&&... cargs)
   {
      return remake<NodeType>(
          r, [](auto&&) {}, std::forward<CArgs>(cargs)...);
   }

   template <typename NodeType>
   object_ref make(id_region reg, session_rlock& state, const clone_config& cfg, auto&& uinit)
   {
      auto asize     = NodeType::alloc_size(cfg);
      auto make_init = [&](node_header* cl)
      {
         assert(cl->_nsize == asize);
         uinit(new (cl) NodeType(cl->_nsize, cl->address(), cfg));
      };
      return state.alloc(reg, asize, NodeType::type, make_init);
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
   template <upsert_mode mode, typename NodeType, typename... CArgs>
   object_ref clone_impl(id_region                        reg,
                         object_ref&                      r,
                         const NodeType*                  src,
                         const clone_config&              cfg,
                         std::invocable<NodeType*> auto&& uinit,
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
         auto mod_lock = r.modify();
         return r.rlock().realloc(r /*r.address()*/, asize, src->get_type(), copy_init);
      }
      return r.rlock().alloc(reg, asize, src->get_type(), copy_init);
   }

   template <upsert_mode mode, typename NodeType>
   object_ref clone(
       object_ref&                      r,
       const NodeType*                  src,
       const clone_config&              cfg   = {},
       std::invocable<NodeType*> auto&& uinit = [](NodeType*) {})
   {
      return clone_impl<mode.make_same_region()>(r.address().region().to_int(), r, src, cfg,
                                                 std::forward<decltype(uinit)>(uinit));
   }

   template <upsert_mode mode, typename NodeType>
   object_ref clone(
       id_region                        reg,
       object_ref&                      r,
       const NodeType*                  src,
       const clone_config&              cfg   = {},
       std::invocable<NodeType*> auto&& uinit = [](NodeType*) {})
   {
      return clone_impl<mode>(reg, r, src, cfg, std::forward<decltype(uinit)>(uinit));
   }

   template <upsert_mode mode, typename NodeType, typename... CArgs>
   object_ref clone(object_ref&                      r,
                    const NodeType*                  src,
                    const clone_config&              cfg,
                    std::invocable<NodeType*> auto&& uinit,
                    CArgs&&... cargs)
   {
      return clone_impl<mode.make_same_region()>(r.address().region().to_int(), r, src, cfg,
                                                 std::forward<decltype(uinit)>(uinit),
                                                 std::forward<CArgs>(cargs)...);
   }
   template <upsert_mode mode, typename NodeType, typename... CArgs>
   object_ref clone(id_region                        reg,
                    object_ref&                      r,
                    const NodeType*                  src,
                    const clone_config&              cfg,
                    std::invocable<NodeType*> auto&& uinit,
                    CArgs&&... cargs)
   {
      return clone_impl<mode>(reg, r, src, cfg, std::forward<decltype(uinit)>(uinit),
                              std::forward<CArgs>(cargs)...);
   }

   template <upsert_mode mode, typename NodeType, typename... CArgs>
   object_ref clone(object_ref& r, const NodeType* src, const clone_config& cfg, CArgs&&... cargs)
   {
      return clone_impl<mode.make_same_region()>(
          r.address().region().to_int(), r, src, cfg, [](auto) {}, std::forward<CArgs>(cargs)...);
   }

   template <upsert_mode mode, typename NodeType, typename... CArgs>
   object_ref clone(id_region           reg,
                    object_ref&         r,
                    const NodeType*     src,
                    const clone_config& cfg,
                    CArgs&&... cargs)
   {
      return clone_impl<mode>(
          reg, r, src, cfg, [](auto) {}, std::forward<CArgs>(cargs)...);
   }

   uint32_t node_header::calculate_checksum() const
   {
      return cast_and_call(this, [&](const auto* t) { return t->calculate_checksum(); });
   }

   node_handle read_session::get_root(int index)
   {
      assert(index < num_top_roots);
      assert(index >= 0);

      // must take the lock to prevent a race condition around
      // retaining the current top root... otherwise we must
      //     read the current top root address,
      //     read / lookup the meta for the address
      //     attempt to retain the meta while making sure the top root
      //     hasn't changed, the lock is probably faster anyway
      std::unique_lock lock(_db._root_change_mutex[index]);
      return node_handle(
          *this, id_address::from_int(_db._dbm->top_root[index].load(std::memory_order_relaxed)));
   }

   database::database(std::filesystem::path dir, config cfg, access_mode mode)
       : _sega{dir}, _dbfile{dir / "db", mode}, _config(cfg)
   {
      if (_dbfile.size() == 0)
      {
         _dbfile.resize(sizeof(database_memory));
         new (_dbfile.data()) database_memory();
      }

      _dbm = reinterpret_cast<database_memory*>(_dbfile.data());

      if (_dbfile.size() != sizeof(database_memory))
         throw std::runtime_error("Wrong size for file: " + (dir / "db").native());

      if (_dbm->magic != file_magic)
         throw std::runtime_error("Not a arbtrie file: " + (dir / "db").native());

      if (not _dbm->clean_shutdown)
      {
         TRIEDENT_WARN("database was not shutdown cleanly, memory may have leaked");
         int num_modify = _sega.clear_lock_bits();

         if (num_modify)
            TRIEDENT_WARN(num_modify, " node(s) failed to complete modification before shutdown");
         TRIEDENT_DEBUG("validating database state");
         std::cerr << std::setw(5) << "root"
                   << " | " << std::setw(10) << "nodes"
                   << " | " << std::setw(10) << " size (MB) "
                   << " | " << std::setw(10) << " avg depth  "
                   << "\n";
         auto s = start_read_session();
         for (int i = 0; i < num_top_roots; ++i)
         {
            auto r = s.get_root(i);
            if (r.address())
            {
               auto stat = s.get_node_stats(r);
               std::cerr << std::setw(5) << i << " | " << stat << "\n";
            }
         }
      }
      _dbm->clean_shutdown = false;

      if (cfg.run_compact_thread)
         _sega.start_compact_thread();
   }

   database::~database()
   {
      _sega.sync(sync_type::sync);
      _dbm->clean_shutdown = true;
      _dbfile.sync(sync_type::sync);
   }

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
      return write_session(*this);
   }
   read_session database::start_read_session()
   {
      return read_session(*this);
   }

   template <typename NodeType>
   void retain_children(session_rlock& state, const NodeType* in)
   {
      in->visit_branches([&](auto bid) { state.get(bid).retain(); });
   }

   id_address make_value(id_region reg, session_rlock& state, const value_type& val)
   {
      return make<value_node>(
                 reg, state, [](auto) {}, val)
          .address();
   }
   std::optional<node_handle> write_session::upsert(node_handle& r, key_view key, node_handle sub)
   {
      _delta_keys = 0;

      // old handle will be written here, if any is found, reset it to null
      _old_handle.reset();
      // retain the handle here until its address is safely stored
      _new_handle = std::move(sub);

      auto state = _segas.lock();

      r.give(upsert(state, r.take(), key, value_type::make_subtree(_new_handle->address())));

      // it has been stored without exception; therefore we can take it
      _new_handle->take();
      return std::move(_old_handle);
   }

   int write_session::upsert(node_handle& r, key_view key, value_view val)
   {
      _delta_keys     = 0;
      _old_value_size = -1;
      auto state      = _segas.lock();

      id_address adr = r.take();
      try
      {
         r.give(upsert(state, adr, key, val));
      }
      catch (...)
      {
         r.give(adr);
         throw;
      }
      return _old_value_size;
   }

   void write_session::insert(node_handle& r, key_view key, value_view val)
   {
      _delta_keys     = 0;
      _old_value_size = -1;
      auto state      = _segas.lock();

      r.give(insert(state, r.take(), key, val));
   }

   int write_session::update(node_handle& r, key_view key, value_view val)
   {
      _delta_keys     = 0;
      _old_value_size = -1;
      auto state      = _segas.lock();
      r.give(update(state, r.take(), key, val));
      return _old_value_size;
   }

   int write_session::remove(node_handle& r, key_view key)
   {
      _delta_keys     = 0;
      _old_value_size = -1;
      auto state      = _segas.lock();
      r.give(remove(state, r.take(), key));
      return _old_value_size;
   }

   id_address write_session::upsert(session_rlock&    state,
                                    id_address        root,
                                    key_view          key,
                                    const value_type& val)
   {
      if (not root) [[unlikely]]
         return make<value_node>(state.get_new_region(), state, key, val).address();
      _cur_val = val;
      return upsert<upsert_mode::unique_upsert>(state.get(root), key);
   }
   id_address write_session::insert(session_rlock&    state,
                                    id_address        root,
                                    key_view          key,
                                    const value_type& val)
   {
      if (not root) [[unlikely]]
         return make<value_node>(state.get_new_region(), state, key, val).address();
      _cur_val = val;
      return upsert<upsert_mode::unique_insert>(state.get(root), key);
   }
   id_address write_session::update(session_rlock&    state,
                                    id_address        root,
                                    key_view          key,
                                    const value_type& val)
   {
      if (not root) [[unlikely]]
         throw std::runtime_error("cannot update key that doesn't exist");
      _cur_val = val;
      return upsert<upsert_mode::unique_update>(state.get(root), key);
   }
   id_address write_session::remove(session_rlock& state, id_address root, key_view key)
   {
      if (not root) [[unlikely]]
         throw std::runtime_error("cannot remove key that doesn't exist");
      return upsert<upsert_mode::unique_remove>(state.get(root), key);
   }

   uint32_t read_session::count_keys(const node_handle& r, key_view from, key_view to)
   {
      if (from > to)
         throw std::runtime_error("count_keys: 'from' key must be less than 'to' key");

      if (not r.address()) [[unlikely]]
         return 0;

      auto state = _segas.lock();
      auto root  = state.get(r.address());
      return count_keys(root, from, to);
   }
   uint32_t read_session::count_keys(object_ref&       r,
                                     const value_node* v,
                                     key_view          from,
                                     key_view          to) const
   {
      assert(to == key_view() or from < to);
      auto k = v->key();
      return k >= from and (to == key_view() or k < to);
   }

   uint32_t read_session::count_keys(object_ref&        r,
                                     const binary_node* n,
                                     key_view           from,
                                     key_view           to) const
   {
      //    TRIEDENT_DEBUG( "binary from: ", to_hex(from), " to: ", to_hex(to), " numb: ", n->num_branches() );
      assert(to == key_view() or from < to);
      auto start = n->lower_bound_idx(from);
      //    TRIEDENT_DEBUG ( "start idx: ", start );
      assert(start >= 0);
      if (start == n->num_branches())
         return 0;
      if (to == key_view())
      {
         //   TRIEDENT_WARN( "numb - start: ", n->num_branches() - start );
         return n->num_branches() - start;
      }
      // TRIEDENT_DEBUG( "end: ", n->lower_bound_idx(to), " start: ", start, "  delta: ", n->lower_bound_idx(to) - start );

      // TRIEDENT_DEBUG ( "end idx: ", n->lower_bound_idx(to), " numb: ", n->num_branches() );
      return n->lower_bound_idx(to) - start;
   }
   uint32_t read_session::count_keys(object_ref&         r,
                                     const setlist_node* n,
                                     key_view            from,
                                     key_view            to) const
   {
      // TRIEDENT_DEBUG( "setlist from: ", to_str(from), " to: ", to_str(to), "  pre: ", to_str(n->get_prefix()) );
      assert(to == key_view() or from < to);
      auto pre = n->get_prefix();
      if (to.size() and to < pre)
         return 0;

      auto slp = n->get_setlist_ptr();

      auto count_range = [&](const id_index* pos, const id_index* end)
      {
         uint32_t count = 0;
         while (pos < end)
         {
            auto bref = r.rlock().get(id_address(n->branch_region(), *pos));
            count += count_keys(bref, key_view(), key_view());
            ++pos;
         }
         return count;
      };

      if (from <= pre)
      {
         // the start is at or before before this node
         if (to.size() <= pre.size())
         {
            // and the end is after all keys in this node
            return n->descendants();
         }
         // TRIEDENT_DEBUG( "begging to middle" );

         // else the end is within this node
         auto    begin    = n->get_branch_ptr();
         auto    end_idx  = n->lower_bound_idx(char_to_branch(to[pre.size()]));
         uint8_t end_byte = slp[end_idx];
         auto    end      = begin + end_idx;
         auto    abs_end  = begin + n->num_branches();
         auto    delta    = end - begin;
         auto    to_tail  = to.substr(pre.size() + 1);

         //   TODO: optimize by subtracting from descendants
         //   if( delta > n->num_branches()/2 ) // subtract tail from n->desendants()
         //      return n->descendants() - count_range( end, begin + n->num_branches() );
         //   else // sum everything to this point

         uint64_t count = n->has_eof_value() + count_range(begin, end);
         if (end != abs_end and end_byte == uint8_t(to[pre.size()]))
         {
            auto sref = r.rlock().get(id_address(n->branch_region(), *end));
            count += count_keys(sref, key_view(), to.substr(pre.size() + 1));
         }

         return count;
      }
      else
      {
         // the start is in the middle of this node
         auto begin   = n->get_branch_ptr();
         auto abs_end = begin + n->num_branches();

         auto    start_idx  = n->lower_bound_idx(char_to_branch(from[pre.size()]));
         uint8_t start_byte = slp[start_idx];
         // TRIEDENT_DEBUG( "start branch: ", start_byte );
         auto start = begin + start_idx;

         if (to.size() > pre.size())
         {
            // end is in the middle of this node
            auto end_idx = n->lower_bound_idx(char_to_branch(to[pre.size()]));
            assert(end_idx < n->num_branches());

            uint8_t end_byte = slp[end_idx];
            auto    end      = begin + end_idx;

            uint32_t count            = 0;
            bool     counted_end_byte = false;
            if (start_byte == uint8_t(from[pre.size()]))
            {
               counted_end_byte = start_byte == end_byte;
               //      TRIEDENT_WARN( "start_byte == from[pre.size()]" );
               auto sref  = r.rlock().get(id_address(n->branch_region(), *start));
               auto btail = from.substr(pre.size() + 1);
               auto etail = (end_byte == start_byte) ? to.substr(pre.size() + 1) : key_view();
               count      = count_keys(sref, btail, etail);
               ++start;
            }
            count += count_range(start, end);
            //  TRIEDENT_DEBUG( "after count_range(...): ", count,  " end byte: ", end_byte, " to[pre.size()] = ", to[pre.size()] );
            assert(end < abs_end);

            // TRIEDENT_WARN( "end byte: ", end_byte, " start: ", start_byte, " to[pre.size]: ", to[pre.size()] );
            if (!counted_end_byte and end_byte == to[pre.size()])
            {
               auto sref  = r.rlock().get(id_address(n->branch_region(), *end));
               auto etail = to.substr(pre.size() + 1);
               //   TRIEDENT_WARN( "END BYTE == to[pre.size()] aka: ", to[pre.size()], " init count: ", count, " etail: '", to_str(etail), "'" );
               count += count_keys(sref, key_view(), etail);
            }
            // TRIEDENT_DEBUG( "final count: ", count );
            return count;
         }
         else
         {  // begin in middle and end is beyond the end of this node
            // TRIEDENT_WARN( "begin in middle, end beyond this node" );
            // TODO: optimize by counting from abs begin to begin and subtracting from
            // descendants()
            uint32_t count = 0;
            if (start_byte == uint8_t(from[pre.size()]))
            {
               auto sref  = r.rlock().get(id_address(n->branch_region(), *start));
               auto btail = from.substr(pre.size() + 1);
               count += count_keys(sref, btail, key_view());
               ++start;
            }
            return count + count_range(start, abs_end);
         }
      }
   }
   uint32_t read_session::count_keys(object_ref&      r,
                                     const full_node* n,
                                     key_view         from,
                                     key_view         to) const
   {
      assert(to == key_view() or from < to);
      auto pre = n->get_prefix();
      if (to.size() and to < pre)
         return 0;

      uint64_t count = 0;

      //TRIEDENT_WARN( "full from ", to_hex( from ), " -> ", to_hex(to) );

      auto count_range = [&](branch_index_type pos, branch_index_type end)
      {
         uint64_t c    = 0;
         auto     opos = pos;
         while (pos < end)
         {
            auto adr = n->get_branch(pos);
            if (adr)
            {
               auto bref = r.rlock().get(adr);
               auto bc   = count_keys(bref, key_view(), key_view());
               c += bc;
               //          TRIEDENT_DEBUG( "   ", to_hex( pos-1), " => ", bc, " total: ", c );
            }
            ++pos;
         }
         //    TRIEDENT_DEBUG( "count_range ", to_hex(opos-1), " -> ", to_hex( end-1), " count: ", c );
         return c;
      };

      if (from <= pre)
      {
         // the start is at or before this node
         if (to.size() <= pre.size())
            return n->descendants();  // end is after this node

         // else the end is within this node

         auto end_byte = char_to_branch(to[pre.size()]);
         auto end_idx  = n->lower_bound(end_byte);

         //   TRIEDENT_WARN( "begin to middle" );
         //   note that branch_id 1 is byte 0 because eof value is branch 0
         count = n->has_eof_value() + count_range(char_to_branch(0), end_idx.first);
         if (end_idx.first != max_branch_count and end_byte == end_idx.first)
         {
            auto sref = r.rlock().get(end_idx.second);
            count += count_keys(sref, key_view(), to.substr(pre.size() + 1));
         }
         return count;
      }
      else
      {
         // the start is in the middle of this node
         auto start_byte = char_to_branch(from[pre.size()]);
         auto start_idx  = n->lower_bound(start_byte);

         if (to.size() > pre.size())
         {
            //   TRIEDENT_WARN( "middle to middle" );
            // begin and end are in the middle of this node
            auto end_byte = char_to_branch(to[pre.size()]);
            auto end_idx  = n->lower_bound(end_byte);

            bool counted_end_byte = false;
            if (start_byte == start_idx.first)
            {
               counted_end_byte = start_byte == end_byte;
               auto sref        = r.rlock().get(start_idx.second);
               auto btail       = from.substr(pre.size() + 1);
               auto etail       = (end_byte == start_byte) ? to.substr(pre.size() + 1) : key_view();
               count            = count_keys(sref, btail, etail);
               //        TRIEDENT_WARN( "count first: ", to_hex( start_idx.first-1), " cnt: ", count,
               //                      " node: ", start_idx.second );
               start_idx.first++;
            }
            count += count_range(start_idx.first, end_idx.first);

            if (not counted_end_byte and end_byte == end_idx.first)
            {
               //      TRIEDENT_WARN( "count end: ", to_hex(end_idx.first-1) );
               auto sref  = r.rlock().get(end_idx.second);
               auto etail = to.substr(pre.size() + 1);
               auto ce    = count_keys(sref, key_view(), etail);
               count += ce;
               //     TRIEDENT_WARN( "CE:  ", ce, " count: ", count );
            }
            return count;
         }
         else
         {
            // TRIEDENT_WARN( "middle to end" );
            // begin in the middle and end is beyond the end of this node
            uint64_t count = 0;
            if (start_idx.first == start_byte)
            {
               auto sref  = r.rlock().get(start_idx.second);
               auto btail = from.substr(pre.size() + 1);
               count += count_keys(sref, btail, key_view());
               ++start_idx.first;
            }
            return count + count_range(start_idx.first, max_branch_count);
         }
      }
   }

   uint32_t read_session::count_keys(object_ref& r, key_view from, key_view to) const
   {
      return cast_and_call(r.header(),
                           [&](const auto* n) { return this->count_keys(r, n, from, to); });
   }

   template <upsert_mode mode>
   id_address write_session::upsert(object_ref&& root, key_view key)
   {
      return upsert<mode>(root, key);
   }
   /**
    *  Inserts key under root, if necessary 
    */
   template <upsert_mode mode>
   id_address write_session::upsert(object_ref& root, key_view key)
   {
      if constexpr (mode.is_unique())
      {
         // TODO: is this node in a synced section of a segment,
         // then it is implicity shared because we cannot modify it
         // in place without risking losing those changes.
         //
         // Note that a new mode, 'sync mode' can be used to only
         // perform that more expensive check if the database is
         // operating in 'sync mode'
         if (root.ref() != 1)
         {
            assert(root.ref() != 0);
            return upsert<mode.make_shared()>(root, key);
         }
      }

      id_address result;
      switch (root.type())
      {
         case node_type::value:
            result = upsert_value<mode>(root, key);
            break;
         case node_type::binary:
            result = upsert_binary<mode>(root, key);
            break;
         case node_type::setlist:
            result = upsert_inner<mode, setlist_node>(root, key);
            break;
            //     case node_type::bitset:
            //       result = upsert_inner<mode, bitset_node>(root, key, val);
            //      break;
         case node_type::full:
            result = upsert_inner<mode, full_node>(root, key);
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
      //  else // if unique mode
      //   We cannot assert this because there is one case where the root
      //   changes under unique mode; however, in that case it is released
      //   so we still don't have to release here
      //   assert( result == root.address() );
      //

      return result;
   }

   template <upsert_mode mode>
   id_address upsert(object_ref&& root, key_view key)
   {
      return upsert<mode>(root, key);
   }

   //================================
   //  upsert_value
   //
   //  Given a value node, if the key is the same then this will
   //  update the data, otherwise if there is a key collision it will
   //  split into a binary node containing both keys
   //================================
   template <upsert_mode mode>
   id_address write_session::upsert_value(object_ref& root, key_view key)
   {
      auto& state        = root.rlock();
      auto  vn           = root.as<value_node>();
      auto  new_val_size = _cur_val.size();

      if constexpr (mode.is_remove())
      {
         if (vn->key() == key)
         {
            _delta_keys = -1;
            return id_address();
         }
         if constexpr (mode.must_remove())
            throw std::runtime_error("attempt to remove key that does not exist");
         return root.address();
      }

      if (vn->key() == key)
      {
         _old_value_size = vn->value_size();
         if constexpr (mode.is_unique())
         {
            if (vn->value_capacity() >= new_val_size)
            {
               id_address old_subtree = root.modify().as<value_node>()->set_value(_cur_val);
               if (old_subtree)
               {
                  // TODO: this could be an expensive operation, say a snapshot with
                  // a days worth of modifications.  Perhaps subtrees should always be
                  // "defer-release" so the compactor can clean it up
                  //
                  // TODO: we could implement a try_fast_release via compare and swap
                  //       and if we are not the final release then we are done, else
                  //       if it looks like we would be the final release then postpone
                  release_node(state.get(old_subtree));
               }
               return root.address();
            }
            //TRIEDENT_DEBUG( "remake value node" );
            return remake<value_node>(root, key, _cur_val).address();
         }
         else  // shared
         {
            //TRIEDENT_WARN( "make value node" );
            return make<value_node>(root.address().region().to_int(), state, key, _cur_val)
                .address();
         }
      }
      else  // add key
      {
         _delta_keys = 1;

         // convert to binary node
         key_view   k1      = vn->key();
         value_type v1      = vn->get_value();
         auto       t1      = vn->is_subtree() ? binary_node::key_index::subtree
                                               : binary_node::key_index::inline_data;
         key_view   k2      = key;
         value_type v2      = _cur_val;
         auto       t2      = _cur_val.is_subtree() ? binary_node::key_index::subtree
                                                    : binary_node::key_index::inline_data;
         auto       new_reg = state.get_new_region();

         if constexpr (use_binary_nodes)
         {
            if (not binary_node::can_inline(vn->value_size()))
            {
               v1 = value_type::make_value_node(make<value_node>(new_reg, state, v1).address());
               t1 = binary_node::key_index::obj_id;
            }

            if (not binary_node::can_inline(v2.size()))
            {
               v2 = value_type::make_value_node(make<value_node>(new_reg, state, v2).address());
               t2 = binary_node::key_index::obj_id;
            }

            // if unique, reuse id of value node
            if constexpr (mode.is_unique())
            {
               return remake<binary_node>(root, clone_config{.data_cap = binary_node_initial_size},
                                          new_reg, k1, v1, t1, k2, v2, t2)
                   .address();
            }
            else  // shared
            {
               return make<binary_node>(root.address().region().to_int(), state,
                                        clone_config{.data_cap = binary_node_initial_size}, new_reg,
                                        k1, v1, t1, k2, v2, t2)
                   .address();
            }
         }
         else  // don't use binary nodes
         {
            static_assert(false, "TODO: handle subtrees properly");
#if 0
            auto cpre    = common_prefix(k1,k2);
            if( k1 > k2 ) {
               std::swap( k1,k2 );
               std::swap( v1,v2 );
               std::swap( t1,t2 );
            }

            if( k1.size() > cpre.size() ) {
               v1 = make<value_node>( new_reg, state, k1.substr(cpre.size()+1), v1) .address();
            } else { // eof value
               v1 = make<value_node>( new_reg, state, v1) .address();
               assert( k2.size() > k1.size() ); // only one eof value or keys would be same
            }

            v2 = make<value_node>( new_reg, state, k2.substr(cpre.size()+1), v2) .address();

            if constexpr ( mode.is_unique() ) 
            {
               return remake<setlist_node>(root, 
                                           [&]( setlist_node* sln ) {
                                           sln->set_branch_region( new_reg );
                                              if( not k1.size() )
                                                sln->set_eof( v1.id() );
                                              else 
                                                sln->add_branch( char_to_branch(k1[cpre.size()]),
                                                                 v1.id() );
                                             sln->add_branch( char_to_branch(k2[cpre.size()]),
                                                              v2.id() );
                                           },
                                           clone_config{.branch_cap=2, .set_prefix=cpre}
                                           ).address();
            }
            else  // shared
            {
               return make<setlist_node>(root.address().region().to_int(), state, 
                                           [&]( setlist_node* sln ) {
                                           sln->set_branch_region( new_reg );
                                              if( not k1.size() )
                                                sln->set_eof( v1.id() );
                                              else 
                                                sln->add_branch( char_to_branch(k1[cpre.size()]),
                                                                 v1.id() );
                                             sln->add_branch( char_to_branch(k2[cpre.size()]),
                                                              v2.id() );
                                           },
                                         clone_config{.branch_cap=2, .set_prefix=cpre}
                                           ).address();
            }
#endif
         }
      }
   }

   /**
    * EOF values cannot be converted to binary or have other child branches, so
    * they have a unique upsert function compared to upserting when a branch of the
    * tree is a value node with a key.  
    */
   template <upsert_mode mode>
   id_address write_session::upsert_eof_value(object_ref& root)
   {
      if constexpr (mode.is_unique())
      {
         if (root.ref() > 1)
            return upsert_eof_value<mode.make_shared()>(root);
      }

      auto& state = root.rlock();

      // this should be handled at the inner node layer
      assert(not _cur_val.is_subtree());

      if constexpr (mode.is_shared())
      {
         if (root.type() == node_type::value)
         {
            // TODO: the only reason we have to fetch the old value
            // is to get its size.  If we aren't interested in the old value
            // size, then this could be skipped, perhaps another 'mode' flag?
            auto vn         = root.as<value_node>();
            _old_value_size = vn->value_size();

            return make_value(state.get_new_region(), root.rlock(), _cur_val);
         }
         throw std::runtime_error("unexpected eof node type");
      }
      else if constexpr (mode.is_unique())
      {
         assert(root.ref() == 1);
         if (root.type() == node_type::value)
         {
            auto vn         = root.as<value_node>();
            _old_value_size = vn->value_size();

            assert(_cur_val.is_view());
            auto vv = _cur_val.view();
            if (vn->value_capacity() >= _cur_val.size())
            {
               //  TRIEDENT_DEBUG("update in place");
               root.modify().as<value_node>()->set_value(vv);
               return root.address();
            }
            //TRIEDENT_DEBUG("remake value to make more space");
            return remake<value_node>(root, key_view{}, _cur_val).address();
         }
         else  // replacing a subtree with some other kind of value
         {
            return make_value(state.get_new_region(), root.rlock(), _cur_val);
         }
      }
   }

   template <upsert_mode mode>
   id_address clone_binary_range(id_region          reg,
                                 object_ref&        r,
                                 const binary_node* src,
                                 key_view           minus_prefix,
                                 int                from,
                                 int                to)
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

      auto& state       = r.rlock();
      auto  init_binary = [&](binary_node* bn)
      {
         bn->_branch_id_region = state.get_new_region().to_int();

         for (int i = from; i < to; ++i)
         {
            auto kvp  = src->get_key_val_ptr(i);
            auto nkey = kvp->key().substr(minus_prefix.size());
            auto nkh  = binary_node::key_header_hash(binary_node::key_hash(nkey));

            // if shared we need to retain any obj_ids/subtrees we migrate
            if constexpr (mode.is_shared())
            {
               if (src->is_obj_id(i))
               {
                  state.get(kvp->value_id()).retain();
               }
            }

            bn->append(kvp, minus_prefix.size(), nkh, src->value_hashes()[i],
                       src->key_offsets()[i].val_type());
         }
      };
      return make<binary_node>(reg, state, {.branch_cap = nbranch, .data_cap = total_kv_size},
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
   object_ref refactor(object_ref& r, const binary_node* root)
   {
      //TRIEDENT_WARN("REFACTOR! ", r.address());
      assert(root->num_branches() > 1);
      auto first_key     = root->get_key(0);
      auto last_key      = root->get_key(root->num_branches() - 1);
      auto cpre          = common_prefix(first_key, last_key);
      bool has_eof_value = first_key.size() == cpre.size();

      int_fast16_t nbranch = has_eof_value;
      int_fast16_t freq_table[256];

      memset(freq_table, 0, sizeof(freq_table));

      auto numb = root->num_branches();
      for (uint32_t i = has_eof_value; i < numb; ++i)
      {
         auto k = root->get_key(i);
         assert(k.size() > cpre.size());
         uint8_t f = k[cpre.size()];
         nbranch += freq_table[f] == 0;
         freq_table[f]++;
      }

      auto       bregion = r.rlock().get_new_region();
      id_address eof_val;
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

         // TRIEDENT_DEBUG( "branch: ", to_hex(byte), " key: ", to_hex(k) );
         id_address new_child;
         if (to - from > 1)
            new_child =
                clone_binary_range<mode>(bregion, r, root, k.substr(0, cpre.size() + 1), from, to);
         else
         {
            auto kvp = root->get_key_val_ptr(from);
            if (root->is_subtree(from))
            {
               new_child = make<value_node>(bregion, r.rlock(), kvp->key().substr(cpre.size() + 1),
                                            value_type::make_subtree(kvp->value_id()))
                               .address();
               //auto cval = r.rlock().get(kvp->value_id());
               if constexpr (mode.is_shared())
               {
                  // TODO: is this tested?
                  r.rlock().get(kvp->value_id()).retain();
               }
            }
            else if (root->is_obj_id(from))
            {
               // TODO: when mode is unique we may be able to use remake rather than make; however,
               //       we must make sure that the reference count isn't lost and that the
               //       value node also has a ref count of 1... may have to retain it in that event
               //       so that when the binary node is released it goes back to 1... for the time being
               //       we will just allocate a new value node and let the binary node clean up the old
               //       binary node at the expense of an extra ID allocation.
               auto cval = r.rlock().get(kvp->value_id());
               new_child = make<value_node>(bregion, r.rlock(), kvp->key().substr(cpre.size() + 1),
                                            cval.as<value_node>()->value())
                               .address();
               if constexpr (mode.is_unique())
                  release_node(cval);
            }
            else
            {
               //   TRIEDENT_WARN( ".... make new value node" );
               new_child = make<value_node>(bregion, r.rlock(), kvp->key().substr(cpre.size() + 1),
                                            root->get_value(from))
                               .address();
            }
         }
         from = to;

         assert(next_branch < branches + nbranch);
         *next_branch = {byte, new_child.index().to_int()};
         ++next_branch;
         //fn->add_branch(uint16_t(byte) + 1, new_child);
      }
      //TRIEDENT_WARN( "next - start: ", next_branch - branches, "  nb: ", nbranch );

      // this branch requires many small keys and small values
      if (nbranch > 128)
      {
         auto init_full = [&](full_node* fn)
         {
            fn->set_branch_region(bregion);
            fn->set_eof(eof_val);
            fn->set_descendants(root->_num_branches);
            //TRIEDENT_DEBUG( "num_br: ", root->_num_branches, " desc: ", fn->descendants() );
            for (auto& p : branches)
               fn->add_branch(branch_index_type(p.first) + 1, id_address(bregion, p.second));
         };
         if constexpr (mode.is_unique())
         {
            return remake<full_node>(r, init_full, clone_config{.set_prefix = cpre});
         }
         else
         {
            return make<full_node>(r.address().region().to_int(), r.rlock(), {.set_prefix = cpre},
                                   init_full);
         }
      }

      auto init_setlist = [&](setlist_node* sl)
      {
         sl->set_branch_region(bregion);
         assert(sl->_num_branches == 0);
         assert(sl->branch_capacity() >= nbranch - has_eof_value);

         sl->_num_branches = nbranch - has_eof_value;
         sl->set_eof(eof_val);
         sl->set_descendants(root->_num_branches);

         int nb = sl->_num_branches;
         for (int i = 0; i < nb; ++i)
         {
            sl->set_index(i, branches[i].first, id_address(bregion, branches[i].second));
         }
         assert(sl->get_setlist_size() == nb);
         assert(sl->validate());
      };

      if constexpr (mode.is_unique())
         return remake<setlist_node>(r, init_setlist,
                                     clone_config{.branch_cap = nbranch, .set_prefix = cpre});
      else
         return make<setlist_node>(r.address().region().to_int(), r.rlock(),
                                   {.branch_cap = nbranch, .set_prefix = cpre}, init_setlist);
   }
   template <upsert_mode mode, typename NodeType>
   object_ref refactor_to_full(object_ref& r, const NodeType* src, auto init)
   {
      auto init_fn = [&](full_node* fn)
      {
         fn->set_branch_region(src->branch_region());
         fn->set_descendants(src->descendants());
         src->visit_branches_with_br(
             [&](short br, id_address oid)
             {
                // TODO: it should be possible to remove this branch
                // because it will always mispredict once
                if (br) [[likely]]
                   fn->add_branch(br, oid);
                else
                   fn->set_eof(oid);
                if constexpr (mode.is_shared())
                   r.rlock().get(oid).retain();
             });
         init(fn);
         assert(fn->num_branches() >= full_node_threshold);
      };
      if constexpr (mode.is_unique())
         return remake<full_node>(r, init_fn, clone_config{.set_prefix = src->get_prefix()});
      else
         return make<full_node>(r.address().region().to_int(), r.rlock(),
                                {.set_prefix = src->get_prefix()}, init_fn);
   }

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
   //     [o] -> value_node (in R2) because cannot be same as parent)
   //           "stfix" = "value"
   //

   template <upsert_mode mode, typename NodeType>
   id_address write_session::upsert_prefix(object_ref&     r,
                                           key_view        key,
                                           key_view        cpre,
                                           const NodeType* fn,
                                           key_view        rootpre)
   {
      auto& state = r.rlock();
      if constexpr (mode.is_remove())
      {
         if constexpr (mode.must_remove())
            throw std::runtime_error("attempt to remove key that does not exist");
         return r.address();
      }
      if constexpr (mode.must_update())
      {
         throw std::runtime_error("attempt to update key that does not exist");
      }
      //   TRIEDENT_DEBUG("KEY DOESN'T SHARE PREFIX  node prelen: ", rootpre.size(), "  cprelen: ", cpre.size());
      //  TRIEDENT_WARN( "root prefix: ", to_hex( rootpre ) );
      //  TRIEDENT_WARN( "insert: ", to_hex(key) );

      assert(cpre.size() < rootpre.size());

      auto new_reg = state.get_new_region();
      // TRIEDENT_DEBUG( "New Region: ", new_reg );
      while (id_region(new_reg) == r.address().region() or
             id_region(new_reg) == id_region(fn->branch_region())) [[unlikely]]
         new_reg = state.get_new_region();

      // there is a chance that r.modify() will rewrite the data
      // pointed at by rootpre... so we should read what we need first
      char root_prebranch = rootpre[cpre.size()];

      id_address child_id;

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
            // release old root if unique because it doesn't happen automatically for unique;
            release_node(r);
         }
      }

      if (key.size() == cpre.size())
      {  // eof
         //   TRIEDENT_DEBUG("  value is on the node (EOF)");
         _delta_keys = 1;
         auto v      = make_value(child_id.region().to_int(), state, _cur_val);
         // must be same region as r because we can't cange the region our parent
         // put this node in.
         return make<setlist_node>(r.address().region().to_int(), state,
                                   {.branch_cap = 2, .set_prefix = cpre},
                                   [&](setlist_node* sln)
                                   {
                                      //                                TRIEDENT_WARN("CHILD ID REGION INSTEAD OF NEW?");
                                      sln->set_branch_region(child_id.region().to_int());
                                      sln->set_eof(v);
                                      sln->add_branch(char_to_branch(root_prebranch), child_id);
                                      sln->set_descendants(1 + fn->descendants());
                                   })
             .address();
      }
      else
      {  // branch node
         //       TRIEDENT_DEBUG("  two branch child, cpre: ", to_hex(cpre), "  key: ", to_hex(key),
         //                     " rpre: ", to_hex(rootpre));
         //
         // NOTE: make_binary with 1 key currently makes a value_node.. TODO: rename
         auto abx =
             make_binary(child_id.region().to_int(), state, key.substr(cpre.size() + 1), _cur_val);
         _delta_keys = 1;
         return make<setlist_node>(
                    r.address().region().to_int(), state, {.branch_cap = 2, .set_prefix = cpre},
                    [&](setlist_node* sln)
                    {
                       sln->set_branch_region(new_reg);
                       std::pair<branch_index_type, id_address> brs[2];
                       sln->set_descendants(1 + fn->descendants());

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
   }  // upsert_prefix

   /**
    * NodeType should be an inner_node and the current value should be inserted at
    * the eof position on this node.
    */
   template <upsert_mode mode, typename NodeType>
   id_address write_session::upsert_eof(object_ref& r, const NodeType* fn)
   {
      if constexpr (mode.is_remove())
         return remove_eof<mode, NodeType>(r, fn);

      auto& state = r.rlock();

      //  TRIEDENT_WARN("upsert value node on inner node");
      if (fn->has_eof_value())  //val_nid)
      {
         id_address val_nid = fn->get_eof_value();
         auto       old_val = state.get(val_nid);
         if constexpr (mode.is_unique())
         {
            if (_cur_val.is_subtree())
            {
               r.modify().as<NodeType>()->set_eof_subtree(_cur_val.subtree_address());
               release_node(old_val);
            }
            else
            {
               //TRIEDENT_DEBUG("... upsert_value<mode>\n");
               id_address new_id = upsert_eof_value<mode>(old_val);
               if (new_id != val_nid)
               {
                  TRIEDENT_WARN("new id: ", new_id, " old val: ", val_nid);
                  TRIEDENT_WARN("replacing..");
                  r.modify().as<NodeType>()->set_eof(new_id);
                  release_node(old_val);
               }
            }
            return r.address();
         }
         else  // shared node
         {
            if (_cur_val.is_subtree())
            {
               auto cref =
                   clone<mode>(r, fn, {.branch_cap = 16},
                               [&](auto cl) { cl->set_eof_subtree(_cur_val.subtree_address()); });
               release_node(old_val);
               return cref.address();
            }
            else
            {
               //  TRIEDENT_WARN("upsert value node on inner node");
               auto new_id = upsert_eof_value<mode>(old_val);
               assert(new_id != val_nid);  // because shared state
               auto cref =
                   clone<mode>(r, fn, {.branch_cap = 16}, [&](auto cl) { cl->set_eof(new_id); });
               release_node(old_val);
               return cref.address();
            }
         }
      }
      else  // there is no value stored here
      {
         _delta_keys = 1;
         if (_cur_val.is_subtree())
         {
            if constexpr (mode.is_unique())
            {
               r.modify().template as<NodeType>(
                   [this](auto p)
                   {
                      p->set_eof_subtree(_cur_val.subtree_address());
                      p->add_descendant(1);
                   });
               return r.address();
            }
            else
            {
               return clone<mode>(r, fn, {.branch_cap = 1},
                                  [&](auto cl)
                                  {
                                     cl->set_eof_subtree(_cur_val.subtree_address());
                                     cl->add_descendant(1);
                                  })
                   .address();
            }
         }
         else  // inserting data
         {
            id_address new_id = make_value(fn->branch_region(), state, _cur_val);
            if constexpr (mode.is_unique())
            {
               r.modify().template as<NodeType>(
                   [new_id](auto* p)
                   {
                      p->set_eof(new_id);
                      p->add_descendant(1);
                   });
               return r.address();
            }
            else
            {
               TRIEDENT_DEBUG(" clone add new value to branch 0, val =", _cur_val);
               return clone<mode>(r, fn, {.branch_cap = 16},
                                  [&](auto cl)
                                  {
                                     cl->set_eof(new_id);
                                     cl->add_descendant(1);
                                  })
                   .address();
            }
         }
      }
   }

   template <upsert_mode mode, typename NodeType>
   id_address write_session::remove_eof(object_ref& r, const NodeType* fn)
   {
      auto& state = r.rlock();
      //      TRIEDENT_DEBUG( "remove key ends on this node" );
      if (fn->has_eof_value())
      {
         _delta_keys = -1;
         if constexpr (mode.is_unique())
         {
            //   TRIEDENT_DEBUG( "mode is unique?" );
            release_node(state.get(fn->get_eof_value()));
            r.modify().as<NodeType>(
                [](auto* p)
                {
                   p->set_eof({});
                   p->remove_descendant(1);
                });

            if (fn->num_branches() == 0)
               return id_address();
            return r.address();
         }
         else  // mode.is_shared()
         {
            //TRIEDENT_WARN("release eof value (shared)");
            if (fn->num_branches() == 0)
            {
               //  TRIEDENT_DEBUG("  num_branch == 0, return null");
               return id_address();
            }
            return clone<mode>(r, fn, {},
                               [&](auto cl)
                               {
                                  //                                 TRIEDENT_DEBUG("remove eof value from clone");
                                  release_node(state.get(cl->get_eof_value()));
                                  cl->set_eof({});
                                  cl->remove_descendant(1);
                               })
                .address();
         }
      }
      if constexpr (mode.must_remove())
         throw std::runtime_error("attempt to remove key that doesn't exist");

      _delta_keys = 0;
      return r.address();
   }
   template <upsert_mode mode, typename NodeType>
   id_address write_session::upsert_inner_existing_br(object_ref&       r,
                                                      key_view          key,
                                                      const NodeType*   fn,
                                                      key_view          cpre,
                                                      branch_index_type bidx,
                                                      id_address        br)
   {
      auto& state = r.rlock();

      // existing branch
      //      TRIEDENT_WARN( "upserting into existing branch: ", br, " with ref: ",
      //                    state.get(br).ref() );
      auto brn = state.get(br);
      if constexpr (mode.is_unique())
      {
         auto new_br = upsert<mode>(brn, key.substr(cpre.size() + 1));
         if constexpr (mode.is_remove())
         {
            if (not new_br)
            {  // then something clearly got removed
               assert(_delta_keys == -1);
               r.modify().as<NodeType>(
                   [=](auto* p)
                   {
                      p->remove_descendant(1);
                      p->remove_branch(bidx);
                   });
               if (fn->num_branches() + fn->has_eof_value() > 0)
                  return r.address();
               else
                  return id_address();
            }
            if (br != new_br)
            {
               assert(_delta_keys == -1);
               // if key was not found, then br would == new_br
               r.modify().as<NodeType>(
                   [bidx, new_br, this](auto* p)
                   {
                      p->remove_descendant(1);
                      p->set_branch(bidx, new_br);
                   });
               return r.address();
            }

            if (_delta_keys)
            {
               assert(_delta_keys == -1);
               r.modify().as<NodeType>([this](auto* p) { p->add_descendant(-1); });
            }

            return r.address();
         }
         else  //  update or insert
         {
            if (br != new_br)
               r.modify().as<NodeType>(
                   [bidx, new_br, this](auto* p)
                   {
                      p->add_descendant(_delta_keys);
                      p->set_branch(bidx, new_br);
                   });
            else if (_delta_keys)
            {
               r.modify().as<NodeType>([this](auto* p) { p->add_descendant(_delta_keys); });
            }
            return r.address();
         }
      }
      else  // shared_node
      {
         if constexpr (mode.is_remove())
         {
            //    TRIEDENT_DEBUG( "remove key ", key );
            // brn.retain();  // because upsert might release() it
            node_handle temp_retain(*this, brn.address());
            auto        new_br = upsert<mode>(brn, key.substr(cpre.size() + 1));
            if (not new_br)
            {
               if (fn->num_branches() + fn->has_eof_value() > 1)
               {
                  assert(_delta_keys == -1);
                  auto cl = clone<mode>(r, fn, {});
                  //     release_node(brn);  // because we retained before upsert(),
                  // and retained again in clone
                  cl.modify().template as<NodeType>(
                      [bidx](auto* p)
                      {
                         p->remove_descendant(1);
                         p->remove_branch(bidx);
                      });
                  return cl.address();
               }
               // because we didn't use to release it...
               temp_retain.take();

               return id_address();
            }
            else
            {
               if (br != new_br)
               {  // something was removed
                  assert(_delta_keys == -1);
                  auto cl = clone<mode>(r, fn, {});
                  //      release_node(brn);  // because we retained before upsert(),
                  // and retained again in clone
                  cl.modify().template as<NodeType>(
                      [bidx, new_br](auto* p)
                      {
                         p->remove_descendant(1);
                         p->set_branch(bidx, new_br);
                      });
                  return cl.address();
               }
               else
               {  // nothing was removed
                  //       release_node(brn);  // because we retained it just in case
               }
               assert(_delta_keys == 0);
               return r.address();
            }
         }
         else  // update/insert
         {
            // clone before upsert because upsert will release the branch when
            // it returns the new one
            //TRIEDENT_DEBUG( "clone: ", r.address(), " before upsert into branch: ", brn.address() );
            auto cl     = clone<mode>(r, fn, {});
            auto new_br = upsert<mode>(brn, key.substr(cpre.size() + 1));
            assert(br != new_br);
            cl.modify().template as<NodeType>(
                [bidx, new_br, this](auto p)
                {
                   // upsert releases brn... which is why we
                   // don't have to retain new_brn when we modify
                   p->set_branch(bidx, new_br);
                   p->add_descendant(_delta_keys);
                });
            //    TRIEDENT_DEBUG( "returning clone: ", cl.address() );
            return cl.address();
         }
      }
   }

   template <upsert_mode mode, typename NodeType>
   id_address write_session::upsert_inner_new_br(object_ref&       r,
                                                 key_view          key,
                                                 const NodeType*   fn,
                                                 key_view          cpre,
                                                 branch_index_type bidx,
                                                 id_address        br)
   {
      auto& state = r.rlock();
      if constexpr (mode.must_remove())
         throw std::runtime_error("unable to find key to remove it");
      else if constexpr (mode.is_remove())
         return r.address();
      else if constexpr (mode.must_update())
         throw std::runtime_error("unable to find key to update value");
      else
      {
         // NOTE: make_binary with one key is currently implimented
         // as making a value node
         auto new_bin =
             make_binary(fn->branch_region(), state, key.substr(cpre.size() + 1), _cur_val);
         _delta_keys = 1;
         if constexpr (mode.is_unique())
         {
            if (fn->can_add_branch())
            {
               r.modify().template as<NodeType>(
                   [bidx, new_bin](auto p)
                   {
                      p->add_branch(bidx, new_bin);
                      p->add_descendant(1);
                   });
               return r.address();
            }
         }
         if constexpr (not std::is_same_v<full_node, NodeType>)
         {
            if (fn->num_branches() + 1 >= full_node_threshold)
            {
               return refactor_to_full<mode>(r, fn,
                                             [&](auto fptr)
                                             {
                                                fptr->add_branch(bidx, new_bin);
                                                fptr->add_descendant(1);
                                             })
                   .address();
            }
         }

         return clone<mode>(r, fn, {.branch_cap = fn->num_branches() + 1},
                            [&](auto cptr)
                            {
                               cptr->add_branch(bidx, new_bin);
                               cptr->add_descendant(1);
                            })
             .address();
      }
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
   id_address write_session::upsert_inner(object_ref& r, key_view key)
   {
      auto& state = r.rlock();
      auto  fn    = r.as<NodeType>();

      auto rootpre = fn->get_prefix();
      auto cpre    = common_prefix(rootpre, key);

      // key does not share the same prefix, insert above this node
      if (cpre.size() != rootpre.size()) [[unlikely]]
         return upsert_prefix<mode>(r, key, cpre, fn, rootpre);

      // else recurse into this node

      // on any given node there is a 256/257 chance this is true
      // on any given path this will be true for all parent nodes
      if (cpre.size() < key.size()) [[likely]]
      {
         const auto bidx = char_to_branch(key[cpre.size()]);
         auto       br   = fn->get_branch(bidx);
         if (br) [[likely]]  // for the top of the tree
            return upsert_inner_existing_br<mode>(r, key, fn, cpre, bidx, br);
         // else create a new branch
         return upsert_inner_new_br<mode>(r, key, fn, cpre, bidx, br);
      }

      // the key ends on this node, store value here
      return upsert_eof<mode, NodeType>(r, fn);
   }  // end upsert_inner<T>

   template <upsert_mode mode>
   id_address write_session::upsert_binary(object_ref& root, key_view key)
   {
      auto bn = root.as<binary_node>();

      int_fast16_t lb_idx;
      uint64_t     key_hash  = binary_node::key_hash(key);
      bool         key_found = false;
      if constexpr (mode.must_insert())
      {
         _delta_keys = 1;
         // no need to test/search for existing node in hash list,
         // the caller already expects this to be an insert
         lb_idx = bn->lower_bound_idx(key);
         if (lb_idx < bn->num_branches())
            key_found = key == bn->get_key(lb_idx);

         // this is unlikey because the caller explictly told us
         // to perform an insert and not an update and we assume the
         // caller would call "upsert" if they didn't know if the key
         // existed or not.
         if (key_found)
            throw std::runtime_error("insert failed because key exists");
      }
      else if constexpr (mode.must_update())
      {
         _delta_keys = 0;
         // there must be a key key to update
         lb_idx    = bn->find_key_idx(key, key_hash);
         key_found = lb_idx != binary_node::key_not_found;
      }
      else  // we may insert or update or remove
      {
         // optimistically search for key to update
         lb_idx    = bn->find_key_idx(key, key_hash);
         key_found = lb_idx != binary_node::key_not_found;

         // but fall back to the lower bound to insert
         if (not key_found)
         {
            lb_idx = bn->lower_bound_idx(key);
            if constexpr (mode.is_remove())
               _delta_keys = 0;
            else
               _delta_keys = 1;
         }
         else  // key found
            if constexpr (mode.is_remove())
               _delta_keys = -1;
      }

      if (key_found)
      {
         if constexpr (mode.is_remove())
            return remove_binary_key<mode>(root, bn, lb_idx, key);
         return update_binary_key<mode>(root, bn, lb_idx, key);
      }
      // else key not found, insert a new value

      if constexpr (mode.must_update())
         throw std::runtime_error("update failed because key doesn't exist");

      if constexpr (mode.is_remove())
      {
         if constexpr (mode.must_remove())
            throw std::runtime_error("remove failed because key doesn't exist");
         else
            return root.address();
      }

      if constexpr (mode.is_unique())
      {
         // assuming we allocate binary nodes with space and grow them
         // every time we have to clone them anyway, then this should be
         // true, especially because we are in the unique path.
         if (bn->can_insert(key, _cur_val)) [[likely]]
         {
            if (bn->can_inline(_cur_val))
            {  // subtree or data
               kv_index kvi(lb_idx,
                            _cur_val.is_subtree() ? kv_type::subtree : kv_type::inline_data);
               root.modify().as<binary_node>()->insert(kvi, key, _cur_val);
            }
            else  // definite obj_id (aka value node)
               root.modify().as<binary_node>()->insert(
                   kv_index(lb_idx, kv_type::obj_id), key,
                   value_type::make_value_node(
                       make_value(bn->branch_region(), root.rlock(), _cur_val)));
            return root.address();
         }
         // else we have to refactor...
      }
      // else mode is shared or unique and we cannot insert into existing
      // space.

      // worst case keys are 1kb and this misses 25% of the time
      // best case keys are small and this misses <1% of the time
      if (bn->insert_requires_refactor(key, _cur_val)) [[unlikely]]
      {
         auto rid = refactor<mode>(root, bn);

         assert((mode.is_unique() and (rid.address() == root.address())) or
                ((mode.is_shared()) and (rid.address() != root.address())));

         // if it wasn't unique before and the id changed then
         // it has become unique. If it was unique before, then
         // it remains unique now.
         return upsert<mode.make_unique()>(rid, key);
      }

      if (binary_node::can_inline(_cur_val))
         return clone<mode>(root, bn, {},
                            binary_node::clone_insert(
                                kv_index(lb_idx, _cur_val.is_subtree() ? kv_type::subtree
                                                                       : kv_type::inline_data),
                                key, _cur_val))
             .address();

      return clone<mode>(
                 root, bn, {},
                 binary_node::clone_insert(kv_index(lb_idx, kv_type::obj_id), key,
                                           value_type::make_value_node(make_value(
                                               bn->branch_region(), root.rlock(), _cur_val))))
          .address();
   }  // upsert_binary

   template <upsert_mode mode>
   id_address write_session::remove_binary_key(object_ref&        root,
                                               const binary_node* bn,
                                               uint16_t           lb_idx,
                                               key_view           key)
   {
      auto kvp        = bn->get_key_val_ptr(lb_idx);
      _old_value_size = kvp->value_size();

      assert(kvp->key() == key);
      if constexpr (mode.is_unique())
      {
         if (bn->is_obj_id(lb_idx))
         {
            auto vn = root.rlock().get(kvp->value_id());
            if (bn->is_subtree(lb_idx))
               _old_value_size = 4;
            else
               _old_value_size = vn.as<value_node>()->value_size();
            release_node(vn);
         }

         root.modify().as<binary_node>([&](auto* b) { b->remove_value(lb_idx); });

         if (bn->num_branches() == 0)
            return id_address();

         return root.address();
      }
      else  // not unique, must clone to update it
      {
         if (bn->num_branches() > 1)
         {
            auto cl = clone<mode>(root, bn, {}, binary_node::clone_remove(lb_idx)).address();

            if (bn->is_obj_id(lb_idx))
            {
               auto vn         = root.rlock().get(kvp->value_id());
               _old_value_size = vn.as<value_node>()->value_size();
               release_node(vn);
            }

            return cl;
         }
         return id_address();
      }
   }

   /**
    *  update_binary_key: 
    *   
    *
    *  cases:
    *    refactoring could be growing the node or splitting to radix if
    *    the binary node is already too full
    *
    *    unique & shared:
    *     inline     -> smaller inline
    *     inline     -> bigger inline (or maybe refactor)
    *     inline     -> value node (or maybe refactor)
    *     inline     -> subtree (or maybe refactor)
    *     value node -> bigger value node
    *     value node -> smaller value node
    *     value node -> smaller inline (new value less than ptr)
    *     value node -> inline (or maybe refactor)
    *     value node -> subtree
    *     subtree    -> inline (or maybe refactor)
    *     subtree    -> value node
    */
   template <upsert_mode mode>
   id_address write_session::update_binary_key(object_ref&        root,
                                               const binary_node* bn,
                                               uint16_t           lb_idx,
                                               key_view           key)
   {
      const auto* kvp = bn->get_key_val_ptr(lb_idx);
      assert(kvp->key() == key);

      int inline_size = _cur_val.size();
      if (not bn->can_inline(inline_size))
         inline_size = sizeof(id_address);
      auto delta_s = inline_size - kvp->value_size();

      // this handles the case where the would be forced to grow
      // beyond the maximum size of a binary node
      if (not bn->can_update_with_compaction(delta_s))
      {
         // reclaims free space within the node...
         auto rid = refactor<mode>(root, bn);

         // refactor in shared mode produces a new unique node...
         return upsert<mode.make_unique()>(rid, key);
      }

      if constexpr (mode.is_unique())
      {
         // current value is value node or subtree
         if (bn->is_obj_id(lb_idx))
         {
            auto cval = root.rlock().get(kvp->value_id());
            if (bn->is_subtree(lb_idx))
               _old_value_size = sizeof(id_address);
            else
               _old_value_size = cval.as<value_node>()->value_size();

            uint64_t new_value_size = sizeof(id_address);
            if (not _cur_val.is_subtree())
               new_value_size = _cur_val.view().size();

            if (bn->can_inline(_cur_val))
            {
               release_node(cval);

               // value node -> smaller inline (or subtree)
               if (new_value_size <= sizeof(id_address))
               {
                  //   TRIEDENT_WARN("value node -> smaller inline" );
                  auto kvt = _cur_val.is_subtree() ? kv_type::subtree : kv_type::inline_data;
                  root.modify().as<binary_node>()->set_value(kv_index(lb_idx, kvt), _cur_val);
                  return root.address();
               }
               else  // value node -> larger inline
               {
                  assert(_cur_val.is_view());
                  // inplace
                  if (bn->can_reinsert(key, _cur_val))
                  {
                     //     TRIEDENT_WARN("value node -> larger inline" );
                     root.modify().as<binary_node>()->reinsert(kv_index(lb_idx), key,
                                                               _cur_val.view());
                     return root.address();
                  }

                  // recapture deadspace
                  return remake<binary_node>(root, bn, clone_config{},
                                             binary_node::clone_update(kv_index(lb_idx), _cur_val))
                      .address();
               }
            }
            else  // value node -> updated value node
            {
               auto nv = upsert_value<mode>(cval, {});
               if (nv != kvp->value_id())
               {
                  TRIEDENT_WARN("release old value...?");
                  //release_node(cval);
                  root.modify().as<binary_node>()->set_value(kv_index(lb_idx, kv_type::obj_id),
                                                             value_type::make_value_node(nv));
               }
               return root.address();
            }
         }
         else  // stored value is inline data
         {
            _old_value_size = kvp->value_size();
            if (_cur_val.is_view())  // new value is data
            {
               auto new_value_size = _cur_val.view().size();
               // inline -> eq or smaller inline
               if (_cur_val.view().size() <= _old_value_size)
               {
                  root.modify().as<binary_node>()->set_value(kv_index(lb_idx), _cur_val.view());
                  return root.address();
               }
               // inline -> larger inline
               else if (bn->can_inline(new_value_size))
               {
                  if (bn->can_reinsert(key, _cur_val))
                  {
                     root.modify().as<binary_node>()->reinsert(kv_index(lb_idx), key, _cur_val);
                     return root.address();
                  }
                  else
                     return remake<binary_node>(
                                root, bn, clone_config{},
                                binary_node::clone_update(kv_index(lb_idx), _cur_val))
                         .address();
               }
               else  // inline -> value_node
               {
                  auto nval = make_value(bn->branch_region(), root.rlock(), _cur_val);
                  auto vval = value_type::make_value_node(nval);
                  // TODO kidx is irrelevant now that value_node is encoded in value_type
                  kv_index kidx(lb_idx, kv_type::obj_id);

                  if (_old_value_size >= sizeof(id_address))
                  {
                     // we can update the value in place
                     root.modify().as<binary_node>()->set_value(kidx, vval);
                     return root.address();
                  }
                  else
                  {
                     // reinsert in place in current node.
                     if (bn->can_reinsert(key, vval))
                     {
                        root.modify().as<binary_node>()->reinsert(kidx, key, vval);
                        return root.address();
                     }
                     // grow to larger binary node
                     return remake<binary_node>(root, bn, clone_config{},
                                                binary_node::clone_update(kidx, vval))
                         .address();
                  }
               }
            }
            else  // replace inline data with subtree
            {
               kv_index kidx(lb_idx, kv_type::subtree);

               if (sizeof(id_address) >= _old_value_size)
               {
                  // we can update in place
                  root.modify().as<binary_node>()->set_value(kidx, _cur_val);
                  return root.address();
               }
               else
               {
                  if (bn->can_reinsert(key, _cur_val))
                  {
                     root.modify().as<binary_node>()->reinsert(kidx, key, _cur_val);
                     return root.address();
                  }
                  else
                  {
                     // TODO: this could fail if the required size is beyond the
                     // maximum size for a binary node
                     return remake<binary_node>(root, bn, clone_config{},
                                                binary_node::clone_update(kidx, _cur_val))
                         .address();
                  }
                  // we may have to reinsert and/or refactor...
               }
            }
         }
      }
      else  // shared mode
      {
         if (bn->is_obj_id(lb_idx))  // current address (subtree/value_node)
         {
            auto cval       = root.rlock().get(kvp->value_id());
            _old_value_size = cval.as<value_node>()->value_size();
            // TODO.... what if clone fails because not enough space
            if (bn->can_inline(_cur_val.view()))
            {
               auto r =
                   clone<mode>(root, bn, {}, binary_node::clone_update(kv_index(lb_idx), _cur_val));
               release_node(cval);  // because clone retained a copy
               return r.address();
            }
            else
            {
               auto nval = make_value(bn->branch_region(), root.rlock(), _cur_val);
               auto r    = clone<mode>(root, bn, {},
                                    binary_node::clone_update(kv_index(lb_idx, kv_type::obj_id),
                                                                 value_type::make_value_node(nval)));
               release_node(cval);  // because clone retained a copy
               return r.address();
            }
         }
         else
         {
            _old_value_size = kvp->value_size();
         }

         if (_cur_val.is_view())  // we are inserting data blob
         {
            if (bn->can_inline(_cur_val.view()))
            {
               auto r =
                   clone<mode>(root, bn, {}, binary_node::clone_update(kv_index(lb_idx), _cur_val));
               return r.address();
            }
            else
            {
               auto nval = make_value(bn->branch_region(), root.rlock(), _cur_val);
               return clone<mode>(root, bn, {},
                                  binary_node::clone_update(kv_index(lb_idx, kv_type::obj_id),
                                                            value_type::make_value_node(nval)))
                   .address();
            }
         }
         else
         {
            TRIEDENT_WARN("subtree case not implimented yet");
            throw std::runtime_error("subtree not implimented");
         }
      }

#if 0

         if (delta_s <= 0)  // update doesn't require reinsert
         {
            if (bn->is_obj_id(lb_idx))  // current address (subtree/value_node)
            {
               // TODO: this assumes no subtrees have been stored directly.
               auto cval = root.rlock().get(kvp->value_id());

               if (_cur_val.is_object_id()) // we are inserting a subtree
               {  
                  throw std::runtime_error( "subtrees need to be tested" );
                  // so is updated value
                  // store the new value, if necessary
                  if (_cur_val.id() != cval.address())
                     root.modify().as<binary_node>()->set_value(lb_idx, _cur_val.id());

                  // release the old value regardless because old and update value each
                  // owns one retain() for a total of 2, but only stored once.
                  release_node(cval);
                  return root.address();  // update in place is complete
               }

               if( not bn->can_inline( _cur_val.view() ) ) {
                  auto nval = upsert_value<mode>( cval );
                  if( nval != kvp->value_id() ) {
                     root.modify().as<binary_node>()->set_value(lb_idx, _cur_val.id());
                  }
                  return root.address();
               }
               _old_value_size = cval.as<value_node>()->value_size();

               if (bn->can_inline(_cur_val.view()))
               {
                  // that can be inlined in the same space as existing address
                  assert( _cur_val.view().size() <= b->get_key_val_ptr(lb_idx)->value_size() );
                  assert(_cur_val.view().size() <= sizeof(id_address));
                  if(_cur_val.view().size() <= sizeof(id_address)) {
                     root.modify().as<binary_node>()->set_value( lb_idx, _cur_val.view() );
                     release_node( cval ); // because we just overwrote its reference.
                  }
                  else {
                     if( bn->can_reinsert( key, _cur_val ) ) {
                        root.modify().as<binary_node>()->reinsert( lb_idx, key, _cur_val );
                     } else {
                        return remake<binary_node>(root, bn, clone_config{}, binary_node::clone_update(lb_idx, _cur_val))
                            .address();

                     }
                  }
                  return root.address();
               }
               /*
               else  // data must be put in a value node
               {
                  // TODO: if it is already in a value node...
                  // TODO: make_value knows type, why erase it again
                  auto nval = make_value(bn->branch_region(), root.rlock(), _cur_val);
                  root.modify().as<binary_node>()->set_value(lb_idx, nval);
               }
               */

                  // release the old value regardless because old and update value each
                  // owns one retain() for a total of 2, but only stored once.
                 // TODO: why was this here... release_node(cval);
                 //  return root.address();  // update in place is complete
            }
            else  // current key value is not obj id
            {
               if (_cur_val.is_object_id())
               {                                                   // but the incoming value is
                  assert(kvp->value_size() >= sizeof(object_id));  // because delta_s <= 0
                  root.modify().as<binary_node>()->set_value(lb_idx, _cur_val);
                  return root.address();  // we are done
               }
               else  // new value is data
               {
                  if (_cur_val.view().size() <= kvp->value_size())
                  {  //  that is less than equal to the old value
                     root.modify().as<binary_node>(
                         [&](auto* b)
                         {
                            b->get_key_val_ptr(lb_idx)->set_value(_cur_val.view());
                            assert(b->key_offsets()[lb_idx].type ==
                                   binary_node::key_index::inline_data);
                         });
                     return root.address();
                  }
                  else
                  {
                     // it must be too big to inline (delta_s <= 0)
                     // and must be big enough to store an address
                     assert(not bn->can_inline(_cur_val.view().size()));
                     assert(kvp->value_size() >= sizeof(object_id));

                     // TODO: make_value knows the type already, why erase it again
                     auto nval = make_value(bn->branch_region(), root.rlock(), _cur_val);

                     root.modify().as<binary_node>(
                         [&](auto* b)
                         {
                            b->get_key_val_ptr(lb_idx)->set_value(nval);
                            assert(b->key_offsets()[lb_idx].type == binary_node::key_index::obj_id);
                         });
                     return root.address();
                  }
               }
            }
         }
         else  // delta_s > 0, reinsert or grow required
         {
            if ( bn->is_obj_id(lb_idx) )
            {
               auto cval = root.rlock().get(kvp->value_id());
               auto cvalp = cval.as<value_node>();

               if( bn->can_inline( _cur_val ) ) 
               {
                  _old_value_size = cvalp->value_size();
                  release_node(cval);

                  //auto key = kvp->get_key();
                  if( bn->can_reinsert( key, _cur_val ) ) {
                     root.modify().as<binary_node>()->reinsert( lb_idx, key, _cur_val );
                  } else {
                     return remake<binary_node>(root, bn, clone_config{}, binary_node::clone_update(lb_idx, _cur_val))
                         .address();

                  }
               } else {
                  auto nval = upsert_value<mode>(cval,{}); 
                  if( nval != kvp->value_id() )
                     root.modify().as<binary_node>()->set_value( lb_idx, nval );
                  return root.address();
               }
            }
            else {
               _old_value_size = kvp->value_size();
            }

            // calculate the size needed to reinsert
            auto new_kvps = bn->calc_key_val_pair_size(key, _cur_val);

            if (_cur_val.is_view())
            {  // if new value is data
               if (bn->can_inline(_cur_val.view()))
               {  // that can be inlined
                  if (bn->can_insert(new_kvps))
                  {  // and we can insert it, then reinsert!
                     root.modify().as<binary_node>()->reinsert(lb_idx, key, _cur_val);
                     return root.address();
                  }
                  else  // clone update
                  {
                     return clone<mode>(root, bn, {}, binary_node::clone_update(lb_idx, _cur_val))
                         .address();
                  }
               }
               else  // cannot be inlined, so make a new value node
               {
                  auto nval = make_value(bn->branch_region(), root.rlock(), _cur_val);
                 // TRIEDENT_DEBUG( "making new value_node: ", nval );
                  if( _old_value_size >= sizeof(id_address) ) {
                  //   TRIEDENT_WARN( "storing new value node id in location of prior inline data" );
                     root.modify().as<binary_node>()->set_value(lb_idx, nval);
                     return root.address();
                  }
                  else if (bn->can_reinsert(key, nval) )  // reinsert if possible
                  {
               //      TRIEDENT_WARN( "reinsert binary node key as value node" );
                     root.modify().as<binary_node>()->reinsert(lb_idx, key, nval);
                     return root.address();
                  }
                  else  // clone to reinsert new node
                  {
                //     TRIEDENT_WARN( "forced to clone binary node to make room to inline key..." );
                     return clone<mode>(root, bn, {}, binary_node::clone_update(lb_idx, nval))
                         .address();
                  }
               }
            }
            else  // new value is an object id
            {
               assert(kvp->value_size() < sizeof(object_id));  // otherwse delta_s <= 0

               if (bn->can_insert(sizeof(object_id)))
               {
                  // TODO: why erase type on reinsert?
                  root.modify().as<binary_node>()->reinsert(lb_idx, key, _cur_val);
                  return root.address();
               }
               else
               {
                  return clone<mode>(root, bn, {}, binary_node::clone_update(lb_idx, _cur_val))
                      .address();
               }
            }
         }
      }
#endif
   }  // update_binary_key()

   /**
    * A binary node with a single key is now just a value node until there
    * is a collision. 
    */
   id_address write_session::make_binary(id_region         reg,
                                         session_rlock&    state,
                                         key_view          key,
                                         const value_type& val)
   {
      return make<value_node>(reg, state, key, val).address();

      // old impl below just in case.

      //TODO: configure how much spare capacity goes into nodes as they are being
      //created.  Currently adding 128 (2 cachelines) + what ever ounding out to nearest
      // 64 bytes is already going on.
      /*
      auto ss = binary_node::calc_key_val_pair_size(key, val) + binary_node_initial_size;
      return make<binary_node>(
                 reg, state, {.branch_cap = binary_node_initial_branch_cap, .data_cap = ss},
                 [&](binary_node* bn)
                 {
                    bn->set_branch_region(state.get_new_region());
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
                          bn->insert(0, key, make_value(bn->branch_region(), state, vv));
                    }
                 })
          .address();
      */
   }

}  // namespace arbtrie
