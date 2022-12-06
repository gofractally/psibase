#pragma once
#include <psio/reflect.hpp>
#include <psio/varint.hpp>
#include <map>
#include <string>
#include <variant>
#include <vector>
#include <psio/fracpack.hpp>

namespace psio
{
   using std::string;
   using std::vector;

   enum scalar_type
   {
      int64_type,
      int32_type,
      int16_type,
      int8_type,
      uint64_type,
      uint32_type,
      uint16_type,
      uint8_type,
      varuint32_type,
      double_type,
      float_type,
      string_type,
      bool_type
   };

   using type_name = std::string;

   struct variant_type
   {
      vector<type_name> types;
   };

   PSIO_REFLECT(variant_type, types)

   struct tuple_type
   {
      vector<type_name> types;
   };
   PSIO_REFLECT(tuple_type, types)

   struct vector_type
   {
      type_name type;
   };
   PSIO_REFLECT(vector_type, type)

   struct enum_type
   {
      scalar_type value_type;
      struct enum_value
      {
         string  name;
         int64_t value;
      };
      vector<enum_value> values;
   };
   using enum_value = enum_type::enum_value;
   PSIO_REFLECT(enum_value, name, value)
   PSIO_REFLECT(enum_type, values)

   /*
    struct function_type {
        struct parameter {
            type_name type;
            string    name;
        };
        vector<type_name> args;
        type_name         result;
    };
    using function_parameter = function_type::parameter;
    PSIO_REFLECT( function_parameter, type, name )
    PSIO_REFLECT( function_type, args, result )
    */

   struct object_type
   {
      struct member
      {
         string    name; ///< the member name
         type_name type; 
         int32_t   number = 0; ///< the index of the member 
         uint32_t  offset = 0; ///< the offset to the member from the start of the object
         uint32_t  size   = 0; ///< the size of the member in the fixed part of object (not in heap)

         template <typename R, typename T, typename... Args>
         void set_params(std::initializer_list<const char*> names, R (T::*method)(Args...))
         {
            if constexpr (sizeof...(Args) > 0)
               push_param<Args...>(names.begin(), names.end());
         }
         template <typename R, typename T, typename... Args>
         void set_params(std::initializer_list<const char*> names, R (T::*method)(Args...) const)
         {
            if constexpr (sizeof...(Args) > 0)
               push_param<Args...>(names.begin(), names.end());
         }

         struct param
         {
            string    name;
            type_name type;
         };
         std::vector<param> params;

        private:
         template <typename A, typename... Args>
         void push_param(std::initializer_list<const char*>::iterator begin,
                         std::initializer_list<const char*>::iterator end)
         {
            params.push_back(
                {.name = begin != end ? *begin : "", .type = get_type_name<remove_view_t<std::remove_cv_t<A>>>()});
            if constexpr (sizeof...(Args) > 0)
               push_param<Args...>(begin != end ? ++begin : end, end);
         }
      };

      const member* get_member_by_name(const std::string_view& n) const
      {
         for (const auto& m : members)
            if (m.name == n)
               return &m;
         return nullptr;
      }

      const member* get_member_by_number(int32_t n) const
      {
         for (const auto& m : members)
            if (m.number == n)
               return &m;
         return nullptr;
      }

      vector<member> members;
      uint32_t       size    = 0;      /// size of the object minus the heap
      uint32_t       min_size = 0;     /// the minimum size of fields excluding heap and excluding the optional fields
      bool           dynamic  = false;  /// whether or not the object may use the heap
   };

   using object_member       = object_type::member;
   using object_method_param = object_type::member::param;
   PSIO_REFLECT(object_method_param, name, type)
   PSIO_REFLECT(object_member, name, type, number, offset, size, params)
   PSIO_REFLECT(object_type, members, size, dynamic)

   struct typedef_type
   {
      type_name type;
   };
   PSIO_REFLECT(typedef_type, type)

   using schema_type =
       std::variant<object_type, variant_type, tuple_type, vector_type, enum_type, typedef_type>;
   PSIO_REFLECT_TYPENAME(schema_type)

   struct schema
   {
      std::map<type_name, schema_type> types;

      std::optional<schema_type> get_type(const std::string& name) const
      {
         auto itr = types.find(name);
         if (itr == types.end())
            return {};
         return itr->second;
      }
      std::optional<object_type> get_object(const string& name) const
      {
         auto itr = types.find(name);
         if (itr == types.end())
            return {};
         auto objptr = std::get_if<object_type>(&itr->second);
         if (objptr)
            return *objptr;
         return {};
      }
      std::optional<vector_type> get_vector(const string& name) const
      {
         auto itr = types.find(name);
         if (itr == types.end())
            return {};
         auto objptr = std::get_if<vector_type>(&itr->second);
         if (objptr)
            return *objptr;
         return {};
      }
      template <typename Visitor>
      bool visit_type(const std::string& type, Visitor&& v)
      {
         auto itr = types.find(type);
         if (itr == types.end())
            return false;
         std::visit(std::forward<Visitor>(v), itr->second);
         return true;
      }

      template <typename T, typename L>
      bool add_type(schema_type t, L&& on_generate)
      {
         using type = std::remove_cv_t<T>;
         auto tn = get_type_name<type>();
         if (types.find(tn) == types.end())
         {
            on_generate(static_cast<type*>(nullptr));
            types[tn] = t;
            return true;
         }
         return false;
      }

      template <typename K, typename V, typename L>
      void generate_map(const std::map<K, V>*, L&& on_generate)
      {
         generate<V>(on_generate);
      }

      template <typename L, typename A, typename... Args>
      void generate_variant(const std::tuple<A, Args...>* v, L&& on_generate)
      {
         if (add_type<std::tuple<std::remove_cv_t<A>, std::remove_cv_t<Args>...>>(tuple_type(), on_generate))
         {
            tuple_type vt;
            generate_helper<L, tuple_type, A, Args...>(vt, on_generate);
            types[get_type_name<std::tuple<A, Args...>>()] = vt;
         }
      }

      template <typename L, typename A, typename... Args>
      void generate_variant(const std::variant<A, Args...>* v, L&& on_generate)
      {
         auto tn = get_type_name<std::variant<A, Args...>>();
         if (add_type<std::variant<A, Args...>>(variant_type(), on_generate))
         {
            variant_type vt;
            generate_helper<L, variant_type, A, Args...>(vt, on_generate);
            types[tn] = vt;
         }
      }

      template <typename L, typename OT, typename A, typename... Args>
      void generate_helper(OT& vt, L&& on_generate)
      {
         generate<A>(on_generate);
         vt.types.push_back(get_type_name<A>());
         if constexpr (sizeof...(Args) > 0)
         {
            generate_helper<L, OT, Args...>(vt, on_generate);
         }
      }


      template <typename T, typename... Ts>
      void generate() {
         generate<T>([](auto) {});
         if constexpr( sizeof...(Ts) > 0 )
            generate<Ts...>();
      }
      template <typename... Ts>
      void generate_tuple_members( const std::tuple<Ts...>* ) {
         if constexpr( sizeof...(Ts)  > 0)
            generate<Ts...>();
      }

      template <typename T, typename L>
      void generate(L on_generate)
      {
         if constexpr (std::is_same_v<varuint32, std::decay_t<T>>)
         {
         }
         else if constexpr (is_std_map<T>::value)
         {
            generate_map((const T*)nullptr, on_generate);
         }
         else if constexpr (is_std_tuple<T>::value)
         {
            generate_variant((const T*)nullptr, on_generate);
         }
         else if constexpr (is_std_variant<T>::value)
         {
            generate_variant((const T*)nullptr, on_generate);
         }
         else if constexpr (is_std_optional<T>::value)
         {
            generate<typename is_std_optional<T>::value_type>(on_generate);
         }
         else if constexpr (is_std_vector<T>::value)
         {
            using value_type = typename is_std_vector<T>::value_type;
            if (add_type<T>(vector_type{get_type_name<value_type>()}, on_generate))
            {
               generate<value_type>(on_generate);
            }
         }
         else if constexpr (reflect<T>::is_struct)
         {
            auto n = get_type_name<T>();
            if (add_type<T>(object_type(), on_generate))
            {
               object_type ot;
               uint32_t    offset = 0;
               reflect<T>::for_each(
                   [&](const meta& r, auto member)
                   {
                      auto m = member((std::decay_t<T>*)nullptr);
                      if constexpr (not std::is_member_function_pointer_v<decltype(m)>)
                      {
                         using member_type =
                             std::decay_t<decltype(static_cast<std::decay_t<T>*>(nullptr)->*m)>;
                         generate<member_type>(on_generate);

                         auto tn   = get_type_name<member_type>();
                         auto size = fracpack_fixed_size<member_type>();
                         if constexpr( may_use_heap<member_type>() ) {
                            size = 4;
                         }

                         ot.members.push_back({.name   = r.name,
                                               .type   = tn,
                                               .number = r.number,
                                               .offset = offset,
                                               .size   = size});

                         offset += size;
                      }
                      else
                      {
                         using member_type = decltype(result_of(m));
                         using args_tuple = decltype(tuple_remove_view(args_as_tuple(m)));
                         generate_tuple_members( (const args_tuple*)nullptr );

                         
                         generate<member_type>(on_generate);
                         auto tn = get_type_name<member_type>();
                         ot.members.push_back({.name = r.name, .type = tn, .number = r.number});
                         ot.members.back().set_params(r.param_names, m);
                      }
                   });
               ot.size  = offset;
               types[n] = ot;
               ot.dynamic = std::is_final_v<T>;
            }
         }
      }  /// generate
   };

   PSIO_REFLECT(schema, types)

}  // namespace psio

// TODO: not legal to add new definitions to std namespace
namespace std
{
   namespace
   {
      using psio::schema_type;
      PSIO_REFLECT_TYPENAME(schema_type)
   }  // namespace
}  // namespace std
