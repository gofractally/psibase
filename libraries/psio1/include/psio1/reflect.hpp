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

#include <psio1/get_type_name.hpp>

// TEMPORARY: removed when psio1 is deleted (see the end of this file).
#include <psio/adapter.hpp>
#include <psio/annotate.hpp>
#include <psio/reflect.hpp>

namespace psio1
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
      psio1::tuple_foreach_impl(obj, s, (std::make_index_sequence<sizeof...(Ts)>*)nullptr);
   }
   template <typename... Ts, typename S>
   void tuple_foreach(std::tuple<Ts...>& obj, S&& s)
   {
      psio1::tuple_foreach_impl(obj, s, (std::make_index_sequence<sizeof...(Ts)>*)nullptr);
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
      using type = std::tuple<std::remove_cvref_t<decltype(psio1::result_of_member(F))>...>;
   };

   template <typename T>
   using struct_tuple_t = get_struct_tuple_impl<typename reflect<T>::data_members>::type;

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
              (name == psio1::hash_name(*names[i++].begin()) && (f(M, names[i - 1]), true)));
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
              (name == psio1::hash_name(*names[i++].begin()) &&
               (f(static_cast<decltype(M)>(nullptr), names[i - 1]), true)));
   }

   template <typename T, typename F>
   constexpr bool get_member_function_type(std::uint64_t name, F&& f)
   {
      return get_member_type((typename reflect<T>::member_functions*)nullptr,
                             reflect<T>::member_function_names, name, f);
   }

}  // namespace psio1

#define PSIO1_EMPTY(...)
#define PSIO1_FIRST(a, ...) a
#define PSIO1_APPLY_FIRST(a) PSIO1_FIRST(a)
#define PSIO1_SKIP_SECOND(a, b, ...) (a, __VA_ARGS__)

#define PSIO1_REMOVE_PARENS(...) BOOST_PP_TUPLE_REM() __VA_ARGS__
#define PSIO1_SEQ_TO_VA_ARGS(seq) PSIO1_REMOVE_PARENS(BOOST_PP_SEQ_TO_TUPLE(seq))

#define PSIO1_SEQ_FILTER(op, data, seq) \
   BOOST_PP_IIF(BOOST_PP_CHECK_EMPTY(seq), PSIO1_EMPTY, BOOST_PP_SEQ_FILTER)(op, data, seq)

#define PSIO1_SEQ_TRANSFORM(op, data, seq) \
   BOOST_PP_IIF(BOOST_PP_CHECK_EMPTY(seq), PSIO1_EMPTY, BOOST_PP_SEQ_TRANSFORM)(op, data, seq)

#define PSIO1_MATCH(base, x) PSIO1_MATCH_CHECK(BOOST_PP_CAT(base, x))
#define PSIO1_MATCH_ADD_PAREN(base, x) PSIO1_MATCH_CHECK(BOOST_PP_CAT(base, x)())
#define PSIO1_MATCH_CHECK(...) PSIO1_MATCH_CHECK_N(__VA_ARGS__, 0, )
#define PSIO1_MATCH_CHECK_N(x, n, r, ...) BOOST_PP_BITAND(n, BOOST_PP_COMPL(BOOST_PP_CHECK_EMPTY(r)))

// Handling of template(typename, int) etc.
#define PSIO1_REFLECT_NAME(STRUCT) BOOST_PP_TUPLE_ELEM(3, 2, PSIO1_TEMPLATE_I(STRUCT))

#define PSIO1_REFLECT_TYPE(STRUCT) PSIO1_REFLECT_TYPE_I(PSIO1_TEMPLATE_I(STRUCT))
#define PSIO1_REFLECT_TYPE_I(STRUCT) PSIO1_REFLECT_TYPE_II STRUCT
#define PSIO1_REFLECT_TYPE_II(c, params, name) \
   BOOST_PP_IIF(c, PSIO1_REFLECT_TYPE_TEMPLATE, PSIO1_REFLECT_TYPE_NONTEMPLATE)(params, name)
#define PSIO1_REFLECT_TYPE_TEMPLATE(params, name) \
   name<BOOST_PP_ENUM_PARAMS(BOOST_PP_VARIADIC_SIZE params, T)>
#define PSIO1_REFLECT_TYPE_NONTEMPLATE(params, name) name

#define PSIO1_REFLECT_TEMPLATE_DECL(STRUCT) PSIO1_REFLECT_TEMPLATE_DECL_I(PSIO1_TEMPLATE_I(STRUCT))
#define PSIO1_REFLECT_TEMPLATE_DECL_I(STRUCT) PSIO1_REFLECT_TEMPLATE_DECL_II STRUCT
#define PSIO1_REFLECT_TEMPLATE_DECL_II(c, params, name) \
   BOOST_PP_IIF(c, PSIO1_REFLECT_TEMPLATE_DECL_TEMPLATE, BOOST_PP_TUPLE_EAT(42))(params)
#define PSIO1_REFLECT_TEMPLATE_DECL_TEMPLATE(params) \
   template <BOOST_PP_ENUM(BOOST_PP_VARIADIC_SIZE params, PSIO1_REFLECT_TPL_PARAM, params)>
#define PSIO1_REFLECT_TPL_PARAM(z, i, data) BOOST_PP_TUPLE_ELEM(i, data) T##i

#define PSIO1_TEMPLATE_I(STRUCT) PSIO1_TEMPLATE_II(PSIO1_MATCH_TEMPLATE##STRUCT, 0, STRUCT)
#define PSIO1_TEMPLATE_II(...) PSIO1_TEMPLATE_III(__VA_ARGS__)
#define PSIO1_TEMPLATE_III(params, n, ...) \
   BOOST_PP_IIF(n, PSIO1_TEMPLATE_TEMPLATE, PSIO1_TEMPLATE_NONTEMPLATE)(params, __VA_ARGS__)
#define PSIO1_MATCH_TEMPLATEtemplate(...) (__VA_ARGS__), 1, ~

#define PSIO1_TEMPLATE_NONTEMPLATE(blah, ...) (0, (), __VA_ARGS__)
#define PSIO1_TEMPLATE_TEMPLATE(params, n, z, args) (1, params, PSIO1_REMOVE_TEMPLATE##args)

#define PSIO1_REMOVE_TEMPLATEtemplate(...)

// Get seq of items. Each result is:
//    base(ident)
//    flag(ident)
//    numbered(int, ident)
//    unnumbered(ident)
//    method(ident, arg1, ...)
#define PSIO1_REFLECT_ITEMS(...) \
   PSIO1_SEQ_TRANSFORM(PSIO1_MATCH_ITEMS, _, BOOST_PP_VARIADIC_TO_SEQ(__VA_ARGS__))
#define PSIO1_MATCH_ITEMS(r, STRUCT, item)                                           \
   BOOST_PP_IIF(BOOST_PP_CHECK_EMPTY(item), ,                                       \
                BOOST_PP_IIF(PSIO1_MATCH(PSIO1_MATCH_ITEMS, item), PSIO1_MATCHED_ITEM, \
                             PSIO1_REFLECT_UNMATCHED_ITEM)(STRUCT, item))
#define PSIO1_MATCHED_ITEM(STRUCT, item)                                        \
   PSIO1_FIRST           PSIO1_APPLY_FIRST(BOOST_PP_CAT(PSIO1_MATCH_ITEMS, item)) \
       PSIO1_SKIP_SECOND BOOST_PP_TUPLE_PUSH_FRONT(                             \
           PSIO1_APPLY_FIRST(BOOST_PP_CAT(PSIO1_MATCH_ITEMS, item)), STRUCT)
#define PSIO1_REFLECT_UNMATCHED_ITEM(STRUCT, member) unnumbered(member)

#define PSIO1_KEEP_BASE(_, ident, ...) base(ident)
#define PSIO1_KEEP_FLAG(_, ident, ...) flag(ident)
#define PSIO1_KEEP_NUMBERED(_, int, ident) numbered(int, ident)
#define PSIO1_KEEP_METHOD(_, ident, ...) method(ident, __VA_ARGS__)

#define PSIO1_MATCH_ITEMSbase(...) (PSIO1_KEEP_BASE, __VA_ARGS__), 1
#define PSIO1_MATCH_ITEMSnumbered(...) (PSIO1_KEEP_NUMBERED, __VA_ARGS__), 1
#define PSIO1_MATCH_ITEMSmethod(...) (PSIO1_KEEP_METHOD, __VA_ARGS__), 1

#define PSIO1_MATCH_ITEMSdefinitionWillNotChange(...) (PSIO1_KEEP_FLAG, definitionWillNotChange), 1
#define PSIO1_HAS_FLAG_IMPL_definitionWillNotChange_definitionWillNotChange(...) , 1

#define PSIO1_MATCH_ITEMSallowHashedMethods(...) (PSIO1_KEEP_FLAG, allowHashedMethods), 1
#define PSIO1_HAS_FLAG_IMPL_allowHashedMethods_allowHashedMethods(...) , 1

// numbered(int, ident)
// unnumbered(ident)
// method(ident, arg1, ...)
#define PSIO1_FILTER_MEMBERS(seq) BOOST_PP_SEQ_FILTER(PSIO1_FILTER_MEMBERS_IMPL, _, seq)
#define PSIO1_FILTER_MEMBERS_IMPL(s, _, elem) PSIO1_MATCH(PSIO1_FILTER_MEMBERS_IMPL, elem)
#define PSIO1_FILTER_MEMBERS_IMPLnumbered(...) , 1
#define PSIO1_FILTER_MEMBERS_IMPLunnumbered(...) , 1
#define PSIO1_FILTER_MEMBERS_IMPLmethod(...) , 1

#define PSIO1_REFLECT_MEMBERS(...) PSIO1_FILTER_MEMBERS(PSIO1_REFLECT_ITEMS(__VA_ARGS__))

// numbered(int, ident)
// unnumbered(ident)
#define PSIO1_FILTER_DATA_MEMBERS(seq) BOOST_PP_SEQ_FILTER(PSIO1_FILTER_DATA_MEMBERS_IMPL, _, seq)
#define PSIO1_FILTER_DATA_MEMBERS_IMPL(s, _, elem) PSIO1_MATCH(PSIO1_FILTER_DATA_MEMBERS_IMPL, elem)
#define PSIO1_FILTER_DATA_MEMBERS_IMPLnumbered(...) , 1
#define PSIO1_FILTER_DATA_MEMBERS_IMPLunnumbered(...) , 1

#define PSIO1_REFLECT_DATA_MEMBERS(...) PSIO1_FILTER_DATA_MEMBERS(PSIO1_REFLECT_ITEMS(__VA_ARGS__))

// method(ident, arg1, ...)
#define PSIO1_FILTER_METHODS(seq) BOOST_PP_SEQ_FILTER(PSIO1_FILTER_METHODS_IMPL, _, seq)
#define PSIO1_FILTER_METHODS_IMPL(s, _, elem) PSIO1_MATCH(PSIO1_FILTER_METHODS_IMPL, elem)
#define PSIO1_FILTER_METHODS_IMPLmethod(...) , 1

#define PSIO1_REFLECT_METHODS(...) PSIO1_FILTER_METHODS(PSIO1_REFLECT_ITEMS(__VA_ARGS__))

// flag(ident)
#define PSIO1_FILTER_FLAGS(seq) BOOST_PP_SEQ_FILTER(PSIO1_FILTER_FLAGS_IMPL, _, seq)
#define PSIO1_FILTER_FLAGS_IMPL(s, _, elem) PSIO1_MATCH(PSIO1_FILTER_FLAGS_IMPL, elem)
#define PSIO1_FILTER_FLAGS_IMPLflag(...) , 1

// flag(ident) => ident
#define PSIO1_REFLECT_FLAGS(...) \
   PSIO1_SEQ_TRANSFORM(PSIO1_EXTRACT_FLAG, _, PSIO1_FILTER_FLAGS(PSIO1_REFLECT_ITEMS(__VA_ARGS__)))
#define PSIO1_EXTRACT_FLAG(r, _, flag) BOOST_PP_CAT(PSIO1_EXTRACT_FLAG, flag)
#define PSIO1_EXTRACT_FLAGflag(flag) flag

// 0 or 1
#define PSIO1_HAS_FLAG(flag, ...)        \
   BOOST_PP_COMPL(BOOST_PP_CHECK_EMPTY( \
       PSIO1_SEQ_FILTER(PSIO1_HAS_FLAG_IMPL, flag, PSIO1_REFLECT_FLAGS(__VA_ARGS__))))
#define PSIO1_HAS_FLAG_IMPL(s, flag, elem) \
   PSIO1_MATCH_ADD_PAREN(BOOST_PP_CAT(BOOST_PP_CAT(PSIO1_HAS_FLAG_IMPL_, flag), _), elem)

// numbered(int, ident)       => ident
// unnumbered(ident)          => ident
// method(ident, arg1, ...)   => ident
#define PSIO1_GET_IDENT(x) BOOST_PP_CAT(PSIO1_GET_IDENT, x)
#define PSIO1_GET_IDENTnumbered(int, ident) ident
#define PSIO1_GET_IDENTunnumbered(ident) ident
#define PSIO1_GET_IDENTmethod(ident, ...) ident

// numbered(int, ident) => 1
// unnumbered(ident)    => 0
#define PSIO1_IS_NUMBERED(x) BOOST_PP_CAT(PSIO1_IS_NUMBERED, x)
#define PSIO1_IS_NUMBEREDnumbered(int, ident) 1
#define PSIO1_IS_NUMBEREDunnumbered(ident) 0

// numbered(int, ident) => int
#define PSIO1_GET_NUMBER(x) BOOST_PP_CAT(PSIO1_GET_NUMBER, x)
#define PSIO1_GET_NUMBERnumbered(int, ident) int

// numbered(int, ident) => int
// unnumbered(ident)    => i
#define PSIO1_NUMBER_OR_AUTO(i, elem) \
   BOOST_PP_CAT(PSIO1_NUMBER_OR_AUTO, PSIO1_IS_NUMBERED(elem))(i, elem)
#define PSIO1_NUMBER_OR_AUTO0(i, ...) i + 1
#define PSIO1_NUMBER_OR_AUTO1(i, x) PSIO1_GET_NUMBER(x)

// method(ident, arg1, ...) => arg1, ...
#define PSIO1_GET_ARGS(x) BOOST_PP_CAT(PSIO1_GET_ARGS, x)
#define PSIO1_GET_ARGSmethod(ident, ...) __VA_ARGS__

// method(ident, arg1, ...) => "arg1", ...
#define PSIO1_GET_QUOTED_ARGS(elem)                                                                \
   BOOST_PP_IIF(BOOST_PP_CHECK_EMPTY(PSIO1_GET_ARGS(elem)), PSIO1_EMPTY, PSIO1_GET_QUOTED_ARGS_IMPL) \
   (elem)
#define PSIO1_GET_QUOTED_ARGS_IMPL(elem)                                      \
   PSIO1_SEQ_TO_VA_ARGS(BOOST_PP_SEQ_TRANSFORM(PSIO1_GET_QUOTED_ARGS_IMPL2, _, \
                                              BOOST_PP_VARIADIC_TO_SEQ(PSIO1_GET_ARGS(elem))))
#define PSIO1_GET_QUOTED_ARGS_IMPL2(r, _, arg) #arg

#define PSIO1_TUPLE_TYPE(s, STRUCT, elem) \
   std::remove_cvref_t<decltype(psio1::result_of_member(&STRUCT::PSIO1_GET_IDENT(elem)))>

#define PSIO1_REFLECT_MEMBER_POINTER(r, STRUCT, elem) &STRUCT::PSIO1_GET_IDENT(elem)

#define PSIO1_REFLECT_DATA_MEMBER_NAME(r, STRUCT, elem) BOOST_PP_STRINGIZE(PSIO1_GET_IDENT(elem)),

#define PSIO1_REFLECT_MEMBER_FUNCTION_NAME(r, STRUCT, elem) \
   {BOOST_PP_STRINGIZE(PSIO1_GET_IDENT(elem)), PSIO1_GET_QUOTED_ARGS(elem)},

#define PSIO1_FOR_EACH_MEMBER(r, STRUCT, i, elem)                                               \
   {                                                                                           \
      (void)lambda(                                                                            \
          psio1::meta{                                                                          \
              .name = BOOST_PP_STRINGIZE(PSIO1_GET_IDENT(elem)),                                \
                                         .number = PSIO1_NUMBER_OR_AUTO(i, elem)},              \
              [](auto p) -> decltype(&std::remove_cvref_t<decltype(*p)>::PSIO1_GET_IDENT(elem)) \
              { return &std::remove_cvref_t<decltype(*p)>::PSIO1_GET_IDENT(elem); });           \
   }

#define PSIO1_FOR_EACH_METHOD(r, STRUCT, elem)                                                  \
   (void)lambda(                                                                               \
       psio1::meta{                                                                             \
           .name                                   = BOOST_PP_STRINGIZE(PSIO1_GET_IDENT(elem)), \
                                      .param_names = {PSIO1_GET_QUOTED_ARGS(elem)},             \
           },                                                                                  \
           [](auto p) -> decltype(&std::remove_cvref_t<decltype(*p)>::PSIO1_GET_IDENT(elem))    \
           { return &std::remove_cvref_t<decltype(*p)>::PSIO1_GET_IDENT(elem); });

#define PSIO1_GET_BY_STR(r, STRUCT, elem)              \
   if (BOOST_PP_STRINGIZE(PSIO1_GET_IDENT(elem)) == m) \
   {                                                  \
      (void)lambda(&STRUCT::PSIO1_GET_IDENT(elem));    \
      return true;                                    \
   }

#define PSIO1_REQ_COMPRESS(r, STRUCT, elem)                             \
   static_assert(                                                      \
       allowHashedMethods or                                           \
       psio1::is_compressed_name(                                       \
           psio1::hash_name(BOOST_PP_STRINGIZE(PSIO1_GET_IDENT(elem)))), \
           "method name '" BOOST_PP_STRINGIZE(PSIO1_GET_IDENT(elem)) "' does not compress");

#define PSIO1_GET_BY_NUMBER(r, STRUCT, i, elem)                              \
   case BOOST_PP_CAT(PSIO1_NUMBER_OR_AUTO, PSIO1_IS_NUMBERED(elem))(i, elem): \
      (void)lambda(&STRUCT::PSIO1_GET_IDENT(elem));                          \
      return true;

#define PSIO1_GET_MEMBER_BY_NAME(r, STRUCT, i, elem)                                            \
   case psio1::hash_name(BOOST_PP_STRINGIZE(PSIO1_GET_IDENT(elem))):                             \
      (void)lambda(                                                                            \
          psio1::meta{                                                                          \
              .name                              = BOOST_PP_STRINGIZE(PSIO1_GET_IDENT(elem)),   \
                                         .number = PSIO1_NUMBER_OR_AUTO(i, elem)},              \
              [](auto p) -> decltype(&std::remove_cvref_t<decltype(*p)>::PSIO1_GET_IDENT(elem)) \
              { return &std::remove_cvref_t<decltype(*p)>::PSIO1_GET_IDENT(elem); });           \
      return true;

#define PSIO1_GET_METHOD_BY_NAME(r, STRUCT, elem)                                                  \
   case psio1::hash_name(BOOST_PP_STRINGIZE(PSIO1_GET_IDENT(elem))):                                \
      (void)lambda(                                                                               \
          psio1::meta{                                                                             \
              .name                                   = BOOST_PP_STRINGIZE(PSIO1_GET_IDENT(elem)), \
                                         .param_names = {PSIO1_GET_QUOTED_ARGS(elem)}},            \
              [](auto p) -> decltype(&std::remove_cvref_t<decltype(*p)>::PSIO1_GET_IDENT(elem))    \
              { return &std::remove_cvref_t<decltype(*p)>::PSIO1_GET_IDENT(elem); });              \
      return true;

#define PSIO1_MEMBER_POINTER_IMPL1(s, STRUCT, elem) &STRUCT::PSIO1_GET_IDENT(elem)
#define PSIO1_MEMBER_POINTER_IMPL2(STRUCT, members) \
   PSIO1_SEQ_TO_VA_ARGS(BOOST_PP_SEQ_TRANSFORM(PSIO1_MEMBER_POINTER_IMPL1, STRUCT, members))
#define PSIO1_MEMBER_POINTER(STRUCT, members)                                          \
   BOOST_PP_IIF(BOOST_PP_CHECK_EMPTY(members), PSIO1_EMPTY, PSIO1_MEMBER_POINTER_IMPL2) \
   (STRUCT, members)

#define PSIO1_PROXY_DATA(r, STRUCT, i, elem)                                    \
   decltype(auto) PSIO1_GET_IDENT(elem)()                                       \
   {                                                                           \
      return _psio_proxy_obj.template get<i, &STRUCT::PSIO1_GET_IDENT(elem)>(); \
   }                                                                           \
   decltype(auto) PSIO1_GET_IDENT(elem)() const                                 \
   {                                                                           \
      return _psio_proxy_obj.template get<i, &STRUCT::PSIO1_GET_IDENT(elem)>(); \
   }

#define PSIO1_PROXY_METHOD(r, STRUCT, i, elem)                                 \
   template <typename... Args>                                                \
   decltype(auto) PSIO1_GET_IDENT(elem)(Args... args)                          \
   {                                                                          \
      return _psio_proxy_obj.template call<i, &STRUCT::PSIO1_GET_IDENT(elem)>( \
          std::forward<decltype(args)>(args)...);                             \
   }

/**
 * PSIO1_REFLECT(<struct>, <member or base spec>...)
 * Each parameter may be one of the following:
 *    * ident                          non-static data member
 *    * definitionWillNotChange()      the struct's definition will not change in the future. This saves 2 bytes from the fracpack representation.
 *    * allowHashedMethods()           allow hashed method identifiers
 *    * base(ident)                    base class (not implemented)
 *    * method(ident, arg1, ...)       method
 *    * numbered(int, ident)           non-static data member with field number
 */
#define PSIO1_REFLECT(STRUCT, ...)                                                                                 \
   template <typename ReflectedType>                                                                              \
   struct BOOST_PP_CAT(psio_reflect_impl_, PSIO1_REFLECT_NAME(STRUCT))                                             \
   {                                                                                                              \
      static constexpr bool is_defined = true;                                                                    \
      static constexpr bool is_struct  = true;                                                                    \
      static constexpr bool definitionWillNotChange =                                                             \
          PSIO1_HAS_FLAG(definitionWillNotChange, __VA_ARGS__);                                                    \
      static constexpr bool requires_compressed_method_names()                                                    \
      {                                                                                                           \
         constexpr bool allowHashedMethods = PSIO1_HAS_FLAG(allowHashedMethods, __VA_ARGS__);                      \
         BOOST_PP_SEQ_FOR_EACH(PSIO1_REQ_COMPRESS, ReflectedType,                                                  \
                               PSIO1_REFLECT_METHODS(__VA_ARGS__));                                                \
         return !allowHashedMethods;                                                                              \
      }                                                                                                           \
      static constexpr psio1::FixedString name = BOOST_PP_STRINGIZE(PSIO1_REFLECT_NAME(STRUCT));                    \
      using data_members                      = psio1::MemberList<BOOST_PP_IIF(                                    \
          BOOST_PP_CHECK_EMPTY(PSIO1_REFLECT_DATA_MEMBERS(__VA_ARGS__)),                      \
          PSIO1_EMPTY,                                                                        \
          PSIO1_SEQ_TO_VA_ARGS)(PSIO1_SEQ_TRANSFORM(PSIO1_REFLECT_MEMBER_POINTER,               \
                                                                       ReflectedType,                             \
                                                                       PSIO1_REFLECT_DATA_MEMBERS(__VA_ARGS__)))>; \
      static constexpr const char* data_member_names[] = {                                                        \
          BOOST_PP_SEQ_FOR_EACH(PSIO1_REFLECT_DATA_MEMBER_NAME,                                                    \
                                ReflectedType,                                                                    \
                                PSIO1_REFLECT_DATA_MEMBERS(__VA_ARGS__))};                                         \
      using member_functions = psio1::MemberList<BOOST_PP_IIF(                                                     \
          BOOST_PP_CHECK_EMPTY(PSIO1_REFLECT_METHODS(__VA_ARGS__)),                                                \
          PSIO1_EMPTY,                                                                                             \
          PSIO1_SEQ_TO_VA_ARGS)(PSIO1_SEQ_TRANSFORM(PSIO1_REFLECT_MEMBER_POINTER,                                    \
                                                  ReflectedType,                                                  \
                                                  PSIO1_REFLECT_METHODS(__VA_ARGS__)))>;                           \
      static constexpr std::initializer_list<const char*> member_function_names[] = {                             \
          BOOST_PP_SEQ_FOR_EACH(PSIO1_REFLECT_MEMBER_FUNCTION_NAME,                                                \
                                ReflectedType,                                                                    \
                                PSIO1_REFLECT_METHODS(__VA_ARGS__))};                                              \
      static constexpr auto member_pointers()                                                                     \
      {                                                                                                           \
         return std::make_tuple(                                                                                  \
             PSIO1_MEMBER_POINTER(ReflectedType, PSIO1_REFLECT_MEMBERS(__VA_ARGS__)));                              \
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
         auto& psio_get_proxy()                                                                                   \
         {                                                                                                        \
            return _psio_proxy_obj;                                                                               \
         }                                                                                                        \
         auto& psio_get_proxy() const                                                                             \
         {                                                                                                        \
            return _psio_proxy_obj;                                                                               \
         }                                                                                                        \
         BOOST_PP_SEQ_FOR_EACH_I(PSIO1_PROXY_DATA,                                                                 \
                                 ReflectedType,                                                                   \
                                 PSIO1_REFLECT_DATA_MEMBERS(__VA_ARGS__))                                          \
         BOOST_PP_SEQ_FOR_EACH_I(PSIO1_PROXY_METHOD,                                                               \
                                 ReflectedType,                                                                   \
                                 PSIO1_REFLECT_METHODS(__VA_ARGS__))                                               \
      };                                                                                                          \
   };                                                                                                             \
   PSIO1_REFLECT_TEMPLATE_DECL(STRUCT)                                                                             \
   BOOST_PP_CAT(psio_reflect_impl_, PSIO1_REFLECT_NAME(STRUCT))<PSIO1_REFLECT_TYPE(STRUCT)>                         \
   psio_get_reflect_impl(PSIO1_REFLECT_TYPE(STRUCT)*, ::psio1::ReflectDummyParam*);

namespace psio1::reflection_impl
{
   using std::pair;
   PSIO1_REFLECT(template(typename, typename) pair, first, second)
}  // namespace psio1::reflection_impl

// TEMPORARY: removed when psio1 is deleted.
//
// Types reflected with PSIO (PSIO_REFLECT, psio::reflect<T>) are usable by
// this library while the rest of psibase is converted: psio1::reflect<T> is
// derived from psio::reflect<T>, so fracpack, views, keys, JSON, schemas and
// GraphQL see such a type exactly as if it had been declared with
// PSIO1_REFLECT. Only data members are bridged.
namespace psio1::reflection_impl
{
   struct canonical_name
   {
      const char* text;
      constexpr const char* c_str() const { return text; }
      constexpr             operator const char*() const { return text; }
      constexpr             operator std::string_view() const { return text; }
   };

   // The projection a PSIO record proxy inherits; it forwards to the proxy
   // object this library's proxies hold.
   template <typename ProxyObject>
   struct canonical_projection
   {
      ProxyObject _psio_proxy_obj;
      template <std::size_t I, auto MemberPtr>
      decltype(auto) get()
      {
         return _psio_proxy_obj.template get<I, MemberPtr>();
      }
      template <std::size_t I, auto MemberPtr>
      decltype(auto) get() const
      {
         return _psio_proxy_obj.template get<I, MemberPtr>();
      }
   };

   template <typename T,
             typename = std::make_index_sequence<::psio::reflect<T>::member_count>>
   struct canonical_reflect;

   template <typename T, std::size_t... I>
   struct canonical_reflect<T, std::index_sequence<I...>>
   {
      static_assert(::psio::reflect<T>::method_count == 0,
                    "psio1 does not bridge the methods of a type reflected with PSIO");
      static_assert(!::psio::has_adapter_v<T, ::psio::binary_category> &&
                        !::psio::has_adapter_v<T, ::psio::sortable_binary_category>,
                    "psio1 does not bridge binary or key adapters of a type reflected with PSIO");

      static constexpr bool is_defined              = true;
      static constexpr bool is_struct               = true;
      static constexpr bool definitionWillNotChange = ::psio::is_dwnc_v<T>;
      static constexpr bool requires_compressed_method_names() { return true; }
      static constexpr canonical_name name{::psio::reflect<T>::name.data()};
      using data_members = MemberList<::psio::reflect<T>::template member_pointer<I>...>;
      // One extra element: an empty record must not declare an empty array.
      static constexpr const char* data_member_names[sizeof...(I) + 1] = {
          ::psio::reflect<T>::template member_name<I>.data()..., nullptr};
      using member_functions = MemberList<>;
      static constexpr std::initializer_list<const char*> member_function_names[1] = {};
      static constexpr auto member_pointers()
      {
         return std::make_tuple(::psio::reflect<T>::template member_pointer<I>...);
      }

      template <typename ProxyObject>
      struct proxy : ::psio::reflect<T>::template proxy<canonical_projection<ProxyObject>>
      {
         template <typename... Args>
         explicit proxy(Args&&... args)
             : ::psio::reflect<T>::template proxy<canonical_projection<ProxyObject>>(
                   canonical_projection<ProxyObject>{ProxyObject(std::forward<Args>(args)...)})
         {
         }
         auto& psio_get_proxy() { return this->_psio_proxy_obj; }
         auto& psio_get_proxy() const { return this->_psio_proxy_obj; }
      };
   };

   template <typename T>
      requires ::psio::Reflected<T>
   canonical_reflect<T> psio_get_reflect_impl(T*, ReflectDummyParam*);
}  // namespace psio1::reflection_impl
