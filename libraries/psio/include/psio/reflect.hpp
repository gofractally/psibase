#pragma once
#include <map>
#include <optional>
#include <string_view>
#include <tuple>
#include <type_traits>
#include <variant>
#include <vector>

#include <boost/core/demangle.hpp>

#include <boost/preprocessor/cat.hpp>
#include <boost/preprocessor/facilities/overload.hpp>
#include <boost/preprocessor/punctuation/comma_if.hpp>
#include <boost/preprocessor/seq/for_each.hpp>
#include <boost/preprocessor/seq/for_each_i.hpp>
#include <boost/preprocessor/stringize.hpp>
#include <boost/preprocessor/tuple/enum.hpp>
#include <boost/preprocessor/variadic/size.hpp>
#include <boost/preprocessor/variadic/to_seq.hpp>
#include <boost/preprocessor/variadic/to_tuple.hpp>

#include <psio/get_type_name.hpp>
#include <psio/member_proxy.hpp>

namespace psio
{
   template <typename R, typename C, typename... Args>
   constexpr std::tuple<std::decay_t<Args>...> args_as_tuple(R (C::*)(Args...)) { return {}; }
   template <typename R, typename C, typename... Args>
   constexpr std::tuple<std::decay_t<Args>...> args_as_tuple(R (C::*)(Args...) const) { return {}; }
   template <typename R, typename... Args>
   constexpr std::tuple<std::decay_t<Args>...> args_as_tuple(R (*)(Args...) ){ return {}; }


   template<typename Tuple, size_t...I>
   auto prune_tuple_h( Tuple t, std::index_sequence<I...> ) {
      return std::make_tuple( std::get<I>(t)... );
   }

   template<typename...Ts>
   auto prune_tuple( std::tuple<Ts...> t ) {
      return prune_tuple_h( t, 
          std::make_index_sequence<std::tuple_size<std::tuple<Ts...>>::value-1>{} );
   }

   template<typename Tuple, size_t...I>
   auto get_tuple_args_h( Tuple t, std::index_sequence<I...> ) {
      return std::make_tuple( args_as_tuple( std::get<I>(t) )... );
   }

   template<typename...MPtrs>
   auto get_tuple_args( std::tuple<MPtrs...> t ) {
      return get_tuple_args_h( t, 
          std::make_index_sequence<std::tuple_size<std::tuple<MPtrs...>>::value>{} );
   }

   template<typename... Ts>
   std::variant<Ts...> tuple_to_variant( std::tuple<Ts...> );


   template<int i, typename T, typename S>
   void tuple_foreach_i( T&& t, S&& f) {
      if constexpr( i < std::tuple_size_v<std::decay_t<T>> ) {
         f( std::get<i>(t) );
         tuple_foreach_i<i+1>(t, std::forward<S>(f) );
      }
   }

   template<typename ... Ts, typename S>
   void tuple_foreach( const std::tuple<Ts...>& obj, S&& s ) {
      tuple_foreach_i<0>( obj, std::forward<S>(s) );
   }
   template<typename ... Ts, typename S>
   void tuple_foreach( std::tuple<Ts...>& obj, S&& s ) {
      tuple_foreach_i<0>( obj, std::forward<S>(s) );
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
   constexpr C class_of_member(R(C::*)(Args...));
   template <typename R, typename C, typename... Args>
   constexpr C class_of_member(R(C::*)(Args...)const);

   template <typename R, typename C, typename... Args>
   void result_of_member(R (C::*)(Args...) const);
   template <typename R, typename C, typename... Args>
   void result_of_member(R (C::*)(Args...));

   struct meta
   {
      const char*                        name;
      uint64_t                           offset = 0;
      std::initializer_list<const char*> param_names;
      int32_t                            number;
   };

#define PSIO_REFLECT_ARGS_INTERNAL(r, OP, i, PARAM) BOOST_PP_COMMA_IF(i) BOOST_PP_STRINGIZE(PARAM)

#define PSIO_REFLECT_ARGS_HELPER(METHOD, PARAM_NAMES) \
   BOOST_PP_SEQ_FOR_EACH_I(PSIO_REFLECT_ARGS_INTERNAL, METHOD, PARAM_NAMES)

#define PSIO_REFLECT_FILTER_PARAMS(NAME, IDX, ...)                            \
   {                                                                          \
      PSIO_REFLECT_ARGS_HELPER(METHOD, BOOST_PP_VARIADIC_TO_SEQ(__VA_ARGS__)) \
   }
#define PSIO_REFLECT_FILTER_NAME(NAME, IDX, ...) NAME
#define PSIO_REFLECT_FILTER_NAME_STR(NAME, IDX, ...) BOOST_PP_STRINGIZE(NAME)
#define PSIO_REFLECT_FILTER_IDX(NAME, IDX, ...) IDX

#define PSIO_REFLECT_FOREACH_PB_INTERNAL(r, OP, member)                     \
      lambda(psio::meta{.name        = PSIO_REFLECT_FILTER_NAME_STR member, \
                        .param_names = PSIO_REFLECT_FILTER_PARAMS member,  \
                        .number      = PSIO_REFLECT_FILTER_IDX    member},   \
             &OP::PSIO_REFLECT_FILTER_NAME member);                         \

#define PSIO_REFLECT_FOREACH_PTR_INTERNAL(r, OP, member)                     \
      &OP::PSIO_REFLECT_FILTER_NAME member,                                  \


#define PSIO_REFLECT_FOREACH_INTERNAL(r, OP, i, member)                                            \
   {                                                                                               \
      auto off = __builtin_offsetof(OP, member);                                                   \
      (void)lambda(psio::meta{.name = BOOST_PP_STRINGIZE(member), .offset = off, .number = i + 1},  \
                              &OP::member);                                                        \
   }

#define PSIO_REFLECT_MEMBER_BY_STR_INTERNAL(r, OP, member) \
   if (BOOST_PP_STRINGIZE(member) == m)                    \
   {                                                       \
      (void)lambda(&OP::member);                           \
      return true;                                         \
   }

#define PSIO_REFLECT_MEMBER_BY_STR_PB_INTERNAL(r, OP, member) \
   if (PSIO_REFLECT_FILTER_NAME_STR member == m)              \
   {                                                          \
      (void)lambda(&OP::PSIO_REFLECT_FILTER_NAME member);     \
      return true;                                            \
   }

#define PSIO_REFLECT_MEMBER_BY_IDX_PB_INTERNAL(r, OP, member) \
   case PSIO_REFLECT_FILTER_IDX member:                       \
      (void)lambda(&OP::PSIO_REFLECT_FILTER_NAME member);     \
      return true;

#define PSIO_REFLECT_PROXY_MEMBER_BY_IDX_INTERNAL(r, OP, I, member)                                \
   template <typename... Args>                                                                     \
   auto member(Args&&... args)                                                                     \
   {                                                                                               \
      return _psio_proxy_obj.call(psio::meta{.number = I + 1, .name = BOOST_PP_STRINGIZE(member)}, \
                                             &OP::member,                                          \
                                             std::forward<Args>(args)...);                         \
   }


#define PSIO_REFLECT_SMPROXY_MEMBER_BY_IDX_INTERNAL(r, OP, I, member)                           \
   psio::member_proxy<I, psio::hash_name(BOOST_PP_STRINGIZE(member)), &OP::member, ProxyObject> \
                       member()                                                                  \
   {                                                                                             \
      return _psio_proxy_obj;                                                                    \
   }                                                                                             \
   psio::member_proxy<                                                                          \
       I, psio::hash_name(BOOST_PP_STRINGIZE(member)), &OP::member, const ProxyObject> member()  \
           const                                                                                 \
   {                                                                                             \
      return _psio_proxy_obj;                                                                    \
   }


#define PSIO_REFLECT_PB_PROXY_MEMBER_BY_IDX_INTERNAL(r, OP, I, member)                           \
   template <typename... Args>                                                                     \
   auto PSIO_REFLECT_FILTER_NAME member( Args... args ) \
   {                                                                                             \
      psio::member_proxy<I, psio::hash_name(PSIO_REFLECT_FILTER_NAME_STR member),                         \
                        &OP:: PSIO_REFLECT_FILTER_NAME member, ProxyObject>    m(_psio_proxy_obj);                         \
      return m.call( std::forward<decltype(args)>(args)... );                                    \
   }                                                                                             \



#define PSIO_REFLECT_SMPROXY_MEMBER_BY_IDX_HELPER(QUERY_CLASS, MEMBER_IDXS) \
   BOOST_PP_SEQ_FOR_EACH_I(PSIO_REFLECT_SMPROXY_MEMBER_BY_IDX_INTERNAL, QUERY_CLASS, MEMBER_IDXS)


#define PSIO_REFLECT_PB_PROXY_MEMBER_BY_IDX_HELPER(QUERY_CLASS, MEMBER_IDXS) \
   BOOST_PP_SEQ_FOR_EACH_I(PSIO_REFLECT_PB_PROXY_MEMBER_BY_IDX_INTERNAL, QUERY_CLASS, MEMBER_IDXS)


#define PSIO_REFLECT_PROXY_MEMBER_BY_PB_INTERNAL(r, OP, member)                                  \
   template <typename... Args>                                                                   \
   auto PSIO_REFLECT_FILTER_NAME member(Args&&... args)                                          \
   {                                                                                             \
      return _psio_proxy_obj.call(psio::meta{.number = PSIO_REFLECT_FILTER_IDX         member,   \
                                             .name   = PSIO_REFLECT_FILTER_NAME_STR      member, \
                                             .param_names = PSIO_REFLECT_FILTER_PARAMS member},  \
                                  &OP::PSIO_REFLECT_FILTER_NAME member,                          \
                                  std::forward<Args>(args)...);                                  \
   }

#define PSIO_REFLECT_FOREACH_MEMBER_HELPER(QUERY_CLASS, MEMBERS) \
   BOOST_PP_SEQ_FOR_EACH_I(PSIO_REFLECT_FOREACH_INTERNAL, QUERY_CLASS, MEMBERS)

#define PSIO_REFLECT_MEMBER_BY_STR_HELPER(QUERY_CLASS, MEMBERS) \
   BOOST_PP_SEQ_FOR_EACH(PSIO_REFLECT_MEMBER_BY_STR_INTERNAL, QUERY_CLASS, MEMBERS)

#define PSIO_REFLECT_MEMBER_BY_IDX_I_INTERNAL(r, OP, I, member) \
   case I + 1:                                                  \
      (void)lambda(&OP::member);                                \
      return true;

#define PSIO_REFLECT_MEMBER_BY_IDX_HELPER(QUERY_CLASS, MEMBER_IDXS) \
   BOOST_PP_SEQ_FOR_EACH_I(PSIO_REFLECT_MEMBER_BY_IDX_I_INTERNAL, QUERY_CLASS, MEMBER_IDXS)

#define PSIO_REFLECT_MEMBER_BY_NAME_I_INTERNAL(r, OP, I, member) \
   case psio::hash_name(BOOST_PP_STRINGIZE(member)):             \
      (void)lambda(&OP::member);                                 \
      return true;

#define PSIO_REFLECT_MEMBER_BY_NAME_HELPER(QUERY_CLASS, MEMBER_NAMES) \
   BOOST_PP_SEQ_FOR_EACH_I(PSIO_REFLECT_MEMBER_BY_NAME_I_INTERNAL, QUERY_CLASS, MEMBER_NAMES)

#define PSIO_REFLECT_MEMBER_TYPE_BY_IDX_INTERNAL(r, OP, I, member) \
   BOOST_PP_COMMA_IF(I) std::decay_t<decltype(psio::result_of_member(&OP::member))>

#define PSIO_REFLECT_MEMBER_TYPE_IDX_HELPER(QUERY_CLASS, MEMBER_IDXS) \
   BOOST_PP_SEQ_FOR_EACH_I(PSIO_REFLECT_MEMBER_TYPE_BY_IDX_INTERNAL, QUERY_CLASS, MEMBER_IDXS)

#define PSIO_REFLECT_FOREACH_MEMBER_PB_HELPER(QUERY_CLASS, MEMBERS) \
   BOOST_PP_SEQ_FOR_EACH(PSIO_REFLECT_FOREACH_PB_INTERNAL, QUERY_CLASS, MEMBERS)


#define PSIO_REFLECT_FOREACH_MEMBER_PTR_HELPER(QUERY_CLASS, MEMBERS) \
   BOOST_PP_SEQ_FOR_EACH(PSIO_REFLECT_FOREACH_PTR_INTERNAL, QUERY_CLASS, MEMBERS)

#define PSIO_REFLECT_MEMBER_INDEX_HELPER(QUERY_CLASS, MEMBER_IDXS) \
   BOOST_PP_SEQ_FOR_EACH_I(PSIO_REFLECT_MEMBER_PB_INTERNAL, QUERY_CLASS, MEMBER_IDXS)

#define PSIO_REFLECT_MEMBER_BY_STR_PB_HELPER(QUERY_CLASS, MEMBER_IDXS) \
   BOOST_PP_SEQ_FOR_EACH(PSIO_REFLECT_MEMBER_BY_STR_PB_INTERNAL, QUERY_CLASS, MEMBER_IDXS)

#define PSIO_REFLECT_MEMBER_BY_IDX_PB_HELPER(QUERY_CLASS, MEMBER_IDXS) \
   BOOST_PP_SEQ_FOR_EACH(PSIO_REFLECT_MEMBER_BY_IDX_PB_INTERNAL, QUERY_CLASS, MEMBER_IDXS)

#define PSIO_REFLECT_PROXY_MEMBER_BY_IDX_HELPER(QUERY_CLASS, MEMBER_IDXS) \
   BOOST_PP_SEQ_FOR_EACH_I(PSIO_REFLECT_PROXY_MEMBER_BY_IDX_INTERNAL, QUERY_CLASS, MEMBER_IDXS)

#define PSIO_REFLECT_PROXY_MEMBER_BY_PB_HELPER(QUERY_CLASS, MEMBER_IDXS) \
   BOOST_PP_SEQ_FOR_EACH(PSIO_REFLECT_PROXY_MEMBER_BY_PB_INTERNAL, QUERY_CLASS, MEMBER_IDXS)

#define PSIO_REFLECT_PARAMS_BY_IDX_PB_INTERNAL(r, OP, i, member)      \
   if constexpr (std::is_member_function_pointer_v<                   \
                     decltype(&OP::PSIO_REFLECT_FILTER_NAME member)>) \
      return OP::BOOST_PP_CAT(PSIO_REFLECT_FILTER_NAME member, ___PARAM_NAMES);

#define PSIO_REFLECT_PARAMS_BY_IDX_PB_HELPER(QUERY_CLASS, MEMBER_IDXS) \
   BOOST_PP_SEQ_FOR_EACH_I(PSIO_REFLECT_PARAMS_BY_IDX_PB_INTERNAL, QUERY_CLASS, MEMBER_IDXS)

   /*
       template<typename ProxyObject> \
       struct proxy { \
            template<typename... Args> \
            explicit proxy( Args&&... args ):_psio_proxy_obj( std::forward<Args>(args)... ){}\
            ProxyObject* operator->(){ return &_psio_proxy_obj; } \
            const ProxyObject* operator->()const{ return &_psio_proxy_obj; } \
            ProxyObject& operator*(){ return _psio_proxy_obj; } \
            const ProxyObject& operator*()const{ return _psio_proxy_obj; } \
            PSIO_REFLECT_PROXY_MEMBER_BY_IDX_HELPER(QUERY_CLASS, BOOST_PP_VARIADIC_TO_SEQ(__VA_ARGS__)) \
           private: \
             ProxyObject _psio_proxy_obj; \
       }; \
       */

#define PSIO_REFLECT(QUERY_CLASS, ...)                                                             \
   PSIO_REFLECT_TYPENAME(QUERY_CLASS)                                                              \
   struct reflect_impl_##QUERY_CLASS                                                               \
   {                                                                                               \
      static constexpr bool               is_defined = true;                                       \
      static constexpr bool               is_struct  = true;                                       \
      static inline constexpr const char* name() { return BOOST_PP_STRINGIZE(QUERY_CLASS); }       \
      typedef std::tuple<                                                                          \
          PSIO_REFLECT_MEMBER_TYPE_IDX_HELPER(QUERY_CLASS, BOOST_PP_VARIADIC_TO_SEQ(__VA_ARGS__))> \
          struct_tuple_type;                                                                       \
      template <typename L>                                                                        \
      constexpr inline static void for_each(L&& lambda)                                            \
      {                                                                                            \
         PSIO_REFLECT_FOREACH_MEMBER_HELPER(QUERY_CLASS, BOOST_PP_VARIADIC_TO_SEQ(__VA_ARGS__))    \
      }                                                                                            \
      template <typename L>                                                                        \
      inline static bool get(const std::string_view& m, L&& lambda)                                \
      {                                                                                            \
         PSIO_REFLECT_MEMBER_BY_STR_HELPER(QUERY_CLASS, BOOST_PP_VARIADIC_TO_SEQ(__VA_ARGS__))     \
         return false;                                                                             \
      }                                                                                            \
      template <typename L>                                                                        \
      inline static bool get(int64_t m, L&& lambda)                                                \
      {                                                                                            \
         switch (m)                                                                                \
         {                                                                                         \
            PSIO_REFLECT_MEMBER_BY_IDX_HELPER(QUERY_CLASS, BOOST_PP_VARIADIC_TO_SEQ(__VA_ARGS__))  \
         }                                                                                         \
         return false;                                                                             \
      }                                                                                            \
      template <typename L>                                                                        \
      inline static bool get_by_name(uint64_t n, L&& lambda)                                       \
      {                                                                                            \
         switch (n)                                                                                \
         {                                                                                         \
            PSIO_REFLECT_MEMBER_BY_NAME_HELPER(QUERY_CLASS, BOOST_PP_VARIADIC_TO_SEQ(__VA_ARGS__)) \
         }                                                                                         \
         return false;                                                                             \
      }                                                                                            \
      template <typename ProxyObject>                                                              \
      struct proxy                                                                                 \
      {                                                                                            \
        private:                                                                                   \
         ProxyObject _psio_proxy_obj;                                                              \
                                                                                                   \
        public:                                                                                    \
         template <typename... Args>                                                               \
         explicit proxy(Args&&... args) : _psio_proxy_obj(std::forward<Args>(args)...)                      \
         {                                                                                         \
         }                                                                                         \
         ProxyObject*       operator->() { return &_psio_proxy_obj; }                              \
         const ProxyObject* operator->() const { return &_psio_proxy_obj; }                        \
         ProxyObject&       operator*() { return _psio_proxy_obj; }                                \
         const ProxyObject& operator*() const { return _psio_proxy_obj; }                          \
         PSIO_REFLECT_SMPROXY_MEMBER_BY_IDX_HELPER(QUERY_CLASS,                                    \
                                                   BOOST_PP_VARIADIC_TO_SEQ(__VA_ARGS__))          \
      };                                                                                           \
   };                                                                                              \
   reflect_impl_##QUERY_CLASS get_reflect_impl(const QUERY_CLASS&);

#define PSIO_REFLECT_INTERFACE(QUERY_CLASS, ...)                                                          \
   PSIO_REFLECT_TYPENAME(QUERY_CLASS)                                                              \
   struct reflect_impl_##QUERY_CLASS                                                               \
   {                                                                                               \
      static constexpr bool               is_defined = true;                                       \
      static constexpr bool               is_struct  = true;                                       \
      static inline constexpr const char* name() { return BOOST_PP_STRINGIZE(QUERY_CLASS); }       \
      template <typename L>                                                                        \
      inline static void for_each(L&& lambda)                                                      \
      {                                                                                            \
         PSIO_REFLECT_FOREACH_MEMBER_PB_HELPER(QUERY_CLASS, BOOST_PP_VARIADIC_TO_SEQ(__VA_ARGS__)) \
      }                                                                                            \
      template <typename L>                                                                        \
      inline static bool get(const std::string_view& m, L&& lambda)                                \
      {                                                                                            \
         PSIO_REFLECT_MEMBER_BY_STR_PB_HELPER(QUERY_CLASS, BOOST_PP_VARIADIC_TO_SEQ(__VA_ARGS__))  \
         return false;                                                                             \
      }                                                                                            \
      template <typename L>                                                                        \
      inline static bool get(int64_t m, L&& lambda)                                                \
      {                                                                                            \
         switch (m)                                                                                \
         {                                                                                         \
            PSIO_REFLECT_MEMBER_BY_IDX_PB_HELPER(QUERY_CLASS,                                      \
                                                 BOOST_PP_VARIADIC_TO_SEQ(__VA_ARGS__))            \
         }                                                                                         \
         return false;                                                                             \
      }                                                                                            \
      static constexpr auto member_pointers() \
      { \
         return psio::prune_tuple( std::make_tuple( \
         PSIO_REFLECT_FOREACH_MEMBER_PTR_HELPER(QUERY_CLASS, BOOST_PP_VARIADIC_TO_SEQ(__VA_ARGS__)) \
          0));                                                                 \
      }\
  \
      template <typename ProxyObject>                                                              \
      struct proxy                                                                                 \
      {                                                                                            \
        private:                                                                                   \
         ProxyObject _psio_proxy_obj;                                                              \
                                                                                                   \
        public:                                                                                    \
         template <typename... Args>                                                               \
         explicit proxy(Args&&... args) : _psio_proxy_obj(std::forward<Args>(args)...)              \
         {                                                                                         \
         }                                                                                         \
         ProxyObject*       operator->() { return &_psio_proxy_obj; }                              \
         const ProxyObject* operator->() const { return &_psio_proxy_obj; }                        \
         ProxyObject&       operator*() { return _psio_proxy_obj; }                                \
         const ProxyObject& operator*() const { return _psio_proxy_obj; }                          \
         PSIO_REFLECT_PB_PROXY_MEMBER_BY_IDX_HELPER(QUERY_CLASS,                                    \
                                                   BOOST_PP_VARIADIC_TO_SEQ(__VA_ARGS__))          \
      };                                                                                           \
   };                                                                                              \
   reflect_impl_##QUERY_CLASS get_reflect_impl(const QUERY_CLASS&);

#define PSIO_REFLECT_TEMPLATE_OBJECT(QUERY_CLASS, TPARAM, ...)                                     \
   template <typename T>                                                                           \
   struct reflect_impl_##QUERY_CLASS                                                               \
   {                                                                                               \
      static constexpr bool     is_defined = true;                                                 \
      static constexpr bool     is_struct  = true;                                                 \
      static inline const char* name()                                                             \
      {                                                                                            \
         return BOOST_PP_STRINGIZE(QUERY_CLASS) "<" BOOST_PP_STRINGIZE(TPARAM) ">";                \
      }                                                                                            \
      template <typename L>                                                                        \
      inline static void for_each(L&& lambda)                                                      \
      {                                                                                            \
         PSIO_REFLECT_FOREACH_MEMBER_HELPER(QUERY_CLASS<T>, BOOST_PP_VARIADIC_TO_SEQ(__VA_ARGS__)) \
      }                                                                                            \
      template <typename L>                                                                        \
      inline static void get(const std::string_view& m, L&& lambda)                                \
      {                                                                                            \
         PSIO_REFLECT_MEMBER_HELPER(QUERY_CLASS<T>, BOOST_PP_VARIADIC_TO_SEQ(__VA_ARGS__))         \
         return false;                                                                             \
      }                                                                                            \
      template <typename L>                                                                        \
      inline static void get(int64_t m, L&& lambda)                                                \
      {                                                                                            \
         switch (m)                                                                                \
         {                                                                                         \
            PSIO_REFLECT_MEMBER_INDEX_HELPER(QUERY_CLASS, BOOST_PP_VARIADIC_TO_SEQ(__VA_ARGS__))   \
         }                                                                                         \
         return false;                                                                             \
      }                                                                                            \
      using tuple_type =                                                                           \
          std::tuple<PSIO_REFLECT_MEMBER_TYPE_HELPER(QUERY_CLASS,                                  \
                                                     BOOST_PP_VARIADIC_TO_SEQ(__VA_ARGS__))>       \
   };                                                                                              \
   template <typename T>                                                                           \
   reflect_impl_##QUERY_CLASS<T> get_reflect_impl(const QUERY_CLASS<T>&);                          \
   constexpr const char*         get_type_name(QUERY_CLASS<T>*)                                    \
   {                                                                                               \
      return reflect_impl_##QUERY_CLASS ::name();                                                  \
   }

   template <typename QueryClass>
   struct reflect_undefined
   {
      static constexpr bool is_defined = false;
      static constexpr bool is_struct  = false;
      template <typename L>
      static void get(const std::string_view& m, L&& lambda);
   };


   template <typename QueryClass>
   reflect_undefined<QueryClass> get_reflect_impl(const QueryClass&);

   template <typename QueryClass>
   using reflect = std::decay_t<decltype(get_reflect_impl(std::declval<QueryClass>()))>;

   template <typename>
   struct is_std_vector : std::false_type
   {
   };

   template <typename T, typename A>
   struct is_std_vector<std::vector<T, A>> : std::true_type
   {
      using value_type = T;
   };

   template <typename>
   struct is_std_optional : std::false_type
   {
   };

   template <typename T>
   struct is_std_optional<std::optional<T>> : std::true_type
   {
      using value_type = T;
   };

   template<typename>
   struct is_std_array : std::false_type{};

   template<typename T,std::size_t N>
   struct is_std_array<std::array<T,N>> : std::true_type{
      using value_type = T;
      constexpr static const std::size_t size = N;
   };

   template<typename T>
   constexpr bool is_array() { return is_std_array<T>::value; }

   template <typename>
   struct is_std_variant : std::false_type
   {
   };


   template <typename... T>
   struct is_std_variant<std::variant<T...>> : std::true_type
   {
      static std::string name() { return get_variant_typename<T...>(); }
      template <typename First, typename... Rest>
      static std::string get_variant_typename()
      {
         if constexpr (sizeof...(Rest) > 0)
            return std::string(get_type_name<First>()) + "|" + get_variant_typename<Rest...>();
         else
            return std::string(get_type_name<First>()) + "|";
      }
      using alts_as_tuple = std::tuple<T...>;
      constexpr static const uint16_t num_types = sizeof...(T);
   };

   template <typename>
   struct is_std_tuple : std::false_type
   {
   };

   template <typename... T>
   struct is_std_tuple<std::tuple<T...>> : std::true_type
   {
      static std::string name() { return get_tuple_typename<T...>(); }
      template <typename First, typename... Rest>
      static std::string get_tuple_typename()
      {
         if constexpr (sizeof...(Rest) > 0)
            return std::string(get_type_name<First>()) + "&" + get_tuple_typename<Rest...>();
         else
            return std::string(get_type_name<First>()) + "&";
      }
   };

   template <typename>
   struct is_std_map : std::false_type
   {
   };

   template <typename K, typename V>
   struct is_std_map<std::map<K, V>> : std::true_type
   {
      static const std::string& name()
      {
         static std::string n =
             std::string("map<") + get_type_name<K>() + "," + get_type_name<V>() + ">";
         return n;
      }
   };

}  // namespace psio

namespace std
{
   namespace
   {
      PSIO_REFLECT_TYPENAME(string)
   }
}  // namespace std
