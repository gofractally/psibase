#pragma once
#include <arbtrie/node_meta.hpp>
#include <cstring>
#include <ostream>
#include <string>
#include <variant>

namespace arbtrie
{
   /**
    *  Variant Wrapper to pass different types of values through update/insert
    *  operations.
    */
   struct value_type
   {
      enum class types
      {
         data,        // binary data
         subtree,     // contains a address as a user value
         value_node,  // contains an address of a value_node containing user data
         remove       // empty state
      };

      value_type(const char* str) : data(to_key(str)) {}
      value_type(const std::string& vv) : data(to_key(vv.data(), vv.size())) {}
      value_type(value_view vv) : data(vv) {}
      value_type() : data(std::monostate{}) {}  // Default constructs to empty state

      // Static helper to construct value_type from id_address with explicit type
      template <types Type>
      static value_type make(id_address i)
      {
         static_assert(Type == types::subtree || Type == types::value_node,
                       "id_address can only be used with subtree or value_node types");
         value_type v;
         v.data.emplace<static_cast<size_t>(Type)>(i);
         return v;
      }
      static value_type make_subtree(id_address i) { return make<types::subtree>(i); }
      static value_type make_value_node(id_address i) { return make<types::value_node>(i); }

      uint16_t size() const
      {
         if (const value_view* vv = std::get_if<value_view>(&data))
         {
            return vv->size();
         }
         return sizeof(id_address);
      }
      const value_view& view() const { return std::get<value_view>(data); }
      id_address        subtree_address() const
      {
         return std::get<static_cast<size_t>(types::subtree)>(data);
      }
      id_address value_address() const
      {
         return std::get<static_cast<size_t>(types::value_node)>(data);
      }
      bool       is_address() const { return is_subtree() or is_value_node(); }
      id_address address() const { return is_subtree() ? subtree_address() : value_address(); }
      bool       is_view() const { return data.index() == static_cast<size_t>(types::data); }
      bool       is_subtree() const { return data.index() == static_cast<size_t>(types::subtree); }
      bool is_value_node() const { return data.index() == static_cast<size_t>(types::value_node); }
      bool is_remove() const { return data.index() == static_cast<size_t>(types::remove); }

      types type() const { return static_cast<types>(data.index()); }

      template <typename Visitor>
      decltype(auto) visit(Visitor&& visitor) const
      {
         return std::visit(std::forward<Visitor>(visitor), data);
      }

      void place_into(uint8_t* buffer, uint16_t size) const
      {
         if (const value_view* vv = std::get_if<value_view>(&data))
         {
            memcpy(buffer, vv->data(), vv->size());
         }
         else
         {
            assert(size == sizeof(id_address));
            id_address id = address();
            memcpy(buffer, &id, sizeof(id_address));
         }
      }
      friend std::ostream& operator<<(std::ostream& out, const value_type& v)
      {
         if (v.is_subtree())
            return out << v.address();
         return out << to_str(v.view());
      }

     private:
      // Order must match types enum
      std::variant<
          value_view,
          id_address,  // subtree
          id_address,  // value_node - TODO: consider using a different type to avoid ambiguity
          std::monostate>
          data;

      // Allow construction with in_place_index
      template <std::size_t I>
      value_type(std::in_place_index_t<I>, id_address i) : data(std::in_place_index<I>, i)
      {
      }
   };

}  // namespace arbtrie
