// note included at bottom of database.cpp

namespace arbtrie
{
   iterator iterator::subtree_iterator()const {
      return iterator( _rs, subtree() );
   }
   bool iterator::reverse_lower_bound_impl(object_ref<node_header>& r, const value_node* in, key_view query)
   {
      pushkey( in->key() );
      return query >= key_view();
   }
   bool iterator::lower_bound_impl(object_ref<node_header>& r, const value_node* in, key_view query)
   {
      pushkey( in->key() );
      return query <= key_view();
   }
   bool iterator::lower_bound_impl(object_ref<node_header>& r, const auto* in, key_view query)
   {
      auto node_prefix = in->get_prefix();
      pushkey(node_prefix);

      if (query <= node_prefix)
      {
         // go to first branch
         std::pair<branch_index_type, fast_meta_address> idx = in->lower_bound(0);
         if (idx.first == 0)
         {
            assert(_path.back().second == 0);
            //   _path.back().second = 0;
            return true;
         }

         if (idx.second)
         {
            _path.back().second = idx.first;
            pushkey(branch_to_char(idx.first));

            auto bref = r.rlock().get(idx.second);
            return lower_bound_impl(bref, {});
         }
         popkey(node_prefix.size() + 1);
         _path.pop_back();
         return false;
      }

      auto cpre = common_prefix(node_prefix, query);
      if (cpre != node_prefix)
      {
         popkey(node_prefix.size());
         return false;
      }

      auto remaining_query = query.substr(cpre.size());
      assert(remaining_query.size() > 0);

      std::pair<branch_index_type, fast_meta_address> idx =
          in->lower_bound(char_to_branch(remaining_query.front()));

      if (idx.second)
      {
         assert(idx.first != 0);  // that would be handled in query <= node_prefix

         _path.back().second = idx.first;

         auto bref = r.rlock().get(idx.second);
         pushkey(branch_to_char(idx.first));
         return lower_bound_impl(bref, remaining_query.substr(1));
      }
      popkey(node_prefix.size() + 1);
      return false;
   }

   bool iterator::reverse_lower_bound_impl(object_ref<node_header>& r, const auto* in, key_view query)
   {
      auto node_prefix = in->get_prefix();
      pushkey(node_prefix);

      if (query > node_prefix)
      {
         assert(query.size() > 0 );
         branch_index_type qidx = char_to_branch(query[0]);

         // go to last branch
         std::pair<branch_index_type, fast_meta_address> idx = in->reverse_lower_bound(qidx);
         assert( idx.second >= 0 );

         if (idx.first == 0)
         {
            assert(_path.back().second == 0);
            return true;
         }

         if (idx.second)
         {
            _path.back().second = idx.first;
            pushkey(branch_to_char(idx.first));

            auto bref = r.rlock().get(idx.second);
            return reverse_lower_bound_impl(bref, query.substr(1));
         }
         popkey(node_prefix.size() + _path.back().second > 0);
         _path.pop_back();
         return false;
      }

      auto cpre = common_prefix(node_prefix, query);
      if (cpre != node_prefix)
      {
         popkey(node_prefix.size() + _path.back().second != 0);
         return false;
      }

      auto remaining_query = query.substr(cpre.size());
      assert(remaining_query.size() > 0);

      std::pair<branch_index_type, fast_meta_address> idx =
          in->reverse_lower_bound(char_to_branch(remaining_query.front()));

      if (idx.second)
      {
         assert(idx.first != 0);  // that would be handled in query <= node_prefix

         _path.back().second = idx.first;

         auto bref = r.rlock().get(idx.second);
         pushkey(branch_to_char(idx.first));
         return reverse_lower_bound_impl(bref, remaining_query.substr(1));
      }
      popkey(node_prefix.size() + _path.back().second != 0 );
      return false;
   }

   bool iterator::lower_bound_impl(object_ref<node_header>& r,
                                   const binary_node*       bn,
                                   key_view                 query)
   {
      auto lbx            = bn->lower_bound_idx(query);
      _path.back().second = lbx;

      if (lbx >= bn->num_branches())
      {
         return false;
      }

      _path.back().second = lbx;
      auto kvp            = bn->get_key_val_ptr(lbx);
      pushkey(bn->get_key_val_ptr(lbx)->key());
      _size = kvp->value_size();

      return true;
   }
   bool iterator::reverse_lower_bound_impl(object_ref<node_header>& r,
                                   const binary_node*       bn,
                                   key_view                 query)
   {
      auto lbx            = bn->reverse_lower_bound_idx(query);
      _path.back().second = lbx;

      if (lbx < 0 )
         return false;

      auto kvp            = bn->get_key_val_ptr(lbx);
      pushkey(bn->get_key_val_ptr(lbx)->key());
      _size = kvp->value_size();

      return true;
   }

   bool iterator::lower_bound_impl(object_ref<node_header>& r, key_view query)
   {
      _path.push_back({r.address(), 0});
      if (not cast_and_call(r.header(),
                            [&](const auto* n) { return lower_bound_impl(r, n, query); }))
         return next();
      return true;
   }
   bool iterator::reverse_lower_bound_impl(object_ref<node_header>& r, key_view query)
   {
      _path.push_back({r.address(), 257});
      if (not cast_and_call(r.header(),
                            [&](const auto* n) { return reverse_lower_bound_impl(r, n, query); }))
         return prev();
      return true;
   }

   bool iterator::lower_bound(key_view prefix)
   {
      if (not _root.address())
         return end();

      auto& db    = _rs._db;
      auto  state = _rs._segas.lock();
      _branches.clear();
      _branches.reserve(prefix.size());
      _path.clear();

      auto rr = state.get(_root.address());
      if (not lower_bound_impl(rr, prefix))
         return end();
      return true;
   }
   bool iterator::reverse_lower_bound(key_view prefix)
   {
      if (not _root.address())
         return end();

      auto& db    = _rs._db;
      auto  state = _rs._segas.lock();
      _branches.clear();
      _branches.reserve(prefix.size());
      _path.clear();

      auto rr = state.get(_root.address());
      if (not reverse_lower_bound_impl(rr, prefix))
         return end();
      return true;
   }

   //void print_hex( key_view v );

   bool iterator::next()
   {
      if (_path.size() == 0)
         return end();

      auto& db    = _rs._db;
      auto  state = _rs._segas.lock();

      auto current = _path.back().second++;
      //   TRIEDENT_WARN( "path.size: ", _path.size() );

      auto handle_inner = [&](const auto* in)
      {
         auto lbx = in->lower_bound(_path.back().second);

         _path.back().second = lbx.first;

         if (not lbx.second)
         {
            popkey(in->get_prefix().size() + (current != 0));
            _path.pop_back();
            return next();
         }
         if (current)
            _branches.back() = branch_to_char(lbx.first);
         else
            pushkey(branch_to_char(lbx.first));

         auto oref   = state.get(lbx.second);
         return lower_bound_impl(oref, {});
      };

      auto oref = state.get(_path.back().first);
      switch (oref.type())
      {
         case node_type::binary:
         {
            auto bn = oref.as<binary_node>();

            if( current < bn->num_branches() )
               popkey(bn->get_key_val_ptr(current)->key_size());

            if (int(bn->num_branches()) - _path.back().second <= 0)
            {
               _path.pop_back();
               return next();
            }
            pushkey(bn->get_key_val_ptr(current + 1)->key());
            return true;
         }
         case node_type::full:
            return handle_inner(oref.as<full_node>());
         case node_type::setlist:
            return handle_inner(oref.as<setlist_node>());
         case node_type::value:
         {
            auto vn = oref.as<value_node>();
            popkey( vn->key().size() );
            _path.pop_back();
            return next();
         }
         default:
            TRIEDENT_WARN( "unexpected type: ", oref.type() );
            throw std::runtime_error("iterator::next unexpected type: ");
      }
      // unreachable
   }

   bool iterator::prev() {
      if( _path.size() == 0 )
         return end();

      auto current = _path.back().second;

      auto& db    = _rs._db;
      auto  state = _rs._segas.lock();

      auto handle_inner = [&]( const auto* in ) {
         if( current == 0 ) {
            popkey( in->get_prefix().size() );
            _path.pop_back();
            return prev();
         }
       //  TRIEDENT_DEBUG( "current: ", current );
         auto lbx = in->reverse_lower_bound( current - 1 );
      //   TRIEDENT_DEBUG( "rlb prev: ", lbx.first );
         _path.back().second = lbx.first;
         if( not lbx.second ) { 
            // add 1 because we are not eof because current != 0 at start of call
            popkey( in->get_prefix().size() + 1 );
            _path.pop_back();
            return prev();
         }
         if( lbx.first == 0 ) {
            popkey(current<257);
            return true;
         }
         if( lbx.first ) {
       //     TRIEDENT_DEBUG( "branches.back = ", branch_to_char(lbx.first) );
            _branches.back() = branch_to_char( lbx.first );

            auto oref   = state.get(lbx.second);
            return reverse_lower_bound_impl( oref, npos );
         }
         else {
            _branches.pop_back();
            _path.pop_back();
         }
         return true;
      };
      
      auto oref = state.get(_path.back().first);
      switch( oref.type() ) {
         case node_type::binary:
         {
   //   TRIEDENT_DEBUG( "binary _path.size: ", _path.size(), " idx: ", _path.back().second );
            const auto* bn = oref.as<binary_node>();
            if( current < bn->num_branches() ) {
               popkey( bn->get_key_val_ptr(current)->key_size() );

               if( current == 0 ) {
                  _path.pop_back();
                  return prev();
               }

               current = --_path.back().second;
               pushkey(bn->get_key_val_ptr(current)->key());
               return true;
            } else {
               current = _path.back().second = bn->num_branches() - 1;
               pushkey(bn->get_key_val_ptr(current)->key());
               return true;
            }
         }
         case node_type::full:
            return handle_inner(oref.as<full_node>());
         case node_type::setlist:
    //  TRIEDENT_DEBUG( "setlist _path.size: ", _path.size(), " idx: ", _path.back().second );
            return handle_inner(oref.as<setlist_node>());
         case node_type::value:
         {
            auto vn = oref.as<value_node>();
            popkey( vn->key().size() );
            _path.pop_back();
            return prev();
         }
         default:
            throw std::runtime_error("iterator::prevunexpected type");
      }
      // unreachable
   }











#if 0
      key_view iterator::key()
      {
         return key_view((char*)_branches.data(), _branches.size());
         auto to_format = []( auto k ) { return k; };
         // TEST CODE 
         if constexpr( true) {
         std::vector<uint8_t> val;
         read_value(val);
         TRIEDENT_WARN( "======================================" );
         TRIEDENT_DEBUG( "val: ", to_format(key_view((char*)val.data(),val.size())), "  branches: ", key_view((char*)_branches.data(), _branches.size()));
       //  return out;
         std::vector  tmp = _branches;
         _branches.clear();
         auto state = _rs._segas.lock();
         for (auto p : _path)
         {
            auto pr = state.get(p.first);
            switch (pr.type())
            {
               case node_type::binary:
               {
                  auto bn  = pr.as<binary_node>();
                  auto kvp = bn->get_key_val_ptr(p.second);
                  TRIEDENT_DEBUG( "BINARY: '", to_format(kvp->key()), "'" );
                  pushkey(kvp->key());
                  break;
               }
               case node_type::setlist:
               {
                  auto bn = pr.as<setlist_node>();
                  TRIEDENT_DEBUG( "SETLST: '", to_format(bn->get_prefix()), "'" );
                  pushkey(bn->get_prefix());
                  if (p.second) {
                     TRIEDENT_DEBUG( "[", to_format(branch_to_char(p.second) ),"]" );
                     pushkey(branch_to_char(p.second));
                  }
                  break;
               }
               case node_type::full:
               {
                  auto bn = pr.as<full_node>();
                  TRIEDENT_DEBUG( "FULLND: '", to_format(bn->get_prefix()), "'" );
                  pushkey(bn->get_prefix());
                  if (p.second) {
                     TRIEDENT_DEBUG( "[", to_format(branch_to_char(p.second) ),"]" );
                     pushkey(branch_to_char(p.second));
                  }
                  break;
               }
               default:
               TRIEDENT_WARN( "DEFAULT!" );
                  break;
            }
         }

         auto out = key_view((char*)_branches.data(), _branches.size());
         auto pre = key_view((char*)tmp.data(), tmp.size());
         if( out != pre ) {
            TRIEDENT_WARN( "\n",to_format(out), " != \n", to_format(pre),"\n",
                           to_format(key_view((char*)val.data(),val.size())));
         }
         TRIEDENT_WARN( "======================================" );
         assert( out == pre );
         return key_view((char*)_branches.data(), _branches.size());
         }
         
      }
#endif

}  // namespace arbtrie
