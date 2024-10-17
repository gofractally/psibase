#pragma once

#include <psio/fracpack.hpp>

#include <type_traits>

namespace psio
{
   template <typename T>
      requires Packable<std::remove_cv_t<T>>
   class view;

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
   using remove_view_t = typename remove_view<T>::type;

   template <typename T>
   struct make_param_value_tuple;

   template <typename R, typename C, typename... A>
   struct make_param_value_tuple<R (C::*)(A...)>
   {
      using type = std::tuple<
          std::remove_cvref_t<typename psio::remove_view_t<typename std::remove_cvref_t<A>>>...>;
   };

   template <typename R, typename C, typename... A>
   struct make_param_value_tuple<R (C::*)(A...) const>
   {
      using type = std::tuple<
          std::remove_cvref_t<typename psio::remove_view_t<typename std::remove_cvref_t<A>>>...>;
   };

   template <typename P>
   struct view_buffer
   {
      P data;
   };

   template <typename T>
   using char_t = std::conditional_t<std::is_const_v<T>, const char, char>;

   template <typename T>
   using char_ptr = char_t<T>*;

   template <typename T>
   using view_base = view_buffer<char_ptr<T>>;

   template <typename... T>
   constexpr auto get_packed_offsets(std::tuple<T...>*, std::uint32_t initial)
   {
      std::array<std::uint32_t, sizeof...(T)> result;
      std::uint32_t                           pos = initial;
      std::size_t                             idx = 0;
      ((result[idx++] = pos, pos += is_packable<T>::fixed_size), ...);
      return result;
   }

   template <typename T>
   constexpr auto fixed_offsets = 0;

   template <typename... T>
   constexpr auto fixed_offsets<std::tuple<T...>> =
       get_packed_offsets((std::tuple<T...>*)nullptr, 2);

   template <Reflected T>
   constexpr auto fixed_offsets<T> = get_packed_offsets(
       (typename get_struct_tuple_impl<typename psio::reflect<T>::data_members>::type*)nullptr,
       psio::reflect<T>::definitionWillNotChange ? 0 : 2);

   inline const char empty_optional[4] = {1, 0, 0, 0};

   template <typename Ch>
   struct frac_proxy_view : view_base<Ch>
   {
      explicit constexpr frac_proxy_view(char_ptr<Ch> ptr) : view_base<Ch>{ptr} {}
      template <uint32_t idx, auto MemberPtr>
      auto get()
      {
         using class_type  = decltype(psio::class_of_member(MemberPtr));
         using member_type = decltype(psio::result_of_member(MemberPtr));
         using result_type =
             view<std::conditional_t<std::is_const_v<Ch>, const member_type, member_type>>;

         constexpr uint32_t offset = fixed_offsets<class_type>[idx];

         if constexpr (is_packable<member_type>::is_optional &&
                       !psio::reflect<class_type>::definitionWillNotChange)
         {
            std::uint16_t fixed_size;
            std::uint32_t pos = 0;
            (void)unpack_numeric<false>(&fixed_size, this->data, pos, 2);
            if (fixed_size <= offset)
            {
               // The const_cast is safe because only a non-empty optional can be modified through a view.
               return result_type{prevalidated{const_cast<Ch*>(empty_optional)}};
            }
         }

         auto out_ptr = this->data + offset;

         if constexpr (is_packable<member_type>::is_optional ||
                       !is_packable<member_type>::is_variable_size)
         {
            return result_type(prevalidated{std::move(out_ptr)});
         }
         else
         {
            std::uint32_t offset;
            std::uint32_t pos = 0;
            (void)unpack_numeric<false>(&offset, out_ptr, pos, 4);
            return result_type(prevalidated{out_ptr + offset});
         }
      }
   };

   template <typename T, typename M>
   constexpr bool is_simple_packable_wrapper = false;

   template <typename T, auto M>
   constexpr bool is_simple_packable_wrapper<T, MemberList<M>> =
       std::is_same_v<typename std::remove_cvref_t<typename MemberPtrType<decltype(M)>::ValueType>,
                      T>;

   template <typename T>
   concept SimplePackableWrapper =
       Reflected<T> && PackableWrapper<T> &&
       is_simple_packable_wrapper<
           std::remove_cvref_t<decltype(clio_unwrap_packable(std::declval<T&>()))>,
           typename reflect<T>::data_members>;

   template <typename Ch>
   struct frac_wrap_view : view_base<Ch>
   {
      explicit constexpr frac_wrap_view(char_ptr<Ch> ptr) : view_base<Ch>{ptr} {}
      template <uint32_t idx, auto MemberPtr>
      auto get()
      {
         using member_type = decltype(psio::result_of_member(MemberPtr));
         using result_type =
             view<std::conditional_t<std::is_const_v<Ch>, const member_type, member_type>>;
         return result_type(prevalidated{this->data});
      }
   };

   struct make_reflect_proxy
   {
      template <typename T>
      using fn = typename reflect<std::remove_cv_t<T>>::template proxy<frac_proxy_view<char_t<T>>>;
   };

   struct make_wrapper_proxy
   {
      template <typename T>
      using fn = typename reflect<std::remove_cv_t<T>>::template proxy<frac_wrap_view<char_t<T>>>;
   };

   struct not_reflected
   {
      template <typename T>
      using fn = view_base<T>;
   };

   template <typename T>
   using view_interface_impl =
       typename std::conditional_t<Reflected<std::remove_cv_t<T>> &&
                                       !PackableWrapper<std::remove_cv_t<T>>,
                                   make_reflect_proxy,
                                   std::conditional_t<SimplePackableWrapper<std::remove_cv_t<T>>,
                                                      make_wrapper_proxy,
                                                      not_reflected>>::template fn<T>;

   template <typename T>
   struct view_interface : view_interface_impl<T>
   {
      explicit constexpr view_interface(char_ptr<T> ptr) : view_interface_impl<T>{ptr} {}
   };

   template <typename T>
   struct operator_arrow_proxy
   {
      T  value;
      T* operator->() { return &value; }
   };
   template <typename T>
   operator_arrow_proxy(const T&) -> operator_arrow_proxy<T>;

   template <typename T>
      requires(is_std_optional<std::remove_cv_t<T>>::value)
   struct view_interface<T> : view_base<T>
   {
      auto operator*() const
      {
         using V = typename T::value_type;
         using R = view<std::conditional_t<std::is_const_v<T>, const V, V>>;

         std::uint32_t offset;
         std::uint32_t pos = 0;
         (void)unpack_numeric<false>(&offset, this->data, pos, 4);
         return R{prevalidated{this->data + offset}};
      }
      auto operator->() const { return operator_arrow_proxy{**this}; }
      auto value() const
      {
         using V = typename T::value_type;
         using R = view<std::conditional_t<std::is_const_v<T>, const V, V>>;

         std::uint32_t offset;
         std::uint32_t pos = 0;
         (void)unpack_numeric<false>(&offset, this->data, pos, 4);
         if (offset == 1)
         {
#ifndef COMPILING_WASM
            throw std::bad_optional_access{};
#else
            abort_error("bad optional access");
#endif
         }
         return R{prevalidated{this->data + offset}};
      }
      template <typename U>
      typename T::value_type value_or(U&& u) const
      {
         using V = typename T::value_type;
         using R = view<std::conditional_t<std::is_const_v<T>, const V, V>>;

         std::uint32_t offset;
         std::uint32_t pos = 0;
         (void)unpack_numeric<false>(&offset, this->data, pos, 4);
         if (offset == 1)
         {
            return static_cast<V>(std::forward<U>(u));
         }
         return static_cast<V>(R{prevalidated{this->data + offset}});
      }
      bool has_value() const
      {
         std::uint32_t offset;
         std::uint32_t pos = 0;
         (void)unpack_numeric<false>(&offset, this->data, pos, 4);
         return offset != 1;
      }
      explicit operator bool() const { return has_value(); }
   };

   template <typename T>
      requires(is_std_variant_v<std::remove_cv_t<T>>)
   struct view_interface<T> : view_base<T>
   {
      std::size_t index() const
      {
         std::uint8_t  tag;
         std::uint32_t pos = 0;
         (void)unpack_numeric<false>(&tag, this->data, pos, 1);
         return tag;
      }
   };

   template <typename T, typename... Ts>
   constexpr std::size_t get_variant_index(std::variant<Ts...>*)
   {
      std::size_t result = 0;
      bool        okay   = false;
      for (bool b : {std::is_same_v<T, Ts>...})
      {
         if (b)
         {
            if (okay)
            {
               okay = false;
               break;
            }
            else
            {
               okay = true;
            }
         }
         if (!okay)
            ++result;
      }
      if (okay)
         return result;
      else
         return -1;
   }

   template <typename T, typename V>
      requires(is_std_variant_v<std::remove_cv_t<V>>)
   bool holds_alternative(view<V> v)
   {
      constexpr std::size_t expected = get_variant_index<T>((std::remove_cv_t<V>*)nullptr);
      static_assert(expected != std::size_t(-1));
      return v.index() == expected;
   }

   template <std::size_t I, typename F, typename T0, typename... T, typename Ch>
   decltype(auto) variant_visit_impl(F&& f, std::variant<T0, T...>*, std::size_t idx, Ch* ptr)
   {
      if (idx == I)
      {
         using V = view<std::conditional_t<std::is_const_v<Ch>, const T0, T0>>;
         return f(V{prevalidated{ptr}});
      }
      else if constexpr (sizeof...(T))
      {
         return variant_visit_impl<I + 1>(std::forward<F>(f), (std::variant<T...>*)nullptr, idx,
                                          ptr);
      }
      __builtin_unreachable();
   }

   template <typename F, typename T>
      requires(is_std_variant_v<std::remove_cv_t<T>>)
   decltype(auto) visit(F&& f, view<T> v)
   {
      return variant_visit_impl<0>(std::forward<F>(f), (std::remove_cv_t<T>*)nullptr, v.index(),
                                   v.data + 5);
   }

   template <typename R, typename T>
      requires(is_std_variant_v<std::remove_cv_t<T>>)
   auto get(view<T> v)
   {
      constexpr std::size_t expected = get_variant_index<R>((std::remove_cv_t<T>*)nullptr);
      static_assert(expected != std::size_t(-1));
      if (v.index() == expected)
      {
         return view<std::conditional_t<std::is_const_v<T>, const R, R>>(prevalidated{v.data + 5});
      }
      else
      {
#ifndef COMPILING_WASM
         throw std::bad_variant_access{};
#else
         abort_error("bad variant access");
#endif
      }
   }
   template <std::size_t I, typename T>
      requires(is_std_variant_v<std::remove_cv_t<T>>)
   auto get(view<T> v)
   {
      static_assert(I < std::variant_size_v<std::remove_cv_t<T>>);
      if (v.index() == I)
      {
         return view<std::variant_alternative_t<I, T>>(prevalidated{v.data + 5});
      }
      else
      {
#ifndef COMPILING_WASM
         throw std::bad_variant_access{};
#else
         abort_error("bad variant access");
#endif
      }
   }
   template <typename R, typename T>
      requires(is_std_variant_v<std::remove_cv_t<T>>)
   auto get_if(view<T> v)
   {
      constexpr std::size_t expected = get_variant_index<R>((std::remove_cv_t<T>*)nullptr);
      static_assert(expected != std::size_t(-1));
      using R2 = view<std::conditional_t<std::is_const_v<T>, const R, R>>;
      if (v.index() == expected)
      {
         return std::optional{R2(prevalidated{v.data + 5})};
      }
      else
      {
         return std::optional<R2>();
      }
   }
   template <std::size_t I, typename T>
      requires(is_std_variant_v<std::remove_cv_t<T>>)
   auto get_if(view<T> v)
   {
      static_assert(I < std::variant_size_v<std::remove_cv_t<T>>);
      using R = view<std::variant_alternative_t<I, T>>;
      if (v.index() == I)
      {
         return std::optional{R(prevalidated{v.data + 5})};
      }
      else
      {
         return std::optional<R>{};
      }
   }

   template <std::size_t I, typename T>
      requires(is_std_tuple<std::remove_cv_t<T>>::value)
   auto get(view<T> v)
   {
      using member_type = std::tuple_element_t<I, T>;
      using result_type = view<member_type>;

      constexpr auto offset = fixed_offsets<std::remove_cv_t<T>>[I];

      if constexpr (is_packable<std::remove_cv_t<member_type>>::is_optional)
      {
         std::uint16_t fixed_size;
         std::uint32_t pos = 0;
         (void)unpack_numeric<false>(&fixed_size, static_cast<view_base<T>&>(v).data, pos, 2);
         if (fixed_size <= offset)
         {
            // The const_cast is safe because only a non-empty optional can be modified through a view.
            return result_type{prevalidated{const_cast<char_ptr<member_type>>(empty_optional)}};
         }
      }

      auto out_ptr = static_cast<view_base<T>&>(v).data + offset;

      if constexpr (is_packable<std::remove_cv_t<member_type>>::is_optional ||
                    !is_packable<std::remove_cv_t<member_type>>::is_variable_size)
      {
         return result_type(prevalidated{std::move(out_ptr)});
      }
      else
      {
         std::uint32_t offset;
         std::uint32_t pos = 0;
         (void)unpack_numeric<false>(&offset, out_ptr, pos, 4);
         return result_type(prevalidated{out_ptr + offset});
      }
   }

   template <typename T>
   struct view_iterator : view_base<T>
   {
      view_iterator() = default;
      explicit view_iterator(prevalidated<char_ptr<T>> data) : view_base<T>{data.data} {}
      template <typename U>
         requires(std::is_same_v<T, const U>)
      view_iterator(const view_iterator<U>& other) : view_base<T>(other.data)
      {
      }
      using value_type       = std::remove_cv_t<T>;
      using reference        = view<T>;
      using difference_type  = std::ptrdiff_t;
      using iterator_concept = std::random_access_iterator_tag;
      constexpr view_iterator& operator++() { return *this += 1; }
      constexpr view_iterator  operator++(int)
      {
         auto result = *this;
         ++*this;
         return result;
      }
      constexpr view_iterator& operator--() { return *this -= 1; }
      constexpr view_iterator  operator--(int)
      {
         auto result = *this;
         --*this;
         return result;
      }
      constexpr view_iterator& operator+=(difference_type diff)
      {
         this->data += diff * is_packable<std::remove_cv_t<T>>::fixed_size;
         return *this;
      }
      constexpr view_iterator& operator-=(difference_type diff) { return *this += -diff; }
      friend view_iterator     operator+(const view_iterator& rhs, difference_type lhs)
      {
         view_iterator result = rhs;
         result += lhs;
         return result;
      }
      friend view_iterator operator+(difference_type lhs, const view_iterator& rhs)
      {
         return rhs + lhs;
      }
      friend view_iterator operator-(const view_iterator& rhs, difference_type lhs)
      {
         view_iterator result = rhs;
         result -= lhs;
         return result;
      }
      friend difference_type operator-(const view_iterator& rhs, const view_iterator& lhs)
      {
         return (rhs.data - lhs.data) / is_packable<std::remove_cv_t<T>>::fixed_size;
      }
      friend constexpr bool operator==(const view_iterator& lhs, const view_iterator& rhs)
      {
         return lhs.data == rhs.data;
      }
      friend constexpr auto operator<=>(const view_iterator& lhs, const view_iterator& rhs)
      {
         return lhs.data <=> rhs.data;
      }
      reference operator*() const
      {
         if constexpr (is_packable<value_type>::is_optional ||
                       !is_packable<value_type>::is_variable_size)
            return reference{prevalidated{this->data}};
         else
         {
            std::uint32_t offset;
            std::uint32_t pos = 0;
            (void)unpack_numeric<false>(&offset, this->data, pos, 4);
            return reference{prevalidated{this->data + offset}};
         }
      }
      auto      operator->() const { return operator_arrow_proxy{**this}; }
      reference operator[](difference_type n) const { return *(*this + n); }
   };

   template <typename T>
   concept PackableUnalignedMemcpy =
       std::is_same_v<T, char> || std::is_same_v<T, unsigned char> || std::is_same_v<T, std::byte>;

   template <typename T>
      requires(is_std_vector_v<std::remove_cv_t<T>>)
   struct view_interface<T> : view_base<T>
   {
      using value_type = typename T::value_type;
      using reference  = view<std::conditional_t<std::is_const_v<T>, const value_type, value_type>>;
      using const_reference = view<const value_type>;
      using size_type       = std::size_t;
      using difference_type = std::ptrdiff_t;
      using const_iterator  = view_iterator<const value_type>;
      using iterator =
          view_iterator<std::conditional_t<std::is_const_v<T>, const value_type, value_type>>;
      using reverse_iterator       = std::reverse_iterator<iterator>;
      using const_reverse_iterator = std::reverse_iterator<const_iterator>;
      iterator begin() const { return iterator{prevalidated{view_base<T>::data + 4}}; }
      iterator end() const
      {
         std::uint32_t size;
         std::uint32_t pos = 0;
         (void)unpack_numeric<false>(&size, view_base<T>::data, pos, 4);
         return iterator{prevalidated{view_base<T>::data + 4 + size}};
      }
      const_iterator         cbegin() const { return begin(); }
      const_iterator         cend() const { return end(); }
      reverse_iterator       rbegin() const { return reverse_iterator(end()); }
      reverse_iterator       rend() const { return reverse_iterator(begin()); }
      const_reverse_iterator crbegin() const { return const_reverse_iterator(end()); }
      const_reverse_iterator crend() const { return const_reverse_iterator(begin()); }
      bool                   empty() { return size() == 0; }
      std::size_t            size() const { return end() - begin(); }
      reference              operator[](size_type idx) const { return *(begin() + idx); }
      reference              at(size_type idx) const
      {
         if (idx < size())
         {
            return *(begin() + idx);
         }
         else
         {
#ifndef COMPILING_WASM
            throw std::out_of_range("view<vector> our of range");
#else
            abort_error("view<vector> our of range");
#endif
         }
      }
      reference front() const { return *begin(); }
      reference back() const { return *(end() - 1); }
      // vector<char> is common enough to make this worthwhile
      remove_view_t<reference>* data() const
         requires PackableUnalignedMemcpy<value_type>
      {
         return reinterpret_cast<remove_view_t<reference>*>(view_base<T>::data + 4);
      }
      // span's converting constructor is not viable because the iterator's reference type is a proxy
      operator std::span<const value_type>() const
         requires PackableUnalignedMemcpy<value_type>
      {
         return {data(), size()};
      }
   };

   template <typename T>
      requires std::same_as<std::remove_cv_t<T>, std::string>
   struct view_interface<T> : view_base<T>
   {
      static constexpr size_t npos = T::npos;
      using traits_type            = typename T::traits_type;
      using value_type             = char;
      using reference              = char_t<T>&;
      using const_reference        = const char&;
      using pointer                = char_t<T>*;
      using const_pointer          = const char*;
      using size_type              = std::size_t;
      using difference_type        = std::ptrdiff_t;
      using iterator               = pointer;
      using const_iterator         = const char*;
      using reverse_iterator       = std::reverse_iterator<iterator>;
      using const_reverse_iterator = std::reverse_iterator<const_iterator>;

      pointer   data() const { return view_base<T>::data + 4; }
      size_type size() const
      {
         std::uint32_t result;
         std::uint32_t pos = 0;
         (void)unpack_numeric<false>(&result, view_base<T>::data, pos, 4);
         return result;
      }
      size_type              length() const { return size(); }
      bool                   empty() const { return size() == 0; }
      iterator               begin() const { return data(); }
      iterator               end() const { return data() + size(); }
      const_iterator         cbegin() const { return begin(); }
      const_iterator         cend() const { return end(); }
      reverse_iterator       rbegin() const { return reverse_iterator(end()); }
      reverse_iterator       rend() const { return reverse_iterator(begin()); }
      const_reverse_iterator crbegin() const { return const_reverse_iterator(end()); }
      const_reverse_iterator crend() const { return const_reverse_iterator(begin()); }

      reference operator[](size_type idx) const { return *(begin() + idx); }
      reference at(size_type idx) const
      {
         if (idx < size())
         {
            return *(begin() + idx);
         }
         else
         {
#ifndef COMPILING_WASM
            throw std::out_of_range("view<string> out of range");
#else
            abort_error("view<string> out of range");
#endif
         }
      }
      reference front() const { return *begin(); }
      reference back() const { return *(end() - 1); }

      std::string_view substr(std::size_t pos = 0, std::size_t count = npos)
      {
         return std::string_view(*this).substr(pos, count);
      }
      operator std::string_view() const { return {data(), size()}; }
   };

   template <typename T, typename Ch>
   Ch* validate_view(std::span<Ch> data)
   {
      if (!fracpack_validate_compatible<std::remove_cv_t<T>>(data))
         abort_error(stream_error::invalid_frac_encoding);
      return data.data();
   }

   template <typename P>
   P get_view_data(const view_buffer<P>& arg)
   {
      return arg.data;
   }

   template <typename T>
   concept ReflectProxy = requires(const T& t) { t.psio_get_proxy(); };

   template <ReflectProxy T>
   auto get_view_data(const T& proxy)
   {
      return get_view_data(proxy.psio_get_proxy());
   }

   template <typename T>
      requires Packable<std::remove_cv_t<T>>
   class view : public view_interface<T>
   {
     public:
      static_assert(ReflectProxy<view_interface<T>> ||
                    std::is_base_of_v<view_base<T>, view_interface<T>>);
      explicit view(std::span<char_t<T>> data) : view_interface<T>{validate_view<T>(data)} {}
      template <typename U>
         requires(std::is_same_v<T, const U>)
      view(const view<U>& other) : view_interface<T>{get_view_data(other)}
      {
      }
      template <typename U>
      explicit constexpr view(prevalidated<U>&& data)
          : view_interface<T>{std::span<char_t<T>>{data.data}.data()}
      {
      }
      explicit constexpr view(prevalidated<char_ptr<T>> p) : view_interface<T>{p.data} {}
      std::remove_cv_t<T> unpack() const
      {
         std::remove_cv_t<T> result;
         bool                has_unknown = false;
         bool                known_end;
         std::uint32_t       pos = 0;
         (void)is_packable<std::remove_cv_t<T>>::template unpack<true, false>(
             &result, has_unknown, known_end, psio::get_view_data(*this), pos, 0xFFFFFFFFu);
         return result;
      }
      operator std::remove_cv_t<T>() const { return unpack(); }
      const view& operator=(const T& value) const
         requires(!std::is_const_v<T> && !is_packable<std::remove_cv_t<T>>::is_variable_size)
      {
         fast_buf_stream stream{psio::get_view_data(*this), is_packable<T>::fixed_size};
         is_packable<T>::pack(value, stream);
         return *this;
      }

     private:
      view& operator=(const view&) = delete;
   };

   template <typename T>
      requires Packable<std::remove_cv_t<T>>
   auto strict_view(std::span<char_t<T>> data)
   {
      if (!fracpack_validate_strict<T>(data))
         abort_error(stream_error::invalid_frac_encoding);
      return view<T>{prevalidated{data}};
   }
}  // namespace psio

namespace std
{

   template <typename T>
      requires(psio::is_std_tuple<std::remove_cv_t<T>>::value)
   struct tuple_size<::psio::view<T>> : std::tuple_size<T>
   {
   };

   template <std::size_t I, typename T>
      requires(psio::is_std_tuple<std::remove_cv_t<T>>::value)
   struct tuple_element<I, ::psio::view<T>>
   {
      using type = ::psio::view<std::tuple_element_t<I, T>>;
   };

}  // namespace std
