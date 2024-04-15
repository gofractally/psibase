#pragma once

#include <concepts>
#include <map>
#include <psio/fracpack.hpp>
#include <psio/to_json.hpp>
#include <psio/to_json/map.hpp>
#include <variant>

namespace psio
{
   template <typename T>
      requires Packable<std::remove_cv_t<T>>
   class shared_view_ptr;

   struct FracStream
   {
      FracStream(std::span<const char> buf) : src(buf.data())
      {
         check(buf.size() <= std::numeric_limits<std::uint32_t>::max(),
               "fracpack buffer too large");
         end_pos = static_cast<std::uint32_t>(buf.size());
      }
      const char*   src;
      std::uint32_t pos = 0;
      std::uint32_t end_pos;
      bool          has_unknown = false;
      bool          known_end   = true;
   };

   class StreamBase
   {
     public:
      void        write(const void* data, std::size_t size) { do_write(data, size); }
      void        write(char ch) { do_write(&ch, 1); }
      friend void increase_indent(StreamBase& self) { self.do_increase_indent(); }
      friend void decrease_indent(StreamBase& self) { self.do_decrease_indent(); }
      friend void write_colon(StreamBase& self) { self.do_write_colon(); }
      friend void write_newline(StreamBase& self) { self.do_write_newline(); }

     protected:
      virtual void do_write(const void* data, std::size_t size) = 0;
      virtual void do_increase_indent()                         = 0;
      virtual void do_decrease_indent()                         = 0;
      virtual void do_write_colon()                             = 0;
      virtual void do_write_newline()                           = 0;
      ~StreamBase()                                             = default;
   };

   template <typename T>
   class StreamRef : public StreamBase
   {
     public:
      StreamRef(T& stream) : stream(stream) {}

     protected:
      void do_write(const void* data, std::size_t size) override { stream.write(data, size); }
      void do_increase_indent() override { increase_indent(stream); }
      void do_decrease_indent() override { decrease_indent(stream); }
      void do_write_colon() override { write_colon(stream); }
      void do_write_newline() override { write_newline(stream); }

     private:
      T& stream;
   };

   namespace schema_types
   {

      struct AnyType;

      template <typename T>
      struct Box
      {
         Box() : value(new T()) {}
         template <std::convertible_to<T> U>
         Box(U&& value) : value(new T(std::forward<U>(value)))
         {
         }
         Box(T&& value) : value(new T(value)) {}
         Box(const Box& other) : value(new T(*other.value)) {}
         Box(Box&&)                          = default;
         Box&               operator=(Box&&) = default;
         T&                 operator*() { return *value; }
         const T&           operator*() const { return *value; }
         T*                 operator->() { return value.get(); }
         const T*           operator->() const { return value.get(); }
         T*                 get() { return value.get(); }
         const T*           get() const { return value.get(); }
         std::unique_ptr<T> value;
      };

      template <typename T, typename Stream>
      void to_json(const Box<T>& wrapper, Stream& stream)
      {
         to_json(*wrapper.value, stream);
      }

      template <typename T>
      T& clio_unwrap_packable(Box<T>& box)
      {
         return *box;
      }

      template <typename T>
      const T& clio_unwrap_packable(const Box<T>& box)
      {
         return *box;
      }

      struct Function;

      struct Schema
      {
         std::map<std::string, AnyType> types;
         //
         const AnyType* get(const std::string& name) const;
         void           insert(std::string name, AnyType type);
         //
         bool merge(const AnyType&, const Schema& other, const AnyType& otherType);
      };
      PSIO_REFLECT(Schema, types)

      struct Member;

      void to_json_members(const std::vector<Member>&, auto& stream);

      struct Object
      {
         std::vector<Member> members;
      };

      PSIO_REFLECT_TYPENAME(Object)

      void to_json(const Object& type, auto& stream)
      {
         to_json_members(type.members, stream);
      }

      inline auto& clio_unwrap_packable(Object& type)
      {
         return type.members;
      }

      inline auto& clio_unwrap_packable(const Object& type)
      {
         return type.members;
      }

      struct Struct
      {
         std::vector<Member> members;
      };
      PSIO_REFLECT_TYPENAME(Struct)

      void to_json(const Struct& type, auto& stream)
      {
         to_json_members(type.members, stream);
      }

      inline auto& clio_unwrap_packable(Struct& type)
      {
         return type.members;
      }

      inline auto& clio_unwrap_packable(const Struct& type)
      {
         return type.members;
      }

      struct Array
      {
         Box<AnyType>  type;
         std::uint64_t len;
      };
      PSIO_REFLECT(Array, type, len)

      struct List
      {
         Box<AnyType> type;
      };
      PSIO_REFLECT_TYPENAME(List)

      void to_json(const List& type, auto& stream)
      {
         to_json(*type.type, stream);
      }

      inline auto& clio_unwrap_packable(List& type)
      {
         return *type.type;
      }
      inline auto& clio_unwrap_packable(const List& type)
      {
         return *type.type;
      }

      struct Option
      {
         Box<AnyType> type;
      };
      PSIO_REFLECT_TYPENAME(Option)

      void to_json(const Option& type, auto& stream)
      {
         to_json(*type.type, stream);
      }

      inline auto& clio_unwrap_packable(Option& type)
      {
         return *type.type;
      }
      inline auto& clio_unwrap_packable(const Option& type)
      {
         return *type.type;
      }

      struct Custom
      {
         Box<AnyType> type;
         std::string  id;
      };
      PSIO_REFLECT(Custom, type, id)

      struct Int
      {
         std::uint32_t bits;
         bool          isSigned;
         friend bool   operator==(const Int&, const Int&) = default;
      };
      PSIO_REFLECT(Int, bits, isSigned)

      struct Float
      {
         std::uint32_t exp;
         std::uint32_t mantissa;
         friend bool   operator==(const Float&, const Float&) = default;
      };
      PSIO_REFLECT(Float, exp, mantissa)

      struct Variant
      {
         std::vector<Member> members;
      };
      PSIO_REFLECT_TYPENAME(Variant)

      void to_json(const Variant& type, auto& stream)
      {
         to_json_members(type.members, stream);
      }

      inline auto& clio_unwrap_packable(Variant& type)
      {
         return type.members;
      }

      inline auto& clio_unwrap_packable(const Variant& type)
      {
         return type.members;
      }

      struct Tuple
      {
         std::vector<AnyType> members;
      };
      PSIO_REFLECT_TYPENAME(Tuple)

      void to_json(const Tuple& type, auto& stream)
      {
         to_json(type.members, stream);
      }

      inline auto& clio_unwrap_packable(Tuple& type)
      {
         return type.members;
      }

      inline auto& clio_unwrap_packable(const Tuple& type)
      {
         return type.members;
      }

      struct FracPack
      {
         Box<AnyType> type;
      };
      PSIO_REFLECT_TYPENAME(FracPack)

      void to_json(const FracPack& type, auto& stream)
      {
         to_json(type.type, stream);
      }

      inline auto& clio_unwrap_packable(FracPack& type)
      {
         return *type.type;
      }
      inline auto& clio_unwrap_packable(const FracPack& type)
      {
         return *type.type;
      }

      struct Type
      {
         std::string type;
      };
      PSIO_REFLECT_TYPENAME(Type)

      void to_json(const Type& type, auto& stream)
      {
         to_json(type.type, stream);
      }

      inline auto& clio_unwrap_packable(Type& type)
      {
         return type.type;
      }
      inline auto& clio_unwrap_packable(const Type& type)
      {
         return type.type;
      }

      struct AnyType
      {
         AnyType();
         AnyType(Int type);
         AnyType(Float type);
         AnyType(Object type);
         AnyType(Struct type);
         AnyType(Option type);
         AnyType(List type);
         AnyType(Array type);
         AnyType(Variant type);
         AnyType(Tuple type);
         AnyType(FracPack type);
         AnyType(Custom type);
         AnyType(Type type);
         AnyType(std::string name);
         AnyType(const char* name);
         std::variant<Struct,
                      Object,
                      Array,
                      List,
                      Option,
                      Variant,
                      Tuple,
                      Int,
                      Float,
                      FracPack,
                      Custom,
                      Type>
                                value;
         mutable const AnyType* resolved = nullptr;
         const AnyType*         resolve(const Schema& schema) const;
      };
      PSIO_REFLECT_TYPENAME(AnyType)
      void to_json(const AnyType& type, auto& stream)
      {
         if (auto* alias = std::get_if<Type>(&type.value))
         {
            to_json(*alias, stream);
         }
         else
         {
            to_json(type.value, stream);
         }
      }

      inline auto& clio_unwrap_packable(AnyType& type)
      {
         return type.value;
      }
      template <std::same_as<AnyType> T>
      auto& clio_unwrap_packable(const T& type)
      {
         return type.value;
      }

      struct Function
      {
         AnyType params;
         AnyType result;
      };
      PSIO_REFLECT(Function, params, result)

      struct Member
      {
         std::string name;
         AnyType     type;
      };
      PSIO_REFLECT(Member, name, type)

      inline AnyType::AnyType() {}
      inline AnyType::AnyType(Int type) : value(std::move(type)) {}
      inline AnyType::AnyType(Float type) : value(std::move(type)) {}
      inline AnyType::AnyType(Object type) : value(std::move(type)) {}
      inline AnyType::AnyType(Struct type) : value(std::move(type)) {}
      inline AnyType::AnyType(Option type) : value(std::move(type)) {}
      inline AnyType::AnyType(List type) : value(std::move(type)) {}
      inline AnyType::AnyType(Array type) : value(std::move(type)) {}
      inline AnyType::AnyType(Variant type) : value(std::move(type)) {}
      inline AnyType::AnyType(Tuple type) : value(std::move(type)) {}
      inline AnyType::AnyType(FracPack type) : value(std::move(type)) {}
      inline AnyType::AnyType(Custom type) : value(std::move(type)) {}
      inline AnyType::AnyType(Type type) : value(std::move(type)) {}
      inline AnyType::AnyType(std::string name) : value(Type{std::move(name)}) {}
      inline AnyType::AnyType(const char* name) : value(Type{std::move(name)}) {}

      struct CommaList
      {
         bool first = true;
         void next(auto& stream)
         {
            if (first)
               increase_indent(stream);
            else
               stream.write(',');
            write_newline(stream);
            first = false;
         }
         void end(auto& stream)
         {
            if (!first)
            {
               decrease_indent(stream);
               write_newline(stream);
            }
         }
      };

      struct CompiledType;

      struct CustomHandler
      {
         template <typename T>
         CustomHandler(const T&) : match(&T::match), frac2json(&T::frac2json)
         {
         }
         bool (*match)(const CompiledType*);
         bool (*frac2json)(const CompiledType*, FracStream& in, StreamBase& out);
      };

      template <typename T>
      bool matchCustomType(const CompiledType*, T*);
      bool matchCustomType(const CompiledType* type, bool*);

      template <typename T>
      struct DefaultCustomHandler
      {
         static bool match(const CompiledType* type) { return matchCustomType(type, (T*)nullptr); }
         static bool frac2json(const CompiledType*, FracStream& in, auto& out)
         {
            T value;
            if (!is_packable<T>::template unpack<true, true>(&value, in.has_unknown, in.known_end,
                                                             in.src, in.pos, in.end_pos))
               return false;
            to_json(value, out);
            return true;
         }
      };

      class CustomTypes
      {
        public:
         template <typename T>
         void insert(std::string name)
         {
            insert(std::move(name), DefaultCustomHandler<T>());
         }
         void         insert(std::string name, const CustomHandler& t);
         std::size_t* find(const std::string& name);
         bool         match(std::size_t index, const CompiledType* type);
         bool         frac2json(const CompiledType* type,
                                std::size_t         index,
                                FracStream&         in,
                                auto&               out) const
         {
            StreamRef stream{out};
            return impl[index].frac2json(type, in, stream);
         }

        private:
         std::map<std::string, std::size_t> names;
         std::vector<CustomHandler>         impl;
      };

      struct CompiledMember
      {
         std::uint16_t       fixed_offset;
         bool                is_optional;  // indirect, 1 is empty
         const CompiledType* type;
      };

      struct CompiledType
      {
         enum Kind : std::uint8_t
         {
            scalar,
            struct_,
            object,
            container,
            array,
            variant,
            optional,
            nested,
            // Used only during initialization
            custom,
            uninitialized,
         };
         Kind                        kind             = uninitialized;
         bool                        is_variable_size = true;
         std::int16_t                custom_id        = -1;
         std::uint32_t               fixed_size       = 0;
         std::vector<CompiledMember> children;
         const AnyType*              original_type = nullptr;
         bool is_container() const { return kind == container || kind == nested; }
      };

      CustomTypes standard_types();

      struct CompiledSchema
      {
         CompiledSchema(const Schema& schema, CustomTypes builtin = standard_types());
         CompiledType*       get(const AnyType* type);
         const CompiledType* get(const AnyType* type) const;
         //
         const Schema&                          schema;
         CustomTypes                            builtin;
         std::map<const AnyType*, CompiledType> types;
      };

      struct ObjectReader;
      struct OptionReader;
      struct ArrayReader;
      struct VariantReader;
      struct NestedReader;

      struct FracParser
      {
         FracParser(std::span<const char> data,
                    const CompiledSchema& schema,
                    const std::string&    type,
                    bool                  enableCustom = true);
         FracParser(const FracStream&   in,
                    const CompiledType* type,
                    const CustomTypes&  builtin,
                    bool                enableCustom = true);
         ~FracParser();
         // returns a start token, an end token or a primitive
         enum ItemKind : std::uint16_t
         {
            error,
            start,
            end,
            scalar,
            empty,
            custom,
         };
         struct Item
         {
            ItemKind              kind;
            std::span<const char> data;
            const CompiledType*   type;
            const AnyType*        parent;
            std::uint32_t         index;
            explicit              operator bool() const { return type != nullptr; }
            Item                  next(FracParser&) { return *this; }
         };
         Item next();
         // Starts parsing the given type at the current pos
         Item parse(const CompiledType* ctype);
         void parse_fixed(Item& result, const CompiledType* ctype, std::uint32_t offset);
         Item push(const CompiledType* type, std::uint32_t offset, bool is_pointer = false);
         // \pre range must be valid
         void push_fixed(const CompiledType* type, std::uint32_t offset);
         //
         void                  read(const CompiledType* type, std::uint32_t offset, Item& result);
         std::span<const char> read_fixed(const CompiledType* type, std::uint32_t offset);

         void deref(std::uint32_t       fixed_pos,
                    std::uint32_t       end_fixed_pos,
                    const CompiledType* type,
                    bool                is_optional,
                    Item&               result);

         using StackItem = std::
             variant<Item, ObjectReader, OptionReader, ArrayReader, VariantReader, NestedReader>;
         FracStream             in;
         const CustomTypes&     builtin;
         std::vector<StackItem> stack;
         // If false, all Custom handling will be ignored
         bool enableCustom = true;
      };

      validation_t fracpack_validate(std::span<const char> data,
                                     const CompiledSchema& schema,
                                     const std::string&    type);

      struct OpenToken
      {
         char operator()(const Object&) const { return '{'; }
         char operator()(const Variant&) const { return '{'; }
         char operator()(const Struct&) const { return '{'; }
         char operator()(const FracPack&) const { return 0; };
         char operator()(const auto&) const { return '['; }
      };

      struct CloseToken
      {
         char operator()(const Object&) const { return '}'; }
         char operator()(const Variant&) const { return '}'; }
         char operator()(const Struct&) const { return '}'; }
         char operator()(const FracPack&) const { return 0; };
         char operator()(const auto&) const { return ']'; }
      };

      struct MemberName
      {
         const std::string* operator()(const Object& type) const
         {
            return &type.members[index].name;
         }
         const std::string* operator()(const Variant& type) const
         {
            return &type.members[index].name;
         }
         const std::string* operator()(const Struct& type) const
         {
            return &type.members[index].name;
         }
         const std::string* operator()(const auto&) const { return nullptr; }
         std::uint32_t      index;
      };

      template <typename Signed, typename Unsigned, typename Stream>
      void int2json(const Int& type, std::span<const char> in, Stream& out)
      {
         const char*   src     = in.data();
         std::uint32_t pos     = 0;
         std::uint32_t end_pos = static_cast<uint32_t>(in.size());
         if (type.isSigned)
         {
            Signed value;
            (void)unpack_numeric<false>(&value, src, pos, end_pos);
            to_json(value, out);
         }
         else
         {
            Unsigned value;
            (void)unpack_numeric<false>(&value, src, pos, end_pos);
            to_json(value, out);
         }
      }

      void scalar_to_json(const Int& type, std::span<const char> in, auto& out)
      {
         switch (type.bits)
         {
            case 1:
               if (type.isSigned)
               {
                  std::int8_t value = static_cast<std::int8_t>(in[0]);
                  if (value != 0 && value != -1)
                     check(false, "invalid i1");
                  to_json(value, out);
               }
               else
               {
                  std::int8_t value = static_cast<std::uint8_t>(in[0]);
                  if (value != 0 && value != 1)
                     check(false, "invalid u1");
                  to_json(value, out);
               }
               return;
            case 8:
               return int2json<std::int8_t, std::uint8_t>(type, in, out);
            case 16:
               return int2json<std::int16_t, std::uint16_t>(type, in, out);
            case 32:
               return int2json<std::int32_t, std::uint32_t>(type, in, out);
            case 64:
               return int2json<std::int64_t, std::uint64_t>(type, in, out);
            default:
               to_json("<<<Unsupported integer width>>>", out);
         }
      }

      void scalar_to_json(const Float& type, std::span<const char> in, auto& out)
      {
         const char*   src     = in.data();
         std::uint32_t pos     = 0;
         std::uint32_t end_pos = static_cast<uint32_t>(in.size());
         if (type == Float{.exp = 11, .mantissa = 53})
         {
            double value;
            (void)unpack_numeric<false>(&value, src, pos, end_pos);
            to_json(value, out);
         }
         else if (type == Float{.exp = 8, .mantissa = 24})
         {
            float value;
            (void)unpack_numeric<false>(&value, src, pos, end_pos);
            to_json(value, out);
         }
         else
         {
            to_json("<<<Only single and double precision floating point numbers are supported>>>",
                    out);
         }
      }

      void scalar_to_json(const auto&, std::span<const char> in, auto& stream) {}

      void to_json(FracParser& parser, auto& stream)
      {
         std::vector<CommaList> groups;
         auto                   start_member = [&](const auto& item)
         {
            if (!groups.empty())
            {
               groups.back().next(stream);
               if (auto* name = std::visit(MemberName{item.index}, item.parent->value))
               {
                  to_json(*name, stream);
                  write_colon(stream);
               }
            }
         };
         auto write_bracket = [&](const FracParser::Item& item, auto&& visitor)
         {
            if (char ch = std::visit(visitor, item.type->original_type->value))
               stream.write(ch);
         };
         while (auto item = parser.next())
         {
            switch (item.kind)
            {
               case FracParser::start:
                  start_member(item);
                  write_bracket(item, OpenToken{});
                  groups.emplace_back();
                  break;
               case FracParser::end:
                  groups.back().end(stream);
                  write_bracket(item, CloseToken{});
                  groups.pop_back();
                  break;
               case FracParser::scalar:
                  start_member(item);
                  std::visit([&](const auto& type) { scalar_to_json(type, item.data, stream); },
                             item.type->original_type->value);
                  break;
               case FracParser::empty:
                  // skip null members
                  //if (groups.empty() ||
                  //    std::visit(MemberName{item.index}, item.parent->value) == nullptr)
                  start_member(item);
                  {
                     stream.write("null", 4);
                  }
                  break;
               case FracParser::custom:
                  start_member(item);
                  if (item.data.empty())
                  {
                     if (!parser.builtin.frac2json(item.type, item.type->custom_id, parser.in,
                                                   stream))
                        check(false, "Failed to parse custom type");
                  }
                  else
                  {
                     FracStream tmpin{item.data};
                     if (!parser.builtin.frac2json(item.type, item.type->custom_id, tmpin, stream))
                        check(false, "Failed to parse custom type");
                  }
                  break;
               case FracParser::error:
                  check(false, std::string_view(item.data.data(), item.data.size()));
            }
         }
      }

      template <typename T>
      constexpr bool is_shared_view_ptr_v = false;
      template <typename T>
      constexpr bool is_shared_view_ptr_v<shared_view_ptr<T>> = true;

      template <typename T>
      constexpr bool is_duration_v = false;
      template <typename Rep, typename Period>
      constexpr bool is_duration_v<std::chrono::duration<Rep, Period>> = true;

      template <typename S, typename... T>
      std::vector<Member> insert_variant_alternatives(S& schema, std::variant<T...>*)
      {
         using psio::get_type_name;
         return {
             Member{.name = get_type_name((T*)nullptr), .type = schema.template insert<T>()}...};
      }

      template <typename T, typename S, std::size_t... I>
      std::vector<AnyType> insert_tuple_elements(S& schema, std::index_sequence<I...>)
      {
         return {schema.template insert<std::remove_cvref_t<std::tuple_element_t<I, T>>>()...};
      }

      constexpr std::uint32_t float_exp_bits(int max_exponent)
      {
         std::uint32_t result = 0;
         while (max_exponent > 0)
         {
            max_exponent /= 2;
            ++result;
         }
         return result;
      }

      template <typename T>
      char type_id;

      class SchemaBuilder
      {
        public:
         SchemaBuilder& expandNested(bool value = true) &
         {
            expandNested_ = value;
            return *this;
         }
         SchemaBuilder&& expandNested(bool value = true) &&
         {
            expandNested_ = value;
            return std::move(*this);
         }
         template <typename T>
         SchemaBuilder& insert(std::string name) &
         {
            schema.insert(std::move(name), insert<T>());
            return *this;
         }
         template <typename T>
         SchemaBuilder&& insert(std::string name) &&
         {
            schema.insert(std::move(name), insert<T>());
            return std::move(*this);
         }
         template <typename T>
         AnyType insert()
         {
            auto [pos, inserted] = ids.insert({&type_id<T>, ids.size()});
            std::string name     = "@" + std::to_string(pos->second);
            if (inserted)
            {
               if constexpr (PackableWrapper<T>)
               {
                  schema.insert(name, insert<std::remove_cvref_t<decltype(clio_unwrap_packable(
                                          std::declval<T&>()))>>());
               }
               else if constexpr (is_shared_view_ptr_v<T>)
               {
                  if (expandNested_)
                  {
                     schema.insert(name,
                                   FracPack{insert<std::remove_cv_t<typename T::value_type>>()});
                  }
                  else
                  {
                     schema.insert(
                         name,
                         Custom{
                             .type = FracPack{insert<std::remove_cv_t<typename T::value_type>>()},
                             .id   = "hex"});
                  }
               }
               else if constexpr (std::is_same_v<T, std::vector<char>> ||
                                  std::is_same_v<T, std::vector<signed char>> ||
                                  std::is_same_v<T, std::vector<unsigned char>>)
               {
                  schema.insert(
                      name, Custom{.type = List{insert<typename T::value_type>()}, .id = "hex"});
               }
               else if constexpr (is_std_optional_v<T>)
               {
                  schema.insert(name, Option{insert<typename is_std_optional<T>::value_type>()});
               }
               else if constexpr (std::is_same_v<T, bool>)
               {
                  schema.insert(name, Custom{.type = Int{.bits = 1}, .id = "bool"});
               }
               else if constexpr (std::is_integral_v<T>)
               {
                  schema.insert(name, Int{.bits = 8 * sizeof(T), .isSigned = std::is_signed_v<T>});
               }
               else if constexpr (std::is_enum_v<T>)
               {
                  schema.insert(name, insert<std::underlying_type_t<T>>());
               }
               else if constexpr (is_duration_v<T>)
               {
                  schema.insert(name, insert<typename T::rep>());
               }
               else if constexpr (std::numeric_limits<T>::is_iec559)
               {
                  schema.insert(name,
                                Float{.exp = float_exp_bits(std::numeric_limits<T>::max_exponent),
                                      .mantissa = std::numeric_limits<T>::digits});
               }
               else if constexpr (std::is_same_v<T, std::string> ||
                                  std::is_same_v<T, std::string_view> ||
                                  std::is_same_v<T, const char*>)
               {
                  schema.insert(name,
                                Custom{.type = List{insert<unsigned char>()}, .id = "string"});
               }
               else if constexpr (is_std_vector_v<T>)
               {
                  schema.insert(name, List{insert<typename is_std_vector<T>::value_type>()});
               }
               else if constexpr (is_std_variant_v<T>)
               {
                  schema.insert(name, Variant{insert_variant_alternatives(*this, (T*)nullptr)});
               }
               else if constexpr (is_std_array_v<T>)
               {
                  using value_type = std::remove_cv_t<typename is_std_array<T>::value_type>;
                  AnyType arr = Array{.type = insert<value_type>(), .len = is_std_array<T>::size};
                  if constexpr (std::is_same_v<value_type, char> ||
                                std::is_same_v<value_type, signed char> ||
                                std::is_same_v<value_type, unsigned char>)
                  {
                     arr = Custom{.type = std::move(arr), .id = "hex"};
                  }
                  schema.insert(name, std::move(arr));
               }
               else if constexpr (std::is_array_v<T>)
               {
                  schema.insert(name,
                                Array{.type = insert<std::remove_cv_t<std::remove_extent_t<T>>>(),
                                      .len  = std::extent_v<T>});
               }
               else if constexpr (reflect<T>::is_struct)
               {
                  std::vector<Member> members;
                  reflect<T>::for_each(
                      [&](const meta& r, auto member)
                      {
                         auto m = member((std::decay_t<T>*)nullptr);
                         if constexpr (not std::is_member_function_pointer_v<decltype(m)>)
                         {
                            using member_type = std::remove_cvref_t<
                                decltype(static_cast<std::decay_t<T>*>(nullptr)->*m)>;
                            members.push_back({.name = r.name, .type = insert<member_type>()});
                         }
                      });
                  if constexpr (reflect<T>::definitionWillNotChange)
                  {
                     schema.insert(name, Struct{std::move(members)});
                  }
                  else
                  {
                     schema.insert(name, Object{std::move(members)});
                  }
               }
               else if constexpr (requires { std::tuple_size<T>::value; })
               {
                  schema.insert(name,
                                Tuple{insert_tuple_elements<T>(
                                    *this, std::make_index_sequence<std::tuple_size_v<T>>())});
               }
               else
               {
                  static_assert(reflect<T>::is_struct, "Don't know schema representation");
               }
            }
            return Type{std::move(name)};
         }
         Schema build() &&
         {
            optimize();
            ids.clear();
            return std::move(schema);
         }

         void optimize();

        private:
         bool                               expandNested_ = false;
         Schema                             schema;
         std::map<const void*, std::size_t> ids;
      };

      void to_json(const Schema& schema, auto& stream)
      {
         to_json(schema.types, stream);
      }

      void to_json_members(const std::vector<Member>& members, auto& stream)
      {
         CommaList comma;
         stream.write('{');
         for (const auto& member : members)
         {
            comma.next(stream);
            to_json(member.name, stream);
            write_colon(stream);
            to_json(member.type, stream);
         }
         comma.end(stream);
         stream.write('}');
      }

      enum class SchemaDifference : std::uint8_t
      {
         equivalent      = 0,
         incompatible    = 1,
         addField        = 2,
         dropField       = 4,
         addAlternative  = 8,
         dropAlternative = 16,
         upgrade         = addField | addAlternative,
         downgrade       = dropField | dropAlternative,
      };
      inline SchemaDifference operator~(SchemaDifference arg)
      {
         return static_cast<SchemaDifference>(~static_cast<std::uint8_t>(arg));
      }
      inline SchemaDifference operator|(SchemaDifference lhs, SchemaDifference rhs)
      {
         return static_cast<SchemaDifference>(static_cast<std::uint8_t>(lhs) |
                                              static_cast<std::uint8_t>(rhs));
      }
      inline SchemaDifference operator&(SchemaDifference lhs, SchemaDifference rhs)
      {
         return static_cast<SchemaDifference>(static_cast<std::uint8_t>(lhs) &
                                              static_cast<std::uint8_t>(rhs));
      }
      inline SchemaDifference& operator|=(SchemaDifference& lhs, SchemaDifference rhs)
      {
         lhs = lhs | rhs;
         return lhs;
      }
      inline SchemaDifference& operator&=(SchemaDifference& lhs, SchemaDifference rhs)
      {
         lhs = lhs & rhs;
         return lhs;
      }
      inline bool operator==(SchemaDifference lhs, int rhs)
      {
         assert(rhs == 0);
         return lhs == SchemaDifference::equivalent;
      }
      inline std::partial_ordering operator<=>(SchemaDifference lhs, int rhs)
      {
         assert(rhs == 0);
         if (lhs == SchemaDifference::equivalent)
            return std::partial_ordering::equivalent;
         if ((lhs & ~SchemaDifference::upgrade) == 0)
            return std::partial_ordering::greater;
         if ((lhs & ~SchemaDifference::downgrade) == 0)
            return std::partial_ordering::less;
         return std::partial_ordering::unordered;
      }

      SchemaDifference match(const Schema&                                   schema1,
                             const Schema&                                   schema2,
                             const std::vector<std::pair<AnyType, AnyType>>& types);
   }  // namespace schema_types

   using schema_types::match;
   using schema_types::Schema;
   using schema_types::SchemaBuilder;
   using schema_types::SchemaDifference;
}  // namespace psio
