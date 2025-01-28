#pragma once
#include <arbtrie/node_header.hpp>
#include <arbtrie/saturated_uint32.hpp>

namespace arbtrie
{


   /**
    *  Extra header information shared by all inner nodes,
    *  This adds 13 bytes to the node_header. Derived nodes
    *  should reserve prefix_capacity() bytes after their
    *  fixed size data elements. 
    *
    *  layout:
    *    node_header
    *    inner_node
    *    derived_fixed
    *    char prefix[prefix_cap]
    *    derived_dynamic
    *
    */
   template <typename Derived>
   struct inner_node : node_header
   {
      inline inner_node(uint32_t            size,
                        fast_meta_address   nid,
                        const clone_config& cfg,
                        uint16_t            num_branch = 0)
          : node_header(size, nid, Derived::type, num_branch)
      {
         _prefix_capacity = cfg.prefix_capacity();
         if (cfg.set_prefix)
            set_prefix(*cfg.set_prefix);
      }

      inline inner_node(uint32_t            size,
                        fast_meta_address   nid,
                        const Derived*      src,
                        const clone_config& cfg)
          : node_header(size, nid, Derived::type, src->_num_branches),
            _descendants(src->_descendants),
            _eof_value(src->_eof_value)
      {
         _branch_id_region = src->_branch_id_region;

         if( cfg.set_prefix ) {
            _prefix_capacity = cfg.prefix_capacity();
            set_prefix( *cfg.set_prefix );
         } else {
            _prefix_capacity = std::max<int>(cfg.prefix_cap,src->prefix_size());
            set_prefix( src->get_prefix() );
         }
      }

      inner_node& set_descendants( int c )   { _descendants = c ; return *this; }
      inner_node& add_descendant( int c )    { _descendants += c ; return *this; }
      inner_node& remove_descendant( int c ) { _descendants -= c ; return *this; }

      saturated_uint32 _descendants = 0;
      uint32_t         _prefix_capacity : 10;
      uint32_t         _prefix_size : 10;
      uint32_t         _unused : 11; // TODO: this could be used extend range of _descendants
      uint32_t         _eof_subtree: 1 = false;
      id_address       _eof_value;

      void set_eof(fast_meta_address e) { 
         _eof_value = e.to_address(); 
         _eof_subtree = false;
      }
      void set_eof_subtree(fast_meta_address e ){
         _eof_value = e.to_address(); 
         _eof_subtree = true;
      }

      bool is_eof_subtree()const { return _eof_subtree; }
      bool has_eof_value() const { return _eof_value; }
      fast_meta_address get_eof_value()const { return _eof_value; }

      void set_prefix(key_view pre)
      {
         assert(pre.size() <= prefix_capacity());
         _prefix_size = pre.size();
         memcpy(start_prefix(), pre.data(), pre.size());
      }

      uint8_t*        start_prefix() { return ((uint8_t*)this) + sizeof(Derived); }
      uint8_t*        end_prefix() { return start_prefix() + _prefix_capacity; }
      const uint8_t*  start_prefix() const { return ((uint8_t*)this) + sizeof(Derived); }
      const uint8_t*  end_prefix() const { return start_prefix() + _prefix_capacity; }
      uint16_t        prefix_capacity() const { return _prefix_capacity; }
      uint16_t        prefix_size() const { return _prefix_size; }
      inline key_view get_prefix() const
      {
         return key_view(start_prefix(), prefix_size());
      }
   } __attribute__((packed));
   static_assert(sizeof(inner_node<void>) == 28);

}  // namespace arbtrie
