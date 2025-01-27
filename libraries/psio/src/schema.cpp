#include <psio/schema.hpp>

#include <psio/chrono.hpp>
#include <set>

namespace psio::schema_types
{
   const AnyType* AnyType::resolve(const Schema& schema) const
   {
      if (!resolved)
      {
         std::size_t    n      = schema.types.size();
         const AnyType* result = this;
         while (auto* alias = std::get_if<Type>(&result->value))
         {
            if (auto* next = schema.get(alias->type))
            {
               result = next;
            }
            check(n-- > 0, "Cycle in type definitions");
         }
         resolved = result;
      }
      return resolved;
   }

   const AnyType* Schema::get(const std::string& name) const
   {
      if (auto pos = types.find(name); pos != types.end())
      {
         return &pos->second;
      }
      return nullptr;
   }

   void Schema::insert(std::string name, AnyType type)
   {
      types.insert(std::make_pair(std::move(name), std::move(type)));
   }

   void CustomTypes::insert(std::string name, const CustomHandler& t)
   {
      std::size_t index = impl.size();
      impl.push_back(t);
      names.insert({std::move(name), index});
   }
   const std::size_t* CustomTypes::find(const std::string& name) const
   {
      if (auto pos = names.find(name); pos != names.end())
         return &pos->second;
      return nullptr;
   }
   bool CustomTypes::match(std::size_t index, const CompiledType* type) const
   {
      return impl[index].match(type);
   }

   bool matchCustomType(const CompiledType* type, bool*)
   {
      if (auto* itype = std::get_if<Int>(&type->original_type->value))
      {
         return itype->bits == 1 && !itype->isSigned;
      }
      return false;
   }

   template <typename T>
   struct BlobImpl
   {
      static bool match(const CompiledType* type)
      {
         if constexpr (requires { T::match(type); })
         {
            return T::match(type);
         }
         else if (type->kind == CompiledType::container)
         {
            const auto& member = type->children[0];
            return !member.is_optional && !member.type->is_variable_size;
         }
         else if (type->kind == CompiledType::nested)
         {
            return true;
         }
         else
         {
            return !type->is_variable_size;
         }
      }
      static bool frac2json(const CompiledType* type, FracStream& in, StreamBase& out)
      {
         if (type->is_container())
         {
            if (type->kind == CompiledType::nested)
            {
               CustomTypes builtin;
               FracParser  tmpParser{in, type, builtin, false};
               while (auto next = tmpParser.next())
               {
                  if (next.kind == FracParser::error)
                     return false;
               }
               in.has_unknown = tmpParser.in.has_unknown;
               in.known_end   = tmpParser.in.known_end;
            }
            std::uint32_t size;
            if (!unpack_numeric<true>(&size, in.src, in.pos, in.end_pos))
               return false;
            std::uint32_t end = in.pos + size;
            if (end > in.end_pos || end < size)
               return false;
            T::frac2json(std::span{in.src + in.pos, size}, out);
            in.pos = end;
            return true;
         }
         else if (!type->is_variable_size)
         {
            std::uint32_t end = in.pos + type->fixed_size;
            if (end > in.end_pos || end < in.pos)
               return false;
            T::frac2json(std::span{in.src + in.pos, type->fixed_size}, out);
            in.pos = end;
            return true;
         }
         return false;
      }
   };

   struct OctetStringImpl
   {
      static void frac2json(std::span<const char> in, StreamBase& out)
      {
         psio::to_json_hex(in.data(), in.size(), out);
      }
   };

   struct StringImpl
   {
      static bool match(const CompiledType* type)
      {
         if (type->kind == CompiledType::container)
         {
            const auto& member = type->children[0];
            if (const auto* t = std::get_if<Int>(&member.type->original_type->value))
            {
               return !member.is_optional && t->bits == 8;
            }
         }
         return false;
      }
      static void frac2json(std::span<const char> in, StreamBase& out)
      {
         to_json(std::string_view{in.data(), in.size()}, out);
      }
   };

   template <int Digits>
   struct TimePointImpl
   {
      // Unwrap a single element struct
      static const CompiledType* unwrap(const CompiledType* type)
      {
         if (type->kind == CompiledType::struct_ && type->children.size() == 1 &&
             !type->children[0].is_optional)
            return type->children[0].type;
         else
            return type;
      }
      static bool match(const CompiledType* type)
      {
         type = unwrap(type);
         // Accept integers up to 64 bits
         if (type->kind == CompiledType::scalar)
         {
            if (auto* itype = std::get_if<Int>(&type->original_type->value))
            {
               return itype->bits <= 64;
            }
         }
         return false;
      }
      static bool frac2json(const CompiledType* type, FracStream& in, StreamBase& out)
      {
         type = unwrap(type);
         if (auto* itype = std::get_if<Int>(&type->original_type->value))
         {
            // read up to 8 bytes
            std::uint64_t raw = 0;
            for (int i = 0; i < (itype->bits + 7) / 8; ++i)
            {
               std::uint8_t digit;
               if (!in.unpack<true, true>(&digit))
                  return false;
               raw += static_cast<std::uint64_t>(digit) << (i * 8);
            }
            // Sign-extend if needed
            std::int64_t value;
            if (itype->isSigned && (raw & (static_cast<std::uint64_t>(1) << (itype->bits - 1))))
            {
               if (itype->bits == 64)
                  value = static_cast<std::int64_t>(raw);
               else
                  value = static_cast<std::int64_t>(
                      raw | ~((static_cast<std::uint64_t>(1) << itype->bits) - 1));
            }
            else
            {
               if (raw & (static_cast<std::uint64_t>(1) << 63))
                  check(false, "Time point out of range");
               value = raw;
            }
            // split seconds from subseconds
            std::int64_t divisor = 1;
            for (int i = 0; i < Digits; ++i)
               divisor *= 10;
            std::int64_t subsec = value % divisor;
            std::int64_t sec    = value / divisor;
            if (subsec < 0)
            {
               --sec;
               subsec += divisor;
            }
            to_json(format_system_time(sec, subsec, Digits), out);
            return true;
         }
         return false;
      }
   };

   struct MapImpl
   {
      static bool match(const CompiledType* type)
      {
         if (type->kind == CompiledType::container)
         {
            const auto& member = type->children[0];
            return !member.is_optional && member.type->children.size() == 2 &&
                   (member.type->kind == CompiledType::object ||
                    member.type->kind == CompiledType::struct_);
         }
         return false;
      }
      static bool frac2json(const CompiledType* type, FracStream& in, StreamBase& out)
      {
         assert(!"This handler should never be used. map needs integration with the parser");
         __builtin_unreachable();
      }
   };

   bool isCustomMap(const AnyType& ty)
   {
      if (auto* custom = std::get_if<Custom>(&ty.value))
      {
         return custom->id == "map";
      }
      return false;
   }

   CustomTypes standard_types()
   {
      CustomTypes result;
      result.insert<bool>("bool");
      result.insert("string", BlobImpl<StringImpl>());
      result.insert("hex", BlobImpl<OctetStringImpl>());
      result.insert("map", MapImpl());
      result.insert("TimePointSec", TimePointImpl<0>());
      result.insert("TimePointUSec", TimePointImpl<6>());
      return result;
   }

   bool CompiledType::matches(const CompiledType* other) const
   {
      std::vector<std::pair<const CompiledType*, const CompiledType*>> stack{{this, other}};
      std::set<std::pair<const CompiledType*, const CompiledType*>>    known;
      while (!stack.empty())
      {
         auto item = stack.back();
         stack.pop_back();
         if (!known.insert(item).second)
         {
            continue;
         }
         auto [lhs, rhs] = item;
         if (lhs->kind != rhs->kind || lhs->is_variable_size != rhs->is_variable_size ||
             lhs->fixed_size != rhs->fixed_size)
         {
            return false;
         }
         if (lhs->children.size() != rhs->children.size())
         {
            return false;
         }
         for (std::size_t i = 0; i < lhs->children.size(); ++i)
         {
            const auto& lm = lhs->children[i];
            const auto& rm = rhs->children[i];
            if (lm.is_optional != rm.is_optional)
               return false;
            stack.push_back({lm.type, rm.type});
         }
      }
      return true;
   }

   // ------
   namespace
   {
      CompiledMember make_member(const CompiledType* mtype,
                                 std::uint32_t&      fixed_size,
                                 bool&               is_variable_size)
      {
         is_variable_size |= mtype->is_variable_size;
         bool is_optional = false;
         if (mtype->kind == CompiledType::optional)
         {
            is_optional = true;
            mtype       = mtype->children[0].type;
         }
         check(fixed_size <= std::numeric_limits<std::uint16_t>::max(), "fixed data too large");
         CompiledMember result{.fixed_offset = static_cast<std::uint16_t>(fixed_size),
                               .is_optional  = is_optional,
                               .type         = mtype};
         if (is_optional || mtype->is_variable_size)
            fixed_size += 4;
         else
            fixed_size += mtype->fixed_size;
         return result;
      }
      void link_impl(CompiledSchema* schema, const std::vector<Member>& members, CompiledType* type)
      {
         for (const auto& member : members)
         {
            type->children.push_back(make_member(schema->get(member.type.resolve(schema->schema)),
                                                 type->fixed_size, type->is_variable_size));
         }
      }

      // List, Option, and Variant do not require their children to be completed first.
      // All other types do.

      enum VertexEvent
      {
         start,
         finish,
         done,
      };
      // nodes that have been discovered but not completed
      // have original_type == nullptr and fixed_size represents
      // its position on the stack.
      //
      // N.B. When a vertex is completed, its children are guaranteed to be
      // discovered, but may not be completed.
      std::pair<CompiledType*, VertexEvent> dfs_discover(CompiledSchema*              schema,
                                                         const AnyType*               type,
                                                         CompiledType::Kind           kind,
                                                         std::vector<const AnyType*>& stack)
      {
         auto& ctype = schema->types[type];
         if (ctype.kind == CompiledType::uninitialized)
         {
            ctype.kind       = kind;
            ctype.fixed_size = stack.size();
            stack.push_back(type);
            return {&ctype, start};
         }
         else
         {
            if (ctype.original_type == nullptr)
            {
               if (ctype.fixed_size != stack.size())
               {
                  check(false, "Invalid recursive type definition");
               }
               ctype.original_type = type;
               ctype.fixed_size    = 0;
               return {&ctype, finish};
            }
            else
            {
               return {&ctype, done};
            }
         }
      }
      CompiledType* dfs_terminal(CompiledSchema*    schema,
                                 const AnyType*     type,
                                 CompiledType::Kind kind)
      {
         auto& ctype = schema->types[type];
         if (ctype.kind == CompiledType::uninitialized)
         {
            ctype.kind          = kind;
            ctype.original_type = type;
            return &ctype;
         }
         else
         {
            return nullptr;
         }
      }

      void add_impl(CompiledSchema*              schema,
                    const AnyType*               type,
                    const Object&                t,
                    std::vector<const AnyType*>& stack,
                    std::vector<const AnyType*>&)
      {
         auto [ctype, state] = dfs_discover(schema, type, CompiledType::object, stack);
         switch (state)
         {
            case start:
               for (const auto& member : t.members)
               {
                  stack.push_back(member.type.resolve(schema->schema));
               }
               break;
            case finish:
               link_impl(schema, t.members, ctype);
               break;
            default:
               break;
         }
      }
      void add_impl(CompiledSchema*              schema,
                    const AnyType*               type,
                    const Struct&                t,
                    std::vector<const AnyType*>& stack,
                    std::vector<const AnyType*>&)
      {
         auto [ctype, state] = dfs_discover(schema, type, CompiledType::struct_, stack);
         switch (state)
         {
            case start:
               check(!t.members.empty(), "Zero-size types not supported");
               for (const auto& member : t.members)
               {
                  stack.push_back(member.type.resolve(schema->schema));
               }
               break;
            case finish:
               ctype->is_variable_size = false;
               link_impl(schema, t.members, ctype);
               break;
            default:
               break;
         }
      }
      void add_impl(CompiledSchema*              schema,
                    const AnyType*               type,
                    const Tuple&                 t,
                    std::vector<const AnyType*>& stack,
                    std::vector<const AnyType*>&)
      {
         auto [ctype, state] = dfs_discover(schema, type, CompiledType::object, stack);
         switch (state)
         {
            case start:
               for (const auto& member : t.members)
               {
                  stack.push_back(member.resolve(schema->schema));
               }
               break;
            case finish:
               for (const auto& member : t.members)
               {
                  ctype->children.push_back(make_member(schema->get(member.resolve(schema->schema)),
                                                        ctype->fixed_size,
                                                        ctype->is_variable_size));
               }
               break;
            default:
               break;
         }
      }
      void add_impl(CompiledSchema*              schema,
                    const AnyType*               type,
                    const Int&                   t,
                    std::vector<const AnyType*>& stack,
                    std::vector<const AnyType*>&)
      {
         if (auto* ctype = dfs_terminal(schema, type, CompiledType::scalar))
         {
            ctype->is_variable_size = false;
            ctype->fixed_size       = (t.bits + 7) / 8;
         }
      }
      void add_impl(CompiledSchema*              schema,
                    const AnyType*               type,
                    const Float&                 t,
                    std::vector<const AnyType*>& stack,
                    std::vector<const AnyType*>&)
      {
         if (auto* ctype = dfs_terminal(schema, type, CompiledType::scalar))
         {
            ctype->is_variable_size = false;
            ctype->fixed_size       = (t.exp + t.mantissa + 7) / 8;
         }
      }
      void add_impl(CompiledSchema*              schema,
                    const AnyType*               type,
                    const Array&                 t,
                    std::vector<const AnyType*>& stack,
                    std::vector<const AnyType*>&)
      {
         auto [ctype, state] = dfs_discover(schema, type, CompiledType::array, stack);
         switch (state)
         {
            case start:
               stack.push_back(t.type->resolve(schema->schema));
               break;
            case finish:
            {
               ctype->is_variable_size    = false;
               const CompiledType* nested = schema->get(t.type->resolve(schema->schema));
               ctype->children.push_back(
                   make_member(nested, ctype->fixed_size, ctype->is_variable_size));
               // TODO: handle array of zero-size elements
               ctype->fixed_size *= t.len;
            }
            break;
            default:
               break;
         }
      }
      void add_impl(CompiledSchema* schema,
                    const AnyType*  type,
                    const Option&   t,
                    std::vector<const AnyType*>&,
                    std::vector<const AnyType*>& queue)
      {
         if (CompiledType* ctype = dfs_terminal(schema, type, CompiledType::optional))
         {
            const AnyType* nested = t.type->resolve(schema->schema);
            queue.push_back(nested);
            ctype->children.push_back({.type = &schema->types[nested]});
         }
      }
      void add_impl(CompiledSchema* schema,
                    const AnyType*  type,
                    const List&     t,
                    std::vector<const AnyType*>&,
                    std::vector<const AnyType*>& queue)
      {
         if (CompiledType* ctype = dfs_terminal(schema, type, CompiledType::container))
         {
            const AnyType* nested = t.type->resolve(schema->schema);
            queue.push_back(nested);
            ctype->children.push_back({.type = &schema->types[nested]});
         }
      }
      void add_impl(CompiledSchema*              schema,
                    const AnyType*               type,
                    const FracPack&              t,
                    std::vector<const AnyType*>& stack,
                    std::vector<const AnyType*>&)
      {
         auto [ctype, state] = dfs_discover(schema, type, CompiledType::nested, stack);
         switch (state)
         {
            case start:
               stack.push_back(t.type->resolve(schema->schema));
               break;
            case finish:
               ctype->children.push_back({.type = schema->get(t.type->resolve(schema->schema))});
               break;
            default:
               break;
         }
      }
      void add_impl(CompiledSchema* schema,
                    const AnyType*  type,
                    const Variant&  t,
                    std::vector<const AnyType*>&,
                    std::vector<const AnyType*>& queue)
      {
         if (CompiledType* ctype = dfs_terminal(schema, type, CompiledType::variant))
         {
            for (const auto& member : t.members)
            {
               const AnyType* nested = member.type.resolve(schema->schema);
               queue.push_back(nested);
               ctype->children.push_back({.type = &schema->types[nested]});
            }
         }
      }
      void add_impl(CompiledSchema*              schema,
                    const AnyType*               type,
                    const Custom&                t,
                    std::vector<const AnyType*>& stack,
                    std::vector<const AnyType*>&)
      {
         auto [ctype, state] = dfs_discover(schema, type, CompiledType::custom, stack);
         switch (state)
         {
            case start:
               stack.push_back(t.type->resolve(schema->schema));
               break;
            case finish:
            {
               CompiledType* child = schema->get(t.type->resolve(schema->schema));
               *ctype              = *child;
            }
            default:
               break;
         }
      }
      void add_impl(CompiledSchema*              schema,
                    const AnyType*               type,
                    const Type&                  t,
                    std::vector<const AnyType*>& stack,
                    std::vector<const AnyType*>&)
      {
         assert(!"type aliases should be resolved before pushing them onto the stack");
      }

   }  // namespace

   CompiledSchema::CompiledSchema(const Schema&               schema,
                                  CustomTypes                 builtin,
                                  std::vector<const AnyType*> extraTypes)
       : schema(schema), builtin(std::move(builtin))
   {
      // collect root types
      std::vector<const AnyType*> stack;
      std::vector<const AnyType*> queue;
      for (const auto* type : extraTypes)
      {
         if (!std::holds_alternative<Type>(type->value))
            queue.push_back(type);
      }
      for (const auto& [name, type] : schema.types)
      {
         if (!std::holds_alternative<Type>(type.value))
            queue.push_back(&type);
         else
            // Detect cycles
            type.resolve(schema);
      }
      // Process all reachable types
      while (!queue.empty())
      {
         stack.swap(queue);
         while (!stack.empty())
         {
            auto top = stack.back();
            stack.pop_back();
            std::visit([&](const auto& t) { add_impl(this, top, t, stack, queue); }, top->value);
         }
      }
      // Resolve optional elements of containers
      for (auto& [type, ctype] : types)
      {
         if (ctype.kind == CompiledType::container)
         {
            CompiledMember& member = ctype.children[0];
            if (member.type->kind == CompiledType::optional)
            {
               member.is_optional = true;
               member.type        = member.type->children[0].type;
            }
         }
      }
      // Custom types need to be resolved last, so the full object graph
      // is available for matching.
      for (auto& [type, ctype] : types)
      {
         if (auto* t = std::get_if<Custom>(&type->value))
         {
            if (auto index = this->builtin.find(t->id))
            {
               if (this->builtin.match(*index, &ctype))
               {
                  if (t->id == "map")
                  {
                     // Potentially recursive custom types need to
                     // be handled in the top level loop.
                     ctype.original_type = type;
                  }
                  else
                  {
                     ctype.custom_id = *index;
                  }
               }
            }
         }
      }
   }

   CompiledType* CompiledSchema::get(const AnyType* type)
   {
      if (auto pos = types.find(type); pos != types.end())
         return &pos->second;
      return nullptr;
   }
   const CompiledType* CompiledSchema::get(const AnyType* type) const
   {
      if (auto pos = types.find(type); pos != types.end())
         return &pos->second;
      return nullptr;
   }
   //-----

   validation_t fracpack_validate(std::span<const char> data,
                                  const CompiledSchema& schema,
                                  const std::string&    type)
   {
      FracParser parser(data, schema, type, false);
      while (auto item = parser.next())
      {
         if (item.kind == FracParser::error)
            return validation_t::invalid;
      }
      if (parser.in.known_end && parser.in.pos != data.size())
         return validation_t::invalid;
      return parser.in.has_unknown ? validation_t::extended : validation_t::valid;
   }

   namespace
   {

      FracParser::Item makeError(const CompiledType* type, std::string_view msg)
      {
         return {.kind = FracParser::error, .data = msg, .type = type};
      }

      void setError(FracParser::Item& result, std::string_view msg)
      {
         result.kind = FracParser::error;
         result.data = msg;
      }

      FracParser::Item check_heap_pos(const FracParser&   parser,
                                      const CompiledType* type,
                                      std::uint32_t       offset)
      {
         if (parser.in.known_end)
         {
            if (parser.in.pos != offset)
               return makeError(type, "wrong offset");
            else if (parser.in.pos > offset)
               return makeError(type, "offset moved backwards");
         }
         return {};
      }

      struct ValidateScalar
      {
         void operator()(const auto&) {}
         void operator()(const Int& type)
         {
            if (auto trailing = type.bits & 0x7)
            {
               if (!type.isSigned)
               {
                  std::uint8_t high = result.data.back();
                  if (high >> trailing)
                     setError(result, "unused bits of unsigned integer must be zero filled");
               }
               else
               {
                  std::int8_t high = result.data.back();
                  if (static_cast<unsigned>(-(high >> trailing)) > 1)
                     setError(result, "signed integer must be sign extended");
               }
            }
         }
         FracParser::Item& result;
      };
   }  // namespace

   struct ObjectReader
   {
      std::uint32_t       start_pos;
      std::uint32_t       index;
      const CompiledType* type;
      bool                last_has_value = true;
      FracParser::Item    next(FracParser& parser)
      {
         std::uint16_t fixed_size;
         auto          fixed_pos = start_pos;
         if (type->kind == CompiledType::struct_)
         {
            fixed_size = type->fixed_size;
         }
         else
         {
            (void)unpack_numeric<false>(&fixed_size, parser.in.src, fixed_pos, parser.in.end_pos);
         }
         if (index == type->children.size())
         {
            if (fixed_size > type->fixed_size)
            {
               if (type->kind == CompiledType::struct_)
                  return makeError(type, "non-extensible struct may not not have extensions");
               if (!verify_extensions(parser.in.src, parser.in.known_end, last_has_value,
                                      fixed_pos + type->fixed_size, fixed_pos + fixed_size,
                                      parser.in.pos, parser.in.end_pos))
                  return makeError(type, "All extensions must be optional");
               parser.in.has_unknown = true;
               parser.in.known_end   = false;
            }
            if (type->kind != CompiledType::struct_ && !last_has_value)
               return makeError(type, "Trailing empty optionals must be omitted");
            return {.kind = FracParser::end, .type = type};
         }
         const auto&      member = type->children[index];
         FracParser::Item result{.type = member.type, .parent = type, .index = index};
         ++index;
         auto fixed_end = fixed_pos + fixed_size;
         fixed_pos += member.fixed_offset;
         if (!member.is_optional && !member.type->is_variable_size)
         {
            if (member.fixed_offset > fixed_size)
               return makeError(type, "Missing non-optional member");
            if (member.type->fixed_size >
                static_cast<std::uint16_t>(fixed_size - member.fixed_offset))
               return makeError(type, "Fixed data too small");
            parser.parse_fixed(result, member.type, fixed_pos);
         }
         else if (member.is_optional && member.fixed_offset >= fixed_size)
         {
            result.kind = FracParser::empty;
         }
         else
         {
            parser.deref(fixed_pos, fixed_end, member.type, member.is_optional, result);
            last_has_value = result.kind != FracParser::empty;
         }
         return result;
      }
   };

   struct OptionReader
   {
      const CompiledType* type;
      bool                completed = false;
      FracParser::Item    next(FracParser& parser)
      {
         if (completed)
            return {.kind = FracParser::end, .type = type};
         else
            completed = true;
         const CompiledType* nested = type->children[0].type;
         FracParser::Item    result{.type = nested, .parent = type};
         auto                start_pos = parser.in.pos;
         parser.in.pos += 4;
         parser.deref(start_pos, parser.in.end_pos, nested, true, result);
         return result;
      }
   };

   struct ArrayReader
   {
      const CompiledType* type;
      std::uint32_t       pos;
      std::uint32_t       end;
      FracParser::Item    next(FracParser& parser)
      {
         if (pos == end)
         {
            return {.kind = FracParser::end, .type = type};
         }
         const CompiledMember& member = type->children[0];
         FracParser::Item      result{.type = member.type, .parent = type};
         if (!member.is_optional && !member.type->is_variable_size)
         {
            parser.parse_fixed(result, member.type, pos);
            pos += member.type->fixed_size;
         }
         else
         {
            parser.deref(pos, end, member.type, member.is_optional, result);
            pos += 4;
         }
         return result;
      }
   };

   struct VariantReader
   {
      const CompiledType* type;
      std::uint32_t       old_end_pos = 0;
      FracParser::Item    next(FracParser& parser)
      {
         if (old_end_pos != 0)
         {
            if (auto err = check_heap_pos(parser, type, parser.in.end_pos))
               return err;
            parser.in.pos       = parser.in.end_pos;
            parser.in.known_end = true;
            parser.in.end_pos   = old_end_pos;
            return {.kind = FracParser::end, .type = type};
         }
         uint8_t tag;
         if (!unpack_numeric<true>(&tag, parser.in.src, parser.in.pos, parser.in.end_pos))
            return makeError(type, "Cannot unpack variant tag");
         if (tag & 0x80)
            return makeError(type, "Variant tag cannot be greater than 127");
         uint32_t size;
         if (!unpack_numeric<true>(&size, parser.in.src, parser.in.pos, parser.in.end_pos))
            return makeError(type, "Cannot read variant tag");
         auto new_end = parser.in.pos + size;
         if (new_end > parser.in.end_pos || new_end < size)
            return makeError(type, "Variant size out-of-bounds");
         old_end_pos       = parser.in.end_pos;
         parser.in.end_pos = new_end;
         if (tag >= type->children.size())
            return makeError(type, "Variant tag out-of-range");
         auto result   = parser.parse(type->children[tag].type);
         result.parent = type;
         result.index  = tag;
         return result;
      }
   };

   struct NestedReader
   {
      const CompiledType* type;
      std::uint32_t       offset;
      std::uint32_t       old_end_pos = 0;
      FracParser::Item    next(FracParser& parser)
      {
         if (old_end_pos != 0)
         {
            if (auto err = check_heap_pos(parser, type, parser.in.end_pos))
               return err;
            parser.in.known_end = true;
            parser.in.pos       = parser.in.end_pos;
            parser.in.end_pos   = old_end_pos;
            return {.kind = FracParser::end, .type = type};
         }
         std::uint32_t size;
         if (!unpack_numeric<true>(&size, parser.in.src, offset, parser.in.end_pos))
            return makeError(type, "Cannot read container size");
         old_end_pos = parser.in.end_pos;
         if (size == 0)
         {
            parser.in.pos = parser.in.end_pos;
         }
         else
         {
            parser.in.pos = offset;
            auto new_end  = offset + size;
            if (new_end > parser.in.end_pos || new_end < offset)
               return makeError(type, "Container size out-of-bounds");
            parser.in.end_pos = new_end;
         }
         auto result   = parser.parse(type->children[0].type);
         result.parent = type;
         return result;
      }
   };

   FracParser::FracParser(std::span<const char> data,
                          const CompiledSchema& schema,
                          const std::string&    type,
                          bool                  enableCustom)
       : in(data), builtin(schema.builtin), enableCustom(enableCustom)
   {
      if (auto xtype = schema.schema.get(type))
      {
         auto ctype = schema.get(xtype->resolve(schema.schema));
         check(ctype != 0, "could not find type");

         stack.push_back(parse(ctype));
      }
   }

   FracParser::FracParser(const FracStream&   in,
                          const CompiledType* type,
                          const CustomTypes&  builtin,
                          bool                enableCustom)
       : in(in), builtin(builtin), enableCustom(enableCustom)
   {
      stack.push_back(parse(type));
   }

   FracParser::~FracParser() = default;

   void FracParser::deref(std::uint32_t       fixed_pos,
                          std::uint32_t       end_fixed_pos,
                          const CompiledType* type,
                          bool                is_optional,
                          Item&               result)
   {
      std::uint32_t offset;
      auto          tmp_pos = fixed_pos;
      if (!unpack_numeric<true>(&offset, in.src, tmp_pos, end_fixed_pos))
         return setError(result, "Cannot read pointer");
      // If the type is an optional
      if (is_optional && offset == 1)
      {
         result.kind = FracParser::empty;
      }
      else
      {
         // validate offset
         std::uint32_t pos = fixed_pos + offset;
         if (pos < offset)
            return setError(result, "integer overflow");
         if (!type->is_container() || offset != 0)
         {
            if (auto err = check_heap_pos(*this, type, pos))
            {
               result.data = err.data;
               result.kind = err.kind;
               return;
            }
         }
         if (type->custom_id != -1 && enableCustom)
         {
            result.kind = FracParser::custom;
            if (offset == 0)
               result.data = std::span{in.src + fixed_pos, in.src + tmp_pos};
            else
               in.pos = pos;
         }
         else if (type->kind == CompiledType::scalar)
         {
            read(type, pos, result);
         }
         else
         {
            if (offset == 0)
            {
               assert(type->is_container());
               result.kind = FracParser::start;
               stack.push_back(ArrayReader{.type = type, .pos = pos, .end = pos});
            }
            else if (auto err = push(type, pos, offset != 0))
               result = err;
            else
               result.kind = FracParser::start;
         }
      }
   }

   FracParser::Item FracParser::parse(const CompiledType* ctype)
   {
      Item result{.type = ctype};
      if (ctype->custom_id != -1 && enableCustom)
      {
         result.kind = FracParser::custom;
      }
      else if (ctype->kind == CompiledType::scalar)
      {
         read(ctype, in.pos, result);
      }
      else if (ctype->kind == CompiledType::optional)
      {
         result = OptionReader{ctype}.next(*this);
      }
      else
      {
         if (auto err = push(ctype, in.pos))
            result = err;
         else
            result.kind = FracParser::start;
      }
      return result;
   }

   void FracParser::parse_fixed(Item& result, const CompiledType* ctype, std::uint32_t fixed_pos)
   {
      if (ctype->custom_id != -1 && enableCustom)
      {
         result.data = read_fixed(ctype, fixed_pos);
         result.kind = FracParser::custom;
      }
      else if (ctype->kind == CompiledType::scalar)
      {
         result.data = read_fixed(ctype, fixed_pos);
         result.kind = FracParser::scalar;
      }
      else
      {
         push_fixed(ctype, fixed_pos);
         result.kind = FracParser::start;
      }
   }

   FracParser::Item FracParser::next()
   {
      if (stack.empty())
         return {};
      std::size_t original_size = stack.size();
      auto        result        = std::visit(
          [&](auto& item)
          {
             // ensure that the reader can safely push items onto the stack
             auto copy                = std::move(item);
             auto res                 = copy.next(*this);
             stack[original_size - 1] = std::move(copy);
             return res;
          },
          stack.back());
      if (result.kind == error)
         stack.clear();
      else if (result.kind == end || std::holds_alternative<Item>(stack.back()))
      {
         stack.pop_back();
      }
      return result;
   }

   FracParser::Item FracParser::select_child(std::uint32_t index)
   {
      if (stack.empty())
         return makeError(nullptr, "Parse stack is empty");
      if (auto* item = std::get_if<Item>(&stack.back()))
      {
         if (item->kind == start)
         {
            stack.pop_back();
         }
      }
      if (auto* reader = std::get_if<ObjectReader>(&stack.back()))
      {
         auto copy    = std::move(*reader);
         copy.index   = index;
         in.known_end = false;
         stack.clear();
         return copy.next(*this);
      }
      else
      {
         return makeError(std::visit([](auto& item) { return item.type; }, stack.back()),
                          "Can only select child of object types");
      }
   }

   void FracParser::push(const Item& item)
   {
      stack.push_back(item);
   }

   namespace
   {

      struct StartPos
      {
         std::uint32_t operator()(const ObjectReader& reader, const FracParser&) const
         {
            return reader.start_pos;
         }
         std::uint32_t operator()(const ArrayReader& reader, const FracParser&) const
         {
            if (reader.type->kind == CompiledType::container)
            {
               return reader.pos - 4;
            }
            else
            {
               return reader.pos;
            }
         }
         std::uint32_t operator()(const OptionReader&, const FracParser& parser) const
         {
            return parser.in.pos;
         }
         std::uint32_t operator()(const VariantReader&, const FracParser& parser) const
         {
            return parser.in.pos;
         }
         std::uint32_t operator()(const NestedReader&, const FracParser& parser) const
         {
            return parser.in.pos;
         }
         std::uint32_t operator()(const FracParser::Item& reader, const FracParser& parser) const
         {
            check(false, "Only single item put back is supported");
            return 0;
         }
      };

   }  // namespace

   std::uint32_t FracParser::get_pos(const Item& item) const
   {
      switch (item.kind)
      {
         case FracParser::start:
            // peek at the top of the stack
            return std::visit([&](auto& r) { return StartPos{}(r, *this); }, stack.back());
         case FracParser::scalar:
            return static_cast<std::uint32_t>(item.data.data() - in.src);
         case FracParser::custom:
            if (item.data.empty())
            {
               return in.pos;
            }
            else
            {
               return static_cast<std::uint32_t>(item.data.data() - in.src);
            }
         case FracParser::end:
         case FracParser::empty:
         case FracParser::error:
            check(false, "Cannot get start pos");
      }
      return 0;
   }

   void FracParser::set_pos(std::uint32_t pos)
   {
      in.pos       = pos;
      in.known_end = true;
      stack.clear();
   }

   FracParser::Item FracParser::push(const CompiledType* type, std::uint32_t offset, bool pointer)
   {
      in.pos = offset;
      switch (type->kind)
      {
         case CompiledType::object:
         case CompiledType::struct_:
         {
            std::uint16_t fixed_size;
            if (type->kind == CompiledType::struct_)
               fixed_size = type->fixed_size;
            else if (!unpack_numeric<true>(&fixed_size, in.src, in.pos, in.end_pos))
               return makeError(type, "Failed to read object size");
            auto heap_start = in.pos + fixed_size;
            if (heap_start < in.pos || heap_start > in.end_pos)
               return makeError(type, "Object fixed data out-of-bounds");
            in.pos = heap_start;
            stack.push_back(ObjectReader{.start_pos = offset, .index = 0, .type = type});
            in.known_end = true;
            break;
         }
         case CompiledType::nested:
         {
            stack.push_back(NestedReader{.type = type, .offset = offset});
            in.known_end = true;
            break;
         }
         case CompiledType::container:
         {
            // get size
            std::uint32_t size;
            if (!unpack_numeric<true>(&size, in.src, in.pos, in.end_pos))
               return makeError(type, "Failed to read container size");
            auto heap_start = in.pos + size;
            if (heap_start < in.pos || heap_start > in.end_pos)
               return makeError(type, "Container size out-of-bounds");
            const CompiledMember& member = type->children[0];
            if (pointer && size == 0)
               return makeError(type, "Empty container member must use zero offset");
            if (member.is_optional || member.type->is_variable_size)
            {
               if (size % 4 != 0)
                  return makeError(type, "Container size is not an exact number of pointers");
            }
            else
            {
               if (size % member.type->fixed_size != 0)
                  return makeError(type, "Container size is not an exact number of elements");
            }
            auto pos = in.pos;
            in.pos   = heap_start;
            stack.push_back(ArrayReader{.type = type, .pos = pos, .end = heap_start});
            in.known_end = true;
            break;
         }
         case CompiledType::array:
         {
            auto start = offset;
            auto end   = offset + type->fixed_size;
            if (end > in.end_pos || end < offset)
               return makeError(type, "Array data too large");
            in.pos = end;
            stack.push_back(ArrayReader{.type = type, .pos = start, .end = end});
            break;
         }
         case CompiledType::optional:
         {
            stack.push_back(OptionReader{type});
            in.known_end = true;
            break;
         }
         case CompiledType::variant:
         {
            stack.push_back(VariantReader{type});
            in.known_end = true;
            break;
         }
         default:
            assert(!"Not implemented");
      }
      return {};
   }
   void FracParser::push_fixed(const CompiledType* type, std::uint32_t offset)
   {
      switch (type->kind)
      {
         case CompiledType::struct_:
         {
            stack.push_back(ObjectReader{.start_pos = offset, .index = 0, .type = type});
            break;
         }
         case CompiledType::array:
         {
            stack.push_back(
                ArrayReader{.type = type, .pos = offset, .end = offset + type->fixed_size});
            break;
         }
         default:
            assert(!"Not a fixed size type");
      }
   }

   void FracParser::read(const CompiledType* type, std::uint32_t offset, Item& result)
   {
      in.pos = offset + type->fixed_size;
      if (in.pos > in.end_pos || in.pos < offset)
         result = makeError(type, "out-of-bounds read");
      else
      {
         result.data = {in.src + offset, type->fixed_size};
         result.kind = FracParser::scalar;
         std::visit(ValidateScalar{result}, type->original_type->value);
      }
   }
   std::span<const char> FracParser::read_fixed(const CompiledType* type, std::uint32_t offset)
   {
      // TODO: verify bounds against end of fixed data
      return {in.src + offset, type->fixed_size};
   }

   namespace
   {
      void visitTypes(auto&& f, AnyType& type);
      void visitTypes(auto&& f, AnyType&, List& type)
      {
         visitTypes(f, *type.type);
      }
      void visitTypes(auto&& f, AnyType&, Array& type)
      {
         visitTypes(f, *type.type);
      }
      void visitTypes(auto&& f, AnyType&, Option& type)
      {
         visitTypes(f, *type.type);
      }
      void visitTypes(auto&& f, AnyType&, Custom& type)
      {
         visitTypes(f, *type.type);
      }
      void visitTypes(auto&& f, std::vector<Member>& types)
      {
         for (auto& member : types)
         {
            visitTypes(f, member.type);
         }
      }
      void visitTypes(auto&& f, AnyType&, Object& type)
      {
         visitTypes(f, type.members);
      }
      void visitTypes(auto&& f, AnyType&, Struct& type)
      {
         visitTypes(f, type.members);
      }
      void visitTypes(auto&& f, AnyType&, Tuple& type)
      {
         for (auto& member : type.members)
         {
            visitTypes(f, member);
         }
      }
      void visitTypes(auto&& f, AnyType&, Variant& type)
      {
         visitTypes(f, type.members);
      }
      void visitTypes(auto&& f, AnyType&, FracPack& type)
      {
         visitTypes(f, *type.type);
      }
      void visitTypes(auto&&, AnyType&, Int&) {}
      void visitTypes(auto&&, AnyType&, Float&) {}
      void visitTypes(auto&& f, AnyType& type, Type& t)
      {
         f(type, t);
      }
      void visitTypes(auto&& f, AnyType& type)
      {
         std::visit([&](auto& t) { visitTypes(f, type, t); }, type.value);
      }
      std::weak_ordering compareAlias(std::string_view lhs, std::string_view rhs)
      {
         bool lhsCanReplace = lhs.starts_with('@');
         bool rhsCanReplace = rhs.starts_with('@');
         if (!lhsCanReplace && !rhsCanReplace)
            return std::weak_ordering::equivalent;
         return std::tuple(lhsCanReplace, lhs.size(), lhs) <=>
                std::tuple(rhsCanReplace, rhs.size(), rhs);
      }

      struct Renamer
      {
         struct RenameInfo
         {
            std::size_t count    = 0;
            std::string bestName = "@";
            bool        shouldInline() const { return count == 1 && bestName.starts_with('@'); }
         };
         std::map<std::string, RenameInfo> fixedNames;
         Schema&                           types;
         // returns either a non-@ name or the final name, whichever is encountered first
         const std::string& getAlias(const std::string& name)
         {
            auto current = &name;
            while (true)
            {
               if (!current->starts_with('@'))
                  return *current;
               auto pos = types.types.find(*current);
               if (pos == types.types.end())
                  check(false, "missing type");
               if (auto alias = std::get_if<Type>(&pos->second.value))
               {
                  current = &alias->type;
               }
               else
               {
                  return *current;
               }
            }
         }
         auto addRef()
         {
            return [this](AnyType&, Type& t) { ++fixedNames[getAlias(t.type)].count; };
         }
         auto rename_fn()
         {
            return [this](AnyType& original, Type& t)
            {
               const auto& alias = getAlias(t.type);
               if (alias.starts_with('@'))
               {
                  auto pos = fixedNames.find(alias);
                  if (pos == fixedNames.end())
                     check(false, "Failed to resolved " + alias);
                  if (pos->second.shouldInline())
                  {
                     auto pos = types.types.find(alias);
                     assert(pos != types.types.end());
                     rename(pos->second);
                     original = std::move(pos->second);
                  }
                  else
                  {
                     t.type = pos->second.bestName;
                  }
               }
               else
                  t.type = alias;
            };
         }
         void rename(AnyType& t) { visitTypes(rename_fn(), t); }
      };
   }  // namespace

   void SchemaBuilder::optimize(std::span<AnyType* const> ext)
   {
      // Group all aliases, user defined types are not replaced
      // lower numbered aliases are preferred.
      Renamer renamer{.types = schema};
      for (AnyType* type : ext)
      {
         visitTypes(renamer.addRef(), *type);
      }
      for (auto& [name, type] : schema.types)
      {
         auto& bestName = renamer.fixedNames[renamer.getAlias(name)].bestName;
         if (bestName == "@" || compareAlias(name, bestName) < 0)
            bestName = name;
         if (!name.starts_with('@'))
         {
            if (auto* alias = std::get_if<Type>(&type.value))
            {
               renamer.fixedNames[renamer.getAlias(alias->type)].bestName = name;
            }
         }
         if (!std::holds_alternative<Type>(type.value))
         {
            visitTypes(renamer.addRef(), type);
         }
      }
      // Build the new schema
      Schema result;
      for (AnyType* type : ext)
      {
         renamer.rename(*type);
      }
      for (auto& [name, type] : schema.types)
      {
         if (auto* alias = std::get_if<Type>(&type.value))
         {
            // Skip aliases that have auto-generated names
            if (!name.starts_with('@'))
            {
               const auto& aliasName = renamer.getAlias(alias->type);
               const auto& bestName =
                   aliasName.starts_with('@') ? renamer.fixedNames[aliasName].bestName : aliasName;
               if (bestName != name)
                  result.types.insert({name, Type{bestName}});
            }
         }
         else
         {
            const auto& info = renamer.fixedNames[name];
            if (!info.shouldInline())
            {
               renamer.rename(type);
               result.types.insert({info.bestName, std::move(type)});
            }
         }
      }
      schema = std::move(result);
   }

   AnyType to_schema(SchemaBuilder& builder, const Object*)
   {
      return Custom{.type = builder.insert<std::vector<Member>>(), .id = "map"};
   }

   AnyType to_schema(SchemaBuilder& builder, const Struct*)
   {
      return Custom{.type = builder.insert<std::vector<Member>>(), .id = "map"};
   }

   AnyType to_schema(SchemaBuilder& builder, const Variant*)
   {
      return Custom{.type = builder.insert<std::vector<Member>>(), .id = "map"};
   }

   struct SchemaMatch
   {
      const Schema&                                       schema1;
      const Schema&                                       schema2;
      std::map<const AnyType*, std::size_t>               on_stack;
      std::set<std::pair<const AnyType*, const AnyType*>> known;
      SchemaDifference                                    difference = SchemaDifference::equivalent;

      const AnyType* resolveAll(const Schema& schema, const AnyType& type)
      {
         const AnyType* result = &type;
         while (true)
         {
            if (const Custom* c = std::get_if<Custom>(&result->value))
               result = c->type.get();
            else if (const Type* t = std::get_if<Type>(&result->value))
               result = schema.get(t->type);
            else
               return result;
         }
      }
      bool isOptional(const Schema& schema, const AnyType& type)
      {
         return std::holds_alternative<Option>(resolveAll(schema, type)->value);
      }
      bool match(const AnyType& lhs, const AnyType& rhs)
      {
         auto plhs    = resolveAll(schema1, lhs);
         auto prhs    = resolveAll(schema2, rhs);
         auto lhs_pos = on_stack.find(plhs);
         auto rhs_pos = on_stack.find(prhs);
         if (lhs_pos != on_stack.end() && rhs_pos != on_stack.end())
         {
            if (lhs_pos->second != rhs_pos->second)
               return false;
         }
         else if (lhs_pos != on_stack.end() || rhs_pos != on_stack.end())
            return false;

         if (!known.insert({plhs, prhs}).second)
            return true;

         std::size_t n = on_stack.size() / 2;
         on_stack.insert({&lhs, n});
         on_stack.insert({&rhs, n});

         bool result = std::visit([this](const auto& l, const auto& r) { return match(l, r); },
                                  plhs->value, prhs->value);

         on_stack.erase(prhs);
         on_stack.erase(plhs);
         return result;
      }

      static const AnyType& memberType(const AnyType& type) { return type; }
      static const AnyType& memberType(const Member& member) { return member.type; }
      template <typename T, typename U>
         requires(std::is_same_v<T, Tuple> || std::is_same_v<T, Object>) &&
                 (std::is_same_v<U, Tuple> || std::is_same_v<U, Object>)
      bool match(const T& lhs, const U& rhs)
      {
         for (std::size_t i = 0, end = std::max(lhs.members.size(), rhs.members.size()); i != end;
              ++i)
         {
            if (i >= lhs.members.size())
            {
               if (!isOptional(schema2, memberType(rhs.members[i])))
                  return false;
            }
            else if (i >= rhs.members.size())
            {
               if (!isOptional(schema1, memberType(lhs.members[i])))
                  return false;
            }
            else if (!match(memberType(lhs.members[i]), memberType(rhs.members[i])))
               return false;
         }
         if (lhs.members.size() > rhs.members.size())
            difference |= SchemaDifference::dropField;
         else if (lhs.members.size() < rhs.members.size())
            difference |= SchemaDifference::addField;
         return true;
      }
      bool match(const Struct& lhs, const Struct& rhs)
      {
         return std::ranges::equal(lhs.members, rhs.members, [this](const auto& l, const auto& r)
                                   { return match(l.type, r.type); });
      }
      bool match(const Array& lhs, const Array& rhs)
      {
         return lhs.len == rhs.len && match(*lhs.type, *rhs.type);
      }
      bool match(const List& lhs, const List& rhs) { return match(*lhs.type, *rhs.type); }
      bool match(const Option& lhs, const Option& rhs) { return match(*lhs.type, *rhs.type); }
      bool match(const Variant& lhs, const Variant& rhs)
      {
         for (std::size_t i = 0, end = std::min(lhs.members.size(), rhs.members.size()); i != end;
              ++i)
         {
            if (!match(lhs.members[i].type, rhs.members[i].type))
               return false;
         }
         if (lhs.members.size() < rhs.members.size())
            difference |= SchemaDifference::addField;
         else if (rhs.members.size() < lhs.members.size())
            difference |= SchemaDifference::dropField;
         return true;
      }
      bool match(const Float& lhs, const Float& rhs) { return lhs == rhs; }
      bool match(const Int& lhs, const Int& rhs) { return lhs == rhs; }
      bool match(const FracPack& lhs, const FracPack& rhs) { return match(*lhs.type, *rhs.type); }
      bool match(const FracPack& lhs, const List& rhs)
      {
         difference |= SchemaDifference::addAlternative;
         auto* t = resolveAll(schema2, *rhs.type);
         if (auto* i = std::get_if<Int>(&t->value))
         {
            return i->bits == 8;
         }
         return false;
      }
      bool match(const List& lhs, const FracPack& rhs)
      {
         difference |= SchemaDifference::dropAlternative;
         auto* t = resolveAll(schema1, *lhs.type);
         if (auto* i = std::get_if<Int>(&t->value))
         {
            return i->bits == 8;
         }
         return false;
      }
      bool match(const auto&, const auto&) { return false; }
   };

   SchemaDifference match(const Schema&                                   schema1,
                          const Schema&                                   schema2,
                          const std::vector<std::pair<AnyType, AnyType>>& types)
   {
      SchemaMatch impl{schema1, schema2};
      for (const auto& [lhs, rhs] : types)
      {
         if (!impl.match(lhs, rhs))
            return SchemaDifference::incompatible;
      }
      return impl.difference;
   }

}  // namespace psio::schema_types
