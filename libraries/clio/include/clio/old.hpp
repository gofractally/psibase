
/** 
     *  Recursively checks the types for any field which requires dynamic allocation,
     */
template <typename T>
constexpr bool contains_offset_ptr()
{
   if constexpr (is_std_optional<T>::value)
   {
      return true;
   }
   else if constexpr (is_std_tuple<T>::value)
   {
      return tuple_contains_offset<T>::value;
   }
   else if constexpr (is_std_variant<T>::value)
   {
      /// TODO: if any ALT is bigger than 8 bytes then it will contain
      /// an offset... this as written doesn't work if a simple struct
      /// is included as one of the alts
      return contains_offset_ptr<typename is_std_variant<T>::alts_as_tuple>();
   }
   else if constexpr (std::is_same_v<std::string, T>)
   {
      return true;
   }
   else if constexpr (is_std_vector<T>::value)
   {
      return true;
   }
   else if constexpr (clio::reflect<T>::is_struct)
   {
      bool is_flat = true;
      clio::reflect<T>::for_each(
          [&](const clio::meta& ref, auto mptr)
          {
             using member_type = std::decay_t<decltype(clio::result_of_member(mptr))>;
             is_flat &= not contains_offset_ptr<member_type>();
          });
      return not is_flat;
   }
   else if constexpr (std::is_arithmetic_v<T>)
   {
      return false;
   }
   else if constexpr (std::is_trivially_copyable<T>::value)
   {
      /// TODO: this should be "is_simple_struct" where simple struct
      /// is defined as aligned(1) with no padding and no members which
      /// are not also fundamental types or simple structs
      return false;
   }
   else
   {
      T::contains_offset_ptr_not_defined;
   }
}

template <typename... Ts>
struct tuple_contains_offset<std::tuple<Ts...> >
{
   static constexpr const auto value = get_contains_offset_ptr<Ts...>();
};
