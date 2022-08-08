#pragma once

#include <psio/check.hpp>
#include <psio/from_json.hpp>
#include <psio/get_type_name.hpp>
#include <psio/reflect.hpp>
#include <psio/stream.hpp>
#include <psio/to_json.hpp>
#include <psio/unaligned_type.hpp>
#include <span>

//#include <boost/hana/for_each.hpp>

/// required for UTF8 validation of strings
#include <simdjson.h>
//#include <rapidjson/encodings.h>

// #define DEBUG
// #include <iostream>

namespace psio
{
   template <typename T>
   class shared_view_ptr;

   template <typename>
   struct is_shared_view_ptr : std::false_type
   {
   };

   template <typename T>
   struct is_shared_view_ptr<shared_view_ptr<T>> : std::true_type
   {
      using value_type = T;
   };

   template <typename View, typename Enable = void>
   struct view;
   template <typename View, typename Enable = void>
   struct const_view;

   template <typename T>
   struct remove_view
   {
      using type = T;
   };
   template <typename T>
   struct remove_view<view<T>>
   {
      using type = T;
   };
   template <typename T>
   struct remove_view<const_view<T>>
   {
      using type = T;
   };

   template <typename T>
   using remove_view_t = typename remove_view<T>::type;

   template <typename T, typename P>
   constexpr bool view_is()
   {
      return std::is_same_v<view<T>, P> || std::is_same_v<const_view<T>, P>;
   }

   template <typename... Ts>
   struct view<std::variant<Ts...>>;
   template <typename... Ts>
   struct view<std::tuple<Ts...>>;

   template <typename... Ts>
   struct view<const std::variant<Ts...>>;

   template <typename T>
   struct view<T, std::enable_if_t<std::is_arithmetic_v<T>>>;

   template <>
   struct view<std::string>;

   template <typename T>
   struct view<T, std::enable_if_t<reflect<T>::is_struct>>;

   template <typename... Ts>
   struct const_view<std::variant<Ts...>>;

   template <typename... Ts>
   struct const_view<std::tuple<Ts...>>;

   template <typename... Ts>
   struct const_view<const std::variant<Ts...>>;

   template <typename T>
   struct const_view<T, std::enable_if_t<std::is_arithmetic_v<T>>>;

   template <>
   struct const_view<std::string>;

   template <typename T>
   struct const_view<T, std::enable_if_t<reflect<T>::is_struct>>;

   template <typename>
   struct is_view : std::false_type
   {
   };

   template <typename T>
   struct is_view<view<T>> : std::true_type
   {
      using value_type = T;
   };
   template <typename T>
   struct is_view<const_view<T>> : std::true_type
   {
      using value_type = T;
   };

   /*
   struct offset_ptr
   {
      offset_ptr(uint32_t i = 0) : offset(i) {}
      offset_ptr& operator=(uint32_t i)
      {
         offset = i;
         return *this;
      }

      unaligned_type<uint32_t> offset;

      template <typename T>
      auto* get() const;
   };
   */
   using offset_ptr = uint32_t;

   template <typename T>
   constexpr uint16_t fracpack_fixed_size();

   /**
     *  A struct can be packed using memcpy if the following properties are true:
     *    0. it is an arithmetic type
     *    1. sizeof(T) == ∑sizeof(members)
     *    2. alignement_of(T) == 1
     *    3. the order of reflected fields, matches memory layout
     *    4. all members meet the can_memcpy requirement
     *    5. the struct is definitionWillNotChange
     */
   template <typename T>
   constexpr bool can_memcpy()
   {
      if constexpr (std::is_arithmetic_v<T>)
      {
         return true;
      }
      else if constexpr (std::is_trivially_copyable_v<T>)
      {
         if constexpr (psio::reflect<T>::is_struct)
         {
            if (not psio::reflect<T>::definitionWillNotChange)
               return false;

            bool     is_flat  = true;
            uint64_t last_pos = 0;
            psio::reflect<T>::for_each(
                [&](const psio::meta& ref, auto member)
                {
                   using MemPtr = decltype(member(std::declval<T*>()));
                   if constexpr (not std::is_member_function_pointer_v<MemPtr>)
                   {
                      using member_type =
                          std::decay_t<decltype(psio::result_of_member(std::declval<MemPtr>()))>;
                      is_flat &= ref.offset == last_pos;
                      is_flat &= can_memcpy<member_type>();
                      last_pos += sizeof(member_type);
                   }
                });
            return (is_flat) and (last_pos == sizeof(T));
         }
         else
            return false;
      }
      else
         return false;
   }

   template <typename T>
   constexpr bool has_non_optional_after_optional()
   {
      if constexpr (psio::reflect<T>::is_struct)
      {
         bool found_optional = false;
         bool has_error      = false;
         psio::reflect<T>::for_each(
             [&](const psio::meta& ref, auto member)
             {
                using MemPtr = decltype(member(std::declval<T*>()));
                if constexpr (not std::is_member_function_pointer_v<MemPtr>)
                {
                   using member_type =
                       std::decay_t<decltype(psio::result_of_member(std::declval<MemPtr>()))>;
                   if constexpr (is_std_optional<member_type>())
                   {
                      found_optional = true;
                   }
                   else
                   {
                      has_error |= found_optional;
                   }
                }
             });
         return has_error;
      }
      else if constexpr (is_std_tuple<T>::value)
      {
         bool found_optional = false;
         bool has_error      = false;
         tuple_foreach(T(),
                       [&](const auto& x)
                       {
                          using member_type = std::decay_t<decltype(x)>;
                          if constexpr (is_std_optional<member_type>())
                          {
                             found_optional = true;
                          }
                          else
                          {
                             has_error |= found_optional;
                          }
                       });
         return has_error;
      }
      return false;
   }

   /**
     *  The number of fields on the struct cannot be extended because
     *  the struct is definitionWillNotChange(), and all members are 
     *  either heap allocated or definitionWillNotChange(), .
     */
   template <typename T>
   constexpr bool is_fixed_structure()
   {
      if constexpr (is_std_array<T>::value)
         return true;  /// number of fields is constant
      if constexpr (is_std_optional<T>::value)
         return true;  /// always the size of an offset
      else if constexpr (is_std_variant<T>::value)
         return false;  /// why isn't this true... type size heap_data[size]
      else if constexpr (is_std_tuple<T>::value)
         return false;  /// this type is extensible...
      else if constexpr (is_shared_view_ptr<T>::value)
         return is_fixed_structure<typename is_shared_view_ptr<T>::value_type>();
      else if constexpr (can_memcpy<T>())
         return true;
      else if constexpr (std::is_same_v<std::string, T>)
         return true;
      else if constexpr (is_std_vector<T>::value)
         return true;  // size followed by heap
      else if constexpr (psio::reflect<T>::is_struct)
      {
         if (not psio::reflect<T>::definitionWillNotChange)
         {
            static_assert(not has_non_optional_after_optional<T>(),
                          "extendable types must not have non-optional after optional member");
            return false;
         }
         bool is_fixed = true;
         psio::reflect<T>::for_each(
             [&](const psio::meta& ref, auto member)
             {
                using MemPtr = decltype(member(std::declval<T*>()));
                if constexpr (not std::is_member_function_pointer_v<MemPtr>)
                {
                   using member_type =
                       std::decay_t<decltype(psio::result_of_member(std::declval<MemPtr>()))>;
                   is_fixed &= is_fixed_structure<member_type>();
                }
             });
         return is_fixed;
      }
      else
      {
         &T::is_fixed_structure;
      }
   }

   template <typename T>
   constexpr bool is_ext_structure()
   {
      return !is_fixed_structure<T>();
   }

   /** 
     *  Recursively checks the types for any field which requires dynamic allocation,
     */
   template <typename T>
   constexpr bool may_use_heap()
   {
      if constexpr (std::is_same_v<bool, T>)
         return false;
      else if constexpr (is_std_array<T>::value)
         return may_use_heap<typename is_std_array<T>::value_type>();
      else if constexpr (is_std_optional<T>::value)
         return true;
      else if constexpr (is_std_tuple<T>::value)
         return true;
      else if constexpr (is_std_variant<T>::value)
         return true;
      else if constexpr (is_shared_view_ptr<T>::value)
         return may_use_heap<typename is_shared_view_ptr<T>::value_type>();
      else if constexpr (std::is_arithmetic_v<T>)
         return false;
      else if constexpr (not psio::reflect<T>::definitionWillNotChange)
         return true;
      else if constexpr (can_memcpy<T>())
         return false;
      else if constexpr (std::is_same_v<std::string, T>)
         return true;
      else if constexpr (is_std_vector<T>::value)
         return true;
      else if constexpr (psio::reflect<T>::is_struct)
      {
         bool is_flat = true;
         psio::reflect<T>::for_each(
             [&](const psio::meta& ref, auto member)
             {
                using MemPtr = decltype(member(std::declval<T*>()));
                using member_type =
                    std::decay_t<decltype(psio::result_of_member(std::declval<MemPtr>()))>;
                is_flat &= not may_use_heap<member_type>();
             });
         return not is_flat;
      }
      else
      {
         T::may_use_heap_undefined;
      }
   }

   template <typename T>
   constexpr bool known_members_may_use_heap()
   {
      if constexpr (psio::reflect<T>::is_struct)
      {
         bool use_heap = false;
         psio::reflect<T>::for_each(
             [&](const psio::meta& ref, auto member)
             {
                using MemPtr = decltype(member(std::declval<T*>()));
                if constexpr (not std::is_member_function_pointer_v<MemPtr>)
                {
                   using member_type =
                       std::remove_cv_t<decltype(psio::result_of_member(std::declval<MemPtr>()))>;
                   if constexpr (psio::reflect<member_type>::is_struct)
                      use_heap |= known_members_may_use_heap<member_type>();
                   else
                      use_heap |= may_use_heap<member_type>();
                }
             });
         return use_heap;
      }
   }

   // TODO: BUG: this can overflow the uint16_t in some cases
   template <typename T>
   constexpr uint16_t fracpack_fixed_size()
   {
      if constexpr (std::is_same_v<bool, T>)
         return 1;
      else if constexpr (is_std_array_v<T>)
      {
         if constexpr (may_use_heap<typename is_std_array<T>::value_type>())
         {
            return sizeof(offset_ptr) * is_std_array<T>::size;
         }
         else
         {
            return fracpack_fixed_size<typename is_std_array<T>::value_type>() *
                   is_std_array<T>::size;
         }
      }
      else if constexpr (is_std_tuple<T>::value)
      {
         uint16_t fixed_size = 0;
         tuple_foreach(T(),
                       [&](const auto& x)
                       {
                          using member_type = std::decay_t<decltype(x)>;
                          if constexpr (may_use_heap<member_type>())
                          {
                             fixed_size += 4;
                          }
                          else
                          {
                             fixed_size += fracpack_fixed_size<member_type>();
                          }
                       });
         return fixed_size;
      }
      else if constexpr (is_shared_view_ptr<T>::value)
      {
         return fracpack_fixed_size<typename is_shared_view_ptr<T>::value_type>();
      }
      else if constexpr (is_std_optional<T>::value)
      {
         return sizeof(offset_ptr);
      }
      else if constexpr (can_memcpy<T>())
      {
         return sizeof(T);
      }
      else if constexpr (is_std_variant<T>::value)
      {
         return sizeof(offset_ptr);
      }
      else if constexpr (std::is_same_v<std::string, T> || is_std_vector<T>::value)
      {
         return sizeof(offset_ptr);
      }
      else if constexpr (reflect<T>::is_struct)
      {
         uint16_t size = 0;
         reflect<T>::for_each(
             [&](const meta& ref, auto member)
             {
                using MemPtr = decltype(member(std::declval<T*>()));
                if constexpr (not std::is_member_function_pointer_v<remove_cvref_t<MemPtr>>)
                {
                   using member_type = decltype(result_of_member(std::declval<MemPtr>()));
                   if constexpr (may_use_heap<member_type>())
                   {
                      size += sizeof(offset_ptr);
                   }
                   else
                   {
                      size += fracpack_fixed_size<member_type>();
                   }
                }
             });
         return size;
      }
      else
      {
         T::undefined_fracpack_fixed_size;
      }
   }

   template <typename T>
   constexpr uint32_t fixed_size_before_optional()
   {
      if constexpr (psio::reflect<T>::is_struct)
      {
         bool     found_optional = false;
         uint32_t fixed_size     = 0;
         psio::reflect<T>::for_each(
             [&](const psio::meta& ref, auto member)
             {
                using MemPtr = decltype(member(std::declval<T*>()));
                if constexpr (not std::is_member_function_pointer_v<MemPtr>)
                {
                   using member_type =
                       std::decay_t<decltype(psio::result_of_member(std::declval<MemPtr>()))>;

                   if constexpr (is_std_optional<member_type>())
                   {
                      found_optional = true;
                   }

                   if (not found_optional)
                   {
                      if constexpr (may_use_heap<member_type>())
                         fixed_size += 4;
                      else
                         fixed_size += fracpack_fixed_size<member_type>();
                   }
                }
             });
         return fixed_size;
      }
      else if constexpr (is_std_tuple<T>::value)
      {
         bool     found_optional = false;
         uint32_t fixed_size     = 0;
         tuple_foreach(T(),
                       [&](const auto& x)
                       {
                          using member_type = std::decay_t<decltype(x)>;
                          if constexpr (is_std_optional<member_type>())
                          {
                             found_optional = true;
                          }
                          if (not found_optional)
                          {
                             if constexpr (may_use_heap<member_type>())
                             {
                                fixed_size += 4;
                             }
                             else
                             {
                                fixed_size += fracpack_fixed_size<member_type>();
                             }
                          }
                       });
      }
      return fracpack_fixed_size<T>();
   }

   template <typename T>
   uint32_t fracpack_size(const T& v);

   using char_ptr = char*;

   template <typename T, typename P, typename S>
   void fracpack_member(char_ptr& heap, const T& member, P ptr, S& stream)
   {
      if constexpr (not std::is_member_function_pointer_v<P>)
         fracpack_member(heap, member.*ptr, stream);
   }

   /**
     *  used to pack a member of a struct or vector
     */
   template <typename T, typename S>
   void fracpack_member(char_ptr& heap, const T& member, S& stream)
   {
      if constexpr (may_use_heap<T>())
      {
         // define a helper function so that it can be reused in the
         // case that T is an optional
         auto pack_on_heap = [&](const auto& mem)
         {
            uint32_t ps = fracpack_size(mem);
            if constexpr (std::is_same_v<size_stream, S>)
            {
               stream.skip(sizeof(uint32_t));  /// skip offset
               stream.skip(ps);                /// data
            }
            else
            {
               uint32_t offset = heap - stream.pos;
               stream.write(&offset, sizeof(offset));
               S substream(heap, stream.end - heap);
               fracpack(mem, substream);
               heap += ps;
            }
         };

         // pack empty optional
         if constexpr (is_std_optional<T>::value)
         {
            if (not member)
            {
               uint32_t tomb = 1;
               stream.write(&tomb, sizeof(tomb));
            }
            else
            {
               using opt_type = typename is_std_optional<T>::value_type;

               if constexpr (is_std_vector<opt_type>::value ||
                             std::is_same_v<opt_type, std::string>)
               {
                  if (member->size() == 0)
                  {
                     uint32_t tomb = 0;
                     stream.write(&tomb, sizeof(tomb));
                     return;
                  }
               }
               pack_on_heap(*member);
            }
            return;
         }
         /** shared views are packed as if there was not a pointer, they are not
          *  nullable because the view/unpack functions don't have a way to represent
          *  a null shared view ptr.
          */
         else if constexpr (is_shared_view_ptr<T>::value)
         {
            if (member.size() == 0)
            {
               abort_error("shared_view_ptr is not allowed to be null");
               /*
               uint32_t offset = 0;
               stream.write(&offset, sizeof(offset));
               */
               return;
            }
         }
         /** pack empty vector */
         else if constexpr (is_std_vector<T>::value)
         {
            if (member.size() == 0)
            {  /// empty vec opt
               uint32_t offset = 0;
               stream.write(&offset, sizeof(offset));
               return; /** return from visiting this member */
            }
         }
         /** pack empty string */
         else if constexpr (std::is_same_v<T, std::string>)
         {
            if (member.size() == 0)
            {  /// empty string opt
               uint32_t offset = 0;
               stream.write(&offset, sizeof(offset));
               return; /** return from visiting this member */
            }
         }

         pack_on_heap(member);
      }
      else
      {
         fracpack(member, stream);
      }
   }
   template <typename T, typename S>
   void fracpack(const shared_view_ptr<T>& v, S& stream)
   {
      stream.write(v.data_with_size_prefix().data(), v.data_with_size_prefix().size());
   }

   template <typename S>
   void fracpack(bool v, S& stream)
   {
      char c = v;
      stream.write(&c, 1);
   }

   /**
     *  Writes v to a stream...without a size prefix
     */
   template <typename T, typename S>
   void fracpack(const T& v, S& stream)
   {
      if constexpr (is_std_tuple<T>::value)
      {
         uint16_t start_heap = fracpack_fixed_size<T>();
         stream.write(&start_heap, sizeof(start_heap));

         char* heap = nullptr;
         if constexpr (not std::is_same_v<size_stream, S>)
            heap = stream.pos + start_heap;

         tuple_foreach(v, [&](const auto& x) { fracpack_member(heap, x, stream); });
      }
      else if constexpr (is_std_variant<T>::value)
      {
         uint8_t idx = v.index();
         //    std::cout << "packing variant: " << int(idx) <<"\n";
         stream.write(&idx, sizeof(idx));
         uint32_t varsize = 0;
         std::visit(
             [&](const auto& iv)
             {
                varsize = fracpack_size(iv);
                //      std::cout << "  element size: " << varsize <<"\n";
                stream.write(&varsize, sizeof(varsize));
                fracpack(iv, stream);
             },
             v);
         //  return 1+ sizeof(varsize) + varsize;
      }
      else if constexpr (is_std_optional<T>::value)
      {
         //         std::cout<<"root optional....\n";
         char* heap = nullptr;

         if constexpr (not std::is_same_v<size_stream, S>)
            heap = stream.pos + 4;

         fracpack_member<T>(heap, v, stream);

         if constexpr (not std::is_same_v<size_stream, S>)
            stream.pos = heap;
      }
      else if constexpr (can_memcpy<T>())
      {
         stream.write(&v, sizeof(T));
      }
      else if constexpr (std::is_same_v<std::string, T>)
      {
         uint32_t s = v.size();
         stream.write(&s, sizeof(s));
         if (s > 0)
            stream.write(v.data(), s);
      }
      else if constexpr (is_std_vector<T>::value)
      {
         //         std::cout << "packing vector at: " << stream.consumed() <<"\n";
         using value_type = typename is_std_vector<T>::value_type;

         if constexpr (can_memcpy<value_type>())
         {
            uint16_t fix_size = fracpack_fixed_size<value_type>();
            uint32_t s        = v.size() * fix_size;

            stream.write(&s, sizeof(s));
            if (s > 0)
               stream.write(v.data(), s);
         }
         else if constexpr (not may_use_heap<value_type>())
         {
            //   std::cout << "packing vector of not may use heap\n";
            uint16_t fix_size = fracpack_fixed_size<value_type>();
            //   std::cout << "fix_size: " << fix_size <<"\n";
            uint32_t s = v.size() * fix_size;

            stream.write(&s, sizeof(s));
            for (const auto& item : v)
            {
               fracpack(item, stream);
            }
            //  return s + sizeof(s);
         }
         else
         {
            uint32_t s = v.size() * sizeof(offset_ptr);
            stream.write(&s, sizeof(s));
            //     uint16_t start_heap = s + 4;  // why 4... it is needed
            char* heap = nullptr;

            if constexpr (not std::is_same_v<size_stream, S>)
               heap = stream.pos + s;
            for (const auto& item : v)
            {
               fracpack_member(heap, item, stream);
            }
            // return start_heap;
         }
      }
      else if constexpr (is_std_array<T>::value)
      {
         uint16_t start_heap = fracpack_fixed_size<T>();

         using member_type = typename is_std_array<T>::value_type;

         char* heap = nullptr;

         if constexpr (not std::is_same_v<size_stream, S>)
            heap = stream.pos + start_heap;

         if constexpr (can_memcpy<member_type>())
         {
            stream.write(&v[0], sizeof(member_type) * is_std_array<T>::size);
         }
         else
         {
            for (const auto& i : v)
               fracpack_member(heap, i, stream);
         }
      }
      else if constexpr (psio::reflect<T>::is_struct)
      {
         //       std::cout << "packing struct at: " << stream.consumed() <<"\n";
         //  std::cout << "packing struct: \n";
         uint16_t start_heap = fracpack_fixed_size<T>();
         if constexpr (not psio::reflect<T>::definitionWillNotChange)  //is_ext_structure<T>())
         {
            //           std::cout << "ext struct heap: " <<start_heap<<"\n";
            stream.write(&start_heap, sizeof(start_heap));
            //           std::cout << "wrote heap: " << stream.consumed() <<"\n";
         }
         char* heap = nullptr;

         if constexpr (not std::is_same_v<size_stream, S>)
            heap = stream.pos + start_heap;

         /// no need to write start_heap, it is always the same because
         /// the structure is "fixed" and cannot be extended in the future
         reflect<T>::for_each([&](const meta& ref, auto member)
                              { fracpack_member(heap, v, member(&v), stream); });

         if constexpr (not std::is_same_v<size_stream, S>)
            stream.pos = heap;
         //         std::cout <<"return start_heap: " << start_heap <<"\n";
         //return start_heap;  /// it has been advanced and now points at end of heap
      }
      else
      {
         T::fracpack_not_defined;
      }
   }

   template <typename T, typename S>
   void fracunpack(T& v, S& stream);
   template <typename T, typename S>
   void fraccheck(S& stream);

   template <typename T, typename P, typename S>
   void fracunpack_member(T& member, P ptr, S& stream)
   {
      if constexpr (not std::is_member_function_pointer_v<P>)
         fracunpack_member(member.*ptr, stream);
   }

   template <typename S>
   void fracunpack(bool& v, S& stream)
   {
      char c;
      stream.read(&c, 1);
      v = c != 0;
   }

   template <typename T, typename S>
   void fracunpack_member(T& member, S& stream)
   {
      if constexpr (may_use_heap<T>())
      {
         if constexpr (is_std_optional<T>::value)
         {
            uint32_t offset;
            stream.read(&offset, sizeof(offset));

            using opt_type = typename is_std_optional<T>::value_type;

            if (offset == 0)
            {
               member = opt_type();
            }
            else if (offset >= 4)
            {
               member = opt_type();
               S insubstr(stream.pos + offset - sizeof(offset_ptr), stream.end);
               fracunpack(*member, insubstr);
            }
            else
               member.reset();
         }
         /** unpack empty vector / string */
         else if constexpr (is_shared_view_ptr<T>::value)
         {
            uint32_t offset;
            stream.read(&offset, sizeof(offset));
            if (offset >= 4)
            {
               S insubstream(stream.pos + offset - sizeof(offset_ptr), stream.end);
               fracunpack(member, insubstream);
            }
            else
               member.reset();
         }
         else if constexpr (is_std_vector<T>::value || std::is_same_v<T, std::string>)
         {
            uint32_t offset;
            stream.read(&offset, sizeof(offset));
            if (offset >= 4)
            {
               S insubstream(stream.pos + offset - sizeof(offset_ptr), stream.end);
               fracunpack(member, insubstream);
            }
            else
               member.resize(0);
         }
         else
         {
            uint32_t offset;
            stream.read(&offset, sizeof(offset));
            S insubstream(stream.pos + offset - sizeof(offset_ptr), stream.end);
            fracunpack(member, insubstream);
         }
      }
      else
      {
         fracunpack(member, stream);
      }
   }

   template <uint32_t I, typename V, typename First, typename... Rest>
   bool init_type(uint8_t i, V& v)
   {
      if (i == I)
      {
         v = V(std::in_place_index_t<I>(), First());
         return true;
      }
      else if constexpr (sizeof...(Rest) > 0)
      {
         return init_type<I + 1, V, Rest...>(i, v);
      }
      return false;
   }
   template <typename First, typename... Rest>
   bool init_variant_by_index(uint8_t index, std::variant<First, Rest...>& v)
   {
      return init_type<0, std::variant<First, Rest...>, First, Rest...>(index, v);
   }

   template <typename T, typename S>
   void fracunpack(T& v, S& stream)
   {
      if constexpr (std::is_same_v<std::string, T>)
      {
         uint32_t size;
         stream.read((char*)&size, sizeof(size));
         v.resize(size);
         if (size > 0)
            stream.read(v.data(), size);
      }
      else if constexpr (is_std_array<T>::value)
      {
         using member_type = typename is_std_array<T>::value_type;

         if constexpr (can_memcpy<member_type>())
         {
            stream.read(&v[0], sizeof(member_type) * is_std_array<T>::size);
         }
         else
         {
            for (auto& i : v)
               fracunpack_member(i, stream);
         }
      }
      else if constexpr (is_std_tuple<T>::value)
      {
         uint16_t start_heap;
         stream.read(&start_heap, sizeof(start_heap));

         const char* heap = stream.pos + start_heap;
         tuple_foreach(v,
                       [&](auto& x)
                       {
                          if (stream.pos < heap)
                             fracunpack_member(x, stream);
                       });
      }
      else if constexpr (is_shared_view_ptr<T>::value)
      {
         v.reset();
         uint32_t size;
         stream.read((char*)&size, sizeof(size));
         v.resize(size);
         stream.read(v.data(), size);
      }
      else if constexpr (is_std_variant<T>::value)
      {
         uint8_t idx;
         stream.read(&idx, 1);
         bool     known = init_variant_by_index(idx, v);
         uint32_t size;
         stream.read(&size, sizeof(size));
         if (known && size)
         {
            S substr(stream.pos, stream.pos + size);
            stream.skip(size);
            std::visit([&](auto& iv) { fracunpack(iv, substr); }, v);
         }
         else
         {
            stream.skip(size);
         }
      }
      else if constexpr (can_memcpy<T>())
      {
         stream.read((char*)&v, sizeof(T));
      }
      else if constexpr (is_std_vector<T>::value)
      {
         using value_type = typename is_std_vector<T>::value_type;
         if constexpr (can_memcpy<value_type>())
         {
            uint16_t fix_size = fracpack_fixed_size<value_type>();

            uint32_t size;
            stream.read((char*)&size, sizeof(size));
            uint32_t s = size / fix_size;
            v.resize(s);
            if (s > 0)
               stream.read(v.data(), size);
         }
         else
         {
            uint16_t fix_size = fracpack_fixed_size<value_type>();
            if constexpr (may_use_heap<value_type>())
               fix_size = sizeof(offset_ptr);
            uint32_t size;
            stream.read(&size, sizeof(size));
            auto elem = size / fix_size;
            v.resize(elem);
            for (auto& e : v)
            {
               fracunpack_member(e, stream);
            }
         }
      }
      else if constexpr (is_std_optional<T>::value)
      {
         fracunpack_member(v, stream);
         /*
         uint32_t offset;
         stream.read( &offset, sizeof(offset) );
         if( offset != 4 ) v = T();
         v = typename is_std_optional<T>::value_type();
         fracunpack( *v, stream );
         */
      }
      else if constexpr (reflect<T>::is_struct)
      {
         uint16_t start_heap = fracpack_fixed_size<T>();
         if constexpr (not psio::reflect<T>::definitionWillNotChange)  //is_ext_structure<T>())
         {
            stream.read(&start_heap, sizeof(start_heap));
         }
         const char* heap = stream.pos + start_heap;
         reflect<T>::for_each(
             [&](const meta& ref, auto member)
             {
                if (stream.pos < heap)
                   fracunpack_member(v, member(&v), stream);
             });
      }
      else
      {
         T::fracunpack_not_defined;
      }
   }  // fracunpack

   template <typename T, typename S>
   void fraccheck_member(S& stream)
   {
      if constexpr (may_use_heap<T>())
      {
         if constexpr (is_std_optional<T>::value)
         {
            uint32_t offset;
            stream.read(&offset, sizeof(offset));

            using opt_type = typename is_std_optional<T>::value_type;

            if (offset >= 4)
            {
               check_input_stream insubstr(stream.pos + offset - sizeof(offset_ptr), stream.end);
               fraccheck<opt_type>(insubstr);
               stream.add_total_read(insubstr.get_total_read());
            }
         }
         /** unpack empty vector / string */
         else if constexpr (is_std_vector<T>::value || std::is_same_v<T, std::string>)
         {
            uint32_t offset;
            stream.read(&offset, sizeof(offset));
            if (offset >= 4)
            {
               S insubstream(stream.pos + offset - sizeof(offset_ptr), stream.end);
               fraccheck<T>(insubstream);

               /** this is safe to read after the above lone because it already checked
                *  the bounds. This enforces that an empty string or vector is always
                *  encoded as a zero offset rather than an offset to a 0 allocated on the
                *  heap.
                */
               uint32_t vec_str_size = 0;
               memcpy(&vec_str_size, stream.pos + offset, sizeof(vec_str_size));

               if (vec_str_size == 0)
                  abort_error(stream_error::empty_vec_used_offset);

               stream.add_total_read(insubstream.get_total_read());
            }
         }
         else
         {
            uint32_t offset;
            stream.read(&offset, sizeof(offset));
            S insubstream(stream.pos + offset - sizeof(offset_ptr), stream.end);
            fraccheck<T>(insubstream);
            stream.add_total_read(insubstream.get_total_read());
         }
      }
      else
      {
         fraccheck<T>(stream);
      }
   }

   struct check_stream
   {
      check_stream(const char* startptr = nullptr, const char* endptr = nullptr)
          : valid(false),
            unknown(false),
            begin(startptr),
            end(endptr),
            heap(startptr),
            pos(startptr)
      {
      }
      check_stream(const check_stream&)            = default;
      check_stream& operator=(const check_stream&) = default;

      bool valid;    ///< no errors detected
      bool unknown;  ///< unknown fields detected, TODO: move from bools to ints

      bool valid_and_known() const { return valid and not unknown; }

      template <typename T>
      friend check_stream fracvalidate(const char* b, const char* e);

      template <typename T>
      friend check_stream fracvalidate_view(const view<T>& v, const char* p, const char* e);

      template <typename MemberType>
      friend uint32_t fracvalidate_member(const char* memptr, check_stream& stream);

      template <typename MemberType>
      friend void fracvalidate_offset(uint32_t offset, const char* memptr, check_stream& stream);

     private:
      const char* begin;  ///< the start of the stream
      const char* end;    ///< the absolute limit on reads
      const char* heap;   ///< the location of the heap
      const char* pos;    ///< the highest point read
   };

   template <typename T>
   check_stream fracvalidate(const char* b, const char* e);

   template <typename T>
   check_stream fracvalidate(const std::span<const char>& v)
   {
      return fracvalidate<T>(v.begin(), v.end());
   }

   template <typename T>
   check_stream fracvalidate(const char* b, size_t s)
   {
      return fracvalidate<T>(b, b + s);
   }
   template <typename T>
   check_stream fracvalidate_view(const view<T>& v, const char* p, const char* e);

   //#ifdef __wasm__
   // Adaptors for rapidjson
   struct rapidjson_stream_adaptor
   {
      rapidjson_stream_adaptor(const char* src, int sz)
      {
         int chars = std::min(sz, 4);
         memcpy(buf, src, chars);
         memset(buf + chars, 0, 4 - chars);
      }
      void Put(char ch) {}
      char Take() { return buf[idx++]; }
      char buf[4];
      int  idx = 0;
   };
   //#endif

   template <typename T>
   constexpr bool may_be_zero_offset()
   {
      if constexpr (is_std_vector<T>::value)
         return true;
      else if constexpr (std::is_same_v<std::string, T>)
         return true;
      else if constexpr (is_std_optional<T>::value)
         return may_be_zero_offset<typename is_std_optional<T>::value_type>();
      return false;
   }

   template <typename MemberType>
   void fracvalidate_offset(uint32_t offset, const char* memptr, check_stream& stream)
   {
      //std::cout << "validating offset to..." << psio::get_type_name<MemberType>() <<"\n";
      const char* obj_start = memptr + offset;

      /// the offset is expected to start after the end of the known heap
      /// if the last offset object had unknown fields then there may be
      /// some unaccounted for heap usage that we cannot verify... but we do
      /// know the portion that we can account for.
      ///
      /// As soon as the stream comes across any unknown data we releax the check, this
      /// may mean that some "invalid but unreachable" data is included in a buffer that
      /// has some unknowns, but for data with no unknowns we maintain the stricter check
      if (stream.unknown)
      {
         if (not(stream.valid = (obj_start >= stream.heap) and obj_start < stream.end))
         {
            //                     std::cerr<< ".......obj start < expected stream.heap\n";
            return;
         }
      }
      else
      {
         if (not(stream.valid = (obj_start == stream.heap) and obj_start < stream.end))
         {
            //             std::cerr<< "offset to type: " << get_type_name<MemberType>() <<"\n";
            //           std::cerr<< obj_start - stream.begin << " vs " << stream.heap - stream.begin <<"\n";
            //            std::cerr<< ".......obj start != expected stream.heap\n";
            return;
         }
      }

      stream.unknown |= obj_start > stream.heap;

      //auto substr  = fracvalidate<opt_member_type>( stream.heap, stream.end );
      //      std::cout << __LINE__ << " obj_start: " << obj_start - stream.begin <<"\n";
      //      std::cout << __LINE__ << " obj_start: " << stream.heap - stream.begin <<"\n";
      auto substr = fracvalidate<MemberType>(obj_start, stream.end);
#ifdef DEBUG
      //      std::cout << __LINE__ << " substr.valid: " << substr.valid <<"\n";
      //      std::cout << __LINE__ << " substr.heap: " << substr.heap - substr.begin <<"\n";
      if (not substr.valid)
      {
         //         auto n = psio::get_type_name<MemberType>();
         //         std::cout << "   valoffset substream " << n << " invalid\n";
      }
#endif

      /// empty vectors / strings shouldn't be on the heap
      /// this check is for canonical form only.
      if constexpr (is_std_vector<MemberType>() || std::is_same_v<MemberType, std::string>)
      {
         //        std::cout << __LINE__ << " steam.valid: " << stream.valid <<"\n";
         if (offset > 0)
         {
            //           std::cout <<"vector/string...\n";
            uint32_t data_size;
            memcpy(&data_size, obj_start, sizeof(data_size));
            stream.valid &= (data_size != 0);
         }
      }
      //stream.pos      = substr.pos;
      //      std::cout << "   heap advanced by:  " << substr.heap - stream.heap <<"\n";
      stream.heap = substr.heap;
      stream.valid &= substr.valid;
      stream.unknown |= substr.unknown;
      //      std::cout << __LINE__ << " steam.valid: " << stream.valid <<"\n";
   }

   template <typename MemberType>
   uint32_t fracvalidate_member(const char* memptr, check_stream& stream)
   {
      //         std::cout << "validating member..." << psio::get_type_name<MemberType>() <<"   ";
      //         std::cout << "heap: " << stream.heap - stream.begin <<"\n";
      if constexpr (may_use_heap<MemberType>())
      {
         //      std::cout << "    may use heap \n";
         if (stream.valid /*&= (stream.end - memptr >= 4)*/)
         {
            uint32_t offset;
            memcpy(&offset, memptr, sizeof(offset));
            //               std::cout << " offset: " << offset <<"\n";

            if constexpr (may_be_zero_offset<MemberType>())
            {
               if (offset == 0)
                  return 4;
            }
            if constexpr (is_std_optional<MemberType>::value)
            {
               //         std::cout << "      validating optional member...\n";
               if (offset == 1)
                  return 4;

               if constexpr (std::is_same_v<std::string, MemberType> ||
                             is_std_vector<MemberType>::value)
               {
                  if ((stream.valid = (offset == 0)))
                  {
                     return 4;
                  }
               }
               if (offset < 4)
               {
                  stream.valid = false;
               }
               else
               {
                  using opt_member_type = typename is_std_optional<MemberType>::value_type;
                  fracvalidate_offset<opt_member_type>(offset, memptr, stream);
               }
            }
            else
            {
               fracvalidate_offset<MemberType>(offset, memptr, stream);
            }
            return 4;
         }
         else
         {
            //               std::cerr<< " stream wasn't valid...\n";
         }
         return 0;
      }
      else
      {
         return fracpack_fixed_size<MemberType>();
      }
   }

   /**
    * @pre b is valid pointer
    * @pre e > b
    */
   // TODO: incorrectly validates PsiBase::PublicKey when variant's size field is smaller than it should be
   template <typename T>
   check_stream fracvalidate(const char* b, const char* e)
   {
      //      std::cout << "validating T..." << psio::get_type_name<T>() <<"\n";
      check_stream stream(b, e);
      if constexpr (is_std_array<T>::value)
      {
         using member_type = typename is_std_array<T>::value_type;
         stream.heap       = stream.pos + fracpack_fixed_size<T>();
         stream.valid      = stream.heap <= stream.end;
         if constexpr (may_use_heap<member_type>())
         {
            for (uint32_t i = 0; stream.valid and i < is_std_array<T>::size; ++i)
            {
               stream.pos += fracvalidate_member<member_type>(stream.pos, stream);
            }
         }
         return stream;
      }
      else if constexpr (is_shared_view_ptr<T>::value)
      {
         if ((stream.valid = (stream.end - stream.begin >= 4)))
         {
            std::uint32_t size;
            std::memcpy(&size, stream.begin, sizeof(size));
            stream.pos += sizeof(size) + size;
            stream.heap = stream.pos;
            stream.valid = fracvalidate<typename is_shared_view_ptr<T>::value_type>(stream.begin + 4, stream.pos).valid;
         }
         return stream;
      }
      else if constexpr (not may_use_heap<T>())
      {
         stream.pos   = stream.begin + fracpack_fixed_size<T>();
         stream.heap  = stream.pos;
         stream.valid = stream.pos <= stream.end;
         return stream;
      }
      else if constexpr (std::is_same_v<T, std::string>)
      {
         //        std::cout << " heap befor evalidate string:  "<< stream.heap - stream.begin <<"\n";
         if (bool(stream.valid = (stream.end - stream.begin >= 4)))
         {
            uint32_t strsize;
            memcpy(&strsize, stream.begin, sizeof(strsize));
            stream.pos += sizeof(strsize) + strsize;
            stream.heap = stream.pos;

            //        std::cout << " heap after validate string:  "<< stream.heap - stream.begin <<"\n";
            if ((stream.valid &= (stream.pos <= stream.end)))
            {
               //#ifndef __wasm__
               stream.valid &= simdjson::validate_utf8(stream.begin + sizeof(strsize), strsize);
               //#else
               //               rapidjson_stream_adaptor s2(stream.begin+sizeof(strsize), strsize);
               //               stream.valid = rapidjson::UTF8<>::Validate(s2, s2);
               //#endif
            }
         }
         else
         {
            abort_error(stream_error::overrun);
         }
         return stream;
      }
      else if constexpr (is_std_vector<T>::value)
      {
         using member_type = typename is_std_vector<T>::value_type;
         if (bool(stream.valid = 4 <= stream.end - stream.begin))
         {
            uint32_t size;
            memcpy(&size, stream.begin, sizeof(size));
            stream.pos += 4;
            stream.heap = stream.pos + size;  /// heap starts after size bytes
            if constexpr (not may_use_heap<member_type>())
            {
               stream.pos = stream.heap;  /// TODO: is this required for return
               stream.valid =
                   (size % fracpack_fixed_size<member_type>() == 0) and stream.heap <= stream.end;
               return stream;
            }
            else if (bool(stream.valid = (size % sizeof(uint32_t) == 0)))
            {  /// must be a multiple of offset
               //stream.heap += size;
               auto end = stream.heap;
               while (stream.valid and stream.pos != end)
               {
                  stream.pos += fracvalidate_member<member_type>(stream.pos, stream);
               }
               return stream;
            }
            else
            {
               //std::cout << "uses heap but size isn't multiple of offsetptr size\n";
            }
         }
         else
         {
            //  std::cout <<"not enough space to read size\n";
         }
      }
      else if constexpr (is_std_optional<T>::value)
      {
         //         std::cout << "root validate optional " << get_type_name<T>() <<"\n";
         stream.heap = stream.pos + 4;
         if (not bool(stream.valid = (stream.end - stream.pos < (ssize_t)sizeof(uint32_t))))
         {
            uint32_t offset;
            memcpy(&offset, stream.pos, sizeof(offset));
            //           std::cout <<"       offset = " << offset<<"\n";
            if (offset == 1)
            {
               stream.valid = 1;
               return stream;
            }
            using member_type = typename is_std_optional<T>::value_type;
            if constexpr (std::is_same_v<std::string, member_type> ||
                          is_std_vector<member_type>::value)
            {
               if ((stream.valid = (offset == 0)))
               {
                  //                  std::cout<<"\n.... empty string opt on optional\n";
                  return stream;
               }
            }

            fracvalidate_offset<typename is_std_optional<T>::value_type>(offset, stream.pos,
                                                                         stream);

            return stream;
         }
         else
         {
#ifdef DEBUG
//            std::cerr<< ".................. stream not long enough\n";
#endif
         }
         return stream;
      }
      else if constexpr (is_std_variant<T>::value)
      {
         if (not bool(stream.valid = stream.begin + 4 + 1 <= stream.end))
         {
            return stream;
         }
         uint8_t type = *stream.pos;
         stream.pos++;
         uint32_t size;
         memcpy(&size, stream.pos, sizeof(size));
         stream.pos += 4;
         if (type >= is_std_variant<T>::num_types)
         {
            stream.unknown = true;
            stream.valid   = stream.pos + size <= stream.end;
            return stream;
         }
         const_view<T> v(stream.begin);

         check_stream substr(0, 0);
         v->visit([&](auto i) { substr = fracvalidate_view(i, stream.pos, stream.end); });

         stream.valid &= substr.valid;
         stream.unknown |= substr.unknown;
         stream.heap = substr.heap;
         stream.pos  = substr.pos;
         return stream;
      }
      else if constexpr (is_std_tuple<T>::value)
      {
         uint16_t start_heap;
         memcpy(&start_heap, stream.pos, sizeof(start_heap));

         stream.pos += sizeof(start_heap);
         stream.heap = stream.pos + start_heap;

         stream.valid = start_heap >= fixed_size_before_optional<T>();
         stream.unknown |= start_heap > fracpack_fixed_size<T>();

         const char* memptr = stream.pos;

         tuple_foreach(T(),
                       [&](const auto& m)
                       {
                          auto delta =
                              fracvalidate_member<std::decay_t<decltype(m)>>(memptr, stream);
                          memptr += delta;
                       });

         return stream;
      }
      else if constexpr (reflect<T>::is_struct and psio::reflect<T>::definitionWillNotChange)
      {
         stream.pos   = stream.begin + fracpack_fixed_size<T>();
         stream.heap  = stream.pos;
         stream.valid = stream.pos <= stream.end;

         if constexpr (known_members_may_use_heap<T>())
         {
            if (stream.valid)
            {
               const char* memptr = stream.begin;
               // visit each offset ptr
               reflect<T>::for_each(
                   [&](const meta& ref, auto member)
                   {
                      using MemPtr = decltype(member(std::declval<T*>()));
                      if constexpr (not std::is_member_function_pointer_v<MemPtr>)
                      {
                         using member_type = decltype(result_of_member(std::declval<MemPtr>()));
                         memptr += fracvalidate_member<member_type>(memptr, stream);
                      }
                   });
            }
         }
      }
      else
      {
         uint16_t start_heap;
         memcpy(&start_heap, stream.pos, sizeof(start_heap));

         stream.pos += sizeof(start_heap);
         stream.heap = stream.pos + start_heap;

         stream.valid = start_heap >= fixed_size_before_optional<T>() and stream.end >= stream.heap;
         stream.unknown |= start_heap > fracpack_fixed_size<T>();

         // visit each offset ptr
         if constexpr (known_members_may_use_heap<T>())
         {
            if (stream.valid)
            {
               const char* memptr = stream.pos;
               reflect<T>::for_each(
                   [&](const meta& ref, auto member)
                   {
                      using MemPtr = decltype(member(std::declval<T*>()));
                      if constexpr (not std::is_member_function_pointer_v<MemPtr>)
                      {
                         using member_type = decltype(result_of_member(std::declval<MemPtr>()));
                         memptr += fracvalidate_member<member_type>(memptr, stream);
                      }
                   });
            }
         }
      }
      return stream;
   }

   template <typename T>
   check_stream fracvalidate_view(const_view<T>& v, const char* p, const char* e)
   {
      return fracvalidate<T>(p, e);
   }

   /** 
     * returns the number of bytes that would be written
     * if fracpack(v) was called
     */
   template <typename T>
   uint32_t fracpack_size(const T& v)
   {
      size_stream size_str;
      fracpack(v, size_str);
      return size_str.size;
   }

   template <uint32_t I, typename Tuple>
   struct get_tuple_offset;

   template <uint32_t Idx, typename First, typename... Ts>
   constexpr uint32_t get_offset()
   {
      static_assert(Idx < sizeof...(Ts) + 1, "index out of range");
      if constexpr (Idx == 0)
         return 0;
      else if constexpr (sizeof...(Ts) == 0)
         if constexpr (may_use_heap<First>())
            return 4;
         else
            return fracpack_fixed_size<First>();
      else
      {
         if constexpr (may_use_heap<First>())
            return get_offset<Idx - 1, Ts...>() + 4;
         else
            return get_offset<Idx - 1, Ts...>() + fracpack_fixed_size<First>();
      }
   }

   template <uint32_t I, typename... Args>
   struct get_tuple_offset<I, std::tuple<Args...>>
   {
      static constexpr const uint32_t value = get_offset<I, Args...>();
   };

   template <typename T>
   auto get_offset(char* pos)
   {
      uint32_t off = *reinterpret_cast<unaligned_type<uint32_t>*>(pos);
      if constexpr (std::is_same_v<std::string, T> || is_std_vector<T>::value)
      {
         if (off == 0)
            return view<T>(pos);
         else
            return view<T>(pos + off);
      }
      return view<T>(pos + off);
   }
   template <typename T>
   auto get_offset(const char* pos)
   {
      uint32_t off = *reinterpret_cast<const unaligned_type<uint32_t>*>(pos);
      if constexpr (std::is_same_v<std::string, T> || is_std_vector<T>::value)
      {
         if (off == 0)
            return const_view<T>(pos);
         else
            return const_view<T>(pos + off);
      }
      return const_view<T>(pos + off);
   }

   struct const_frac_proxy_view
   {
      const_frac_proxy_view(const char* c) : buffer(c) {}

      template <uint32_t idx, uint64_t Name, auto MemberPtr, typename T>
      auto operator[](T&& k) const
      {
         return get<idx, Name, MemberPtr>()[std::forward<T>(k)];
      }
      template <uint32_t idx, uint64_t Name, auto MemberPtr, typename T>
      auto operator[](T&& k)
      {
         return get<idx, Name, MemberPtr>()[std::forward<T>(k)];
      }

      template <uint32_t idx, uint64_t Name, auto MemberPtr>
      auto get() const
      {
         using class_type  = decltype(psio::class_of_member(MemberPtr));
         using tuple_type  = typename psio::reflect<class_type>::struct_tuple_type;
         using member_type = decltype(psio::result_of_member(MemberPtr));

         constexpr uint32_t offset = psio::get_tuple_offset<idx, tuple_type>::value +
                                     2 * (not psio::reflect<class_type>::definitionWillNotChange);

         //psio::is_ext_structure<class_type>());  // the 2 bytes that point to expected start of heap if it cannot be assumed

         auto out_ptr = buffer + offset;

         if constexpr (is_std_optional<member_type>::value)
         {
            using opt_type        = typename is_std_optional<member_type>::value_type;
            using const_view_type = const_view<opt_type>;

            if constexpr (is_ext_structure<class_type>())
            {
               uint16_t start_heap = *reinterpret_cast<const unaligned_type<uint16_t>*>(buffer);
               if (start_heap < offset + 2)
                  return const_view_type(nullptr);
            }
            auto ptr = reinterpret_cast<const unaligned_type<offset_ptr>*>(out_ptr);
            if (ptr->val < 4)
               return const_view_type(nullptr);
            return get_offset<opt_type>(out_ptr);  //view_type(ptr->get<opt_type>());
         }
         else if constexpr (may_use_heap<member_type>())
         {
            return get_offset<member_type>(out_ptr);
         }
         else
         {
            return const_view<member_type>(out_ptr);
         }
      }
      const char* buffer;
   };
   struct frac_proxy_view
   {
      frac_proxy_view(char* c) : buffer(c) {}

      template <uint32_t idx, uint64_t Name, auto MemberPtr, typename T>
      auto operator[](T&& k) const
      {
         return get<idx, Name, MemberPtr>()[std::forward<T>(k)];
      }
      template <uint32_t idx, uint64_t Name, auto MemberPtr, typename T>
      auto operator[](T&& k)
      {
         return get<idx, Name, MemberPtr>()[std::forward<T>(k)];
      }

      /** This method is called by the reflection library to get the field */
      template <uint32_t idx, uint64_t Name, auto MemberPtr>
      auto get()
      {
         using class_type  = decltype(psio::class_of_member(MemberPtr));
         using tuple_type  = typename psio::reflect<class_type>::struct_tuple_type;
         using member_type = decltype(psio::result_of_member(MemberPtr));

         constexpr uint32_t offset = psio::get_tuple_offset<idx, tuple_type>::value +
                                     2 * (not psio::reflect<class_type>::definitionWillNotChange);

         char* out_ptr = buffer + offset;
         //       std::cout << "offset: " << offset <<"\n";

         if constexpr (is_std_optional<member_type>::value)
         {
            using opt_type  = typename is_std_optional<member_type>::value_type;
            using view_type = view<opt_type>;

            if constexpr (is_ext_structure<class_type>())
            {
               uint16_t start_heap = *reinterpret_cast<unaligned_type<uint16_t>*>(buffer);
               if (start_heap < offset + 2)
                  return view_type(nullptr);
            }
            auto ptr = reinterpret_cast<const unaligned_type<offset_ptr>*>(out_ptr);
            if (ptr->val < 4)
               return view_type(nullptr);
            return get_offset<opt_type>(out_ptr);
         }
         else if constexpr (may_use_heap<member_type>())
         {
            return get_offset<member_type>(out_ptr);
         }
         else
         {
            return view<member_type>(out_ptr);
         }
      }

      //private:
      char* buffer;
   };

   template <typename View, typename Enable>
   struct view
   {
      using View::not_defined;
   };
   template <typename View, typename Enable>
   struct const_view
   {
      using View::not_defined;
   };

   template <>
   struct view<bool>
   {
      using char_ptr = char*;
      view(char_ptr p = nullptr) : pos(p) {}
      operator bool() const { return *pos != 0; }

      template <typename V>
      auto& operator=(V&& v)
      {
         *pos = (0 != v);
         return *this;
      }

      template <typename S>
      friend S& operator<<(S& stream, const view& member)
      {
         return stream << bool(0 != *member.pos);
      }

      auto* operator->() { return this; }
      auto& operator*() { return *this; }
      auto* operator->() const { return this; }
      auto& operator*() const { return *this; }

     private:
      friend struct const_view<bool>;
      char_ptr pos;
   };

   template <>
   struct const_view<bool>
   {
      using char_ptr = const char*;
      const_view(char_ptr p = nullptr) : pos(p) {}
      const_view(view<bool> v) : pos(v.pos) {}
      operator bool() const { return *pos != 0; }

      template <typename S>
      friend S& operator<<(S& stream, const const_view& member)
      {
         return stream << bool(0 != *member.pos);
      }

      auto* operator->() { return this; }
      auto& operator*() { return *this; }
      auto* operator->() const { return this; }
      auto& operator*() const { return *this; }

     private:
      char_ptr pos;
   };

   template <typename T>
   struct view<T, std::enable_if_t<std::is_arithmetic_v<T>>>
   {
      using char_ptr = char*;
      view(char_ptr p = nullptr) : pos(p) {}
      operator T() const { return *reinterpret_cast<const unaligned_type<T>*>(pos); }

      template <typename V>
      auto& operator=(V&& v)
      {
         *reinterpret_cast<unaligned_type<T>*>(pos) = std::forward<V>(v);
         return *this;
      }

      template <typename S>
      friend S& operator<<(S& stream, const view& member)
      {
         return stream << (T) * reinterpret_cast<unaligned_type<T>*>(member.pos);
      }

      auto* operator->() { return this; }
      auto& operator*() { return *this; }
      auto* operator->() const { return this; }
      auto& operator*() const { return *this; }

     private:
      friend struct const_view<T>;
      char_ptr pos;
   };

   template <typename T>
   struct const_view<T, std::enable_if_t<std::is_arithmetic_v<T>>>
   {
      using char_ptr = const char*;
      const_view(char_ptr p = nullptr) : pos(p) {}
      const_view(view<T> v) : pos(v.pos) {}

      operator T() const { return *reinterpret_cast<const unaligned_type<T>*>(pos); }

      template <typename S>
      friend S& operator<<(S& stream, const const_view& member)
      {
         return stream << (T) * reinterpret_cast<const unaligned_type<T>*>(member.pos);
      }

      auto* operator->() const { return this; }
      auto& operator*() const { return *this; }

     private:
      char_ptr pos;
   };

   template <>
   struct view<std::string>
   {
      view(char* p = nullptr) : pos(p) {}

      uint32_t size() const { return *reinterpret_cast<const unaligned_type<uint32_t>*>(pos); }

      bool valid() const { return pos != nullptr; }

      operator std::string_view() const { return std::string_view(pos + 4, size()); }
      operator std::string() const { return std::string(pos + 4, size()); }

      template <typename S>
      friend S& operator<<(S& stream, const view& member)
      {
         return stream << std::string_view(member);
      }

      auto* operator->() { return this; }
      auto& operator*() { return *this; }

      // TODO: add [] operators for mutation in place

     private:
      friend struct const_view<std::string>;
      char* pos;
   };

   template <>
   struct const_view<std::string>
   {
      const_view(const char* p = nullptr) : pos(p) {}
      const_view(view<std::string> v) : pos(v.pos) {}

      uint32_t size() const { return *reinterpret_cast<const unaligned_type<uint32_t>*>(pos); }

      bool valid() const { return pos != nullptr; }

      operator std::string_view() const { return std::string_view(pos + 4, size()); }
      operator std::string() const { return std::string(pos + 4, size()); }

      template <typename S>
      friend S& operator<<(S& stream, const const_view& member)
      {
         return stream << std::string_view(member);
      }

      auto* operator->() const { return this; }
      auto& operator*() const { return *this; }

     private:
      const char* pos;
   };

   template <typename T>
   struct view<shared_view_ptr<T>>
   {
      view(char* p = nullptr) : pos(p) {}
      auto operator->()
      {
         auto s = *reinterpret_cast<const unaligned_type<uint32_t>*>(pos);
         if (not s)
            return view<T>(nullptr);
         return view<T>(pos + 4);
      }
      auto operator*()
      {
         if (not pos)
            return view<T>(nullptr);
         return view<T>(pos + 4);
      }
      bool valid() const
      {
         return pos != nullptr && 0 != *reinterpret_cast<const unaligned_type<uint32_t>*>(pos);
      }
      operator T() const { return view<T>(pos); }

     private:
      friend const_view<shared_view_ptr<T>>;
      char* pos;
   };

   template <typename T>
   struct const_view<shared_view_ptr<T>>
   {
      const_view(const char* p = nullptr) : pos(p) {}
      const_view(view<shared_view_ptr<T>> v) : pos(v.pos) {}

      auto operator->() const
      {
         auto s = *reinterpret_cast<const unaligned_type<uint32_t>*>(pos);
         if (not s)
            return const_view<T>(nullptr);
         return view<T>(pos + 4);
      }
      auto operator*() const
      {
         if (not pos)
            return const_view<T>(nullptr);
         return const_view<T>(pos + 4);
      }

      bool valid() const
      {
         return pos != nullptr && 0 != *reinterpret_cast<const unaligned_type<uint32_t>*>(pos);
      }

      operator T() const { return view<T>(pos); }

     private:
      const char* pos;
   };

   /// TODO: specialize this based on whether T is memcpyable and ensure
   /// so that data() and data_size() return types that are proper (e.g. unaligned_type<T>*) and factor
   /// in the fact thatthey might be unaligned.
   template <typename T>
   struct view<std::vector<T>>
   {
      view(char* p = nullptr) : pos(p) {}

      uint32_t size() const
      {
         if constexpr (not may_use_heap<T>())
         {
            constexpr uint16_t fix_size = fracpack_fixed_size<T>();
            return data_size() / fix_size;
         }
         else
         {
            return data_size() / 4;
         }
      }

      auto operator[](uint32_t idx)
      {
         if constexpr (may_use_heap<T>())
         {
            return get_offset<T>(pos + 4 + idx * sizeof(uint32_t));
         }
         else
         {
            return view<T>(pos + 4 + idx * fracpack_fixed_size<T>());
         }
      }

      inline char*    data() const { return pos + sizeof(uint32_t); }
      inline uint32_t data_size() const
      {
         return *reinterpret_cast<const unaligned_type<uint32_t>*>(pos);
      }

      bool valid() const { return pos != nullptr; }

      auto* operator->() { return this; }
      auto& operator*() { return *this; }

      operator std::vector<T>() const
      {
         input_stream   in(pos, pos + 0xfffffff);  /// TODO: maintain real end
         std::vector<T> tmp;
         fracunpack<std::vector<T>>(tmp, in);
         return tmp;
      }

     private:
      friend struct const_view<std::vector<T>>;
      char* pos;
   };

   template <typename T, size_t S>
   struct view<std::array<T, S>>
   {
      view(char* p = nullptr) : pos(p) {}

      uint32_t size() const { return S; }

      auto operator[](uint32_t idx)
      {
         if constexpr (may_use_heap<T>())
         {
            return get_offset<T>(pos + idx * sizeof(uint32_t));
         }
         else
         {
            return view<T>(pos + idx * fracpack_fixed_size<T>());
         }
      }

      inline char*    data() const { return pos; }
      inline uint32_t data_size() const { return S * fracpack_fixed_size<T>(); }

      bool valid() const { return pos != nullptr; }

      auto* operator->() { return this; }
      auto& operator*() { return *this; }

      operator std::array<T, S>() const
      {
         input_stream     in(pos, pos + 0xfffffff);  /// TODO: maintain real end
         std::array<T, S> tmp;
         fracunpack<std::array<T, S>>(tmp, in);
         return tmp;
      }

     private:
      friend struct const_view<std::array<T, S>>;
      char* pos;
   };
   template <typename T, size_t S>
   struct const_view<std::array<T, S>>
   {
      const_view(const char* p = nullptr) : pos(p) {}
      const_view(view<std::array<T, S>> v) : pos(v.pos) {}

      uint32_t size() const { return S; }

      auto operator[](uint32_t idx) const
      {
         if constexpr (may_use_heap<T>())
         {
            return get_offset<T>(pos + idx * sizeof(uint32_t));
         }
         else
         {
            return view<T>(pos + idx * fracpack_fixed_size<T>());
         }
      }

      inline const char* data() const { return pos; }
      inline uint32_t    data_size() const { return S * fracpack_fixed_size<T>(); }

      bool valid() const { return pos != nullptr; }

      auto* operator->() { return this; }
      auto& operator*() { return *this; }

      operator std::array<T, S>() const
      {
         input_stream     in(pos, pos + 0xfffffff);  /// TODO: maintain real end
         std::array<T, S> tmp;
         fracunpack<std::array<T, S>>(tmp, in);
         return tmp;
      }

     private:
      const char* pos;
   };

   /// TODO: specialize this based on whether T is memcpyable and ensure
   /// so that data() and data_size() return types that are proper (e.g. unaligned_type<T>*) and factor
   /// in the fact thatthey might be unaligned.
   template <typename T>
   struct const_view<std::vector<T>>
   {
      const_view(const char* p = nullptr) : pos(p) {}
      const_view(view<std::vector<T>> v) : pos(v.pos) {}

      uint32_t size() const
      {
         if constexpr (not may_use_heap<T>())
         {
            constexpr uint16_t fix_size = fracpack_fixed_size<T>();
            return *reinterpret_cast<const unaligned_type<uint32_t>*>(pos) / fix_size;
         }
         else
         {
            return *reinterpret_cast<const unaligned_type<uint32_t>*>(pos) / 4;
         }
      }

      auto operator[](uint32_t idx) const
      {
         if constexpr (may_use_heap<T>())
         {
            return get_offset<T>(pos + 4 + idx * sizeof(uint32_t));
         }
         else
         {
            return const_view<T>(pos + 4 + idx * fracpack_fixed_size<T>());
         }
      }

      inline const char* data() const { return pos + sizeof(uint32_t); }
      inline uint32_t    data_size() const
      {
         return *reinterpret_cast<const unaligned_type<uint32_t>*>(pos);
      }

      bool valid() const { return pos != nullptr; }

      auto* operator->() const { return this; }
      auto& operator*() const { return *this; }

      operator std::vector<T>() const
      {
         input_stream   in(pos, pos + 0xfffffff);  /// TODO: maintain real end
         std::vector<T> tmp;
         fracunpack<std::vector<T>>(tmp, in);
         return tmp;
      }

     private:
      const char* pos;
   };

   template <typename T>
   struct view<T, std::enable_if_t<reflect<T>::is_struct>>
       : public reflect<T>::template proxy<psio::frac_proxy_view>
   {
      using base = typename reflect<T>::template proxy<psio::frac_proxy_view>;
      using base::base;
      view(char* p) : base(p) {}

      friend struct const_view<T>;
      auto* operator->() { return this; }
      auto& operator*() { return *this; }

      operator T() const
      {
         input_stream in(this->psio_get_proxy().buffer,
                         this->psio_get_proxy().buffer + 0xfffffff);  /// TODO: maintain real end
         T            tmp;
         fracunpack<T>(tmp, in);
         return tmp;
      }

      T get() const { return (T)(*this); }
   };

   template <typename T>
   struct const_view<T, std::enable_if_t<reflect<T>::is_struct>>
       : public reflect<T>::template proxy<psio::const_frac_proxy_view>
   {
      using base = typename reflect<T>::template proxy<psio::const_frac_proxy_view>;
      using base::base;
      const_view(view<T> v) : base(v.pos) {}
      const_view(char* p) : base(p) {}

      operator T() const
      {
         input_stream in(this->psio_get_proxy().buffer,
                         this->psio_get_proxy().buffer + 0xfffffff);  /// TODO: maintain real end
         T            tmp;
         fracunpack<T>(tmp, in);
         return tmp;
      }

      T get() const { return (T)(*this); }

      auto* operator->() const { return this; }
      auto& operator*() const { return *this; }
   };

   template <typename... Ts>
   struct view<std::tuple<Ts...>>
   {
      using tuple_type = std::tuple<typename remove_view<Ts>::type...>;
      view(char* p = nullptr) : pos(p) {}

      template <uint8_t I>
      auto get()
      {
         using element_type    = std::tuple_element_t<I, tuple_type>;
         const auto i_offset   = get_offset<I, Ts...>();
         uint16_t   start_heap = 0;
         memcpy(&start_heap, pos, sizeof(start_heap));

         if constexpr (may_use_heap<element_type>())
         {
            if constexpr (is_std_optional<element_type>::value)
            {
               if (i_offset + 4 > start_heap)
                  return view<element_type>(nullptr);
               if (reinterpret_cast<unaligned_type<uint32_t>*>(pos + sizeof(start_heap) + i_offset)
                       ->val < 4)
                  return view<element_type>(nullptr);
            }
            return get_offset<element_type>(pos + sizeof(start_heap) + i_offset);
         }
         else
         {
            return view<element_type>(pos + sizeof(start_heap) + i_offset);
         }
      }

      template <typename Lamda>
      auto call(Lamda&& fun)
      {
         return _call(std::forward<Lamda>(fun), std::make_index_sequence<sizeof...(Ts)>{});
      }

      char* data() { return pos; }
      auto* operator->() { return this; }
      auto& operator*() { return *this; }

     private:
      friend struct const_view<std::tuple<Ts...>>;

      template <typename Function, size_t... I>
      auto _call(Function&& f, std::index_sequence<I...>)
      {
         return f(get<I>()...);
      }

      char* pos;
   };

   template <typename... Ts>
   struct const_view<std::tuple<Ts...>>
   {
      using tuple_type = std::tuple<Ts...>;
      const_view(const char* p = nullptr) : pos(p) {}
      const_view(view<std::tuple<Ts...>> v) : pos(v.pos) {}

      template <uint8_t I>
      auto get() const
      {
         using element_type    = std::tuple_element_t<I, tuple_type>;
         const auto i_offset   = get_offset<I, Ts...>();
         uint16_t   start_heap = 0;
         memcpy(&start_heap, pos, sizeof(start_heap));

         if constexpr (may_use_heap<element_type>())
         {
            if constexpr (is_std_optional<element_type>::value)
            {
               if (i_offset + 4 > start_heap)
                  return view<element_type>(nullptr);
               if (reinterpret_cast<unaligned_type<uint32_t>*>(pos + sizeof(start_heap) + i_offset)
                       ->val < 4)
                  return view<element_type>(nullptr);
            }
            return get_offset<element_type>(pos + sizeof(start_heap) + i_offset);
         }
         else
         {
            return const_view<element_type>(pos + sizeof(start_heap) + i_offset);
         }
      }

      template <typename Lamda>
      auto call(Lamda&& fun) const
      {
         return _call(std::forward<Lamda>(fun), std::make_index_sequence<sizeof...(Ts)>{});
      }

      const char* data() const { return pos; }
      const auto* operator->() const { return this; }
      const auto& operator*() const { return *this; }

     private:
      template <typename Function, size_t... I>
      auto _call(Function&& f, std::index_sequence<I...>) const
      {
         return f(get<I>()...);
      }

      const char* pos;
   };

   template <typename... Ts>
   struct view<std::variant<Ts...>>
   {
      view(char* p = nullptr) : pos(p) {}

      template <typename Visitor>
      void visit(Visitor&& v)
      {
         _visit_variant<Visitor, Ts...>(std::forward<Visitor>(v));
      }

      bool     valid() const { return pos != nullptr; }
      uint8_t  type() const { return *pos; }
      uint32_t size() const { return *reinterpret_cast<unaligned_type<uint32_t>*>(pos + 1); }
      /// the data of the inner object
      char* data() { return pos + 5; }
      auto* operator->() { return this; }
      auto& operator*() { return *this; }

      operator std::variant<Ts...>() const
      {
         input_stream        in(pos, pos + 0xfffffff);  /// TODO: maintain real end
         std::variant<Ts...> tmp;
         fracunpack<std::variant<Ts...>>(tmp, in);
         return tmp;
      }

     private:
      friend struct const_view<std::variant<Ts...>>;
      char* pos;
      template <typename Visitor, typename First, typename... Rest>
      void _visit_variant(Visitor&& v)
      {
         if (sizeof...(Rest) + 1 + *pos == sizeof...(Ts))
         {
            v(view<First>(pos + 1 + 4));
         }
         else if constexpr (sizeof...(Rest) > 0)
         {
            _visit_variant<Visitor, Rest...>(std::forward<Visitor>(v));
         }
      }
   };
   template <typename... Ts>
   struct const_view<std::variant<Ts...>>
   {
      const_view(const char* p = nullptr) : pos(p) {}
      const_view(view<std::variant<Ts...>> v) : pos(v.pos) {}

      template <typename Visitor>
      void visit(Visitor&& v) const
      {
         _visit_variant<Visitor, Ts...>(std::forward<Visitor>(v));
      }

      bool     valid() const { return pos != nullptr; }
      uint8_t  type() const { return *pos; }
      uint32_t size() const { return *reinterpret_cast<const unaligned_type<uint32_t>*>(pos + 1); }
      const char* data() const { return pos + 5; }
      auto*       operator->() const { return this; }
      auto&       operator*() const { return *this; }

      operator std::variant<Ts...>() const
      {
         input_stream        in(pos, pos + 0xfffffff);  /// TODO: maintain real end
         std::variant<Ts...> tmp;
         fracunpack<std::variant<Ts...>>(tmp, in);
         return tmp;
      }

     private:
      const char* pos;
      template <typename Visitor, typename First, typename... Rest>
      void _visit_variant(Visitor&& v) const
      {
         if (sizeof...(Rest) + 1 + *pos == sizeof...(Ts))
         {
            v(const_view<First>(pos + 1 + 4));
         }
         else if constexpr (sizeof...(Rest) > 0)
         {
            _visit_variant<Visitor, Rest...>(std::forward<Visitor>(v));
         }
      }
   };

   template <typename T>
   std::vector<char> convert_to_frac(const T& v)
   {
      std::vector<char> result(fracpack_size(v));
      fast_buf_stream   buf(result.data(), result.size());
      fracpack(v, buf);
      return result;
   }
   template <typename T>
   T convert_from_frac(const std::vector<char>& v)
   {
      T            tmp;
      input_stream buf(v.data(), v.size());
      fracunpack(tmp, buf);
      return tmp;
   }
   template <typename T>
   T convert_from_frac(input_stream buf)
   {
      T tmp;
      fracunpack(tmp, buf);
      return tmp;
   }

   /* used so as not to confuse with other types that might be used to consrtuct shared_view*/
   struct size_tag
   {
      uint32_t size;
   };

   /**
     *  A shared_ptr<char> array containing the data
     *  
     *  uint32_t    size
     *  char[size]  fracpack(T) 
     */
   template <typename T>
   class shared_view_ptr
   {
     public:
      typedef T value_type;

      shared_view_ptr(const T& from)
      {
         uint32_t size = fracpack_size(from);

         _data = std::shared_ptr<char>(new char[size + sizeof(size)], [](char* c) { delete[] c; });
         memcpy(_data.get(), &size, sizeof(size));

         fast_buf_stream out(_data.get() + sizeof(size), size);
         psio::fracpack(from, out);
         //         std::cout <<"\n\n\n consumed "<< out.consumed() << "vs "<<size<<"\n\n\n";
      }

      shared_view_ptr(const char* data, uint32_t size)
      {
         _data = std::shared_ptr<char>(new char[size + sizeof(size)], [](char* c) { delete[] c; });
         memcpy(_data.get(), &size, sizeof(size));
         memcpy(_data.get() + sizeof(size), data, size);
      }

      shared_view_ptr(const shared_view_ptr<std::vector<char>>& p) { _data = p._data; }

      /** allocate the memory so another function can fill it in */
      explicit shared_view_ptr(size_tag s)
      {
         _data =
             std::shared_ptr<char>(new char[s.size + sizeof(s.size)], [](char* c) { delete[] c; });
         memcpy(_data.get(), &s.size, sizeof(s.size));
      }

      shared_view_ptr(){};
      bool operator!() const { return _data == nullptr; }

      const auto operator->() const { return const_view<T>(data()); }
      auto       operator->() { return view<T>(data()); }

      const auto operator*() const { return const_view<T>(data()); }
      auto       operator*() { return view<T>(data()); }

      /** returns the data without a size prefix */
      const char* data() const { return _data.get() + 4; }
      /** returns the data without a size prefix */
      char* data() { return _data.get() + 4; }

      std::span<const char> data_with_size_prefix() const
      {
         return std::string_view(_data.get(), size() + sizeof(uint32_t));
      }

      /** @return the number of bytes of packed data after the size prefix */
      size_t size() const
      {
         if (_data == nullptr)
            return 0;
         uint32_t s;
         memcpy(&s, _data.get(), sizeof(s));
         return s;
      }

      void reset() { _data.reset(); }

      void resize(uint32_t size)
      {
         _data.reset();
         _data = std::shared_ptr<char>(new char[size + sizeof(size)], [](char* c) { delete[] c; });
         memcpy(_data.get(), &size, sizeof(size));
      }

      operator T() const { return unpack(); }

      bool validate(bool& unknown) const
      {
         if (_data)
         {
            auto r  = psio::fracvalidate<T>(data(), data() + size());
            unknown = r.unknown;
            return r.valid;
         }
         return false;
      }
      bool validate() const
      {
         if (_data)
         {
            return psio::fracvalidate<T>(data(), data() + size()).valid;
         }
         return false;
      }
      bool validate_all_known() const
      {
         if (_data)
         {
            return psio::fracvalidate<T>(data(), data() + size()).valid_and_known();
         }
         return false;
      }

      T unpack() const
      {
         T            tmp{};
         input_stream in(_data.get() + sizeof(uint32_t), size());
         psio::fracunpack(tmp, in);
         return tmp;
      }

     private:
      std::shared_ptr<char> _data;
   };
   template <>
   class shared_view_ptr<void>
   {
   };

   template <typename T, typename S>
   void to_json(const shared_view_ptr<T>& obj, S& stream)
   {
      to_json(obj.unpack(), stream);
   }

   template <typename T, typename S>
   void from_json(shared_view_ptr<T>& obj, S& stream)
   {
      if (stream.peek_token().get().type == json_token_type::type_string)
      {
         // TODO: avoid copy
         std::vector<char> v;
         from_json(v, stream);
         obj = {v.data(), v.size()};
      }
      else
      {
         T inner;
         from_json(inner, stream);
         obj = inner;
      }
   }

   template <typename T, typename R, typename... Args>
   constexpr auto tuple_from_function_args(R (T::*func)(Args...))
       -> std::tuple<std::decay_t<Args>...>;

   template <typename T, typename R, typename... Args>
   constexpr auto tuple_from_function_args(R (T::*func)(Args...) const)
       -> std::tuple<std::decay_t<Args>...>;

   template <typename... Args>
   constexpr auto tuple_remove_view(std::tuple<Args...>) -> std::tuple<remove_view_t<Args>...>;

   /// TODO: remove is_fixed_structure and is_ext_structure they are not being used properly
   ///       and are likely poorly defined

   template <typename T>
   std::vector<char> to_frac(const T& v)
   {
      std::vector<char> result(fracpack_size(v));
      fast_buf_stream   s(result.data(), result.size());
      fracpack(v, s);
      return result;
   }

   template <typename T>
   T from_frac(const std::vector<char>& b)
   {
      if (fracvalidate<T>(b.data(), b.data() + b.size()).valid)
         return convert_from_frac<T>(b);
      abort_error(stream_error::invalid_frac_encoding);
   }

   template <typename T>
   auto make_view(const char* data, size_t size)
   {
      if (fracvalidate<T>(data, size).valid_and_known())
         return const_view<T>(data);
      return const_view<T>();
   }

}  // namespace psio
