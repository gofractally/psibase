#pragma once

#include <charconv>
#include <concepts>
#include <map>
#include <psio/fracpack.hpp>
#include <psio/from_json/map.hpp>
#include <psio/get_type_name.hpp>
#include <psio/json/any.hpp>
#include <psio/to_json.hpp>
#include <psio/to_json/map.hpp>
#include <ranges>
#include <variant>

namespace psio
{
   template <typename T>
      requires Packable<std::remove_cv_t<T>>
   class shared_view_ptr;

   template <typename T>
   struct nested;

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

      template <bool Unpack, bool Verify, typename T>
      bool unpack(T* value)
      {
         return is_packable<T>::template unpack<Unpack, Verify>(value, has_unknown, known_end, src,
                                                                pos, end_pos);
      }
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

      std::size_t written() { return do_written(); }
      void        rewrite(std::size_t offset, const void* data, std::size_t size)
      {
         do_rewrite(offset, data, size);
      }

      template <typename T>
      void write_raw(const T& v)
      {
         write(&v, sizeof(v));
      }
      template <typename T>
      void rewrite_raw(std::size_t offset, const T& value)
      {
         do_rewrite(offset, &value, sizeof(value));
      }

     protected:
      virtual void        do_write(const void* data, std::size_t size)                    = 0;
      virtual void        do_increase_indent()                                            = 0;
      virtual void        do_decrease_indent()                                            = 0;
      virtual void        do_write_colon()                                                = 0;
      virtual void        do_write_newline()                                              = 0;
      virtual std::size_t do_written()                                                    = 0;
      virtual void        do_rewrite(std::size_t pos, const void* data, std::size_t size) = 0;
      ~StreamBase()                                                                       = default;
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
      std::size_t do_written() override { return stream.written(); }
      void        do_rewrite(std::size_t pos, const void* data, std::size_t size) override
      {
         stream.rewrite(pos, data, size);
      };

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
      template <typename T, typename Stream>
      void from_json(Box<T>& wrapper, Stream& stream)
      {
         from_json(*wrapper.value, stream);
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

      void to_json(const Schema& schema, auto& stream)
      {
         to_json(schema.types, stream);
      }

      void from_json(Schema& schema, auto& stream)
      {
         from_json(schema.types, stream);
      }

      inline auto& clio_unwrap_packable(Schema& schema)
      {
         return schema.types;
      }

      inline const auto& clio_unwrap_packable(const Schema& schema)
      {
         return schema.types;
      }

      struct Member;

      void to_json_members(const std::vector<Member>&, auto& stream);
      void from_json_members(const std::vector<Member>&, auto& stream);

      struct Object
      {
         std::vector<Member> members;
      };

      PSIO_REFLECT_TYPENAME(Object)

      void to_json(const Object& type, auto& stream)
      {
         to_json_members(type.members, stream);
      }
      void from_json(Object& type, auto& stream)
      {
         from_json_members(type.members, stream);
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
      void from_json(Struct& type, auto& stream)
      {
         from_json_members(type.members, stream);
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
      void from_json(List& type, auto& stream)
      {
         from_json(*type.type, stream);
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
      void from_json(Option& type, auto& stream)
      {
         from_json(*type.type, stream);
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
      void from_json(Variant& type, auto& stream)
      {
         from_json_members(type.members, stream);
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
      void from_json(Tuple& type, auto& stream)
      {
         from_json(type.members, stream);
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
      void from_json(FracPack& type, auto& stream)
      {
         from_json(type.type, stream);
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
      constexpr bool psio_is_untagged(const Type*)
      {
         return true;
      }

      void to_json(const Type& type, auto& stream)
      {
         to_json(type.type, stream);
      }
      void from_json(Type& type, auto& stream)
      {
         from_json(type.type, stream);
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
         to_json(type.value, stream);
      }
      void from_json(AnyType& type, auto& stream)
      {
         from_json(type.value, stream);
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

      struct FunctionType
      {
         AnyType                params;
         std::optional<AnyType> result;
      };
      PSIO_REFLECT(FunctionType, params, result)

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
         CustomHandler(const T&)
             : match(&T::match),
               frac2json(&T::frac2json),
               json2frac(&T::json2frac),
               is_empty_container(&T::is_empty_container)
         {
         }
         bool (*match)(const CompiledType*);
         bool (*frac2json)(const CompiledType*, FracStream& in, StreamBase& out);
         void (*json2frac)(const CompiledType*, const json::any& in, StreamBase& out);
         bool (*is_empty_container)(const CompiledType*, const json::any& in);
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
         static void json2frac(const CompiledType*, const json::any& in, StreamBase& out)
         {
            T value = convert_from_json<T>(convert_to_json(in));
            is_packable<T>::pack(value, out);
         }
         static bool is_empty_container(const CompiledType*, const json::any& in)
         {
            if constexpr (is_packable<T>::supports_0_offset)
            {
               T value = convert_from_json<T>(convert_to_json(in));
               return is_packable<T>::is_empty_container(value);
            }
            else
            {
               return false;
            }
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
         void               insert(std::string name, const CustomHandler& t);
         const std::size_t* find(const std::string& name) const;
         bool               match(std::size_t index, const CompiledType* type) const;
         bool               frac2json(const CompiledType* type,
                                      std::size_t         index,
                                      FracStream&         in,
                                      auto&               out) const
         {
            StreamRef stream{out};
            return impl[index].frac2json(type, in, stream);
         }

         void json2frac(const CompiledType* type,
                        std::size_t         index,
                        const json::any&    in,
                        auto&               out) const
         {
            StreamRef stream{out};
            impl[index].json2frac(type, in, stream);
         }

         bool is_empty_container(const CompiledType* type,
                                 std::size_t         index,
                                 const json::any&    in) const
         {
            return impl[index].is_empty_container(type, in);
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
         bool matches(const CompiledType* other) const;
      };

      CustomTypes standard_types();

      struct CompiledSchema
      {
         CompiledSchema(const Schema&               schema,
                        CustomTypes                 builtin    = standard_types(),
                        std::vector<const AnyType*> extraTypes = {});
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
            const CompiledType*   parent;
            std::uint32_t         index;
            explicit              operator bool() const { return type != nullptr; }
            Item                  next(FracParser&) { return *this; }
         };
         Item next();
         Item select_child(std::uint32_t index);
         void push(const Item&);
         // Returns the position that the item starts at. The item must
         // be the most recent item, and must be one of start, scalar, or custom
         // - empty elements are not necessarily represented in the packed data
         // - I'm not sure what the position of an end element should mean
         std::uint32_t get_pos(const Item&) const;
         // Sets the current position to pos and clears the parse stack
         void set_pos(std::uint32_t pos);
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
         // We need to see the contents of the variant to
         // know whether we need a '{', because the alternative
         // might be untagged
         char operator()(const Variant&) const { return 0; }
         char operator()(const Struct&) const { return '{'; }
         char operator()(const FracPack&) const { return 0; };
         char operator()(const Option&) const { return 0; };
         char operator()(const auto&) const { return '['; }
         char operator()(const Custom& custom) const
         {
            if (custom.id == "map")
            {
               return '{';
            }
            else
            {
               return '[';
            }
         }
      };

      struct CloseToken
      {
         char operator()(const Object&) const { return '}'; }
         char operator()(const Variant&) const { return '}'; }
         char operator()(const Struct&) const { return '}'; }
         char operator()(const FracPack&) const { return 0; };
         char operator()(const Option&) const { return 0; };
         char operator()(const Custom& custom) const
         {
            if (custom.id == "map")
            {
               return '}';
            }
            else
            {
               return ']';
            }
         }
         char operator()(const auto&) const { return ']'; }
      };

      struct MemberName
      {
         const std::string* operator()(const Object& type) const
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

      struct SeparatedList
      {
         static constexpr unsigned comma       = 0;
         static constexpr unsigned colon       = 1;
         static constexpr unsigned single      = 1;
         unsigned char             first : 1   = 1;
         unsigned char             kind : 1    = comma;
         unsigned char             flatten : 1 = 0;
         void                      next(auto& stream)
         {
            if (first)
               increase_indent(stream);
            else if (kind == comma)
               stream.write(',');
            else
               stream.write(':');
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

      bool isCustomMap(const AnyType&);

      void to_json(FracParser& parser, auto& stream)
      {
         std::vector<SeparatedList> groups;
         auto                       start_member = [&](const auto& item)
         {
            if (!groups.empty())
            {
               if (groups.back().kind != SeparatedList::colon)
               {
                  if (const auto* variant =
                          std::get_if<Variant>(&item.parent->original_type->value))
                  {
                     const auto& name = variant->members[item.index].name;
                     if (name.starts_with('@'))
                     {
                        groups.back().kind = SeparatedList::single;
                     }
                     else
                     {
                        stream.write('{');
                        groups.back().next(stream);
                        to_json(name, stream);
                        write_colon(stream);
                     }
                  }
                  else
                  {
                     groups.back().next(stream);
                     if (auto* name =
                             std::visit(MemberName{item.index}, item.parent->original_type->value))
                     {
                        to_json(*name, stream);
                        write_colon(stream);
                     }
                  }
               }
               else
               {
                  groups.back().next(stream);
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
               {
                  start_member(item);
                  SeparatedList list = {};
                  if (!groups.empty() && groups.back().flatten)
                     list.kind = SeparatedList::colon;
                  else if (isCustomMap(*item.type->original_type))
                     list.flatten = true;
                  groups.push_back(list);
                  if (list.kind == SeparatedList::comma)
                     write_bracket(item, OpenToken{});
                  break;
               }
               case FracParser::end:
                  if (groups.back().kind == SeparatedList::comma)
                  {
                     groups.back().end(stream);
                     write_bracket(item, CloseToken{});
                  }
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

      void scalar_to_key(const Int& type, std::span<const char> data, auto& stream)
      {
         if (type.isSigned)
         {
            stream.write(data.back() ^ 0x80);
            data = data.first(data.size() - 1);
         }
         for (char ch : std::ranges::reverse_view{data})
            stream.write(ch);
      }
      void scalar_to_key(const Float& type, std::span<const char> data, auto& stream)
      {
         // check for zero
         bool is_minus_zero =
             data.back() == static_cast<char>(0x80) &&
             std::ranges::all_of(data.first(data.size() - 1), [](char ch) { return ch == 0; });
         if ((data.back() & 0x80) && !is_minus_zero)
         {
            for (char ch : data | std::views::reverse)
               stream.write(ch ^ 0xff);
         }
         else
         {
            stream.write(data.back() | 0x80);
            data = data.first(data.size() - 1);
            for (char ch : std::ranges::reverse_view{data})
               stream.write(ch);
         }
      }
      void scalar_to_key(const auto& type, std::span<const char>, auto& stream)
      {
         check(false, "Not a scalar type");
      }

      inline bool isOctet(const CompiledType* type)
      {
         if (const auto* intType = std::get_if<Int>(&type->original_type->value))
         {
            return intType->bits <= 8;
         }
         return false;
      }

      inline bool isOctet(const CompiledMember& member)
      {
         return !member.is_optional && isOctet(member.type);
      }

      // TODO: Allow extensions without breaking key ordering
      void to_key(FracParser& parser, auto& stream)
      {
         auto start_member = [&](const auto& item)
         {
            if (item.parent)
            {
               if (item.parent->kind == CompiledType::optional)
                  stream.write('\1');
               if (item.parent->children[item.index].is_optional)
                  stream.write('\1');
            }
         };
         while (auto item = parser.next())
         {
            switch (item.kind)
            {
               case FracParser::start:
                  start_member(item);
                  break;
               case FracParser::end:
                  switch (item.type->kind)
                  {
                     case CompiledType::container:
                        if (isOctet(item.type->children[0]))
                        {
                           stream.write("\0", 2);
                        }
                        else
                        {
                           stream.write('\0');
                        }
                        break;
                     default:
                        break;
                  }
                  break;
               case FracParser::scalar:
                  if (item.parent)
                  {
                     auto optionalCount = (item.parent->kind == CompiledType::container) +
                                          (item.parent->children[item.index].is_optional ||
                                           item.parent->kind == CompiledType::optional);
                     if (optionalCount == 2)
                        stream.write('\1');
                     if (optionalCount != 0)
                     {
                        if (isOctet(item.parent->children[0].type))
                        {
                           char             buf[1];
                           fixed_buf_stream tmp_stream(buf, 1);
                           std::visit([&](const auto& type)
                                      { scalar_to_key(type, item.data, tmp_stream); },
                                      item.type->original_type->value);
                           stream.write(buf[0]);
                           if (buf[0] == '\0')
                              stream.write('\1');
                           break;
                        }
                        stream.write('\1');
                     }
                  }
                  std::visit([&](const auto& type) { scalar_to_key(type, item.data, stream); },
                             item.type->original_type->value);
                  break;
               case FracParser::empty:
                  if (item.parent)
                  {
                     if (item.parent->kind == CompiledType::container)
                        stream.write('\1');
                     if (isOctet(item.parent->children[item.index].type))
                        stream.write('\0');
                  }
                  stream.write('\0');
                  break;
               case FracParser::custom:
                  check(false, "to_key does not handle custom types");
               case FracParser::error:
                  check(false, std::string_view(item.data.data(), item.data.size()));
            }
         }
      }

      template <typename T>
      struct Json2Int
      {
         template <typename V>
         T operator()(const V& v) const
         {
            if constexpr (std::is_integral_v<V>)
            {
               return static_cast<T>(v);
            }
            else if constexpr (std::is_convertible_v<V, std::string_view>)
            {
               std::string_view data{v};
               T                result;
               const char*      end = data.data() + data.size();
               auto             res = std::from_chars(data.data(), end, result);
               if (res.ec == std::errc::result_out_of_range)
               {
                  abort_error(from_json_error::number_out_of_range);
               }
               else if (res.ec != std::errc{})
               {
                  abort_error(from_json_error::expected_int);
               }
               if (res.ptr != end)
               {
                  abort_error(from_json_error::expected_int);
               }
               return result;
            }
            else
            {
               abort_error(from_json_error::expected_int);
            }
         }
      };

      template <typename T>
      struct Json2Float
      {
         template <typename V>
         T operator()(const V& v) const
         {
            if constexpr (std::is_arithmetic_v<V>)
            {
               return static_cast<T>(v);
            }
            else
            {
               abort_error(from_json_error::expected_number);
            }
         }
         T operator()(const std::string& s) const
         {
            // TODO: use std::from_chars once we have it (LLVM 20).
            errno = 0;
            char* end;
            T     result;
            if constexpr (std::is_same_v<T, double>)
            {
               result = std::strtod(s.c_str(), &end);
            }
            else if constexpr (std::is_same_v<T, float>)
            {
               result = std::strtof(s.c_str(), &end);
            }
            else
            {
               static_assert(std::is_same_v<T, float>, "Only float and double are supported");
            }
            if (errno || end != s.c_str() + s.size())
               abort_error(from_json_error::expected_number);
            return result;
         }
      };

      template <typename Signed, typename Unsigned, typename Out>
      void json2int(const Int& type, const json::any& in, Out& out)
      {
         if (type.isSigned)
         {
            to_frac(in.visit(Json2Int<Signed>()), out);
         }
         else
         {
            to_frac(in.visit(Json2Int<Unsigned>()), out);
         }
      }

      void scalar_to_frac(const Int& type, const json::any& in, auto& out)
      {
         switch (type.bits)
         {
            case 1:
               if (type.isSigned)
               {
                  std::int8_t value = in.visit(Json2Int<std::int8_t>());
                  if (value != 0 && value != -1)
                     check(false, "invalid i1");
                  to_frac(value, out);
               }
               else
               {
                  std::int8_t value = in.visit(Json2Int<std::uint8_t>());
                  if (value != 0 && value != 1)
                     check(false, "invalid u1");
                  to_frac(value, out);
               }
               return;
            case 8:
               return json2int<std::int8_t, std::uint8_t>(type, in, out);
            case 16:
               return json2int<std::int16_t, std::uint16_t>(type, in, out);
            case 32:
               return json2int<std::int32_t, std::uint32_t>(type, in, out);
            case 64:
               return json2int<std::int64_t, std::uint64_t>(type, in, out);
            default:
               abort_error("<<<Unsupported integer width>>>");
         }
      }

      void scalar_to_frac(const Float& type, const json::any& in, auto& out)
      {
         if (type == Float{.exp = 11, .mantissa = 53})
         {
            to_frac(in.visit(Json2Float<double>()), out);
         }
         else if (type == Float{.exp = 8, .mantissa = 24})
         {
            to_frac(in.visit(Json2Float<float>()), out);
         }
         else
         {
            abort_error(
                "<<<Only single and double precision floating point numbers are supported>>>");
         }
      }

      void scalar_to_frac(const auto& type, const json::any& in, auto& out)
      {
         abort_error("Not implemented");
      }

      void to_frac(const CompiledType& ty,
                   const json::any&    v,
                   auto&               stream,
                   const CustomTypes&  builtin);

      struct GetMemberValues
      {
         const json::any&              value;
         std::vector<const json::any*> operator()(const std::vector<Member>& members) const
         {
            auto* v = value.get_if<json::any_object>();
            if (!v)
               abort_error(from_json_error::expected_start_object);
            // Collect members
            std::vector<const json::any*> member_values;
            member_values.reserve(members.size());
            for (const auto& m : members)
            {
               auto pos =
                   std::ranges::find_if(*v, [&](const auto& entry) { return entry.key == m.name; });
               member_values.push_back(pos != v->end() ? &pos->value : nullptr);
            }
            return member_values;
         }
         std::vector<const json::any*> operator()(const Object& ty) const
         {
            return (*this)(ty.members);
         }
         std::vector<const json::any*> operator()(const Struct& ty) const
         {
            return (*this)(ty.members);
         }
         std::vector<const json::any*> operator()(const Tuple& ty) const
         {
            auto* v = value.get_if<json::any_array>();
            if (!v)
               abort_error(from_json_error::expected_start_array);
            if (v->size() != ty.members.size())
               abort_error("Expected tuple of length " + std::to_string(ty.members.size()));
            std::vector<const json::any*> member_values;
            member_values.reserve(ty.members.size());
            for (const auto& item : *v)
            {
               member_values.push_back(&item);
            }
            return member_values;
         }
         std::vector<const json::any*> operator()(const auto& ty) const
         {
            abort_error("Not implemented");
         }
      };

      template <typename To, typename From>
      To checked_cast(From from)
      {
         if constexpr (std::is_signed_v<From>)
         {
            if constexpr (std::is_signed_v<To>)
            {
               if (from < std::numeric_limits<To>::min() || from > std::numeric_limits<To>::max())
               {
                  abort_error("Integer overflow");
               }
            }
            else
            {
               if (from < 0 ||
                   static_cast<std::make_unsigned_t<From>>(from) > std::numeric_limits<To>::max())
               {
                  abort_error("Integer overflow");
               }
            }
         }
         else
         {
            if (from > static_cast<std::make_unsigned_t<To>>(std::numeric_limits<To>::max()))
            {
               abort_error("Integer overflow");
            }
         }
         return static_cast<To>(from);
      }

      inline bool is_empty_container(const CompiledType& ty,
                                     const json::any&    in,
                                     const CustomTypes&  builtin)
      {
         if (ty.custom_id != -1 && ty.is_container())
         {
            return builtin.is_empty_container(&ty, ty.custom_id, in);
         }
         if (ty.kind == CompiledType::container)
         {
            auto* arr = in.get_if<json::any_array>();
            return arr && arr->size() == 0;
         }
         else if (ty.kind == CompiledType::nested)
         {
            abort_error("Not implemented");
         }
         else
         {
            return false;
         }
      }

      void object_to_frac(const CompiledType& ty,
                          bool                extensible,
                          const json::any&    in,
                          auto&               out,
                          const CustomTypes&  builtin)
      {
         auto member_values = std::visit(GetMemberValues{in}, ty.original_type->value);
         // Count trailing empty optionals
         std::size_t end = ty.children.size();
         if (extensible)
         {
            for (; end > 0; --end)
            {
               if (!ty.children[end - 1].is_optional ||
                   (member_values[end - 1] && !member_values[end - 1]->get_if<json::null_t>()))
               {
                  break;
               }
            }
            to_frac(std::uint16_t{0}, out);
         }
         auto base_pos = out.written();
         // Write member fixed data
         for (std::size_t i = 0; i < end; ++i)
         {
            if (ty.children[i].is_optional)
            {
               if (!member_values[i] || member_values[i]->get_if<json::null_t>())
               {
                  to_frac(std::uint32_t{1}, out);
                  member_values[i] = nullptr;
               }
               else
               {
                  to_frac(std::uint32_t{0}, out);
               }
            }
            else
            {
               if (!member_values[i])
                  abort_error("missing field");
               const CompiledType* member_ty = ty.children[i].type;
               if (member_ty->is_variable_size)
               {
                  to_frac(std::uint32_t{0}, out);
               }
               else
               {
                  to_frac(*member_ty, *member_values[i], out, builtin);
                  member_values[i] = nullptr;
               }
            }
         }
         // Write member variable data and fix up offsets
         if (extensible)
         {
            out.rewrite_raw(base_pos - 2, checked_cast<std::uint16_t>(out.written() - base_pos));
         }
         for (std::size_t i = 0; i < end; ++i)
         {
            if (member_values[i])
            {
               if (!is_empty_container(*ty.children[i].type, *member_values[i], builtin))
               {
                  auto pos = base_pos + ty.children[i].fixed_offset;
                  out.rewrite_raw(pos, checked_cast<std::uint32_t>(out.written() - pos));
                  to_frac(*ty.children[i].type, *member_values[i], out, builtin);
               }
            }
         }
      }

      void array_to_frac(const CompiledType& ty,
                         bool                variable,
                         const json::any&    in,
                         auto&               out,
                         const CustomTypes&  builtin)
      {
         auto* arr = in.get_if<json::any_array>();
         if (!arr)
         {
            abort_error(from_json_error::expected_start_array);
         }
         const CompiledMember& member = ty.children[0];
         std::uint32_t fixed_size     = member.type->is_variable_size ? 4 : member.type->fixed_size;
         if (std::numeric_limits<std::uint32_t>::max() / fixed_size < arr->size())
            abort_error("Integer overflow");
         auto size = static_cast<std::uint32_t>(arr->size() * fixed_size);
         if (variable)
         {
            to_frac(size, out);
         }
         else
         {
            if (size != ty.fixed_size)
            {
               abort_error("Wrong array size");
            }
         }
         if (member.is_optional || member.type->is_variable_size)
         {
            auto base_pos = out.written();
            for (const auto& v : *arr)
            {
               (void)v;
               to_frac(std::uint32_t{0}, out);
            }
            for (const auto& v : *arr)
            {
               if (member.is_optional && v.get_if<json::null_t>())
               {
                  out.rewrite_raw(base_pos, std::uint32_t{1});
               }
               else
               {
                  if (!is_empty_container(*member.type, v, builtin))
                  {
                     out.rewrite_raw(base_pos,
                                     checked_cast<std::uint32_t>(out.written() - base_pos));
                     to_frac(*member.type, v, out, builtin);
                  }
               }
               base_pos += 4;
            }
         }
         else  // fixed size
         {
            for (const json::any& v : *arr)
            {
               to_frac(*member.type, v, out, builtin);
            }
         }
      }

      void variant_to_frac(const CompiledType& ty,
                           const json::any&    in,
                           auto&               out,
                           const CustomTypes&  builtin)
      {
         auto* obj = in.get_if<json::any_object>();
         if (!obj)
         {
            abort_error(from_json_error::expected_start_object);
         }
         if (obj->size() == 1)
         {
            const auto& varty = std::get<Variant>(ty.original_type->value);
            const auto& name  = obj->front().key;
            auto        pos   = std::ranges::find_if(varty.members,
                                                     [&](auto& member) { return member.name == name; });
            if (pos != varty.members.end())
            {
               auto alt = checked_cast<std::uint8_t>(pos - varty.members.begin());
               to_frac(alt, out);
               to_frac(std::uint32_t{0}, out);
               auto base_pos = out.written();
               assert(!ty.children[alt].is_optional);
               to_frac(*ty.children[alt].type, obj->front().value, out, builtin);
               out.rewrite_raw(base_pos - 4, checked_cast<std::uint32_t>(out.written() - base_pos));
               return;
            }
         }
         abort_error("Not implemented");
      }

      void to_frac(const CompiledType& ty,
                   const json::any&    v,
                   auto&               stream,
                   const CustomTypes&  builtin)
      {
         if (ty.custom_id != -1)
         {
            return builtin.json2frac(&ty, ty.custom_id, v, stream);
         }
         switch (ty.kind)
         {
            case CompiledType::scalar:
            {
               std::visit([&](auto& ty) { scalar_to_frac(ty, v, stream); },
                          ty.original_type->value);
               break;
            }
            case CompiledType::struct_:
            {
               object_to_frac(ty, false, v, stream, builtin);
               break;
            }
            case CompiledType::object:
            {
               object_to_frac(ty, true, v, stream, builtin);
               break;
            }
            case CompiledType::container:
            {
               array_to_frac(ty, true, v, stream, builtin);
               break;
            }
            case CompiledType::array:
            {
               array_to_frac(ty, false, v, stream, builtin);
               break;
            }
            case CompiledType::variant:
            {
               variant_to_frac(ty, v, stream, builtin);
               break;
            }
            case CompiledType::optional:
            {
               if (v.get_if<json::null_t>())
               {
                  std::uint32_t offset = 1;
                  to_frac(offset, stream);
               }
               else if (is_empty_container(*ty.children[0].type, v, builtin))
               {
                  to_frac(std::uint32_t{0}, stream);
               }
               else
               {
                  std::uint32_t offset = 4;
                  to_frac(offset, stream);
                  to_frac(*ty.children[0].type, v, stream, builtin);
               }
               break;
            }
               // nested,
            default:
               abort_error("Not implemented");
         }
      }

      template <typename T>
      constexpr bool psio_custom_schema(T*)
      {
         return false;
      }

      template <typename Rep>
      constexpr bool psio_custom_schema(
          std::chrono::time_point<std::chrono::system_clock, std::chrono::duration<Rep>>*)
      {
         return true;
      }

      template <typename Rep>
      constexpr bool psio_custom_schema(
          std::chrono::time_point<std::chrono::system_clock,
                                  std::chrono::duration<Rep, std::micro>>*)
      {
         return true;
      }

      template <typename T>
      constexpr bool is_nested_wrapper_v = false;
      template <typename T>
      constexpr bool is_nested_wrapper_v<shared_view_ptr<T>> = true;
      template <typename T>
      constexpr bool is_nested_wrapper_v<nested<T>> = true;

      template <typename T>
      constexpr bool is_duration_v = false;
      template <typename Rep, typename Period>
      constexpr bool is_duration_v<std::chrono::duration<Rep, Period>> = true;

      template <typename T>
      constexpr bool is_time_point_v = false;
      template <typename Clock, typename Duration>
      constexpr bool is_time_point_v<std::chrono::time_point<Clock, Duration>> = true;

      template <typename T>
      std::string get_alternative_name(const T*)
      {
         using psio::get_type_name;
         using psio::psio_is_untagged;
         if constexpr (psio_is_untagged(static_cast<const T*>(nullptr)))
         {
            std::string result("@");
            result += get_type_name(static_cast<const T*>(nullptr));
            return result;
         }
         else
         {
            return get_type_name(static_cast<const T*>(nullptr));
         }
      }

      template <typename S, typename... T>
      std::vector<Member> insert_variant_alternatives(S& schema, std::variant<T...>*)
      {
         using psio::get_type_name;
         return {Member{.name = get_alternative_name((T*)nullptr),
                        .type = schema.template insert<T>()}...};
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
      concept JsonMapType = requires {
         typename T::key_type;
         typename T::mapped_type;
         typename T::value_type;
         requires std::convertible_to<typename T::key_type, std::string_view>;
      };

      class SchemaBuilder;

      template <typename T>
      concept HasToSchema = requires(SchemaBuilder& builder, const T* t) {
         { to_schema(builder, t) } -> std::convertible_to<AnyType>;
      };

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
               if constexpr (HasToSchema<T>)
               {
                  schema.insert(name, to_schema(*this, static_cast<const T*>(nullptr)));
               }
               else if constexpr (PackableWrapper<T>)
               {
                  schema.insert(name, insert<std::remove_cvref_t<decltype(clio_unwrap_packable(
                                          std::declval<T&>()))>>());
               }
               else if constexpr (is_nested_wrapper_v<T>)
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
               else if constexpr (is_time_point_v<T>)
               {
                  schema.insert(name, insert<typename T::duration>());
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
                  auto members = psio::apply_members(
                      (typename reflect<T>::data_members*)nullptr,
                      [this](auto... member)
                      {
                         std::size_t i = 0;
                         return std::vector<Member>{Member{
                             .name = reflect<T>::data_member_names[i++],
                             .type = insert<
                                 std::remove_cvref_t<decltype(((T*)nullptr)->*member)>>()}...};
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
               else if constexpr (JsonMapType<T>)
               {
                  schema.insert(
                      name, Custom{.type = List{insert<typename T::value_type>()}, .id = "map"});
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
               if constexpr (psio_custom_schema(static_cast<T*>(nullptr)))
               {
                  auto& item = schema.types.find(name)->second;
                  item       = Custom{.type = std::move(item), .id = psio::get_type_name<T>()};
               }
            }
            return Type{std::move(name)};
         }
         Schema build(std::span<AnyType* const> ext = {}) &&
         {
            optimize(ext);
            ids.clear();
            return std::move(schema);
         }

         void optimize(std::span<AnyType* const> ext = {});

        private:
         bool                               expandNested_ = false;
         Schema                             schema;
         std::map<const void*, std::size_t> ids;
      };

      AnyType to_schema(SchemaBuilder& builder, const Object*);
      AnyType to_schema(SchemaBuilder& builder, const Struct*);
      AnyType to_schema(SchemaBuilder& builder, const Variant*);

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

      void from_json_members(std::vector<Member>& members, auto& stream)
      {
         from_json_object(stream,
                          [&](std::string_view key)
                          {
                             members.push_back(Member{std::string(key)});
                             from_json(members.back().type, stream);
                          });
      }

      template <typename T>
      bool matchCustomType(const CompiledType* type, T*)
      {
         auto           schema = SchemaBuilder{}.insert<T>("T").build();
         CompiledSchema cschema{schema};
         return cschema.get(schema.get("T"))->matches(type);
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

      struct SchemaMatch;
      struct TypeMatcher
      {
        public:
         TypeMatcher(const Schema& l, const Schema& r, SchemaDifference allowed);
         ~TypeMatcher();
         bool match(const AnyType& lhs, const AnyType& rhs);

        private:
         std::unique_ptr<SchemaMatch> impl;
         SchemaDifference             allowed;
      };
   }  // namespace schema_types

   using schema_types::match;
   using schema_types::Schema;
   using schema_types::SchemaBuilder;
   using schema_types::SchemaDifference;
}  // namespace psio
