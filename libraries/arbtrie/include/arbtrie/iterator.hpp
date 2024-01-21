#pragma once
#include <arbtrie/arbtrie.hpp>
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
      // return the root this iterator is based on
      node_handle get_root() const { return _root; }

      bool next();  // moves to next key, return valid()
      bool prev();  // moves to the prv key, return valid()

      // moves to the lower_bound key > search, return valid()
      bool upper_bound(key_view search);

      // moves to the lower_bound key with prefix, return valid()
      bool lower_bound(key_view prefix = {});

      // moves to the last key with prefix, return valid()
      bool last(key_view prefix = {});

      // moves to the key(), return valid()
      bool get(key_view key);

      // true if the iterator points to a key/value pair
      bool valid() const { return _path.size() > 0; }

      // the key the iterator is currently pointing to
      key_view key();

      // if the value is a subtree, return an iterator into that subtree
      iterator sub_iterator() const;
      bool     is_node() const;
      bool     is_data() const;

      // return -1 if no
      int32_t value_size() const { return _size; }

      // resizes v to the and copies the value into it
      int32_t read_value(auto& buffer);

      // copies the value into [s,s+s_len) and returns the
      // number of bytes copied
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
      auto brs() { return std::string_view((char*)_branches.data(),_branches.size() ); }
      void pushkey(std::string_view k)
      {
      //   std::cerr << "push: " << std::setw(20) << to_hex(k) <<"   | ";
         _branches.resize(_branches.size() + k.size());
         memcpy(_branches.data() + _branches.size() - k.size(), k.data(), k.size());
       //  std::cerr << to_hex(brs()) <<"\n";
      }
      void pushkey(char c) { 
       //  std::cerr << "push: " << std::setw(20) << to_hex(c) <<"   | ";;
         _branches.push_back(c); 
       //  std::cerr << to_hex(brs()) <<"\n";
      }
      void popkey(int s) { 
         assert( s >= 0 );
       //  std::cerr << "pop:  " << std::setw(20) <<
       //     to_hex( std::string_view((char*)_branches.data()+_branches.size()-s, s) ) <<"   | ";
         _branches.resize(_branches.size() - s); 
       //  std::cerr << to_hex(brs()) <<"\n";
      }

      // path[0] = root
      // branch[0] eq the branch taken from root,
      //    branch.size() then the value is on the node path[branches.size()]
      // if branches.size() >= path.size() surplus bytes in branches represent
      //    the key into the binary node and path.back() should be a binary node.
      std::vector<uint8_t>                                   _branches;
      std::vector<std::pair<id_address, branch_index_type> > _path;

      int           _size;  // -1 if unknown
      object_id     _oid;
      read_session& _rs;
      node_handle   _root;

      /*
      struct frame {
         id_address  node;
         std::string prefix;
         uint16_t    branch;
      };
      std::vector<frame> _stack;
      */

      bool lower_bound_impl(object_ref<node_header>& r, const auto* in, key_view prefix);
      bool lower_bound_impl(object_ref<node_header>& r, const binary_node* bn, key_view prefix);
      bool lower_bound_impl(object_ref<node_header>& r, const value_node* bn, key_view prefix);
      bool lower_bound_impl(object_ref<node_header>& r, key_view prefix);
   };

}  // namespace arbtrie
