#pragma once
#include <map>
#include <memory>
#include <optional>
#include <span>
#include <string_view>
#include <tuple>
#include <type_traits>
#include <variant>
#include <vector>

#include <boost/core/demangle.hpp>
#include <boost/preprocessor/cat.hpp>
#include <boost/preprocessor/control/iif.hpp>
#include <boost/preprocessor/facilities/check_empty.hpp>
#include <boost/preprocessor/logical/bitand.hpp>
#include <boost/preprocessor/logical/compl.hpp>
#include <boost/preprocessor/repetition/enum.hpp>
#include <boost/preprocessor/repetition/enum_params.hpp>
#include <boost/preprocessor/seq/filter.hpp>
#include <boost/preprocessor/seq/for_each.hpp>
#include <boost/preprocessor/seq/for_each_i.hpp>
#include <boost/preprocessor/seq/to_tuple.hpp>
#include <boost/preprocessor/seq/transform.hpp>
#include <boost/preprocessor/stringize.hpp>
#include <boost/preprocessor/tuple/eat.hpp>
#include <boost/preprocessor/tuple/elem.hpp>
#include <boost/preprocessor/tuple/push_front.hpp>
#include <boost/preprocessor/tuple/rem.hpp>
#include <boost/preprocessor/variadic/size.hpp>
#include <boost/preprocessor/variadic/to_seq.hpp>

#include <psio/get_type_name.hpp>

namespace psio
{
   template <typename R, typename C, typename... Args>
   constexpr std::tuple<std::remove_cvref_t<Args>...> args_as_tuple(
       R (C::*)(Args...));  // { return ; }
   template <typename R, typename C, typename... Args>
   constexpr std::tuple<std::remove_cvref_t<Args>...> args_as_tuple(R (C::*)(Args...) const)
   {
      return {};
   }
   template <typename R, typename... Args>
   constexpr std::tuple<std::remove_cvref_t<Args>...> args_as_tuple(R (*)(Args...))
   {
      return {};
   }

   template <typename Tuple, size_t... I>
   constexpr auto get_tuple_args_h(Tuple t, std::index_sequence<I...>)
   {
      return std::make_tuple(args_as_tuple(std::get<I>(t))...);
   }

   template <typename... MPtrs>
   constexpr auto get_tuple_args(std::tuple<MPtrs...> t)
   {
      return get_tuple_args_h(
          t, std::make_index_sequence<std::tuple_size<std::tuple<MPtrs...>>::value>{});
   }

   template <typename... Ts>
   constexpr std::variant<Ts...> tuple_to_variant(std::tuple<Ts...>);

   template <typename F, typename T, std::size_t... I>
   void tuple_foreach_impl(T&& t, F&& f, std::index_sequence<I...>*)
   {
      (f(std::get<I>(t)), ...);
   }

   template <typename... Ts, typename S>
   void tuple_foreach(const std::tuple<Ts...>& obj, S&& s)
   {
      psio::tuple_foreach_impl(obj, s, (std::make_index_sequence<sizeof...(Ts)>*)nullptr);
   }
   template <typename... Ts, typename S>
   void tuple_foreach(std::tuple<Ts...>& obj, S&& s)
   {
      psio::tuple_foreach_impl(obj, s, (std::make_index_sequence<sizeof...(Ts)>*)nullptr);
   }

   template <typename... T, typename F>
   constexpr void tuple_foreach_type(const std::tuple<T...>* obj, F&& f)
   {
      (f((T*)nullptr), ...);
   }

   template <typename R, typename C, typename... Args>
   R result_of(R (C::*)(Args...) const);
   template <typename R, typename C, typename... Args>
   R result_of(R (C::*)(Args...));
   template <typename R, typename... Args>
   R result_of(R (*)(Args...));

   template <typename R, typename C>
   constexpr R result_of_member(R(C::*));
   template <typename R, typename C>
   constexpr C class_of_member(R(C::*));
   template <typename R, typename C, typename... Args>
   constexpr C class_of_member(R (C::*)(Args...));
   template <typename R, typename C, typename... Args>
   constexpr C class_of_member(R (C::*)(Args...) const);

   template <typename R, typename C, typename... Args>
   void result_of_member(R (C::*)(Args...) const);
   template <typename R, typename C, typename... Args>
   void result_of_member(R (C::*)(Args...));

   template <unsigned N>
   struct FixedString
   {
      char buf[N + 1]{};

      constexpr FixedString(const char (&s)[N + 1])
      {
         for (unsigned i = 0; i < N; ++i)
            buf[i] = s[i];
      }

      template <unsigned N1, unsigned N2>
      constexpr FixedString(const FixedString<N1>& a, const FixedString<N2>& b)
      {
         static_assert(N == N1 + N2);
         for (unsigned i = 0; i < N1; ++i)
            buf[i] = a.buf[i];
         for (unsigned i = 0; i < N2; ++i)
            buf[N1 + i] = b.buf[i];
      }

      constexpr operator const char*() const { return buf; }
      constexpr operator const decltype(buf) & () const { return buf; }
      constexpr operator std::string_view() const { return buf; }

      constexpr const char* c_str() const { return buf; }
      constexpr size_t      size() const { return N; }
   };
   template <unsigned N>
   FixedString(char const (&)[N]) -> FixedString<N - 1>;

   template <unsigned N1, unsigned N2>
   constexpr FixedString<N1 + N2> operator+(const FixedString<N1>& a, const FixedString<N2>& b)
   {
      return {a, b};
   }

   template <unsigned N1, unsigned N2>
   constexpr FixedString<N1 + N2 - 1> operator+(const FixedString<N1>& a, const char (&b)[N2])
   {
      return {a, FixedString{b}};
   }

   struct meta
   {
      const char*                        name;
      uint64_t                           offset      = ~uint64_t(0);
      std::initializer_list<const char*> param_names = {};
      int32_t                            number      = 0;
   };

   template <typename QueryClass>
   struct reflect_undefined
   {
      static constexpr bool is_defined              = false;
      static constexpr bool is_struct               = false;
      static constexpr bool definitionWillNotChange = false;
      template <typename L>
      static void get(const std::string_view& m, L&& lambda);
   };

   namespace reflection_impl
   {
      // Ensures that all overloads of psio_get_reflect_impl in this namespace
      // can be found by ADL.
      struct ReflectDummyParam;
   }  // namespace reflection_impl
   using reflection_impl::ReflectDummyParam;

   template <typename QueryClass>
   reflect_undefined<QueryClass> psio_get_reflect_impl(const QueryClass&, ReflectDummyParam*);

   template <typename QueryClass>
   concept ReflectedAsMember = requires(QueryClass* v) { v->psio_get_reflect_impl(v, nullptr); };

   template <ReflectedAsMember QueryClass>
   auto psio_get_reflect_impl(QueryClass* v,
                              ReflectDummyParam*) -> decltype(v->psio_get_reflect_impl(v, nullptr));

   template <typename QueryClass>
   using reflect =
       decltype(psio_get_reflect_impl((QueryClass*)nullptr, (ReflectDummyParam*)nullptr));

   template <typename>
   struct is_std_vector : std::false_type
   {
   };

   template <typename T, typename A>
   struct is_std_vector<std::vector<T, A>> : std::true_type
   {
      using value_type = T;
   };

   template <typename T>
   constexpr bool is_std_vector_v = is_std_vector<T>::value;

   template <typename>
   struct is_std_optional : std::false_type
   {
   };

   template <typename T>
   struct is_std_optional<std::optional<T>> : std::true_type
   {
      using value_type = T;
   };

   template <typename T>
   constexpr bool is_std_optional_v = is_std_optional<T>::value;

   template <typename>
   struct is_std_unique_ptr : std::false_type
   {
   };

   template <typename T>
   struct is_std_unique_ptr<std::unique_ptr<T>> : std::true_type
   {
      using value_type = T;
   };

   template <typename T>
   constexpr bool is_std_unique_ptr_v = is_std_unique_ptr<T>::value;

   template <typename>
   struct is_std_reference_wrapper : std::false_type
   {
   };

   template <typename T>
   struct is_std_reference_wrapper<std::reference_wrapper<T>> : std::true_type
   {
      using value_type = T;
   };

   template <typename T>
   constexpr bool is_std_reference_wrapper_v = is_std_reference_wrapper<T>::value;

   template <typename>
   struct is_std_array : std::false_type
   {
   };

   template <typename T, auto N>
   struct is_std_array<std::array<T, N>> : std::true_type
   {
      using value_type                        = T;
      constexpr static const std::size_t size = N;
   };

   template <typename T>
   constexpr bool is_std_array_v = is_std_array<T>::value;

   template <typename>
   struct is_std_variant : std::false_type
   {
   };

   template <typename... T>
   struct is_std_variant<std::variant<T...>> : std::true_type
   {
   };

   template <typename T>
   constexpr bool is_std_variant_v = is_std_variant<T>::value;

   template <typename>
   struct is_std_tuple : std::false_type
   {
   };

   template <typename... T>
   struct is_std_tuple<std::tuple<T...>> : std::true_type
   {
   };

   template <typename T>
   constexpr bool is_std_tuple_v = is_std_tuple<T>::value;

   template <typename>
   struct is_std_map : std::false_type
   {
   };

   template <typename K, typename V>
   struct is_std_map<std::map<K, V>> : std::true_type
   {
   };

   template <typename T>
   constexpr bool is_std_map_v = is_std_map<T>::value;

   template <typename... Ts>
   struct TypeList
   {
      static constexpr int size = sizeof...(Ts);
   };

   template <typename... Ts>
   std::tuple<Ts...> TupleFromTypeListImpl(TypeList<Ts...>&&);
   template <typename T>
   using TupleFromTypeList = decltype(TupleFromTypeListImpl(std::declval<T>()));

   template <typename T>
   struct MemberPtrType;

   template <typename V, typename T>
   struct MemberPtrType<V(T::*)>
   {
      static constexpr bool isFunction      = false;
      static constexpr bool isConstFunction = false;
      using ValueType                       = V;
   };

   template <typename R, typename T, typename... Args>
   struct MemberPtrType<R (T::*)(Args...)>
   {
      static constexpr bool isFunction      = true;
      static constexpr bool isConstFunction = false;
      static constexpr int  numArgs         = sizeof...(Args);
      using ClassType                       = T;
      using ReturnType                      = R;
      using ArgTypes                        = TypeList<Args...>;
      using SimplifiedArgTypes              = TypeList<std::remove_cvref_t<Args>...>;
   };

   template <typename R, typename T, typename... Args>
   struct MemberPtrType<R (T::*)(Args...) const>
   {
      static constexpr bool isFunction      = true;
      static constexpr bool isConstFunction = true;
      static constexpr int  numArgs         = sizeof...(Args);
      using ClassType                       = T;
      using ReturnType                      = R;
      using ArgTypes                        = TypeList<Args...>;
      using SimplifiedArgTypes              = TypeList<std::remove_cvref_t<Args>...>;
   };

   // Not really a member, but usable via std::invoke
   template <typename R, typename T, typename... Args>
   struct MemberPtrType<R (*)(T&, Args...)>
   {
      static constexpr bool isFunction      = true;
      static constexpr bool isConstFunction = false;
      static constexpr int  numArgs         = sizeof...(Args);
      using ClassType                       = T;
      using ReturnType                      = R;
      using ArgTypes                        = TypeList<Args...>;
      using SimplifiedArgTypes              = TypeList<std::remove_cvref_t<Args>...>;
   };

   // Not really a member, but usable via std::invoke
   template <typename R, typename T, typename... Args>
   struct MemberPtrType<R (*)(const T&, Args...)>
   {
      static constexpr bool isFunction      = true;
      static constexpr bool isConstFunction = true;
      static constexpr int  numArgs         = sizeof...(Args);
      using ClassType                       = T;
      using ReturnType                      = R;
      using ArgTypes                        = TypeList<Args...>;
      using SimplifiedArgTypes              = TypeList<std::remove_cvref_t<Args>...>;
   };

   template <typename F, typename... Args>
   void forEachType(TypeList<Args...>, F&& f)
   {
      (f((std::remove_cvref_t<Args>*)nullptr), ...);
   }

   template <typename F, typename... Args>
   void forEachNamedType(TypeList<Args...>, std::span<const char* const> names, F&& f)
   {
      size_t i = 0;
      auto   g = [&](auto* p)
      {
         f(p, i < names.size() ? names.begin()[i] : nullptr);
         ++i;
      };
      (g((std::remove_cvref_t<Args>*)nullptr), ...);
   }

   template <typename T>
   concept Reflected = reflect<T>::is_defined;

   template <Reflected T>
   struct is_reflected<T> : std::true_type
   {
   };

   template <typename T>
      requires(is_reflected<T>::value)
   constexpr const char* get_type_name(const T*)
   {
      return reflect<T>::name.c_str();
   }

   template <auto... F>
   struct MemberList;

   template <typename T>
   struct get_struct_tuple_impl;

   template <auto... F>
   struct get_struct_tuple_impl<MemberList<F...>>
   {
      using type = std::tuple<std::remove_cvref_t<decltype(psio::result_of_member(F))>...>;
   };

   template <auto... M, typename F>
   constexpr decltype(auto) apply_members(MemberList<M...>*, F&& f)
   {
      return f(M...);
   }

   template <typename T, auto... M, typename F>
   constexpr F for_each_member(T* t, MemberList<M...>*, F&& f)
   {
      (f(t->*M), ...);
      return static_cast<F&&>(f);
   }

   template <bool TypeOnly, typename T, auto... M, typename F>
   constexpr F for_each_member_ptr(T* t, MemberList<M...>*, F&& f)
   {
      if constexpr (TypeOnly)
      {
         (f((decltype(&(t->*M)))nullptr), ...);
      }
      else
      {
         (f(&(t->*M)), ...);
      }
      return static_cast<F&&>(f);
   }

   template <typename T>
   struct get_member_pointer_types;
   template <auto... F>
   struct get_member_pointer_types<MemberList<F...>>
   {
      using type = TypeList<decltype(F)...>;
   };

   template <auto... M, typename F>
   constexpr F for_each_member_type(MemberList<M...>*, F&& f)
   {
      (f(static_cast<decltype(M)>(nullptr)), ...);
      return static_cast<F&&>(f);
   }

   template <auto... M, typename F>
   constexpr bool get_member(MemberList<M...>*,
                             const char* const* names,
                             std::string_view   name,
                             F&&                f)
   {
      std::size_t i = 0;
      return (false || ... || (name == names[i++] && (f(M), true)));
   }

   template <typename T, typename F>
   constexpr bool get_data_member(std::string_view name, F&& f)
   {
      return get_member((typename reflect<T>::data_members*)nullptr, reflect<T>::data_member_names,
                        name, f);
   }

   template <auto... M, typename F>
   constexpr bool get_member(MemberList<M...>*,
                             const std::initializer_list<const char*>* names,
                             std::string_view                          name,
                             F&&                                       f)
   {
      std::size_t i = 0;
      return (false || ... || (name == *names[i++].begin() && (f(M, names[i - 1]), true)));
   }

   template <typename T, typename F>
   constexpr bool get_member_function(std::string_view name, F&& f)
   {
      return get_member((typename reflect<T>::member_functions*)nullptr,
                        reflect<T>::member_function_names, name, f);
   }

   template <auto... M, typename F>
   constexpr bool get_member(MemberList<M...>*,
                             const std::initializer_list<const char*>* names,
                             std::uint64_t                             name,
                             F&&                                       f)
   {
      std::size_t i = 0;
      return (false || ... ||
              (name == psio::hash_name(*names[i++].begin()) && (f(M, names[i - 1]), true)));
   }

   template <typename T, typename F>
   constexpr bool get_member_function(std::uint64_t name, F&& f)
   {
      return get_member((typename reflect<T>::member_functions*)nullptr,
                        reflect<T>::member_function_names, name, f);
   }

   template <auto... M, typename F>
   constexpr bool get_member_type(MemberList<M...>*,
                                  const std::initializer_list<const char*>* names,
                                  std::uint64_t                             name,
                                  F&&                                       f)
   {
      std::size_t i = 0;
      return (false || ... ||
              (name == psio::hash_name(*names[i++].begin()) &&
               (f(static_cast<decltype(M)>(nullptr), names[i - 1]), true)));
   }

   template <typename T, typename F>
   constexpr bool get_member_function_type(std::uint64_t name, F&& f)
   {
      return get_member_type((typename reflect<T>::member_functions*)nullptr,
                             reflect<T>::member_function_names, name, f);
   }

}  // namespace psio

#define PSIO_EMPTY(...)
#define PSIO_FIRST(a, ...) a
#define PSIO_APPLY_FIRST(a) PSIO_FIRST(a)
#define PSIO_SKIP_SECOND(a, b, ...) (a, __VA_ARGS__)

#define PSIO_REMOVE_PARENS(...) BOOST_PP_TUPLE_REM() __VA_ARGS__
#define PSIO_SEQ_TO_VA_ARGS(seq) PSIO_REMOVE_PARENS(BOOST_PP_SEQ_TO_TUPLE(seq))

#define PSIO_SEQ_FILTER(op, data, seq) \
   BOOST_PP_IIF(BOOST_PP_CHECK_EMPTY(seq), PSIO_EMPTY, BOOST_PP_SEQ_FILTER)(op, data, seq)

#define PSIO_SEQ_TRANSFORM(op, data, seq) \
   BOOST_PP_IIF(BOOST_PP_CHECK_EMPTY(seq), PSIO_EMPTY, BOOST_PP_SEQ_TRANSFORM)(op, data, seq)

#define PSIO_MATCH(base, x) PSIO_MATCH_CHECK(BOOST_PP_CAT(base, x))
#define PSIO_MATCH_ADD_PAREN(base, x) PSIO_MATCH_CHECK(BOOST_PP_CAT(base, x)())
#define PSIO_MATCH_CHECK(...) PSIO_MATCH_CHECK_N(__VA_ARGS__, 0, )
#define PSIO_MATCH_CHECK_N(x, n, r, ...) BOOST_PP_BITAND(n, BOOST_PP_COMPL(BOOST_PP_CHECK_EMPTY(r)))

// Handling of template(typename, int) etc.
#define PSIO_REFLECT_NAME(STRUCT) BOOST_PP_TUPLE_ELEM(3, 2, PSIO_TEMPLATE_I(STRUCT))

#define PSIO_REFLECT_TYPE(STRUCT) PSIO_REFLECT_TYPE_I(PSIO_TEMPLATE_I(STRUCT))
#define PSIO_REFLECT_TYPE_I(STRUCT) PSIO_REFLECT_TYPE_II STRUCT
#define PSIO_REFLECT_TYPE_II(c, params, name) \
   BOOST_PP_IIF(c, PSIO_REFLECT_TYPE_TEMPLATE, PSIO_REFLECT_TYPE_NONTEMPLATE)(params, name)
#define PSIO_REFLECT_TYPE_TEMPLATE(params, name) \
   name<BOOST_PP_ENUM_PARAMS(BOOST_PP_VARIADIC_SIZE params, T)>
#define PSIO_REFLECT_TYPE_NONTEMPLATE(params, name) name

#define PSIO_REFLECT_TEMPLATE_DECL(STRUCT) PSIO_REFLECT_TEMPLATE_DECL_I(PSIO_TEMPLATE_I(STRUCT))
#define PSIO_REFLECT_TEMPLATE_DECL_I(STRUCT) PSIO_REFLECT_TEMPLATE_DECL_II STRUCT
#define PSIO_REFLECT_TEMPLATE_DECL_II(c, params, name) \
   BOOST_PP_IIF(c, PSIO_REFLECT_TEMPLATE_DECL_TEMPLATE, BOOST_PP_TUPLE_EAT(42))(params)
#define PSIO_REFLECT_TEMPLATE_DECL_TEMPLATE(params) \
   template <BOOST_PP_ENUM(BOOST_PP_VARIADIC_SIZE params, PSIO_REFLECT_TPL_PARAM, params)>
#define PSIO_REFLECT_TPL_PARAM(z, i, data) BOOST_PP_TUPLE_ELEM(i, data) T##i

#define PSIO_TEMPLATE_I(STRUCT) PSIO_TEMPLATE_II(PSIO_MATCH_TEMPLATE##STRUCT, 0, STRUCT)
#define PSIO_TEMPLATE_II(...) PSIO_TEMPLATE_III(__VA_ARGS__)
#define PSIO_TEMPLATE_III(params, n, ...) \
   BOOST_PP_IIF(n, PSIO_TEMPLATE_TEMPLATE, PSIO_TEMPLATE_NONTEMPLATE)(params, __VA_ARGS__)
#define PSIO_MATCH_TEMPLATEtemplate(...) (__VA_ARGS__), 1, ~

#define PSIO_TEMPLATE_NONTEMPLATE(blah, ...) (0, (), __VA_ARGS__)
#define PSIO_TEMPLATE_TEMPLATE(params, n, z, args) (1, params, PSIO_REMOVE_TEMPLATE##args)

#define PSIO_REMOVE_TEMPLATEtemplate(...)

// Get seq of items. Each result is:
//    base(ident)
//    flag(ident)
//    numbered(int, ident)
//    unnumbered(ident)
//    method(ident, arg1, ...)
#define PSIO_REFLECT_ITEMS(...) \
   PSIO_SEQ_TRANSFORM(PSIO_MATCH_ITEMS, _, BOOST_PP_VARIADIC_TO_SEQ(__VA_ARGS__))
#define PSIO_MATCH_ITEMS(r, STRUCT, item)                                           \
   BOOST_PP_IIF(BOOST_PP_CHECK_EMPTY(item), ,                                       \
                BOOST_PP_IIF(PSIO_MATCH(PSIO_MATCH_ITEMS, item), PSIO_MATCHED_ITEM, \
                             PSIO_REFLECT_UNMATCHED_ITEM)(STRUCT, item))
#define PSIO_MATCHED_ITEM(STRUCT, item)                                        \
   PSIO_FIRST           PSIO_APPLY_FIRST(BOOST_PP_CAT(PSIO_MATCH_ITEMS, item)) \
       PSIO_SKIP_SECOND BOOST_PP_TUPLE_PUSH_FRONT(                             \
           PSIO_APPLY_FIRST(BOOST_PP_CAT(PSIO_MATCH_ITEMS, item)), STRUCT)
#define PSIO_REFLECT_UNMATCHED_ITEM(STRUCT, member) unnumbered(member)

#define PSIO_KEEP_BASE(_, ident, ...) base(ident)
#define PSIO_KEEP_FLAG(_, ident, ...) flag(ident)
#define PSIO_KEEP_NUMBERED(_, int, ident) numbered(int, ident)
#define PSIO_KEEP_METHOD(_, ident, ...) method(ident, __VA_ARGS__)

#define PSIO_MATCH_ITEMSbase(...) (PSIO_KEEP_BASE, __VA_ARGS__), 1
#define PSIO_MATCH_ITEMSnumbered(...) (PSIO_KEEP_NUMBERED, __VA_ARGS__), 1
#define PSIO_MATCH_ITEMSmethod(...) (PSIO_KEEP_METHOD, __VA_ARGS__), 1

#define PSIO_MATCH_ITEMSdefinitionWillNotChange(...) (PSIO_KEEP_FLAG, definitionWillNotChange), 1
#define PSIO_HAS_FLAG_IMPL_definitionWillNotChange_definitionWillNotChange(...) , 1

#define PSIO_MATCH_ITEMSallowHashedMethods(...) (PSIO_KEEP_FLAG, allowHashedMethods), 1
#define PSIO_HAS_FLAG_IMPL_allowHashedMethods_allowHashedMethods(...) , 1

// numbered(int, ident)
// unnumbered(ident)
// method(ident, arg1, ...)
#define PSIO_FILTER_MEMBERS(seq) BOOST_PP_SEQ_FILTER(PSIO_FILTER_MEMBERS_IMPL, _, seq)
#define PSIO_FILTER_MEMBERS_IMPL(s, _, elem) PSIO_MATCH(PSIO_FILTER_MEMBERS_IMPL, elem)
#define PSIO_FILTER_MEMBERS_IMPLnumbered(...) , 1
#define PSIO_FILTER_MEMBERS_IMPLunnumbered(...) , 1
#define PSIO_FILTER_MEMBERS_IMPLmethod(...) , 1

#define PSIO_REFLECT_MEMBERS(...) PSIO_FILTER_MEMBERS(PSIO_REFLECT_ITEMS(__VA_ARGS__))

// numbered(int, ident)
// unnumbered(ident)
#define PSIO_FILTER_DATA_MEMBERS(seq) BOOST_PP_SEQ_FILTER(PSIO_FILTER_DATA_MEMBERS_IMPL, _, seq)
#define PSIO_FILTER_DATA_MEMBERS_IMPL(s, _, elem) PSIO_MATCH(PSIO_FILTER_DATA_MEMBERS_IMPL, elem)
#define PSIO_FILTER_DATA_MEMBERS_IMPLnumbered(...) , 1
#define PSIO_FILTER_DATA_MEMBERS_IMPLunnumbered(...) , 1

#define PSIO_REFLECT_DATA_MEMBERS(...) PSIO_FILTER_DATA_MEMBERS(PSIO_REFLECT_ITEMS(__VA_ARGS__))

// method(ident, arg1, ...)
#define PSIO_FILTER_METHODS(seq) BOOST_PP_SEQ_FILTER(PSIO_FILTER_METHODS_IMPL, _, seq)
#define PSIO_FILTER_METHODS_IMPL(s, _, elem) PSIO_MATCH(PSIO_FILTER_METHODS_IMPL, elem)
#define PSIO_FILTER_METHODS_IMPLmethod(...) , 1

#define PSIO_REFLECT_METHODS(...) PSIO_FILTER_METHODS(PSIO_REFLECT_ITEMS(__VA_ARGS__))

// flag(ident)
#define PSIO_FILTER_FLAGS(seq) BOOST_PP_SEQ_FILTER(PSIO_FILTER_FLAGS_IMPL, _, seq)
#define PSIO_FILTER_FLAGS_IMPL(s, _, elem) PSIO_MATCH(PSIO_FILTER_FLAGS_IMPL, elem)
#define PSIO_FILTER_FLAGS_IMPLflag(...) , 1

// flag(ident) => ident
#define PSIO_REFLECT_FLAGS(...) \
   PSIO_SEQ_TRANSFORM(PSIO_EXTRACT_FLAG, _, PSIO_FILTER_FLAGS(PSIO_REFLECT_ITEMS(__VA_ARGS__)))
#define PSIO_EXTRACT_FLAG(r, _, flag) BOOST_PP_CAT(PSIO_EXTRACT_FLAG, flag)
#define PSIO_EXTRACT_FLAGflag(flag) flag

// 0 or 1
#define PSIO_HAS_FLAG(flag, ...)        \
   BOOST_PP_COMPL(BOOST_PP_CHECK_EMPTY( \
       PSIO_SEQ_FILTER(PSIO_HAS_FLAG_IMPL, flag, PSIO_REFLECT_FLAGS(__VA_ARGS__))))
#define PSIO_HAS_FLAG_IMPL(s, flag, elem) \
   PSIO_MATCH_ADD_PAREN(BOOST_PP_CAT(BOOST_PP_CAT(PSIO_HAS_FLAG_IMPL_, flag), _), elem)

// numbered(int, ident)       => ident
// unnumbered(ident)          => ident
// method(ident, arg1, ...)   => ident
#define PSIO_GET_IDENT(x) BOOST_PP_CAT(PSIO_GET_IDENT, x)
#define PSIO_GET_IDENTnumbered(int, ident) ident
#define PSIO_GET_IDENTunnumbered(ident) ident
#define PSIO_GET_IDENTmethod(ident, ...) ident

// numbered(int, ident) => 1
// unnumbered(ident)    => 0
#define PSIO_IS_NUMBERED(x) BOOST_PP_CAT(PSIO_IS_NUMBERED, x)
#define PSIO_IS_NUMBEREDnumbered(int, ident) 1
#define PSIO_IS_NUMBEREDunnumbered(ident) 0

// numbered(int, ident) => int
#define PSIO_GET_NUMBER(x) BOOST_PP_CAT(PSIO_GET_NUMBER, x)
#define PSIO_GET_NUMBERnumbered(int, ident) int

// numbered(int, ident) => int
// unnumbered(ident)    => i
#define PSIO_NUMBER_OR_AUTO(i, elem) \
   BOOST_PP_CAT(PSIO_NUMBER_OR_AUTO, PSIO_IS_NUMBERED(elem))(i, elem)
#define PSIO_NUMBER_OR_AUTO0(i, ...) i + 1
#define PSIO_NUMBER_OR_AUTO1(i, x) PSIO_GET_NUMBER(x)

// method(ident, arg1, ...) => arg1, ...
#define PSIO_GET_ARGS(x) BOOST_PP_CAT(PSIO_GET_ARGS, x)
#define PSIO_GET_ARGSmethod(ident, ...) __VA_ARGS__

// method(ident, arg1, ...) => "arg1", ...
#define PSIO_GET_QUOTED_ARGS(elem)                                                                \
   BOOST_PP_IIF(BOOST_PP_CHECK_EMPTY(PSIO_GET_ARGS(elem)), PSIO_EMPTY, PSIO_GET_QUOTED_ARGS_IMPL) \
   (elem)
#define PSIO_GET_QUOTED_ARGS_IMPL(elem)                                      \
   PSIO_SEQ_TO_VA_ARGS(BOOST_PP_SEQ_TRANSFORM(PSIO_GET_QUOTED_ARGS_IMPL2, _, \
                                              BOOST_PP_VARIADIC_TO_SEQ(PSIO_GET_ARGS(elem))))
#define PSIO_GET_QUOTED_ARGS_IMPL2(r, _, arg) #arg

#define PSIO_TUPLE_TYPE(s, STRUCT, elem) \
   std::remove_cvref_t<decltype(psio::result_of_member(&STRUCT::PSIO_GET_IDENT(elem)))>

#define PSIO_REFLECT_MEMBER_POINTER(r, STRUCT, elem) &STRUCT::PSIO_GET_IDENT(elem)

#define PSIO_REFLECT_DATA_MEMBER_NAME(r, STRUCT, elem) BOOST_PP_STRINGIZE(PSIO_GET_IDENT(elem)),

#define PSIO_REFLECT_MEMBER_FUNCTION_NAME(r, STRUCT, elem) \
   {BOOST_PP_STRINGIZE(PSIO_GET_IDENT(elem)), PSIO_GET_QUOTED_ARGS(elem)},

#define PSIO_FOR_EACH_MEMBER(r, STRUCT, i, elem)                                               \
   {                                                                                           \
      /* TODO: fix or remove: auto off = __builtin_offsetof(STRUCT, PSIO_GET_IDENT(elem)); */  \
      auto off = ~uint64_t(0);                                                                 \
      (void)lambda(                                                                            \
          psio::meta{                                                                          \
              .name = BOOST_PP_STRINGIZE(PSIO_GET_IDENT(elem)), .offset = off,                 \
                                         .number = PSIO_NUMBER_OR_AUTO(i, elem)},              \
              [](auto p) -> decltype(&std::remove_cvref_t<decltype(*p)>::PSIO_GET_IDENT(elem)) \
              { return &std::remove_cvref_t<decltype(*p)>::PSIO_GET_IDENT(elem); });           \
   }

#define PSIO_FOR_EACH_METHOD(r, STRUCT, elem)                                                  \
   (void)lambda(                                                                               \
       psio::meta{                                                                             \
           .name                                   = BOOST_PP_STRINGIZE(PSIO_GET_IDENT(elem)), \
                                      .param_names = {PSIO_GET_QUOTED_ARGS(elem)},             \
           },                                                                                  \
           [](auto p) -> decltype(&std::remove_cvref_t<decltype(*p)>::PSIO_GET_IDENT(elem))    \
           { return &std::remove_cvref_t<decltype(*p)>::PSIO_GET_IDENT(elem); });

#define PSIO_GET_BY_STR(r, STRUCT, elem)              \
   if (BOOST_PP_STRINGIZE(PSIO_GET_IDENT(elem)) == m) \
   {                                                  \
      (void)lambda(&STRUCT::PSIO_GET_IDENT(elem));    \
      return true;                                    \
   }

#define PSIO_REQ_COMPRESS(r, STRUCT, elem)                                             \
   static_assert(allowHashedMethods or psio::is_compressed_name(psio::hash_name(       \
                                           BOOST_PP_STRINGIZE(PSIO_GET_IDENT(elem)))), \
                                                                "method name does not compress");

#define PSIO_GET_BY_NUMBER(r, STRUCT, i, elem)                              \
   case BOOST_PP_CAT(PSIO_NUMBER_OR_AUTO, PSIO_IS_NUMBERED(elem))(i, elem): \
      (void)lambda(&STRUCT::PSIO_GET_IDENT(elem));                          \
      return true;

#define PSIO_GET_MEMBER_BY_NAME(r, STRUCT, i, elem)                                            \
   case psio::hash_name(BOOST_PP_STRINGIZE(PSIO_GET_IDENT(elem))):                             \
      (void)lambda(                                                                            \
          psio::meta{                                                                          \
              .name                              = BOOST_PP_STRINGIZE(PSIO_GET_IDENT(elem)),   \
                                         .number = PSIO_NUMBER_OR_AUTO(i, elem)},              \
              [](auto p) -> decltype(&std::remove_cvref_t<decltype(*p)>::PSIO_GET_IDENT(elem)) \
              { return &std::remove_cvref_t<decltype(*p)>::PSIO_GET_IDENT(elem); });           \
      return true;

#define PSIO_GET_METHOD_BY_NAME(r, STRUCT, elem)                                                  \
   case psio::hash_name(BOOST_PP_STRINGIZE(PSIO_GET_IDENT(elem))):                                \
      (void)lambda(                                                                               \
          psio::meta{                                                                             \
              .name                                   = BOOST_PP_STRINGIZE(PSIO_GET_IDENT(elem)), \
                                         .param_names = {PSIO_GET_QUOTED_ARGS(elem)}},            \
              [](auto p) -> decltype(&std::remove_cvref_t<decltype(*p)>::PSIO_GET_IDENT(elem))    \
              { return &std::remove_cvref_t<decltype(*p)>::PSIO_GET_IDENT(elem); });              \
      return true;

#define PSIO_MEMBER_POINTER_IMPL1(s, STRUCT, elem) &STRUCT::PSIO_GET_IDENT(elem)
#define PSIO_MEMBER_POINTER_IMPL2(STRUCT, members) \
   PSIO_SEQ_TO_VA_ARGS(BOOST_PP_SEQ_TRANSFORM(PSIO_MEMBER_POINTER_IMPL1, STRUCT, members))
#define PSIO_MEMBER_POINTER(STRUCT, members)                                          \
   BOOST_PP_IIF(BOOST_PP_CHECK_EMPTY(members), PSIO_EMPTY, PSIO_MEMBER_POINTER_IMPL2) \
   (STRUCT, members)

#define PSIO_PROXY_DATA(r, STRUCT, i, elem)                                    \
   decltype(auto) PSIO_GET_IDENT(elem)()                                       \
   {                                                                           \
      return _psio_proxy_obj.template get<i, &STRUCT::PSIO_GET_IDENT(elem)>(); \
   }                                                                           \
   decltype(auto) PSIO_GET_IDENT(elem)() const                                 \
   {                                                                           \
      return _psio_proxy_obj.template get<i, &STRUCT::PSIO_GET_IDENT(elem)>(); \
   }

#define PSIO_PROXY_METHOD(r, STRUCT, i, elem)                                 \
   template <typename... Args>                                                \
   decltype(auto) PSIO_GET_IDENT(elem)(Args... args)                          \
   {                                                                          \
      return _psio_proxy_obj.template call<i, &STRUCT::PSIO_GET_IDENT(elem)>( \
          std::forward<decltype(args)>(args)...);                             \
   }

/**
 * PSIO_REFLECT(<struct>, <member or base spec>...)
 * Each parameter may be one of the following:
 *    * ident                          non-static data member
 *    * definitionWillNotChange()      the struct's definition will not change in the future. This saves 2 bytes from the fracpack representation.
 *    * allowHashedMethods()           allow hashed method identifiers
 *    * base(ident)                    base class (not implemented)
 *    * method(ident, arg1, ...)       method
 *    * numbered(int, ident)           non-static data member with field number
 */
#define PSIO_REFLECT(STRUCT, ...)                                                                                 \
   template <typename ReflectedType>                                                                              \
   struct BOOST_PP_CAT(psio_reflect_impl_, PSIO_REFLECT_NAME(STRUCT))                                             \
   {                                                                                                              \
      static constexpr bool is_defined = true;                                                                    \
      static constexpr bool is_struct  = true;                                                                    \
      static constexpr bool definitionWillNotChange =                                                             \
          PSIO_HAS_FLAG(definitionWillNotChange, __VA_ARGS__);                                                    \
      static constexpr bool requires_compressed_method_names()                                                    \
      {                                                                                                           \
         constexpr bool allowHashedMethods = PSIO_HAS_FLAG(allowHashedMethods, __VA_ARGS__);                      \
         BOOST_PP_SEQ_FOR_EACH(PSIO_REQ_COMPRESS, ReflectedType,                                                  \
                               PSIO_REFLECT_METHODS(__VA_ARGS__));                                                \
         return !allowHashedMethods;                                                                              \
      }                                                                                                           \
      static constexpr psio::FixedString name = BOOST_PP_STRINGIZE(PSIO_REFLECT_NAME(STRUCT));                    \
      using data_members                      = psio::MemberList<BOOST_PP_IIF(                                    \
          BOOST_PP_CHECK_EMPTY(PSIO_REFLECT_DATA_MEMBERS(__VA_ARGS__)),                      \
          PSIO_EMPTY,                                                                        \
          PSIO_SEQ_TO_VA_ARGS)(PSIO_SEQ_TRANSFORM(PSIO_REFLECT_MEMBER_POINTER,               \
                                                                       ReflectedType,                             \
                                                                       PSIO_REFLECT_DATA_MEMBERS(__VA_ARGS__)))>; \
      static constexpr const char* data_member_names[] = {                                                        \
          BOOST_PP_SEQ_FOR_EACH(PSIO_REFLECT_DATA_MEMBER_NAME,                                                    \
                                ReflectedType,                                                                    \
                                PSIO_REFLECT_DATA_MEMBERS(__VA_ARGS__))};                                         \
      using member_functions = psio::MemberList<BOOST_PP_IIF(                                                     \
          BOOST_PP_CHECK_EMPTY(PSIO_REFLECT_METHODS(__VA_ARGS__)),                                                \
          PSIO_EMPTY,                                                                                             \
          PSIO_SEQ_TO_VA_ARGS)(PSIO_SEQ_TRANSFORM(PSIO_REFLECT_MEMBER_POINTER,                                    \
                                                  ReflectedType,                                                  \
                                                  PSIO_REFLECT_METHODS(__VA_ARGS__)))>;                           \
      static constexpr std::initializer_list<const char*> member_function_names[] = {                             \
          BOOST_PP_SEQ_FOR_EACH(PSIO_REFLECT_MEMBER_FUNCTION_NAME,                                                \
                                ReflectedType,                                                                    \
                                PSIO_REFLECT_METHODS(__VA_ARGS__))};                                              \
      static constexpr auto member_pointers()                                                                     \
      {                                                                                                           \
         return std::make_tuple(                                                                                  \
             PSIO_MEMBER_POINTER(ReflectedType, PSIO_REFLECT_MEMBERS(__VA_ARGS__)));                              \
      }                                                                                                           \
                                                                                                                  \
      template <typename ProxyObject>                                                                             \
      struct proxy                                                                                                \
      {                                                                                                           \
        private:                                                                                                  \
         ProxyObject _psio_proxy_obj;                                                                             \
                                                                                                                  \
        public:                                                                                                   \
         template <typename... Args>                                                                              \
         explicit proxy(Args&&... args) : _psio_proxy_obj(std::forward<Args>(args)...)                            \
         {                                                                                                        \
         }                                                                                                        \
         auto& psio_get_proxy() const                                                                             \
         {                                                                                                        \
            return _psio_proxy_obj;                                                                               \
         }                                                                                                        \
         BOOST_PP_SEQ_FOR_EACH_I(PSIO_PROXY_DATA,                                                                 \
                                 ReflectedType,                                                                   \
                                 PSIO_REFLECT_DATA_MEMBERS(__VA_ARGS__))                                          \
         BOOST_PP_SEQ_FOR_EACH_I(PSIO_PROXY_METHOD,                                                               \
                                 ReflectedType,                                                                   \
                                 PSIO_REFLECT_METHODS(__VA_ARGS__))                                               \
      };                                                                                                          \
   };                                                                                                             \
   PSIO_REFLECT_TEMPLATE_DECL(STRUCT)                                                                             \
   BOOST_PP_CAT(psio_reflect_impl_, PSIO_REFLECT_NAME(STRUCT))<PSIO_REFLECT_TYPE(STRUCT)>                         \
   psio_get_reflect_impl(PSIO_REFLECT_TYPE(STRUCT)*, ::psio::ReflectDummyParam*);

namespace psio::reflection_impl
{
   using std::pair;
   PSIO_REFLECT(template(typename, typename) pair, first, second)
}  // namespace psio::reflection_impl
