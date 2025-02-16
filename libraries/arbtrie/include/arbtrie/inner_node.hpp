#pragma once
#include <arbtrie/node_header.hpp>
#include <concepts>

namespace arbtrie
{
   template <typename T>
   struct inner_node;

   template <typename T>
   concept inner_node_concept =
       requires(T node, branch_index_type br, id_address addr, const T& const_node) {
          // Required static members
          requires std::same_as<decltype(T::type), const node_type>;

          // Required member functions
          {
             node.add_branch(br, addr)
          } -> std::same_as<T&>;
          {
             node.remove_branch(br)
          } -> std::same_as<T&>;
          {
             node.set_branch(br, addr)
          } -> std::same_as<T&>;
          {
             const_node.get_branch(br)
          } -> std::same_as<id_address>;
          {
             const_node.lower_bound(br)
          } -> std::same_as<std::pair<branch_index_type, id_address>>;
          {
             const_node.can_add_branch()
          } -> std::same_as<bool>;
          {
             const_node.get_prefix()
          } -> std::same_as<key_view>;
          {
             const_node.has_eof_value()
          } -> std::same_as<bool>;
          {
             const_node.get_eof_value()
          } -> std::same_as<id_address>;

          // Required from inner_node base
          requires std::derived_from<T, inner_node<T>>;
       };

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
                        id_address          nid,
                        const clone_config& cfg,
                        uint16_t            num_branch = 0)
          : node_header(size, nid, Derived::type, num_branch)
      {
         _prefix_capacity = cfg.prefix_capacity();
         if (cfg.set_prefix)
            set_prefix(*cfg.set_prefix);
      }

      inline inner_node(uint32_t size, id_address nid, const Derived* src, const clone_config& cfg)
          : node_header(size, nid, Derived::type, src->_num_branches),
            _descendants(src->_descendants),
            _eof_value(src->_eof_value)
      {
         _branch_id_region = src->_branch_id_region;

         if (cfg.set_prefix)
         {
            _prefix_capacity = cfg.prefix_capacity();
            set_prefix(*cfg.set_prefix);
         }
         else
         {
            _prefix_capacity = std::max<int>(cfg.prefix_cap, src->prefix_size());
            set_prefix(src->get_prefix());
         }
      }

      inner_node& set_descendants(int c)
      {
         _descendants = c;
         return *this;
      }
      inner_node& add_descendant(int c)
      {
         _descendants += c;
         return *this;
      }
      inner_node& remove_descendant(int c)
      {
         _descendants -= c;
         return *this;
      }
      uint32_t descendants() const { return _descendants; }

      uint32_t   _descendants = 0;
      uint32_t   _prefix_capacity : 10;
      uint32_t   _prefix_size : 10;
      uint32_t   _unused : 11;  // TODO: this could be used extend range of _descendants
      uint32_t   _eof_subtree : 1 = false;
      id_address _eof_value;

      void set_eof(id_address e)
      {
         _eof_value   = e;
         _eof_subtree = false;
      }
      void set_eof_subtree(id_address e)
      {
         _eof_value   = e;
         _eof_subtree = true;
      }

      bool       is_eof_subtree() const { return _eof_subtree; }
      bool       has_eof_value() const { return bool(_eof_value); }
      id_address get_eof_value() const { return _eof_value; }

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
         return key_view((const char*)start_prefix(), prefix_size());
      }
   } __attribute__((packed));

   struct void_node
   {
      static const node_type type = node_type::undefined;

      // Required interface methods for inner_node_concept
      key_view   get_prefix() const { return {}; }
      bool       has_eof_value() const { return false; }
      id_address get_eof_value() const { return {}; }
      bool       is_eof_subtree() const { return false; }
      id_region  branch_region() const { return {}; }
      uint16_t   num_branches() const { return 0; }

      // Branch operations
      void       add_branch(branch_index_type, id_address) {}
      void       remove_branch(branch_index_type) {}
      void       set_branch(branch_index_type, id_address) {}
      id_address get_branch(branch_index_type) const { return {}; }

      // Lower/upper bound operations
      std::pair<branch_index_type, id_address> lower_bound(branch_index_type) const
      {
         return {max_branch_count, {}};
      }

      template <typename F>
      void visit_branches(F&&) const
      {
      }

      template <typename F>
      void visit_branches_with_br(F&&) const
      {
      }
   };

   static_assert(sizeof(inner_node<void_node>) == 28);

}  // namespace arbtrie
