#pragma once
#include <arbtrie/address.hpp>
#include <variant>

namespace arbtrie
{

   /**
    *  A value can be one of:
    *  - value_view (data)
    *  - subtree (id_address)
    *  - remove (empty)
    */
   struct remove
   {
   };

   struct value_type
   {
      value_type(const char* str) : data(to_key(str)) {}
      value_type(const std::string& vv) : data(to_key(vv.data(), vv.size())) {}
      value_type(value_view vv) : data(vv) {}
      value_type(remove vv) : data(vv) {}
      value_type(id_address i) : data(i) {}
      value_type() {}

      uint16_t size() const
      {
         if (const value_view* vv = std::get_if<value_view>(&data))
         {
            return vv->size();
         }
         return sizeof(id_address);
      }
      const value_view& view() const { return std::get<value_view>(data); }
      id_address        id() const { return std::get<id_address>(data); }
      bool              is_subtree() const { return data.index() == 1; }
      bool              is_view() const { return data.index() == 0; }
      bool              is_remove() const { return data.index() == 2; }

      auto visit(auto&& l) const { return std::visit(std::forward<decltype(l)>(l), data); }

      // copy the value into the provided buffer
      void place_into(uint8_t* buffer, uint16_t size) const
      {
         if (const value_view* vv = std::get_if<value_view>(&data))
         {
            memcpy(buffer, vv->data(), vv->size());
         }
         else
         {
            assert(size == sizeof(id_address));
            auto id = std::get<id_address>(data).to_int();
            memcpy(buffer, &id, sizeof(id));
         }
      }
      friend std::ostream& operator<<(std::ostream& out, const value_type& v)
      {
         if (v.is_subtree())
            return out << v.id();
         return out << to_str(v.view());
      }

     private:
      std::variant<value_view, id_address, remove> data;
   };

}  // namespace arbtrie
