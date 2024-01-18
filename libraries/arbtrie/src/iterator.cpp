// note included at bottom of database.cpp

namespace arbtrie
{

   void append(std::vector<uint8_t>& v, key_view k)
   {
      auto os = v.size();
      v.resize(os + k.size());
      memcpy(v.data() + os, k.data(), k.size());
   }

   bool iterator::lower_bound_impl(object_ref<node_header>& r,
                                   const value_node*        in,
                                   key_view                 prefix)
   {
      return prefix == key_view();
   }
   bool iterator::lower_bound_impl(object_ref<node_header>& r, const auto* in, key_view query)
   {
      auto node_prefix = in->get_prefix();
      if (query <= node_prefix)
      {
         append(_branches, node_prefix);
         // go to first branch
         std::pair<branch_index_type, object_id> idx = in->lower_bound(0);
         if( idx.first == 0 )
            return true;
         if (idx.second)
         {
            auto bref = r.rlock().get(idx.second);
            _branches.push_back( branch_to_char(idx.first) );
            _path.push_back(bref.id());
            return lower_bound_impl(bref, {});
         }
         return false;
      }
      auto cpre = common_prefix(node_prefix, query);
      if( cpre != node_prefix ) 
         return false;

      append(_branches, node_prefix);
      // query must be longer to share a common prefix
      // and not be less than node_prefix

      auto remaining = query.substr(cpre.size());
      assert(remaining.size() > 0);
      std::pair<branch_index_type, object_id> idx =
          in->lower_bound(char_to_branch(remaining.front()));
      if( idx.first == 0 )
         return true;

      if (idx.second)
      {
         auto bref = r.rlock().get(idx.second);
         _branches.push_back( branch_to_char(idx.first) );
         _path.push_back(bref.id());
         return lower_bound_impl(bref, remaining.substr(1));
      }
      return false;

      /*
      if (cpre != rpre)
         return false;

      int br = 0;
      if (cpre == prefix)
      {
         append(_branches, prefix);
      }
      else
      {
         assert(cpre.size() < prefix.size());
         br = 1 + uint8_t(prefix[cpre.size()]);
      }

      auto idx = in->lower_bound(br);
      if (idx.first >= max_branch_count)
         return false;

      append(_branches, prefix.substr(0, cpre.size()));
      if (idx.first == 0)
      {
         return true;
      }

      _path.push_back(idx.second);
      _branches.push_back(uint8_t(idx.first - 1));

      auto bref = r.rlock().get(idx.second);
      if (prefix.size() > cpre.size())
         return lower_bound_impl(bref, prefix.substr(cpre.size() + 1));
      return lower_bound_impl(bref, key_view());
      */
   }

   bool iterator::lower_bound_impl(object_ref<node_header>& r,
                                   const binary_node*       bn,
                                   key_view                 prefix)
   {
      auto lbx = bn->lower_bound_idx(prefix);
      if (lbx >= bn->num_branches())
         return false;
      auto kvs = bn->get_key_val_ptr(lbx);

      auto os = _branches.size();
      _branches.resize(os + kvs->key_size());
      memcpy(_branches.data() + os, kvs->key_ptr(), kvs->key_size());

      // TODO bn->is_obj_id(lbx);

      //_path.push_back( r.id() );
      //TRIEDENT_DEBUG( "path.push:  ", r.id() );
      _cur_branch = lbx;
      return true;
   }

   bool iterator::lower_bound_impl(object_ref<node_header>& r, key_view prefix)
   {
      return cast_and_call(r.obj(), [&](const auto* n) { return lower_bound_impl(r, n, prefix); });
   }

   bool iterator::lower_bound(key_view prefix)
   {
      if (not _root.id())
         return false;

      auto& db    = _rs._db;
      auto  state = _rs._segas.lock();
      _branches.clear();
      _branches.reserve(prefix.size());
      _path.clear();
      _path.push_back(_root.id());
      _cur_branch = 0;

      auto rr = state.get(_root.id());

      return lower_bound_impl(rr, prefix);
   }

   bool iterator::next()
   {
      if (_path.size() == 0)
         return false;

      auto& db    = _rs._db;
      auto  state = _rs._segas.lock();

      // inner node
      auto handle_inner = [&](auto* in)
      {
         // come into the inner node and get the current branch
         // go to the next branch, which may or may not be on this node
         // find the lower bound for br
         auto lbp = in->lower_bound(_cur_branch+1);
         if( lbp.second ) {
            if( _cur_branch == 0 )
               _branches.push_back( branch_to_char( lbp.first ) );
            else
               _branches.back() = branch_to_char( lbp.first );

            _cur_branch = lbp.first;
            _path.push_back(lbp.second);
            _cur_branch = 0;
            auto nextlb = state.get(lbp.second);
            return lower_bound_impl( nextlb, {} );
         }

         _path.pop_back();
         _branches.pop_back();
         _branches.resize(_branches.size() - in->prefix_size());
         if( _branches.size() ) {
            _cur_branch = char_to_branch(_branches.back());
            return next();
         }
         return false;
      };

      while (_path.size())
      {
         auto oref = state.get(_path.back());
         switch (oref.type())
         {
            case node_type::binary:
            {
               auto bn = oref.as<binary_node>();
               assert(_cur_branch < bn->num_branches());
               auto kvp = bn->get_key_val_ptr(_cur_branch);

               _branches.resize(_branches.size() - kvp->key_size());

               _cur_branch++;
               if (bn->num_branches() <= _cur_branch)
               {
                  _path.pop_back();
                  if(_branches.size() )
                     _cur_branch = char_to_branch(_branches.back());
                  else
                     return false;
                  continue;
               }
               auto kvp2 = bn->get_key_val_ptr(_cur_branch);
               _branches.resize(_branches.size() + kvp2->key_size());
               memcpy(_branches.data() + _branches.size() - kvp2->key_size(), kvp2->key_ptr(),
                      kvp2->key_size());
               return true;
            }
            case node_type::setlist:
               return handle_inner(oref.as<setlist_node>());
            case node_type::full:
               return handle_inner(oref.as<full_node>());
            case node_type::value:
               return true;
            default:
               return false;
         }
      }

      return false;
   }

}  // namespace arbtrie
