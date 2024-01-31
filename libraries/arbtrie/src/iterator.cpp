// note included at bottom of database.cpp

namespace arbtrie
{
   bool iterator::lower_bound_impl(object_ref<node_header>& r, const value_node* in, key_view query)
   {
      return query == key_view();
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

   bool iterator::lower_bound_impl(object_ref<node_header>& r, key_view query)
   {
      _path.push_back({r.address(), 0});
      //_stack.push_back( { .node = r.address(), .branch = 0 } );
      if (not cast_and_call(r.header(),
                            [&](const auto* n) { return lower_bound_impl(r, n, query); }))
         return next();
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

   //void print_hex( std::string_view v );

   bool iterator::next()
   {
      if (_path.size() == 0)
         return end();

      auto& db    = _rs._db;
      auto  state = _rs._segas.lock();

      auto current = _path.back().second++;
      //   TRIEDENT_WARN( "path.size: ", _path.size() );

      auto handle_inner = [&](auto* in)
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
         bool result = lower_bound_impl(oref, {});
         assert(result);
         return result;
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
         default:
            throw std::runtime_error("iterator::next unexpected type");
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
         TRIEDENT_DEBUG( "val: ", to_format(std::string_view((char*)val.data(),val.size())), "  branches: ", key_view((char*)_branches.data(), _branches.size()));
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
                           to_format(std::string_view((char*)val.data(),val.size())));
         }
         TRIEDENT_WARN( "======================================" );
         assert( out == pre );
         return key_view((char*)_branches.data(), _branches.size());
         }
         
      }
#endif

}  // namespace arbtrie
