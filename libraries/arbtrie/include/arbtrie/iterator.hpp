#pragma once
#include <arbtrie/arbtrie.hpp>
#include <arbtrie/node_handle.hpp>
#include <arbtrie/seg_allocator.hpp>
#include <vector>

namespace arbtrie
{
   /**
    * In caching mode, every node that is visited is marked as
    * read so that the compactor can better sort the most frequently
    * used items.
    */
   enum iterator_caching_mode
   {
      noncaching = 0,
      caching    = 1
   };
   /**
    *   An iterator grabs a read-only snapshot of the database
    *   and provides a consistent view.
    */
   template <iterator_caching_mode CacheMode = noncaching>
   class iterator
   {
      friend class read_session;
      iterator(read_session& s, node_handle r) : _rs(s), _root(std::move(r)) {}

     public:
      // TODO: npos size == 1024 / max key length
      static constexpr const std::array<char, max_key_length> nposa = []()
      {
         std::array<char, max_key_length> ar;
         ar.fill(0xff);
         return ar;
      }();

      static constexpr const key_view npos = key_view(nposa.data(), nposa.size());
      static_assert(npos > key_view());

      // return the root this iterator is based on
      node_handle get_root() const { return _root; }
      // the key the iterator is currently pointing to
      key_view key() const { return to_key(_branches.data(), _branches.size()); }

      bool next();  // moves to next key, return valid()
      bool prev();  // moves to the prv key, return valid()

      // lower_bound(search) + next()
      // similar to std::map::upper_bound
      bool upper_bound(key_view search);

      // moves to the first key >= prefix from the begin, return valid()
      // similar to std::map::lower_bound
      bool lower_bound(key_view prefix = {});

      // moves to the last key <= prefix from the end, return valid()
      //  reverse_lower_bound(key) == lower_bound(key) when key exists
      //  otherwise it equals the key before lower_bound(key)
      bool reverse_lower_bound(key_view prefix = npos);

      // if reverse_lower_bound(key) == key,
      // this returns the prior key, othewise equal to
      // reverse_lower_bound(key)
      bool reverse_upper_bound(key_view prefix = npos);

      // moves to the last key with prefix
      // if no keys contain prefix, return false
      // valid() will return false if this returns false
      bool last(key_view prefix = {});

      // moves to the first key with prefix
      // if no keys contain prefix, return false
      // valid() will return false if this returns false
      bool first(key_view prefix = {});

      // returns false if not found
      template <typename Callback>
      bool get(key_view key, Callback&& callback) const;

      // Like get(), but also positions the iterator at the found key
      // Returns true if found and positions iterator at the key
      // Returns false and calls end() if not found
      template <typename Callback>
      bool get2(key_view key, Callback&& callback);

      // true if the iterator points to a key/value pair
      bool valid() const { return _path.size() > 0; }

      // if the value is a subtree, return an iterator into that subtree
      iterator subtree_iterator() const;
      bool     is_subtree() const;
      bool     is_data() const;

      // @return node_handle of subtree iff is_subtree()
      // @throw if not is_subtree()
      node_handle subtree() const;

      // @return a handle to the root of the tree this iterator is traversing
      node_handle root_handle() const { return _root; }

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

      void pushkey(key_view k)
      {
         _branches.resize(_branches.size() + k.size());
         memcpy(_branches.data() + _branches.size() - k.size(), k.data(), k.size());
      }
      void pushkey(uint8_t c) { _branches.push_back(c); }
      void popkey(int s)
      {
         assert(s >= 0);
         _branches.resize(_branches.size() - s);
      }

      std::vector<uint8_t>                                          _branches;
      std::vector<std::pair<fast_meta_address, branch_index_type> > _path;

      int           _size;  // -1 if unknown
      object_id     _oid;
      read_session& _rs;
      node_handle   _root;

      bool lower_bound_impl(object_ref& r, const auto* in, key_view prefix);
      bool lower_bound_impl(object_ref& r, const binary_node* bn, key_view prefix);
      bool lower_bound_impl(object_ref& r, const value_node* bn, key_view prefix);
      bool lower_bound_impl(object_ref& r, key_view prefix);

      bool reverse_lower_bound_impl(object_ref& r, const auto* in, key_view prefix);
      bool reverse_lower_bound_impl(object_ref& r, const binary_node* bn, key_view prefix);
      bool reverse_lower_bound_impl(object_ref& r, const value_node* bn, key_view prefix);
      bool reverse_lower_bound_impl(object_ref& r, key_view prefix);

      template <typename Callback>
      bool get2_impl(object_ref& r, key_view key, Callback&& callback);
   };

}  // namespace arbtrie
