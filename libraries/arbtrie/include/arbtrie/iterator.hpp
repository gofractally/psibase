#pragma once
#include <arbtrie/arbtrie.hpp>
#include <arbtrie/node_handle.hpp>
#include <arbtrie/seg_allocator.hpp>
#include <vector>

namespace arbtrie
{
   /**
    *   An iterator grabs a read-only snapshot of the database
    *   and provides a consistent view.
    */
   class iterator
   {
      friend class read_session;
      iterator(read_session& s, node_handle r) : _rs(s), _root(std::move(r)) {}

     public:
      // TODO: npos size == 1024 / max key length
      static constexpr const std::array<uint8_t,128> nposa = [](){
         std::array<uint8_t,128> ar; ar.fill(0xff);
      return ar; }();
      static constexpr const key_view npos = key_view( nposa.data(), nposa.size() );
      static_assert( npos > key_view() );

      // return the root this iterator is based on
      node_handle get_root() const { return _root; }
      // the key the iterator is currently pointing to
      key_view key()const
      {
         return key_view(_branches.data(), _branches.size());
      }

      bool next();  // moves to next key, return valid()
      bool prev();  // moves to the prv key, return valid()

      // lower_bound(search) + next()
      bool upper_bound(key_view search);

      // moves to the first key >= prefix from the begin, return valid()
      bool lower_bound(key_view prefix = {});

      // moves to the first key <= prefix from the end, return valid()
      bool reverse_lower_bound(key_view prefix = npos);

      // reverse_lower_bound(prefix) + prev()
      bool reverse_upper_bound(key_view prefix = {});

      // moves to the last key with prefix, return valid()
      //   = reverse_lower_bound(prefix)
      bool last(key_view prefix = {});

      // moves to the key(), return valid()
      bool get(key_view key);

      // true if the iterator points to a key/value pair
      bool valid() const { return _path.size() > 0; }


      // if the value is a subtree, return an iterator into that subtree
      iterator subtree_iterator() const;
      bool     is_subtree() const;
      bool     is_data() const;

      // @return node_handle of subtree iff is_subtree()
      // @throw if not is_subtree()
      node_handle subtree()const;

      // @return a handle to the root of the tree this iterator is traversing 
      node_handle root_handle()const { return _root; }

      // return -1 if no
      int32_t value_size() const { return _size; }

      // resizes v to the and copies the value into it
      int32_t read_value(auto& buffer);

      // copies the value into [s,s+s_len) 
      //
      // @throw if type is a subtree
      // @return total bytes copied
      //
      int32_t read_value(char* s, uint32_t s_len);

      std::string value_as_string() const;

     private:
      bool end()
      {
         _branches.clear();
         _path.clear();
         return false;
      }
      void begin()
      {
         _branches.clear();
         _path.clear();
      }

      //auto brs() { return key_view((char*)_branches.data(),_branches.size() ); }
      void pushkey(key_view k)
      {
         _branches.resize(_branches.size() + k.size());
         memcpy(_branches.data() + _branches.size() - k.size(), k.data(), k.size());
      }
      void pushkey(uint8_t c) { 
         _branches.push_back(c); 
      }
      void popkey(int s) { 
         assert( s >= 0 );
         _branches.resize(_branches.size() - s); 
      }

      std::vector<uint8_t>                                          _branches;
      std::vector<std::pair<fast_meta_address, branch_index_type> > _path;

      int           _size;  // -1 if unknown
      object_id     _oid;
      read_session& _rs;
      node_handle   _root;

      bool lower_bound_impl(object_ref<node_header>& r, const auto* in, key_view prefix);
      bool lower_bound_impl(object_ref<node_header>& r, const binary_node* bn, key_view prefix);
      bool lower_bound_impl(object_ref<node_header>& r, const value_node* bn, key_view prefix);
      bool lower_bound_impl(object_ref<node_header>& r, key_view prefix);

      bool reverse_lower_bound_impl(object_ref<node_header>& r, const auto* in, key_view prefix);
      bool reverse_lower_bound_impl(object_ref<node_header>& r, const binary_node* bn, key_view prefix);
      bool reverse_lower_bound_impl(object_ref<node_header>& r, const value_node* bn, key_view prefix);
      bool reverse_lower_bound_impl(object_ref<node_header>& r, key_view prefix);
   };

}  // namespace arbtrie
