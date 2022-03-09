#pragma once
#include <clio/error.hpp>
#include <clio/name.hpp>
#include <clio/stream.hpp>
#include <clio/unaligned_type.hpp>

namespace clio
{

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

   template <typename T>
   constexpr uint16_t fracpack_fixed_size();

   /**
     *  A struct can be packed using memcpy if the following properties are true:
     *    0. it is an arithmetic type
     *    1. sizeof(T) == ∑sizeof(members)
     *    2. alignement_of(T) == 1
     *    3. the order of reflected fields, matches memory layout
     *    4. all members meet the can_memcpy requirement
     *    5. the struct is final
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
         if constexpr (clio::reflect<T>::is_struct)
         {
            if (not std::is_final_v<T>)
               return false;

            bool     is_flat  = true;
            uint64_t last_pos = 0;
            clio::reflect<T>::for_each(
                [&](const clio::meta& ref, auto mptr)
                {
                   using member_type = std::decay_t<decltype(clio::result_of_member(mptr))>;
                   is_flat &= ref.offset == last_pos;
                   is_flat &= can_memcpy<member_type>();
                   last_pos += sizeof(member_type);
                });
            return (is_flat) and (last_pos == sizeof(T));
         }
         else
            return false;
      }
      else
         return false;
   }

   /**
     *  The number of fields on the struct cannot be extended because
     *  the struct is final and all members are either heap allocated 
     *  or final.
     */
   template <typename T>
   constexpr bool is_fixed_structure()
   {
      if constexpr (is_std_optional<T>::value)
         return true;
      else if constexpr (is_std_variant<T>::value)
         return false;
      else if constexpr (can_memcpy<T>())
         return true;
      else if constexpr (std::is_same_v<std::string, T>)
         return true;
      else if constexpr (is_std_vector<T>::value)
         return true;
      else if constexpr (clio::reflect<T>::is_struct)
      {
         if (not std::is_final_v<T>)
            return false;
         bool is_fixed = true;
         clio::reflect<T>::for_each(
             [&](const clio::meta& ref, auto mptr)
             {
                using member_type = std::decay_t<decltype(clio::result_of_member(mptr))>;
                is_fixed &= is_fixed_structure<member_type>();
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
      if constexpr (is_std_optional<T>::value)
         return true;
      if constexpr (is_std_variant<T>::value)
         return true;
      if constexpr (std::is_arithmetic_v<T>)
         return false;
      if constexpr (not std::is_final_v<T>)
         return true;
      else if constexpr (can_memcpy<T>())
         return false;
      else if constexpr (std::is_same_v<std::string, T>)
         return true;
      else if constexpr (is_std_vector<T>::value)
         return true;
      else if constexpr (clio::reflect<T>::is_struct)
      {
         bool is_flat = true;
         clio::reflect<T>::for_each(
             [&](const clio::meta& ref, auto mptr)
             {
                using member_type = std::decay_t<decltype(clio::result_of_member(mptr))>;
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
   constexpr uint16_t fracpack_fixed_size()
   {
      if constexpr (can_memcpy<T>())
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
             [&](const meta& ref, const auto& mptr)
             {
                using member_type = decltype(result_of_member(mptr));
                if constexpr (may_use_heap<member_type>())
                {
                   size += sizeof(offset_ptr);
                }
                else
                {
                   size += fracpack_fixed_size<member_type>();
                }
             });
         return size;
      }
   }

   template <typename T>
   uint32_t fracpack_size(const T& v);

   /**
     *  used to pack a member of a struct or vector
     */
   template <typename T, typename S>
   void fracpack_member(uint16_t& start_heap, const T& member, S& stream)
   {
      if constexpr (may_use_heap<T>())
      {
         // define a helper function so that it can be reused in the
         // case that T is an optional
         auto pack_on_heap = [&](const auto& mem)
         {
            if constexpr (std::is_same_v<size_stream, S>)
            {
               stream.skip(sizeof(uint32_t));  /// skip offset
               auto heapsize = fracpack_size(mem);
               start_heap += heapsize;
            }
            else
            {
               uint32_t offset = start_heap - stream.consumed();
               stream.write(&offset, sizeof(offset));
               fixed_buf_stream substream(stream.pos + offset - sizeof(offset),
                                          stream.end - stream.pos);

               auto ps = fracpack(mem, substream);
               start_heap += ps;
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
                  fracpack_member(start_heap, *member, stream);
                  return;
               }
               else
               {
                  pack_on_heap(*member);
               }
            }
            return;
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

   /**
     *  Writes v to a stream...without a size prefix
     */
   template <typename T, typename S>
   uint32_t fracpack(const T& v, S& stream)
   {
      if constexpr (is_std_variant<T>::value)
      {
         uint8_t idx = v.index();
         stream.write(&idx, sizeof(idx));
         uint32_t msize = 1;
         std::visit([&](const auto& iv) { msize += fracpack(iv, stream); }, v);
         return msize;
      }
      else if constexpr (is_std_optional<T>::value)
      {
         if (not v)
         {
            uint32_t tomb = 1;
            stream.write(&tomb, sizeof(tomb));
         }
         else
         {
            uint32_t heap = 4;
            stream.write(&heap, sizeof(heap));
            fracpack(*v, stream);
         }
      }
      else if constexpr (can_memcpy<T>())
      {
         stream.write(&v, sizeof(T));
         return sizeof(T);
      }
      else if constexpr (std::is_same_v<std::string, T>)
      {
         uint32_t s = v.size();
         stream.write(&s, sizeof(s));
         if (s > 0)
            stream.write(v.data(), s);
         return s + sizeof(s);
      }
      else if constexpr (is_std_vector<T>::value)
      {
         using value_type = typename is_std_vector<T>::value_type;

         if constexpr (can_memcpy<value_type>())
         {
            uint16_t fix_size = fracpack_fixed_size<value_type>();
            uint32_t s        = v.size() * fix_size;

            stream.write(&s, sizeof(s));
            if (s > 0)
               stream.write(v.data(), s);
            return s + sizeof(s);
         }
         else
         {
            uint32_t s = v.size() * sizeof(offset_ptr);
            stream.write(&s, sizeof(s));
            uint16_t start_heap = s + 4;  // why 4... it is needed
            for (const auto& item : v)
            {
               fracpack_member(start_heap, item, stream);
            }
            return start_heap;
         }
      }
      else if constexpr (clio::reflect<T>::is_struct)
      {
         uint16_t start_heap = fracpack_fixed_size<T>();
         if constexpr (is_ext_structure<T>())
         {
            stream.write(&start_heap, sizeof(start_heap));
            start_heap += sizeof(start_heap);
         }
         /// no need to write start_heap, it is always the same because
         /// the structure is "fixed" and cannot be extended in the future
         reflect<T>::for_each(
             [&](const meta& ref, const auto& mptr)
             {
                //using member_type = decltype(result_of_member(mptr));
                //              std::cout << "member: " << ref.name << " may use heap: " << may_use_heap<member_type>() <<"\n";
                fracpack_member(start_heap, v.*mptr, stream);
             });
         //         std::cout <<"return start_heap: " << start_heap <<"\n";
         return start_heap;  /// it has been advanced and now points at end of heap
      }
      else
      {
         T::fracpack_not_defined;
      }
      return 0;
   }

   template <typename T, typename S>
   void fracunpack(T& v, S& stream);
   template <typename T, typename S>
   void fraccheck(S& stream);

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
         else if constexpr (is_std_vector<T>::value || std::is_same_v<T, std::string>)
         {
            uint32_t offset;
            stream.read(&offset, sizeof(offset));
            if (offset >= 4)
            {
               input_stream insubstream(stream.pos + offset - sizeof(offset_ptr), stream.end);
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

   template <typename V, typename First, typename... Rest>
   bool init_type(uint8_t i, V& v)
   {
      if (i == 0)
      {
         v = First();
         return true;
      }
      else if constexpr (sizeof...(Rest) > 0)
      {
         return init_type<V, Rest...>(i - 1, v);
      }
      return false;
   }
   template <typename First, typename... Rest>
   bool init_variant_by_index(uint8_t index, std::variant<First, Rest...>& v)
   {
      return init_type<std::variant<First, Rest...>, First, Rest...>(index, v);
   }

   template <typename T, typename S>
   void fracunpack(T& v, S& stream)
   {
      if constexpr (is_std_variant<T>::value)
      {
         uint8_t idx;
         stream.read(&idx, 1);
         init_variant_by_index(idx, v);
         std::visit([&](auto& iv) { fracunpack(iv, stream); }, v);
      }
      else if constexpr (can_memcpy<T>())
      {
         stream.read((char*)&v, sizeof(T));
      }
      else if constexpr (std::is_same_v<std::string, T>)
      {
         uint32_t size;
         stream.read((char*)&size, sizeof(size));
         v.resize(size);
         if (size > 0)
            stream.read(v.data(), size);
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
            uint32_t size;
            stream.read(&size, sizeof(size));
            auto elem = size / sizeof(offset_ptr);
            v.resize(elem);
            for (auto& e : v)
            {
               fracunpack_member(e, stream);
            }
         }
      }
      else if constexpr (reflect<T>::is_struct)
      {
         uint16_t start_heap = fracpack_fixed_size<T>();
         if constexpr (is_ext_structure<T>())
         {
            stream.read(&start_heap, sizeof(start_heap));
         }
         const char* heap = stream.pos + start_heap;
         reflect<T>::for_each(
             [&](const meta& ref, const auto& mptr)
             {
                if (stream.pos < heap)
                   fracunpack_member(v.*mptr, stream);
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

   template <typename T, typename S>
   void fraccheck(S& stream)
   {
      if constexpr (can_memcpy<T>())
      {
         stream.checkread(sizeof(T));
      }
      else if constexpr (std::is_same_v<std::string, T>)
      {
         uint32_t size;
         stream.read((char*)&size, sizeof(size));
         if (size > 0)
            stream.checkread(size);
      }
      else if constexpr (is_std_vector<T>::value)
      {
         using value_type = typename is_std_vector<T>::value_type;
         if constexpr (can_memcpy<value_type>())
         {
            uint32_t size;
            stream.read((char*)&size, sizeof(size));
            if (size > 0)
               stream.checkread(size);
         }
         else
         {
            uint32_t size;
            stream.read(&size, sizeof(size));
            auto elem = size / sizeof(offset_ptr);
            for (uint32_t i = 0; i < elem; ++i)
               fraccheck_member<value_type>(stream);
         }
      }
      else if constexpr (reflect<T>::is_struct)
      {
         uint16_t start_heap = fracpack_fixed_size<T>();
         if constexpr (is_ext_structure<T>())
         {
            stream.read(&start_heap, sizeof(start_heap));
         }
         const char* heap = stream.pos + start_heap;
         
         reflect<T>::for_each(
             [&](const meta& ref, const auto& mptr)
             {
                using member_type = std::decay_t<decltype(clio::result_of_member(mptr))>;
                if (stream.pos < heap)
                   fraccheck_member<member_type>(stream);
             });
      }
      else
      {
         T::fracunpack_not_defined;
      }
   }  // fraccheck

   /** 
     * returns the number of bytes that would be written
     * if fracpack(v) was called
     */
   template <typename T>
   uint32_t fracpack_size(const T& v)
   {
      size_stream size_str;
      return fracpack(v, size_str);
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

   template <typename View, typename Enable = void>
   struct view;

   template <typename T>
   struct view<T, std::enable_if_t<std::is_arithmetic_v<T>>>;

   template <>
   struct view<std::string>;

   template <typename... Ts>
   struct view<std::variant<Ts...>>;

   template <typename T>
   struct view<T, std::enable_if_t<reflect<T>::is_struct>>;

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

   struct frac_proxy_view2
   {
      frac_proxy_view2(char* c) : buffer(c) {}

      /** This method is called by the reflection library to get the field */
      template <uint32_t idx, uint64_t Name, auto MemberPtr>
      auto get()
      {
         using class_type  = decltype(clio::class_of_member(MemberPtr));
         using tuple_type  = typename clio::reflect<class_type>::struct_tuple_type;
         using member_type = decltype(clio::result_of_member(MemberPtr));

         constexpr uint32_t offset =
             clio::get_tuple_offset<idx, tuple_type>::value +
             2 * (clio::is_ext_structure<
                     class_type>());  // the 2 bytes that point to expected start of heap if it cannot be assumed

         char* out_ptr = buffer + offset;

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
            auto ptr = reinterpret_cast<clio::offset_ptr*>(out_ptr);
            if (ptr->offset < 4)
               return view_type(nullptr);
            return get_offset<opt_type>(out_ptr);  //view_type(ptr->get<opt_type>());
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

     private:
      char* buffer;
   };

   template <typename View, typename Enable>
   struct view
   {
      using View::not_defined;
   };

   template <typename T>
   struct view<T, std::enable_if_t<std::is_arithmetic_v<T>>>
   {
      view(char* p = nullptr) : pos(p) {}
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

     private:
      char* pos;
   };

   template <>
   struct view<std::string>
   {
      view(const char* p = nullptr) : pos(p) {}

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

     private:
      const char* pos;
   };

   template <typename T>
   struct view<std::vector<T>>
   {
      view(char* p = nullptr) : pos(p) {}

      uint32_t size() const
      {
         constexpr uint16_t fix_size = fracpack_fixed_size<T>();
         return *reinterpret_cast<const unaligned_type<uint32_t>*>(pos) / fix_size;
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

      bool valid() const { return pos != nullptr; }

      auto* operator->() { return this; }
      auto& operator*() { return *this; }

     private:
      char* pos;
   };

   template <typename T>
   struct view<T, std::enable_if_t<reflect<T>::is_struct>>
       : public reflect<T>::template proxy<clio::frac_proxy_view2>
   {
      using base = typename reflect<T>::template proxy<clio::frac_proxy_view2>;
      using base::base;

      auto* operator->() { return this; }
      auto& operator*() { return *this; }
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

      bool  valid() const { return pos != nullptr; }
      auto* operator->() { return this; }
      auto& operator*() { return *this; }

     private:
      char* pos;
      template <typename Visitor, typename First, typename... Rest>
      void _visit_variant(Visitor&& v)
      {
         if (sizeof...(Rest) + 1 + *pos == sizeof...(Ts))
         {
            v(view<First>(pos + 1));
         }
         else if constexpr (sizeof...(Rest) > 0)
         {
            _visit_variant<Visitor, Rest...>(std::forward<Visitor>(v));
         }
      }
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

         fixed_buf_stream out(_data.get() + sizeof(size), size);
         clio::fracpack(from, out);
      }

      shared_view_ptr(const char* data)
      {
         uint32_t size = 0;
         memcpy(&size, data, sizeof(size));

         _data = std::shared_ptr<char>(new char[size + sizeof(size)], [](char* c) { delete[] c; });
         memcpy(_data.get(), data, size + sizeof(size));
      }

      shared_view_ptr(){};
      operator bool() const { return _data != nullptr; }

      const auto operator->() const { return view<T>(data() + 4); }
      auto       operator->() { return view<T>(data() + 4); }

      const char* data() const { return _data.get(); }
      char*       data() { return _data.get(); }

      /** @return the number of bytes of packed data */
      size_t size() const
      {
         uint32_t s;
         memcpy(&s, _data.get(), sizeof(s));
         return s;
      }

      void reset(size_t s = 0) { _data.reset(); }

      operator T() const { return unpack(); }

      bool validate() const
      {
         clio::check_input_stream in(data() + 4, size());
         clio::fraccheck<T>(in);
         return in.total_read <= size();
      }

      T unpack() const
      {
         T            tmp;
         input_stream in(_data.get() + sizeof(uint32_t), size());
         clio::fracunpack(tmp, in);
         return tmp;
      }

     private:
      std::shared_ptr<char> _data;
   };

}  // namespace clio
