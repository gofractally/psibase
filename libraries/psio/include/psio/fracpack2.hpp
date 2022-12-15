#pragma once

#include <psio/reflect.hpp>

namespace psio
{
   // If a type T supports the expressions `clio_unwrap_packable(T&)`,
   // which returns a `T2&`, and `clio_unwrap_packable(const T&)`, which
   // returns `const T2&`, then packing or unpacking T packs or unpacks
   // the returned reference instead.
   template <typename T>
   concept PackableWrapper = requires(T& x, const T& cx)
   {
      clio_unwrap_packable(x);
      clio_unwrap_packable(cx);
   };

   template <typename T, bool Reflected>
   struct is_packable_reflected;

   template <typename T>
   struct is_packable_reflected<T, false> : std::bool_constant<false>
   {
   };

   template <typename T>
   struct is_packable_reflected<T, true>;

   template <typename T>
   struct is_packable : is_packable_reflected<T, ReflectedAsMember<T>>
   {
   };

   template <typename T>
   concept Packable = is_packable<T>::value;

   template <typename T>
   concept PackableNumeric =            //
       std::is_same_v<T, std::byte> ||  //
       std::is_same_v<T, uint8_t> ||    //
       std::is_same_v<T, uint16_t> ||   //
       std::is_same_v<T, uint32_t> ||   //
       std::is_same_v<T, uint64_t> ||   //
       std::is_same_v<T, int8_t> ||     //
       std::is_same_v<T, int16_t> ||    //
       std::is_same_v<T, int32_t> ||    //
       std::is_same_v<T, int64_t> ||    //
       std::is_same_v<T, float> ||      //
       std::is_same_v<T, double>;

   template <bool Unpack, bool Verify, PackableNumeric T>
   [[nodiscard]] bool unpack_numeric(T*          value,
                                     bool&       has_unknown,
                                     const char* src,
                                     uint32_t&   pos,
                                     uint32_t    end_pos);

   template <typename T>
   struct is_packable_memcpy : std::bool_constant<false>
   {
   };

   template <typename T>
   concept PackableMemcpy = is_packable_memcpy<T>::value;

   template <PackableNumeric T>
   struct is_packable_memcpy<T> : std::bool_constant<true>
   {
   };

   template <PackableMemcpy T, int N>
   struct is_packable_memcpy<std::array<T, N>> : std::bool_constant<true>
   {
      static_assert(sizeof(std::array<T, N>) == N * sizeof(T));
   };

   template <>
   struct is_packable<std::string>;

   template <>
   struct is_packable<std::string_view>;

   template <PackableMemcpy T>
   struct is_packable<std::span<T>>;

   template <Packable T>
   struct is_packable<std::vector<T>>;

   template <Packable T, int N>
   requires(!is_packable_memcpy<T>::value) struct is_packable<std::array<T, N>>;

   template <Packable T>
   struct is_packable<std::optional<T>>;

   template <Packable... Ts>
   struct is_packable<std::tuple<Ts...>>;

   template <Packable... Ts>
   struct is_packable<std::variant<Ts...>>;

   // Default implementations for is_packable<T>
   template <typename T, typename Derived>
   struct base_packable_impl : std::bool_constant<true>
   {
      // // Pack object into a single contiguous region
      // template <typename S>
      // static void pack(const T& value, S& stream);

      // True if T is a variable-sized container and it is empty
      static bool is_empty_container(const T& value) { return false; }

      // Pack either:
      // * Object content if T is fixed size
      // * Space for offset if T is variable size. Must be 0 if is_empty_container().
      template <typename S>
      static void embedded_fixed_pack(const T& value, S& stream)
      {
         if constexpr (Derived::is_variable_size)
            stream.write_raw(uint32_t(0));
         else
            Derived::pack(value, stream);
      }

      // Repack offset if T is variable size
      template <typename S>
      static void embedded_fixed_repack(const T& value,
                                        uint32_t fixed_pos,
                                        uint32_t heap_pos,
                                        S&       stream)
      {
         if (Derived::is_variable_size && !Derived::is_empty_container(value))
            stream.rewrite_raw(fixed_pos, heap_pos - fixed_pos);
      }

      // Pack object content it T is variable size
      template <typename S>
      static void embedded_variable_pack(const T& value, S& stream)
      {
         if (Derived::is_variable_size && !Derived::is_empty_container(value))
            Derived::pack(value, stream);
      }

      // // Unpack and/or Verify object in a single contiguous region
      // template <bool Unpack, bool Verify>
      // [[nodiscard]] static bool unpack(T*          value,
      //                                  bool&       has_unknown,
      //                                  const char* src,
      //                                  uint32_t&   pos,
      //                                  uint32_t    end_pos);

      // Unpack and/or Verify object which is pointed to by an offset
      template <bool Unpack, bool Verify>
      [[nodiscard]] static bool embedded_variable_unpack(T*          value,
                                                         bool&       has_unknown,
                                                         const char* src,
                                                         uint32_t&   fixed_pos,
                                                         uint32_t    end_fixed_pos,
                                                         uint32_t&   heap_pos,
                                                         uint32_t    end_heap_pos)
      {
         uint32_t orig_pos = fixed_pos;
         uint32_t offset;
         if (!unpack_numeric<true, Verify>(&offset, has_unknown, src, fixed_pos, end_fixed_pos))
            return false;
         if constexpr (Derived::supports_0_offset)
         {
            if (offset == 0)
            {
               if constexpr (Unpack)
                  value->clear();
               return true;
            }
         }
         uint32_t new_heap_pos = orig_pos + offset;
         if constexpr (Verify)
         {
            if (offset < 4 || new_heap_pos < heap_pos || new_heap_pos > end_heap_pos)
               return false;
            if (new_heap_pos != heap_pos && !has_unknown)
               return false;
         }
         heap_pos = new_heap_pos;
         Derived::unpack<Unpack, Verify>(value, has_unknown, src, heap_pos, end_heap_pos);
      }

      // Unpack and/or verify either:
      // * Object at fixed_pos if T is fixed size
      // * Object at offset if T is variable size
      template <bool Unpack, bool Verify>
      [[nodiscard]] static bool embedded_unpack(T*          value,
                                                bool&       has_unknown,
                                                const char* src,
                                                uint32_t&   fixed_pos,
                                                uint32_t    end_fixed_pos,
                                                uint32_t&   heap_pos,
                                                uint32_t    end_heap_pos)
      {
         if constexpr (Derived::is_variable_size)
            return Derived::embedded_variable_unpack<Unpack, Verify>(
                value, has_unknown, src, fixed_pos, end_fixed_pos, heap_pos, end_heap_pos);
         else
            return Derived::unpack<Unpack, Verify>(value, has_unknown, src, fixed_pos,
                                                   end_fixed_pos);
      }
   };  // base_packable_impl

   template <PackableMemcpy T>
   struct is_packable<T> : base_packable_impl<T, is_packable<T>>
   {
      static constexpr uint32_t fixed_size        = sizeof(T);
      static constexpr bool     is_variable_size  = false;
      static constexpr bool     is_optional       = false;
      static constexpr bool     supports_0_offset = false;

      template <typename S>
      static void pack(const T& value, S& stream)
      {
         stream.write_raw(value);
      }

      template <bool Unpack, bool Verify>
      [[nodiscard]] static bool unpack(T*          value,
                                       bool&       has_unknown,
                                       const char* src,
                                       uint32_t&   pos,
                                       uint32_t    end_pos)
      {
         if constexpr (Verify)
            if (end_pos - pos < sizeof(T))
               return false;
         if constexpr (Unpack)
            memcpy(value, src + pos, sizeof(T));
         pos += sizeof(T);
         return true;
      }
   };  // is_packable<PackableMemcpy>

   template <bool Unpack, bool Verify, PackableNumeric T>
   [[nodiscard]] bool unpack_numeric(T*          value,
                                     bool&       has_unknown,
                                     const char* src,
                                     uint32_t&   pos,
                                     uint32_t    end_pos)
   {
      return is_packable<T>::unpack<Unpack, Verify>(value, has_unknown, src, pos, end_pos);
   }

   template <>
   struct is_packable<bool> : base_packable_impl<bool, is_packable<bool>>
   {
      static constexpr uint32_t fixed_size        = 1;
      static constexpr bool     is_variable_size  = false;
      static constexpr bool     is_optional       = false;
      static constexpr bool     supports_0_offset = false;

      template <typename S>
      static void pack(const bool& value, S& stream)
      {
         stream.write_raw(value);
      }

      template <bool Unpack, bool Verify>
      [[nodiscard]] static bool unpack(bool*       value,
                                       bool&       has_unknown,
                                       const char* src,
                                       uint32_t&   pos,
                                       uint32_t    end_pos)
      {
         if constexpr (Verify)
            if (end_pos - pos < 1 || src[pos] > 1)
               return false;
         if constexpr (Unpack)
            *value = src[pos] != 0;
         pos += 1;
         return true;
      }
   };  // is_packable<bool>

   template <PackableWrapper T>
   struct is_packable<T> : std::bool_constant<true>
   {
      using inner = std::remove_cvref_t<decltype(clio_unwrap_packable(std::declval<T&>()))>;
      using is_p  = is_packable<inner>;

      static constexpr uint32_t fixed_size        = is_p::fixed_size;
      static constexpr bool     is_variable_size  = is_p::is_variable_size;
      static constexpr bool     is_optional       = is_p::is_optional;
      static constexpr bool     supports_0_offset = is_p::supports_0_offset;

      template <bool Unpack>
      inner* ptr(T* value)
      {
         if constexpr (Unpack)
            return &clio_unwrap_packable(*value);
         else
            return nullptr;
      }

      template <typename S>
      static void pack(const T& value, S& stream)
      {
         return is_p::pack(clio_unwrap_packable(value), stream);
      }

      static bool is_empty_container(const T& value)
      {
         return is_p::is_empty_container(clio_unwrap_packable(value));
      }

      template <typename S>
      static void embedded_fixed_pack(const T& value, S& stream)
      {
         return is_p::embedded_fixed_pack(clio_unwrap_packable(value), stream);
      }

      template <typename S>
      static void embedded_fixed_repack(const T& value,
                                        uint32_t fixed_pos,
                                        uint32_t heap_pos,
                                        S&       stream)
      {
         return is_p::embedded_fixed_repack(clio_unwrap_packable(value), fixed_pos, heap_pos,
                                            stream);
      }

      template <typename S>
      static void embedded_variable_pack(const T& value, S& stream)
      {
         return is_p::embedded_variable_pack(clio_unwrap_packable(value), stream);
      }

      template <bool Unpack, bool Verify>
      [[nodiscard]] static bool unpack(T*          value,
                                       bool&       has_unknown,
                                       const char* src,
                                       uint32_t&   pos,
                                       uint32_t    end_pos)
      {
         return is_p::unpack<Unpack, Verify>(ptr<Unpack>(value), has_unknown, src, pos, end_pos);
      }

      template <bool Unpack, bool Verify>
      [[nodiscard]] static bool embedded_variable_unpack(T*          value,
                                                         bool&       has_unknown,
                                                         const char* src,
                                                         uint32_t&   fixed_pos,
                                                         uint32_t    end_fixed_pos,
                                                         uint32_t&   heap_pos,
                                                         uint32_t    end_heap_pos)
      {
         return is_p::embedded_variable_unpack<Unpack, Verify>(ptr<Unpack>(value), has_unknown, src,
                                                               fixed_pos, end_fixed_pos, heap_pos,
                                                               end_heap_pos);
      }

      template <bool Unpack, bool Verify>
      [[nodiscard]] static bool embedded_unpack(T*          value,
                                                bool&       has_unknown,
                                                const char* src,
                                                uint32_t&   fixed_pos,
                                                uint32_t    end_fixed_pos,
                                                uint32_t&   heap_pos,
                                                uint32_t    end_heap_pos)
      {
         return is_p::embedded_unpack<Unpack, Verify>(ptr<Unpack>(value), has_unknown, src,
                                                      fixed_pos, end_fixed_pos, heap_pos,
                                                      end_heap_pos);
      }
   };  // is_packable<PackableWrapper>

   template <typename T, typename Derived>
   struct packable_container_memcpy_impl : base_packable_impl<T, Derived>
   {
      static constexpr uint32_t fixed_size        = 4;
      static constexpr bool     is_variable_size  = true;
      static constexpr bool     is_optional       = false;
      static constexpr bool     supports_0_offset = true;

      template <typename S>
      static void pack(const T& value, S& stream)
      {
         is_packable<uint32_t>::pack(value.size(), stream);
         stream.write(value.data(), value.size() * sizeof(T::value_type));
      }

      static bool is_empty_container(const T& value) { return value.empty(); }

      template <bool Unpack, bool Verify>
      [[nodiscard]] static bool unpack(T*          value,
                                       bool&       has_unknown,
                                       const char* src,
                                       uint32_t&   pos,
                                       uint32_t    end_pos)
      {
         uint32_t fixed_size;
         if (!unpack_numeric<true, Verify>(&fixed_size, has_unknown, src, pos, end_pos))
            return false;
         uint32_t size    = fixed_size / sizeof(T::value_type);
         uint32_t new_pos = pos + fixed_size;
         if constexpr (Verify)
         {
            if ((fixed_size % sizeof(T::value_type)) || new_pos < pos || new_pos > end_pos)
               return false;
         }
         if constexpr (Unpack)
         {
            value->resize(size);
            if (size)
               memcpy(value->data(), src + pos, fixed_size);
         }
         pos = new_pos;
         return true;
      }
   };  // packable_container_memcpy_impl

   template <>
   struct is_packable<std::string>
       : packable_container_memcpy_impl<std::string, is_packable<std::string>>
   {
   };

   template <>
   struct is_packable<std::string_view>
       : packable_container_memcpy_impl<std::string_view, is_packable<std::string_view>>
   {
   };

   template <PackableMemcpy T>
   struct is_packable<std::span<T>>
       : packable_container_memcpy_impl<std::span<T>, is_packable<std::span<T>>>
   {
   };

   template <Packable T>
   requires(is_packable_memcpy<T>::value) struct is_packable<std::vector<T>>
       : packable_container_memcpy_impl<std::vector<T>, is_packable<std::vector<T>>>
   {
   };

   template <Packable T>
   requires(!is_packable_memcpy<T>::value) struct is_packable<std::vector<T>>
       : base_packable_impl<std::vector<T>, is_packable<std::vector<T>>>
   {
      static constexpr uint32_t fixed_size        = 4;
      static constexpr bool     is_variable_size  = true;
      static constexpr bool     is_optional       = false;
      static constexpr bool     supports_0_offset = true;

      template <typename S>
      static void pack(const std::vector<T>& value, S& stream)
      {
         uint32_t num_bytes = value.size() * is_packable<T>::fixed_size;
         assert(num_bytes == value.size() * is_packable<T>::fixed_size);
         is_packable<uint32_t>::pack(num_bytes, stream);
         stream.about_to_write(num_bytes);
         uint32_t fixed_pos = stream.written();
         for (const auto& x : value)
            is_packable<T>::embedded_fixed_pack(x, stream);
         for (const auto& x : value)
         {
            is_packable<T>::embedded_fixed_repack(x, fixed_pos, stream.written(), stream);
            is_packable<T>::embedded_variable_pack(x, stream);
            fixed_pos += is_packable<T>::fixed_size;
         }
      }

      static bool is_empty_container(const std::vector<T>& value) { return value.empty(); }

      template <bool Unpack, bool Verify>
      [[nodiscard]] static bool unpack(std::vector<T>* value,
                                       bool&           has_unknown,
                                       const char*     src,
                                       uint32_t&       pos,
                                       uint32_t        end_pos)
      {
         uint32_t fixed_size;
         if (!unpack_numeric<true, Verify>(&fixed_size, has_unknown, src, pos, end_pos))
            return false;
         uint32_t size          = fixed_size / is_packable<T>::fixed_size;
         uint32_t fixed_pos     = pos;
         uint32_t heap_pos      = pos + fixed_size;
         uint32_t end_fixed_pos = heap_pos;
         if constexpr (Verify)
         {
            if ((fixed_size % is_packable<T>::fixed_size) || heap_pos < pos || heap_pos > end_pos)
               return false;
         }
         if constexpr (Unpack)
         {
            value->resize(size);
            for (const auto& x : *value)
               if (!is_packable<T>::embedded_unpack<Unpack, Verify>(
                       &x, has_unknown, src, fixed_pos, end_fixed_pos, heap_pos, end_pos))
                  return false;
         }
         else
         {
            for (uint32_t i = 0; i < size; ++i)
               if (!is_packable<T>::embedded_unpack<Unpack, Verify>(
                       nullptr, has_unknown, src, fixed_pos, end_fixed_pos, heap_pos, end_pos))
                  return false;
         }
         pos = heap_pos;
         return true;
      }  // unpack
   };    // is_packable<std::vector<T>> (!memcpy)

   template <Packable T, int N>
   requires(!is_packable_memcpy<T>::value) struct is_packable<std::array<T, N>>
       : base_packable_impl<std::array<T, N>, is_packable<std::array<T, N>>>
   {
      static constexpr uint32_t fixed_size =
          is_packable<T>::is_variable_size ? 4 : is_packable<T>::fixed_size * N;
      static constexpr bool is_variable_size  = is_packable<T>::is_variable_size;
      static constexpr bool is_optional       = true;
      static constexpr bool supports_0_offset = false;

      template <typename S>
      static void pack(const T& value, S& stream)
      {
         stream.about_to_write(is_packable<T>::fixed_size * N);
         uint32_t fixed_pos = stream.written();
         for (const auto& x : value)
            is_packable<T>::embedded_fixed_pack(x, stream);
         for (const auto& x : value)
         {
            is_packable<T>::embedded_fixed_repack(x, fixed_pos, stream.written(), stream);
            is_packable<T>::embedded_variable_pack(x, stream);
            fixed_pos += is_packable<T>::fixed_size;
         }
      }

      template <bool Unpack, bool Verify>
      [[nodiscard]] static bool unpack(T*          value,
                                       bool&       has_unknown,
                                       const char* src,
                                       uint32_t&   pos,
                                       uint32_t    end_pos)
      {
         uint32_t fixed_pos     = pos;
         uint32_t heap_pos      = pos + is_packable<T>::fixed_size * N;
         uint32_t end_fixed_pos = heap_pos;
         if constexpr (Verify)
         {
            if (heap_pos < pos || heap_pos > end_pos)
               return false;
         }
         if constexpr (Unpack)
         {
            for (const auto& x : *value)
               if (!is_packable<T>::embedded_unpack<Unpack, Verify>(
                       &x, has_unknown, src, fixed_pos, end_fixed_pos, heap_pos, end_pos))
                  return false;
         }
         else
         {
            for (uint32_t i = 0; i < N; ++i)
               if (!is_packable<T>::embedded_unpack<Unpack, Verify>(
                       nullptr, has_unknown, src, fixed_pos, end_fixed_pos, heap_pos, end_pos))
                  return false;
         }
         pos = heap_pos;
         return true;
      }
   };

   template <Packable T>
   struct is_packable<std::optional<T>>
       : base_packable_impl<std::optional<T>, is_packable<std::optional<T>>>
   {
      static constexpr uint32_t fixed_size        = 4;
      static constexpr bool     is_variable_size  = true;
      static constexpr bool     is_optional       = true;
      static constexpr bool     supports_0_offset = false;

      template <typename S>
      static void pack(const std::optional<T>& value, S& stream)
      {
         uint32_t fixed_pos = stream.written();
         embedded_fixed_pack(value, stream);
         uint32_t heap_pos = stream.written();
         embedded_fixed_repack(value, fixed_pos, heap_pos, stream);
         embedded_variable_pack(value, stream);
      }

      template <typename S>
      static void embedded_fixed_pack(const std::optional<T>& value, S& stream)
      {
         if (!is_packable<T>::is_optional && is_packable<T>::is_variable_size && value.has_value())
            is_packable<T>::embedded_fixed_pack(*value, stream);
         else
            stream.write_raw(uint32_t(1));
      }

      template <typename S>
      static void embedded_fixed_repack(const std::optional<T>& value,
                                        uint32_t                fixed_pos,
                                        uint32_t                heap_pos,
                                        S&                      stream)
      {
         if (value.has_value())
         {
            if (!is_packable<T>::is_optional && is_packable<T>::is_variable_size)
               is_packable<T>::embedded_fixed_repack(*value, fixed_pos, heap_pos, stream);
            else
               stream.rewrite_raw(fixed_pos, heap_pos - fixed_pos);
         }
      }

      template <typename S>
      static void embedded_variable_pack(const std::optional<T>& value, S& stream)
      {
         if (value.has_value() && !is_packable<T>::is_empty_container(*value))
            is_packable<T>::pack(*value, stream);
      }

      template <bool Unpack, bool Verify>
      [[nodiscard]] static bool unpack(std::optional<T>* value,
                                       bool&             has_unknown,
                                       const char*       src,
                                       uint32_t&         pos,
                                       uint32_t          end_pos)
      {
         uint32_t fixed_pos = pos;
         pos += 4;
         uint32_t end_fixed_pos = pos;
         return embedded_unpack<Unpack, Verify>(value, has_unknown, src, fixed_pos, end_fixed_pos,
                                                pos, end_pos);
      }

      template <bool Unpack, bool Verify>
      [[nodiscard]] static bool embedded_unpack(std::optional<T>* value,
                                                bool&             has_unknown,
                                                const char*       src,
                                                uint32_t&         fixed_pos,
                                                uint32_t          end_fixed_pos,
                                                uint32_t&         heap_pos,
                                                uint32_t          end_heap_pos)
      {
         uint32_t orig_pos = fixed_pos;
         uint32_t offset;
         if (!unpack_numeric<true, Verify>(&offset, has_unknown, src, fixed_pos, end_fixed_pos))
            return false;
         if (offset == 1)
         {
            *value = std::nullopt;
            return true;
         }
         fixed_pos = orig_pos;
         value->emplace();
         return is_packable<T>::embedded_variable_unpack<Unpack, Verify>(
             &**value, has_unknown, src, fixed_pos, end_fixed_pos, heap_pos, end_heap_pos);
      }
   };  // is_packable<std::optional<T>>

   template <Packable... Ts>
   struct is_packable<std::tuple<Ts...>>
       : base_packable_impl<std::tuple<Ts...>, is_packable<std::tuple<Ts...>>>
   {
      static constexpr uint32_t fixed_size        = 4;
      static constexpr bool     is_variable_size  = true;
      static constexpr bool     is_optional       = false;
      static constexpr bool     supports_0_offset = false;

      template <typename S>
      static void pack(const std::tuple<Ts...>& value, S& stream)
      {
         int num_present = 0;
         int i           = 0;
         tuple_foreach(  //
             value,
             [&](const auto& x)
             {
                using is_p = is_packable<std::remove_cvref_t<decltype(x)>>;
                ++i;
                if constexpr (is_p::is_optional)
                {
                   if (x.has_value())
                      num_present = i;
                }
                else
                {
                   num_present = i;
                }
             });
         uint16_t fixed_size = 0;
         i                   = 0;
         tuple_foreach(  //
             value,
             [&](const auto& x)
             {
                using is_p = is_packable<std::remove_cvref_t<decltype(x)>>;
                if (i < num_present)
                   fixed_size += is_p::fixed_size;
                ++i;
             });
         is_packable<uint16_t>::pack(fixed_size, stream);
         uint32_t fixed_pos = stream.written();
         i                  = 0;
         tuple_foreach(  //
             value,
             [&](const auto& x)
             {
                using is_p = is_packable<std::remove_cvref_t<decltype(x)>>;
                if (i < num_present)
                   is_p::embedded_fixed_pack(x, stream);
                ++i;
             });
         i = 0;
         tuple_foreach(  //
             value,
             [&](const auto& x)
             {
                using is_p = is_packable<std::remove_cvref_t<decltype(x)>>;
                if (i < num_present)
                {
                   is_p::embedded_fixed_repack(x, fixed_pos, stream.written(), stream);
                   is_p::embedded_variable_pack(x, stream);
                   fixed_pos += is_p::fixed_size;
                }
                ++i;
             });
      }  // pack

      template <bool Unpack, bool Verify>
      [[nodiscard]] static bool unpack(std::tuple<Ts...>* value,
                                       bool&              has_unknown,
                                       const char*        src,
                                       uint32_t&          pos,
                                       uint32_t           end_pos)
      {
         uint16_t fixed_size;
         if (!unpack_numeric<true, Verify>(&fixed_size, has_unknown, src, pos, end_pos))
            return false;
         uint32_t fixed_pos     = pos;
         uint32_t heap_pos      = pos + fixed_size;
         uint32_t end_fixed_pos = heap_pos;
         if constexpr (Verify)
         {
            if (heap_pos < pos || heap_pos > end_pos)
               return false;
         }
         bool ok = true;
         if constexpr (Unpack)
         {
            tuple_foreach(  //
                *value,
                [&](const auto& x)
                {
                   using is_p = is_packable<std::remove_cvref_t<decltype(x)>>;
                   if (fixed_pos < end_fixed_pos || !is_p::is_optional)
                      ok &= is_p::embedded_unpack<Unpack, Verify>(x, has_unknown, src, fixed_pos,
                                                                  end_fixed_pos, heap_pos, end_pos);
                });
         }
         else
         {
            tuple_foreach_type(  //
                (std::tuple<Ts...>*)nullptr,
                [&](auto* p)
                {
                   using is_p = is_packable<std::remove_cvref_t<decltype(*p)>>;
                   if (fixed_pos < end_fixed_pos || !is_p::is_optional)
                      ok &= is_p::embedded_unpack<Unpack, Verify>(
                          nullptr, has_unknown, src, fixed_pos, end_fixed_pos, heap_pos, end_pos);
                });
         }
         if (!ok)
            return false;
         if constexpr (Verify)
         {
            if (fixed_pos < end_fixed_pos)
               has_unknown = true;
         }
         pos = heap_pos;
      }  // unpack
   };    // is_packable<std::tuple<Ts...>>

   template <bool Unpack, bool Verify, size_t I, typename... Ts>
   [[nodiscard]] bool unpack_variant_impl(size_t               tag,
                                          std::variant<Ts...>* value,
                                          bool&                has_unknown,
                                          const char*          src,
                                          uint32_t&            pos,
                                          uint32_t             end_pos)
   {
      if constexpr (I < sizeof...(Ts))
      {
         using is_p = is_packable<std::variant_alternative_t<I, std::variant<Ts...>>>;
         if (tag == I)
         {
            if constexpr (Unpack)
            {
               value->template emplace<I>();
               return is_p::unpack(&std::get<I>(*value), has_unknown, src, pos, end_pos);
            }
            else
            {
               return is_p::unpack(nullptr, has_unknown, src, pos, end_pos);
            }
         }
         else
         {
            return unpack_variant_impl<Unpack, Verify, I + 1>(tag, value, has_unknown, src, pos,
                                                              end_pos);
         }
      }
      else
      {
         if constexpr (Unpack)
            return false;
         if constexpr (Verify)
            has_unknown = true;
         return true;
      }
   }

   template <Packable... Ts>
   struct is_packable<std::variant<Ts...>>
       : base_packable_impl<std::variant<Ts...>, is_packable<std::variant<Ts...>>>
   {
      static_assert(sizeof...(Ts) < 128);

      static constexpr uint32_t fixed_size        = 4;
      static constexpr bool     is_variable_size  = true;
      static constexpr bool     is_optional       = false;
      static constexpr bool     supports_0_offset = false;

      template <typename S>
      static void pack(const std::variant<Ts...>& value, S& stream)
      {
         is_packable<uint8_t>::pack(value.index(), stream);
         uint32_t size_pos = stream.written();
         is_packable<uint32_t>::pack(0, stream);
         uint32_t content_pos = stream.written();
         std::visit([&](const auto& x)
                    { is_packable<std::remove_cvref_t<decltype(x)>>::pack(x, stream); },
                    value);
         stream.rewrite_raw(size_pos, stream.written() - content_pos);
      }

      template <bool Unpack, bool Verify>
      [[nodiscard]] static bool unpack(std::variant<Ts...>* value,
                                       bool&                has_unknown,
                                       const char*          src,
                                       uint32_t&            pos,
                                       uint32_t             end_pos)
      {
         uint8_t tag;
         if (!unpack_numeric<true, Verify>(&tag, has_unknown, src, pos, end_pos))
            return false;
         if constexpr (Verify)
            if (tag & 0x80)
               return false;
         uint32_t size;
         if (!unpack_numeric<true, Verify>(&size, has_unknown, src, pos, end_pos))
            return false;
         uint32_t content_pos = pos;
         uint32_t content_end = pos + size;
         if constexpr (Verify)
            if (content_end < content_pos || content_end > end_pos)
               return false;
         bool inner_unknown = false;
         if (!unpack_variant_impl<Unpack, Verify, 0>(tag, value, inner_unknown, src, content_pos,
                                                     content_end))
            return false;
         if constexpr (Verify)
         {
            if (inner_unknown)
               has_unknown = true;
            else if (content_pos != content_end)
               return false;
         }
         pos = content_end;
         return true;
      }
   };  // is_packable<std::variant<Ts...>>

   template <typename T>
   struct is_packable_reflected<T, true> : base_packable_impl<T, is_packable<T>>
   {
      static constexpr uint32_t get_fixed_size()
      {
         if (is_variable_size)
            return 4;
         uint32_t size = 0;
         reflect<T>::for_each(
             [&](const meta& ref, auto member)
             {
                using m = MemberPtrType<decltype(member(std::declval<T*>()))>;
                if constexpr (!m::isFunction)
                   size += is_packable<typename m::ValueType>::fixed_size;
             });
         return size;
      }

      static constexpr bool get_is_var_size()
      {
         if (!reflect<T>::definitionWillNotChange)
            return true;
         bool is_var = false;
         reflect<T>::for_each(
             [&](const meta& ref, auto member)
             {
                using m = MemberPtrType<decltype(member(std::declval<T*>()))>;
                if constexpr (!m::isFunction)
                   is_var |= is_packable<typename m::ValueType>::is_variable_size;
             });
         return is_var;
      }

      static constexpr uint32_t fixed_size        = get_fixed_size();
      static constexpr bool     is_variable_size  = get_is_var_size();
      static constexpr bool     is_optional       = false;
      static constexpr bool     supports_0_offset = false;

      template <typename S>
      static void pack(const T& value, S& stream)
      {
         if constexpr (is_variable_size)
         {
            int num_present = 0;
            int i           = 0;
            reflect<T>::for_each(
                [&](const meta& ref, auto member)
                {
                   using m = MemberPtrType<decltype(member(std::declval<T*>()))>;
                   if constexpr (!m::isFunction)
                   {
                      ++i;
                      if constexpr (is_packable<typename m::ValueType>::is_optional)
                      {
                         if ((value->*member(&value)).has_value())
                            num_present = i;
                      }
                      else
                      {
                         num_present = i;
                      }
                   }
                });
            uint16_t fixed_size = 0;
            i                   = 0;
            reflect<T>::for_each(
                [&](const meta& ref, auto member)
                {
                   using m = MemberPtrType<decltype(member(std::declval<T*>()))>;
                   if constexpr (!m::isFunction)
                   {
                      if (i < num_present)
                         fixed_size += is_packable<typename m::ValueType>::fixed_size;
                      ++i;
                   }
                });
            is_packable<uint16_t>::pack(fixed_size, stream);
            uint32_t fixed_pos = stream.written();
            i                  = 0;
            reflect<T>::for_each(
                [&](const meta& ref, auto member)
                {
                   using m = MemberPtrType<decltype(member(std::declval<T*>()))>;
                   if constexpr (!m::isFunction)
                   {
                      if (i < num_present)
                         is_packable<typename m::ValueType>::embedded_fixed_pack(
                             value->*member(&value), stream);
                      ++i;
                   }
                });
            i = 0;
            reflect<T>::for_each(
                [&](const meta& ref, auto member)
                {
                   using m = MemberPtrType<decltype(member(std::declval<T*>()))>;
                   if constexpr (!m::isFunction)
                   {
                      if (i < num_present)
                      {
                         using is_p = is_packable<typename m::ValueType>;
                         is_p::embedded_fixed_repack(value->*member(&value), fixed_pos,
                                                     stream.written(), stream);
                         is_p::embedded_variable_pack(value->*member(&value), stream);
                         fixed_pos += is_p::fixed_size;
                      }
                      ++i;
                   }
                });
         }  // is_variable_size
         else
         {
            reflect<T>::for_each(
                [&](const meta& ref, auto member)
                {
                   using m = MemberPtrType<decltype(member(std::declval<T*>()))>;
                   if constexpr (!m::isFunction)
                      is_packable<typename m::ValueType>::pack(value->*member(&value), stream);
                });
         }
      }  // pack

      template <bool Unpack, bool Verify>
      [[nodiscard]] static bool unpack(T*          value,
                                       bool&       has_unknown,
                                       const char* src,
                                       uint32_t&   pos,
                                       uint32_t    end_pos)
      {
         if constexpr (is_variable_size)
         {
            uint16_t fixed_size;
            if (!unpack_numeric<true, Verify>(&fixed_size, has_unknown, src, pos, end_pos))
               return false;
            uint32_t fixed_pos     = pos;
            uint32_t heap_pos      = pos + fixed_size;
            uint32_t end_fixed_pos = heap_pos;
            if constexpr (Verify)
            {
               if (heap_pos < pos || heap_pos > end_pos)
                  return false;
            }
            bool ok = true;
            reflect<T>::for_each(
                [&](const meta& ref, auto member)
                {
                   using m = MemberPtrType<decltype(member(std::declval<T*>()))>;
                   if constexpr (!m::isFunction)
                   {
                      using is_p = is_packable<typename m::ValueType>;
                      if (fixed_pos < end_fixed_pos || !is_p::is_optional)
                      {
                         if constexpr (Unpack)
                            ok &=
                                is_p::embedded_unpack(&value->*member(&value), has_unknown, src,
                                                      fixed_pos, end_fixed_pos, heap_pos, end_pos);
                         else
                            ok &= is_p::embedded_unpack(nullptr, has_unknown, src, fixed_pos,
                                                        end_fixed_pos, heap_pos, end_pos);
                      }
                   }
                });
            if (!ok)
               return false;
            if constexpr (Verify)
            {
               if (fixed_pos < end_fixed_pos)
                  has_unknown = true;
            }
            pos = heap_pos;
         }  // is_variable_size
         else
         {
            bool ok = true;
            reflect<T>::for_each(
                [&](const meta& ref, auto member)
                {
                   using m    = MemberPtrType<decltype(member(std::declval<T*>()))>;
                   using is_p = is_packable<typename m::ValueType>;
                   if constexpr (!m::isFunction)
                   {
                      if constexpr (Unpack)
                         ok &= is_p::unpack<Unpack, Verify>(&(value->*member(&value)), has_unknown,
                                                            src, pos, end_pos);
                      else
                         ok &=
                             is_p::unpack<Unpack, Verify>(nullptr, has_unknown, src, pos, end_pos);
                   }
                });
            return ok;
         }
      }  // unpack
   };    // is_packable_reflected

}  // namespace psio
