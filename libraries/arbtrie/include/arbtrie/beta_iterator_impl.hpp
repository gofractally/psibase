
#pragma once
#include <arbtrie/beta_iterator.hpp>
#include <arbtrie/concepts.hpp>
#include <arbtrie/read_lock.hpp>
#include <arbtrie/seg_alloc_session.hpp>
#include <arbtrie/seg_allocator.hpp>

namespace arbtrie
{
   namespace beta
   {

      template <iterator_caching_mode CacheMode>
      bool iterator<CacheMode>::next()
      {
         auto state = _rs.lock();
         return next_impl(state);
      }

      /**
    * @brief Move to the next key in the iterator
    * 
    * @param state the segment allocator state
    * @return true if the iterator is now at a valid key, false if the iterator is at the end
    */
      template <iterator_caching_mode CacheMode>
      bool iterator<CacheMode>::next_impl(read_lock& state)
      {
         if (is_end())
            throw std::runtime_error("iterator::next: attempt to move past end");

         // Loop until we reach the end of the iterator
         while (not is_end())
         {
            auto oref = state.get(_path.back().oid);
            // Cast to appropriate node type and process
            if (cast_and_call(
                    oref.template header<node_header, CacheMode>(),
                    [&](const /*arbtrie::node*/ auto* n)
                    {
                       const local_index start_idx = current_index();

                       // on transition from before the first key,
                       // push the common prefix
                       if (start_idx == begin_index)
                          push_prefix(n->get_prefix());

                       // Get the next index in this node
                       auto nidx = n->next_index(start_idx);
                       if (nidx >= n->end_index())
                       {
                          // if we are at the top of the tree, we are done
                          if (_path.size() == 1)
                          {
                             // not all nodes have end_index() iterator::end_index,
                             // for example, setlist/binary_node end_index() = num_branches()
                             // and value_node end_index() == 1
                             _path.back().index = end_index.to_int();
                             return true;
                          }

                          // If at end of node, pop it and continue searching up the tree
                          pop_path();
                          return false;  // continue the outer loop
                       }

                       // on setlist and full nodes just swap the last byte
                       // on binary nodes we have to swap the entire key
                       update_branch(n->get_branch_key(nidx), nidx);

                       // I have either arrived at the next value, or need to continue down the tree
                       switch (n->get_type(nidx))
                       {
                          case value_type::types::subtree:
                          case value_type::types::data:
                             return true;  // stop searching
                          case value_type::types::value_node:
                             push_path(n->get_value(nidx).value_address(), {}, begin_index);
                             return false;  // continue down the tree
                          case value_type::types::remove:
                             throw std::runtime_error("iterator::next: remove type found");
                       }
                    }))
               break;
         }
         // If we've reached this point, we've popped all nodes from the path
         // and haven't found a next key, so we're at the end
         return false;
      }
#if 0
      template <iterator_caching_mode CacheMode>
      inline bool iterator<CacheMode>::is_subtree() const
      {
         if (not valid()) [[unlikely]]
            return false;

         auto       state = _rs._segas.lock();
         object_ref rr    = state.get(_path.back().first);
         switch (rr.type())
         {
            case node_type::binary:
               return rr.as<binary_node>()->is_subtree(_path.back().second);
            case node_type::full:
               return rr.as<full_node>()->is_eof_subtree();
            case node_type::setlist:
               return rr.as<setlist_node>()->is_eof_subtree();
            case node_type::value:
               return rr.as<value_node>()->is_subtree();
            default:
               throw std::runtime_error("iterator::is_subtree unhandled type");
         }
      }

      template <iterator_caching_mode CacheMode>
      inline node_handle iterator<CacheMode>::subtree() const
      {
         if (not is_subtree()) [[unlikely]]
            throw std::runtime_error("iterator::subtree: not a subtree");

         auto       state = _rs._segas.lock();
         object_ref rr    = state.get(_path.back().first);
         switch (rr.type())
         {
            case node_type::binary:
            {
               auto bn  = rr.as<binary_node>();
               auto idx = _path.back().second;
               auto kvp = bn->get_key_val_ptr(idx);
               return _rs.create_handle(kvp->value_id());
            }
            case node_type::full:
               return _rs.create_handle(rr.as<full_node>()->get_eof_value());
            case node_type::setlist:
               return _rs.create_handle(rr.as<setlist_node>()->get_eof_value());
            case node_type::value:
               return _rs.create_handle(rr.as<value_node>()->subtree());
            default:
               throw std::runtime_error("iterator::subtree unhandled type");
         }
      }

      template <iterator_caching_mode CacheMode>
      inline int32_t iterator<CacheMode>::read_value(auto& buffer)
      {
         if (0 == _path.size())
         {
            buffer.resize(0);
            return -1;
         }

         auto       state = _rs._segas.lock();
         object_ref rr    = state.get(_path.back().first);

         switch (rr.type())
         {
            case node_type::binary:
            {
               auto kvp = rr.as<binary_node>()->get_key_val_ptr(_path.back().second);
               auto s   = kvp->value_size();
               buffer.resize(s);
               memcpy(buffer.data(), kvp->val_ptr(), s);
               return s;
            }
            case node_type::full:
            {
               auto b0 = rr.as<full_node>()->get_eof_value();
               assert(b0);
               auto v = state.get(b0).as<value_node>()->value();
               auto s = v.size();
               buffer.resize(s);
               memcpy(buffer.data(), v.data(), s);
               return s;
            }
            case node_type::setlist:
            {
               auto b0 = rr.as<setlist_node>()->get_eof_value();
               assert(b0);
               auto v = state.get(b0).as<value_node>()->value();
               auto s = v.size();
               buffer.resize(s);
               memcpy(buffer.data(), v.data(), s);
               return s;
            }
            case node_type::value:
            {
               auto b0 = rr.as<value_node>();
               buffer.resize(b0->value_size());
               memcpy(buffer.data(), b0->value().data(), b0->value_size());
               return b0->value_size();
            }

            default:
               throw std::runtime_error("iterator::read_value unhandled type");
         }
         return -1;
      }

      template <iterator_caching_mode CacheMode>
      iterator<CacheMode> iterator<CacheMode>::subtree_iterator() const
      {
         return iterator<CacheMode>(_rs, subtree());
      }
      template <iterator_caching_mode CacheMode>
      bool iterator<CacheMode>::reverse_lower_bound_impl(object_ref&       r,
                                                         const value_node* in,
                                                         key_view          query)
      {
         auto ikey = in->key();
         if (query < ikey)
            return push_rend(r.address());
         return push_path(r.address(), ikey, 0);
      }

      template <iterator_caching_mode CacheMode>
      bool iterator<CacheMode>::lower_bound_impl(object_ref&       r,
                                                 const value_node* in,
                                                 key_view          query)
      {
         auto ikey = in->key();
         if (query > ikey)
            return push_end(r.address());
         return push_path(r.address(), ikey, 0);
      }

      template <iterator_caching_mode CacheMode>
      bool iterator<CacheMode>::lower_bound_impl(object_ref&        r,
                                                 const binary_node* bn,
                                                 key_view           query)
      {
         auto lbx = bn->lower_bound_idx(query);

         if (lbx >= bn->num_branches())
            return push_end(r.address());

         auto kvp = bn->get_key_val_ptr(lbx);
         push_path(r.address(), kvp->key(), lbx);
         _size = kvp->value_size();

         return true;
      }
      template <iterator_caching_mode CacheMode>
      bool iterator<CacheMode>::reverse_lower_bound_impl(object_ref&        r,
                                                         const binary_node* bn,
                                                         key_view           query)
      {
         auto lbx = bn->reverse_lower_bound_idx(query);

         if (lbx < 0)
            return push_rend(r.address());

         auto kvp = bn->get_key_val_ptr(lbx);
         push_path(r.address(), kvp->key(), lbx);
         _size = kvp->value_size();

         return true;
      }

      template <iterator_caching_mode CacheMode>
      bool iterator<CacheMode>::reverse_lower_bound_impl(object_ref&                    r,
                                                         const inner_node_concept auto* in,
                                                         key_view                       query)
      {
         auto node_prefix = in->get_prefix();

         if (query > node_prefix)
         {
            // Find the last branch <= query
            auto [idx, addr] = in->reverse_lower_bound(char_to_branch(query.front()));

            if (idx == 0)
               return push_path(r.address(), node_prefix, 0);
            if (idx < 0)
               return push_rend(r.address());
            assert(addr);

            push_path(r.address(), node_prefix, idx);

            auto& next = r.rlock().get(addr);
            return reverse_lower_bound_impl(next, query.substr(1));
         }

         auto cpre = common_prefix(node_prefix, query);
         if (cpre != node_prefix)  // query is less than node prefix
         {
            // Go to the last branch in this node
            auto [idx, addr] = in->reverse_lower_bound(256);
            if (idx <= 0)
               return push_rend(r.address());
            assert(addr);

            push_path(r.address(), node_prefix, idx);

            auto& next = r.rlock().get(addr);
            return reverse_lower_bound_impl(next, npos);
         }

         // query starts with node prefix, find last branch <= remaining query
         auto remaining_query = query.substr(cpre.size());
         auto [idx, addr]     = in->reverse_lower_bound(char_to_branch(remaining_query.front()));

         if (idx == 0)
            return push_path(r.address(), node_prefix, 0);
         if (idx < 0)
            return push_rend(r.address());
         assert(addr);

         push_path(r.address(), node_prefix, idx);

         auto& next = r.rlock().get(addr);
         if (idx == char_to_branch(remaining_query.front()))
            return reverse_lower_bound_impl(next, remaining_query.substr(1));
         else
            return reverse_lower_bound_impl(next, npos);
      }

      template <iterator_caching_mode CacheMode>
      bool iterator<CacheMode>::lower_bound_impl(object_ref&                    r,
                                                 const inner_node_concept auto* in,
                                                 key_view                       query)
      {
         auto node_prefix = in->get_prefix();

         if (query <= node_prefix)
         {
            //then the lower bound is the first branch
            auto [idx, addr] = in->lower_bound(0);

            if (idx == 0)
               return push_path(r.address(), node_prefix, 0);
            if (idx == 257)
               return push_end(r.address());
            assert(idx.second);

            push_path(r.address(), node_prefix, idx);

            auto& next = r.rlock().get(addr);
            return lower_bound_impl(next, query.substr(node_prefix.size() + 1));
         }
         auto cpre = common_prefix(node_prefix, query);
         if (cpre != node_prefix)  // the lower bound is beyond the node prefix
            return push_end(r.address());

         auto remaining_query = query.substr(cpre.size());

         auto [idx, addr] = in->lower_bound(char_to_branch(remaining_query.front()));
         assert(addr);
         assert(idx > 0 && idx < 257);

         auto& next = r.rlock().get(addr);
         return lower_bound_impl(next, remaining_query.substr(1));
      }

      template <iterator_caching_mode CacheMode>
      bool iterator<CacheMode>::first(key_view prefix)
      {
         if (not lower_bound(prefix))
            return false;
         if (common_prefix(prefix, key()) == prefix)
            return true;
         return end();
      }

      template <iterator_caching_mode CacheMode>
      bool iterator<CacheMode>::last(key_view prefix)
      {
         if (not _root.address()) [[unlikely]]
            return end();

         if (prefix.size() > max_key_length)
            throw std::runtime_error("invalid key length");
         std::array<char, max_key_length> lastkey;
         memcpy(lastkey.data(), prefix.data(), prefix.size());
         memset(lastkey.data() + prefix.size(), 0xff, max_key_length - prefix.size());
         if (lower_bound(key_view(lastkey.data(), lastkey.size())))
         {
            if (key().substr(0, prefix.size()) == prefix)
               return true;
            if (prev())
            {
               if (key().substr(0, prefix.size()) == prefix)
                  return true;
               return end();
            }
         }
         end();
         auto state = _rs._segas.lock();
         auto rr    = state.get(_root.address());
         if (not reverse_lower_bound_impl(rr, npos))
            return end();
         return true;
      }

      template <iterator_caching_mode CacheMode>
      bool iterator<CacheMode>::reverse_lower_bound_impl(object_ref&        r,
                                                         const binary_node* bn,
                                                         key_view           query)
      {
         auto lbx            = bn->reverse_lower_bound_idx(query);
         _path.back().second = lbx;

         if (lbx < 0)
         {
            _path.pop_back();
            return false;
         }

         auto kvp = bn->get_key_val_ptr(lbx);
         pushkey(bn->get_key_val_ptr(lbx)->key());
         _size = kvp->value_size();

         return true;
      }

      template <iterator_caching_mode CacheMode>
      bool iterator<CacheMode>::reverse_lower_bound_impl(object_ref& r, key_view query)
      {
         _path.push_back({r.address(), 257});
         if (not cast_and_call(r.header<node_header, CacheMode>(), [&](const auto* n)
                               { return reverse_lower_bound_impl(r, n, query); }))
            return prev();
         return true;
      }

      template <iterator_caching_mode CacheMode>
      bool iterator<CacheMode>::lower_bound(key_view prefix)
      {
         if (not _root.address())
            return end();

         end();

         _branches2.reserve(prefix.size());
         _path2.reserve(prefix.size());
         _path.reserve(prefix.size());

         auto state = _rs._segas.lock();
         auto rr    = state.get(_root.address());
         if (not lower_bound_impl(rr, prefix))
            return end();
         return true;
      }

      template <iterator_caching_mode CacheMode>
      bool iterator<CacheMode>::lower_bound_impl(object_ref& r, key_view query)
      {
         _path.push_back({r.address(), 0});
         if (not cast_and_call(r.header<node_header, CacheMode>(),
                               [&](const auto* n) { return lower_bound_impl(r, n, query); }))
            return next();
         return true;
      }

      template <iterator_caching_mode CacheMode>
      bool iterator<CacheMode>::reverse_lower_bound(key_view prefix)
      {
         if (lower_bound(prefix))
         {
            if (key() > prefix)
               return prev();
            if (key() == prefix)
               return true;
            else
               return end();
         }
         if (last())
         {
            if (key() <= prefix)
               return true;
            return end();
         }
         return false;
      }
      template <iterator_caching_mode CacheMode>
      bool iterator<CacheMode>::upper_bound(key_view search)
      {
         if (lower_bound(search))
         {
            if (key() == search)
               return next();
            return true;
         }
         return false;
      }
      template <iterator_caching_mode CacheMode>
      bool iterator<CacheMode>::reverse_upper_bound(key_view search)
      {
         if (reverse_lower_bound(search))
         {
            if (key() == search)
               return prev();
            return true;
         }
         return false;
      }

      /**
 * @brief Move to the next key in the iterator
 * 
 * @return true if the iterator is now at a valid key, false if the iterator is at the end
 */

      template <iterator_caching_mode CacheMode>
      bool iterator<CacheMode>::prev()
      {
         if (_path.empty())
            return rend();

         auto state = _rs._segas.lock();
         return prev_impl(state);
      }

      template <iterator_caching_mode CacheMode>
      bool iterator<CacheMode>::prev_impl(segment_allocator::read_lock& r)
      {
         while (true)
         {
            auto oref = r.get(_path.back().oid);
            if (cast_and_call(oref.header<node_header, CacheMode>(),
                              [&](const is_node_header_derived auto* n)
                              {
                                 auto nidx = n->prev_index(_path.back().index);
                                 if (nidx == rend_index)
                                 {
                                    pop_path();
                                    return false;  // continue the outer loop
                                 }
                                 auto obkey = n->get_key_for_index(_path.back().index);
                                 auto nbkey = n->get_key_for_index(nidx);
                                 update_path(obkey, nbkey, nidx);
                                 if (auto cadr = n->get_child_address_for_index(nidx))
                                 {
                                    push_path(cadr, {}, end_index);
                                    return false;
                                 }
                                 return true;
                              }))
               return valid();
         }
         // unreachable
      }

      template <iterator_caching_mode CacheMode>
      template <typename Callback>
      bool iterator<CacheMode>::get(key_view key, Callback&& callback) const
      {
         if (not _root.address()) [[unlikely]]
         {
            callback(false, value_type{});
            return false;
         }

         auto state = _rs._segas.lock();
         auto rr    = state.get(_root.address());

         return _rs.get(rr, key, std::forward<Callback>(callback));
      }

      template <iterator_caching_mode CacheMode>
      template <typename Callback>
      bool iterator<CacheMode>::get2(key_view key, Callback&& callback)
      {
         if (not _root.address()) [[unlikely]]
         {
            callback(false, value_type{});
            return end();
         }

         _branches.clear();
         _path.clear();

         auto state = _rs._segas.lock();
         auto rr    = state.get(_root.address());

         // _path.push_back({rr.address(), 0});

         if (get2_impl(rr, key, std::forward<Callback>(callback)))
            return true;
         return end();
      }

      template <iterator_caching_mode CacheMode>
      template <typename Callback>
      bool iterator<CacheMode>::get2_impl(object_ref& r, key_view key, Callback&& callback)
      {
         if (_path.empty())
         {
            _path.push_back({r.address(), 0});
         }

         auto handle_inner = [&](const inner_node_concept auto* in)
         {
            auto node_prefix = in->get_prefix();
            pushkey(node_prefix);

            auto cpre = common_prefix(node_prefix, key);
            if (cpre != node_prefix)
            {
               return false;
            }

            auto remaining_key = key.substr(cpre.size());
            if (not remaining_key.empty())
            {
               auto br   = char_to_branch(remaining_key.front());
               auto addr = in->get_branch(br);
               if (not addr)
               {
                  return false;
               }
               _path.push_back({fast_meta_address(addr), 0});
               pushkey(branch_to_char(br));
               auto next_ref = r.rlock().get(addr);
               bool result =
                   get2_impl(next_ref, remaining_key.substr(1), std::forward<Callback>(callback));
               if (!result)
               {
                  popkey(1);
                  _path.pop_back();
               }
               return result;
            }

            if (not in->has_eof_value())
            {
               return false;
            }

            auto eof_addr = in->get_eof_value();
            assert(eof_addr);

            if (in->is_eof_subtree())
            {
               callback(true, value_type(eof_addr));
            }
            else
            {
               auto val = r.rlock().get(eof_addr);
               callback(true, value_type(val.template as<value_node>()->value()));
            }
            return true;
         };

         switch (r.type())
         {
            case node_type::full:
               return handle_inner(r.template as<full_node>());
            case node_type::setlist:
               return handle_inner(r.template as<setlist_node>());
            case node_type::binary:
            {
               auto bn  = r.template as<binary_node>();
               auto idx = bn->find_key_idx(key);
               if (idx < 0)
                  return false;

               _path.back().second = idx;
               pushkey(bn->get_key_val_ptr(idx)->key());

               auto kvp = bn->get_key_val_ptr(idx);

               if (bn->is_subtree(idx))
               {
                  callback(true, value_type(kvp->value_id()));
               }
               else if (bn->is_obj_id(idx))
               {
                  auto val = r.rlock().get(kvp->value_id());
                  callback(true, value_type(val.template as<value_node>()->value()));
               }
               else
               {
                  callback(true, kvp->value());
               }
               return true;
            }
            case node_type::value:
            {
               auto vn = r.template as<value_node>();
               if (vn->key() != key)
                  return false;

               pushkey(vn->key());
               callback(true, vn->value());
               return true;
            }
            default:
               throw std::runtime_error("iterator::get2 unexpected type");
         }
      }
#endif
   }  // namespace beta

}  // namespace arbtrie
