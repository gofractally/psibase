#include <services/user/REvents.hpp>

#include <sqlite3.h>
#include <psibase/Table.hpp>
#include <psibase/dispatch.hpp>
#include <psibase/nativeTables.hpp>
#include <psio/schema.hpp>
#include <regex>
#include <services/user/Events.hpp>
#include <services/user/EventsTables.hpp>

#include "SchemaCache.hpp"
#include "eventKeys.hpp"
#include "types.hpp"

using namespace psibase;
using namespace psio::schema_types;
using namespace UserService;

template <typename T>
struct ExtraCustom
{
   ExtraCustom(const CustomTypes& origin, std::initializer_list<std::pair<std::string, T>> v)
   {
      for (const auto& [key, value] : v)
      {
         add(origin, key, value);
      }
   }
   void add(std::size_t index, T value)
   {
      if (index >= values.size())
         values.resize(index + 1);
      values[index] = std::move(value);
   }
   void add(const CustomTypes& origin, const std::string& name, T value)
   {
      if (const std::size_t* idx = origin.find(name))
      {
         add(*idx, std::move(value));
      }
   }
   const T* find(std::size_t index) const
   {
      if (index >= values.size())
         return nullptr;
      if constexpr (requires { !values[index]; })
      {
         if (!values[index])
            return nullptr;
      }
      return &values[index];
   }
   std::vector<T> values;
};

int compare_account_number(void*, int lsize, const void* ldata, int rsize, const void* rdata)
{
   auto lhs = AccountNumber{std::string_view{(const char*)ldata, static_cast<std::size_t>(lsize)}};
   auto rhs = AccountNumber{std::string_view{(const char*)rdata, static_cast<std::size_t>(rsize)}};
   if (lhs < rhs)
      return -1;
   else if (rhs < lhs)
      return 1;
   else
      return 0;
}

const auto& custom_collation()
{
   static const ExtraCustom<const char*> result{psibase_builtins, {{"AccountNumber", "ACCOUNT"}}};
   return result;
}

void register_collation(void*, sqlite3* db, int eTextRep, const char* name)
{
   if (name == std::string_view{"ACCOUNT"})
   {
      sqlite3_create_collation(db, name, SQLITE_UTF8, nullptr, compare_account_number);
   }
}

void getColumns(const CompiledType* ctype, const Object& type, auto& stream)
{
   for (std::size_t i = 0; i < ctype->children.size(); ++i)
   {
      check(i < type.members.size(), "Internal error: wrong number of members");
      const auto& member = type.members[i];
      if (i != 0)
         stream.write(',');
      stream.write(member.name.data(), member.name.size());
      if (const char* const* collate = custom_collation().find(ctype->children[i].type->custom_id))
      {
         stream.write(" TEXT COLLATE ", 14);
         stream.write(*collate, std::strlen(*collate));
      }
   }
}

void getColumns(const CompiledType*, const auto& type, auto&)
{
   abortMessage("Unsupported row type: " + psio::convert_to_json(AnyType{type}));
}

void getColumns(const CompiledType* type, auto& stream)
{
   std::visit([&](const auto& t) { return getColumns(type, t, stream); },
              type->original_type->value);
}

struct EventVTab : sqlite3_vtab
{
   EventVTab(DbId db, AccountNumber service, MethodNumber event, const CompiledType* type)
       : index{db, service, event}, rowType(type)
   {
      auto secondary = SecondaryIndexTable(
          DbId::writeOnly,
          psio::convert_to_key(std::tuple(EventIndex::service, secondaryIndexReadyTableNum)));
      if (auto row = secondary.getIndex<0>().get(std::tuple(db, service, event)))
         indexes = std::move(row->indexes);
      else
         indexes = std::vector{SecondaryIndexInfo{}};
   }
   EventIndexTable                 index;
   std::vector<SecondaryIndexInfo> indexes;
   const CompiledType*             rowType;
   std::vector<char>               key() const { return psio::convert_to_key(index); }
   std::string_view                get_collation(int column) const
   {
      if (const char* const* collate =
              custom_collation().find(rowType->children[column].type->custom_id))
      {
         return *collate;
      }
      return "BINARY";
   }
};

struct EventCursor : sqlite3_vtab_cursor
{
   std::vector<char> key;
   std::vector<char> end;
   std::vector<char> data;
   std::size_t       prefixLen;
   EventCursor(const EventVTab& vtab) : key(vtab.key()), prefixLen(key.size() + 1) {}
   EventVTab* vtab() { return static_cast<EventVTab*>(pVtab); }
   int        setEof()
   {
      key.resize(prefixLen - 1);
      return SQLITE_OK;
   }
   bool          eof() { return key.size() < prefixLen; }
   std::uint64_t eventId() const { return keyToEventId(key, prefixLen); }
   void          seek()
   {
      auto sz = psibase::raw::kvGreaterEqual(DbId::writeOnly, key.data(), key.size(), prefixLen);
      if (sz == 0xffffffffu)
      {
         setEof();
      }
      else
      {
         // vtab()->index.db
         auto key_size = psibase::raw::getKey(nullptr, 0);
         key.resize(key_size);
         psibase::raw::getKey(key.data(), key.size());
         if (!end.empty() && compare_blob(key, end) >= 0)
            setEof();
         else
         {
            sz = psibase::raw::getSequential(vtab()->index.db, eventId());
            if (sz == 0xffffffffu)
            {
               check(false, "Internal error: indexed event does not exist");
            }
            data.resize(sz);
            psibase::raw::getResult(data.data(), data.size(), 0);
            // Extract just the data
            psio::FracStream stream{data};
            std::uint16_t    fixed_size;
            if (!stream.unpack<true, true>(&fixed_size))
            {
               check(false, "Internal error: malformed event");
            }
            std::uint32_t fixed_end = stream.pos + fixed_size;
            if (fixed_end > stream.end_pos || fixed_end < stream.pos)
            {
               check(false, "Internal error: fixed size out-of-bounds");
            }
            std::uint32_t heap_end = stream.end_pos;
            stream.end_pos         = fixed_end;
            AccountNumber eventService;
            if (!stream.unpack<true, true>(&eventService))
            {
               check(false, "Internal error: event missing service");
            }
            if (eventService != vtab()->index.service)
            {
               check(false, "Internal error: event service does not match index");
            }
            std::uint32_t typePtr;
            if (!stream.unpack<true, true>(&typePtr) || typePtr == 1)
            {
               check(false, "Internal error: event missing type");
            }
            std::uint32_t valuePtr;
            if (!stream.unpack<true, true>(&valuePtr) || typePtr == 1)
            {
               check(false, "Internal error: event mising data");
            }
            std::uint32_t valueStart = stream.pos - 4 + valuePtr;
            if (valueStart < valuePtr || valueStart > heap_end)
            {
               check(false, "Internal error: event data out-of-bounds");
            }
            // Find the end of the event data (either the end of the wrapper,
            // or the start of the next heap object)
            std::uint32_t nextPtr;
            while (true)
            {
               if (!stream.unpack<true, true>(&nextPtr))
               {
                  nextPtr = heap_end;
                  break;
               }
               else if (nextPtr > 1)
               {
                  nextPtr = stream.pos - 4 + nextPtr;
                  if (nextPtr > heap_end || nextPtr < stream.pos)
                  {
                     check(false, "extension out-of-bounds");
                  }
                  break;
               }
            }

            data.erase(data.begin() + nextPtr, data.end());
            data.erase(data.begin(), data.begin() + valueStart);
         }
      }
   }
};

int event_eof(sqlite3_vtab_cursor* cursor)
{
   auto* c = static_cast<EventCursor*>(cursor);
   return c->eof() ? 1 : 0;
}

int event_next(sqlite3_vtab_cursor* cursor)
{
   auto* c = static_cast<EventCursor*>(cursor);
   if (c->eof())
   {
      return SQLITE_ERROR;
   }
   c->key.push_back('\0');
   c->seek();
   return SQLITE_OK;
}

int event_rowid(sqlite3_vtab_cursor* cursor, sqlite_int64* result)
{
   auto* c = static_cast<EventCursor*>(cursor);
   if (c->eof())
      return SQLITE_ERROR;
   *result = c->eventId();
   return SQLITE_OK;
}

int scalar_to_sql(const Int& type, std::span<const char> in, sqlite3_context* ctx)
{
   std::uint64_t result = 0;
   if (in.size() > sizeof(result))
   {
      sqlite3_result_text(ctx, "Integer too large", -1, SQLITE_STATIC);
      return SQLITE_ERROR;
   }
   std::memcpy(&result, in.data(), in.size());
   if (type.isSigned)
   {
      auto sext = 64 - type.bits;
      sqlite3_result_int64(ctx, static_cast<sqlite3_int64>(result << sext) >> sext);
   }
   else
   {
      if (result & (1ull << 63))
      {
         sqlite3_result_double(ctx, result);
      }
      else
      {
         sqlite3_result_int64(ctx, static_cast<sqlite_int64>(result));
      }
   }
   return SQLITE_OK;
}

int scalar_to_sql(const Float& type, std::span<const char> in, sqlite3_context* ctx)
{
   if (type == Float{.exp = 11, .mantissa = 53})
   {
      double value;
      assert(in.size() == sizeof(value));
      std::memcpy(&value, in.data(), in.size());
      sqlite3_result_double(ctx, value);
      return SQLITE_OK;
   }
   else if (type == Float{.exp = 8, .mantissa = 24})
   {
      float value;
      assert(in.size() == sizeof(value));
      std::memcpy(&value, in.data(), in.size());
      sqlite3_result_double(ctx, value);
      return SQLITE_OK;
   }
   else
   {
      sqlite3_result_text(ctx,
                          "Only single and double precision floating point numbers are supported",
                          -1, SQLITE_STATIC);
      return SQLITE_ERROR;
   }
}

int scalar_to_sql(const auto&, std::span<const char>, sqlite3_context* ctx)
{
   sqlite3_result_text(ctx, "Internal error: unhandled scalar type", -1, SQLITE_STATIC);
   return SQLITE_ERROR;
}

struct SqlCustomHandler
{
   int (*to_sql)(const CompiledType*, psio::FracStream&, sqlite3_context* ctx);
   explicit operator bool() const { return to_sql != nullptr; }
};

int bool_to_sql(const CompiledType* type, psio::FracStream& in, sqlite3_context* ctx)
{
   bool value;
   if (!psio::is_packable<bool>::unpack<true, true>(&value, in.has_unknown, in.known_end, in.src,
                                                    in.pos, in.end_pos))
   {
      sqlite3_result_text(ctx, "Not a valid bool value", -1, SQLITE_STATIC);
      return SQLITE_ERROR;
   }
   sqlite3_result_int(ctx, value ? 1 : 0);
   return SQLITE_OK;
}

int string_to_sql(const CompiledType* type, psio::FracStream& in, sqlite3_context* ctx)
{
   std::uint32_t size;
   if (!psio::unpack_numeric<true>(&size, in.src, in.pos, in.end_pos))
   {
      sqlite3_result_text(ctx, "cannot read string size", -1, SQLITE_STATIC);
      return SQLITE_ERROR;
   }
   std::uint32_t end = in.pos + size;
   if (end > in.end_pos || end < size)
   {
      sqlite3_result_text(ctx, "string size out of bounds", -1, SQLITE_STATIC);
      return SQLITE_ERROR;
   }
   sqlite3_result_text64(ctx, in.src + in.pos, size, SQLITE_TRANSIENT, SQLITE_UTF8);
   in.pos = end;
   return SQLITE_OK;
}

int blob_to_sql(const CompiledType* type, psio::FracStream& in, sqlite3_context* ctx)
{
   if (type->is_container())
   {
      std::uint32_t size;
      if (!psio::unpack_numeric<true>(&size, in.src, in.pos, in.end_pos))
      {
         sqlite3_result_text(ctx, "cannot read container size", -1, SQLITE_STATIC);
         return SQLITE_ERROR;
      }
      std::uint32_t end = in.pos + size;
      if (end > in.end_pos || end < size)
      {
         sqlite3_result_text(ctx, "container size out of bounds", -1, SQLITE_STATIC);
         return SQLITE_ERROR;
      }
      sqlite3_result_blob64(ctx, in.src + in.pos, size, SQLITE_TRANSIENT);
      in.pos = end;
      return SQLITE_OK;
   }
   else if (!type->is_variable_size)
   {
      std::uint32_t end = in.pos + type->fixed_size;
      if (end > in.end_pos || end < in.pos)
      {
         sqlite3_result_text(ctx, "blob out of bounds", -1, SQLITE_STATIC);
         return SQLITE_ERROR;
      }
      sqlite3_result_blob64(ctx, in.src + in.pos, type->fixed_size, SQLITE_TRANSIENT);
      in.pos = end;
      return SQLITE_OK;
   }
   else
   {
      sqlite3_result_text(ctx, "wrong type for blob", -1, SQLITE_STATIC);
      return SQLITE_ERROR;
   }
}

int account_to_sql(const CompiledType* type, psio::FracStream& in, sqlite3_context* ctx)
{
   AccountNumber value;
   if (!psio::is_packable<AccountNumber>::unpack<true, true>(&value, in.has_unknown, in.known_end,
                                                             in.src, in.pos, in.end_pos))
   {
      sqlite3_result_text(ctx, "Not a valid AccountNumber", -1, SQLITE_STATIC);
      return SQLITE_ERROR;
   }
   auto s = value.str();
   sqlite3_result_text64(ctx, s.data(), s.size(), SQLITE_TRANSIENT, SQLITE_UTF8);
   return SQLITE_OK;
}

const auto& psibase_sql_builtins()
{
   static const ExtraCustom<SqlCustomHandler> result{psibase_builtins,
                                                     {{"bool", {&bool_to_sql}},
                                                      {"string", {&string_to_sql}},
                                                      {"hex", {&blob_to_sql}},
                                                      {"AccountNumber", {&account_to_sql}}}};
   return result;
}

std::string_view jsonPrefix("\x2f\x0a\xc4\x5b\xc1\xe1\x4d\xcc\x60\x02\xd4\xbe\x67\xb9\x06\xd4", 16);

int event_column(sqlite3_vtab_cursor* cursor, sqlite3_context* ctx, int n)
{
   auto*      c = static_cast<EventCursor*>(cursor);
   FracParser parser(psio::FracStream{c->data}, c->vtab()->rowType, psibase_builtins);
   auto       item = parser.select_child(n);
   switch (item.kind)
   {
      case FracParser::error:
         sqlite3_result_text64(ctx, item.data.data(), item.data.size(), SQLITE_STATIC, SQLITE_UTF8);
         return SQLITE_ERROR;
      case FracParser::start:
      case FracParser::end:
         break;
      case FracParser::scalar:
         return std::visit([&](const auto& type) { return scalar_to_sql(type, item.data, ctx); },
                           item.type->original_type->value);
      case FracParser::empty:
         sqlite3_result_null(ctx);
         return SQLITE_OK;
      case FracParser::custom:
         if (auto* handler = psibase_sql_builtins().find(item.type->custom_id))
         {
            if (item.data.empty())
            {
               return handler->to_sql(item.type, parser.in, ctx);
            }
            else
            {
               psio::FracStream tmpin{item.data};
               return handler->to_sql(item.type, tmpin, ctx);
            }
         }
   }
   // json as text
   parser.push(std::move(item));
   std::vector<char>   result(jsonPrefix.begin(), jsonPrefix.end());
   psio::vector_stream stream{result};
   to_json(parser, stream);
   sqlite3_result_text64(ctx, result.data(), result.size(), SQLITE_TRANSIENT, SQLITE_UTF8);
   return SQLITE_OK;
}

int event_connect(sqlite3*           db,
                  void*              pAux,
                  int                args,
                  const char* const* argv,
                  sqlite3_vtab**     ppVtab,
                  char**             err)
{
   AccountNumber service  = {};
   MethodNumber  event    = {};
   DbId          event_db = DbId::historyEvent;
   for (int i = 3; i < args; ++i)
   {
      std::string_view arg = argv[i];
      if (arg.starts_with("service="))
      {
         service = AccountNumber{arg.substr(8)};
      }
      else if (arg.starts_with("db="))
      {
         if (arg == "db=history")
         {
            event_db = DbId::historyEvent;
         }
         else if (arg == "db=ui")
         {
            event_db = DbId::uiEvent;
         }
         else if (arg == "db=merkle")
         {
            event_db = DbId::merkleEvent;
         }
         else
         {
            check(false, "Unknown db: " + std::string(arg.substr(3)));
         }
      }
      else if (arg.starts_with("type="))
      {
         event = MethodNumber{arg.substr(5)};
      }
      else
      {
         check(false, "Unknown argument: " + std::string(arg));
      }
   }
   const CompiledType* type = SchemaCache::instance().getSchemaType(event_db, service, event);
   if (type == nullptr)
      return SQLITE_ERROR;
   auto                vtab = std::make_unique<EventVTab>(event_db, service, event, type);
   std::vector<char>   index;
   psio::vector_stream stream{index};
   stream.write("CREATE TABLE e(", 15);
   getColumns(vtab->rowType, stream);
   stream.write(")", 2);
   if (int err = sqlite3_declare_vtab(db, index.data()))
      return err;
   *ppVtab = vtab.release();
   return SQLITE_OK;
}

int event_disconnect(sqlite3_vtab* vtab)
{
   delete static_cast<EventVTab*>(vtab);
   return SQLITE_OK;
}

struct IndexConstraints
{
   bool usable : 1;
   bool unique : 1;
   bool eq : 1;
   bool upper : 1;
   bool lower : 1;
   int  estimatedCost() const
   {
      if (!usable)
         return 1000000;
      if (eq && unique)
         return 1;
      if (eq && !unique)
         return 10;
      if (lower && upper)
         return 300;
      if (lower || upper)
         return 500;
      return 1000;
   }
   friend bool operator==(const IndexConstraints&, const IndexConstraints&) = default;
};
auto operator<=>(const IndexConstraints& lhs, const IndexConstraints& rhs)
{
   return lhs.estimatedCost() <=> rhs.estimatedCost();
}

int event_best_index(sqlite3_vtab* base_vtab, sqlite3_index_info* info)
{
   auto                          vtab = static_cast<EventVTab*>(base_vtab);
   std::vector<IndexConstraints> constraints(vtab->rowType->children.size() + 1);
   constraints[0] = {.usable = true, .unique = true};
   for (const auto& index : vtab->indexes)
   {
      constraints[index.getPos()].usable = true;
   }
   auto usableConstraint = [&](int idx)
   {
      if (!info->aConstraint[idx].usable)
         return false;
      auto column = info->aConstraint[idx].iColumn;
      if (column < 0)
         return true;
      return sqlite3_vtab_collation(info, idx) == vtab->get_collation(column);
   };
   for (int i = 0; i < info->nConstraint; ++i)
   {
      if (usableConstraint(i) && constraints[info->aConstraint[i].iColumn + 1].usable)
      {
         switch (info->aConstraint[i].op)
         {
            case SQLITE_INDEX_CONSTRAINT_EQ:
               constraints[info->aConstraint[i].iColumn + 1].eq = true;
               break;
            case SQLITE_INDEX_CONSTRAINT_LT:
            case SQLITE_INDEX_CONSTRAINT_LE:
               constraints[info->aConstraint[i].iColumn + 1].lower = true;
               break;
            case SQLITE_INDEX_CONSTRAINT_GT:
            case SQLITE_INDEX_CONSTRAINT_GE:
               constraints[info->aConstraint[i].iColumn + 1].upper = true;
               break;
         }
      }
   }
   int  best = std::ranges::min_element(constraints) - constraints.begin() - 1;
   char buf[info->nConstraint + 1];
   int  argc = 0;
   for (int i = 0; i < info->nConstraint; ++i)
   {
      auto appendArg = [&](char type)
      {
         buf[argc]                           = type;
         info->aConstraintUsage[i].argvIndex = argc + 1;
         ++argc;
      };
      if (info->aConstraint[i].iColumn == best && usableConstraint(i))
      {
         switch (info->aConstraint[i].op)
         {
            case SQLITE_INDEX_CONSTRAINT_EQ:
               appendArg('=');
               break;
            case SQLITE_INDEX_CONSTRAINT_LT:
               appendArg(')');
               break;
            case SQLITE_INDEX_CONSTRAINT_LE:
               appendArg(']');
               break;
            case SQLITE_INDEX_CONSTRAINT_GT:
               appendArg('(');
               break;
            case SQLITE_INDEX_CONSTRAINT_GE:
               appendArg('[');
               break;
         }
      }
   }
   buf[argc]    = '\0';
   info->idxNum = best;
   info->idxStr = (char*)sqlite3_malloc(argc + 1);
   if (!info->idxStr)
      return SQLITE_NOMEM;
   std::memcpy(info->idxStr, buf, argc + 1);
   info->needToFreeIdxStr = 1;
   info->estimatedCost    = constraints[best + 1].estimatedCost();
   return SQLITE_OK;
}

int event_open(sqlite3_vtab* vtab, sqlite3_vtab_cursor** result)
{
   *result = new EventCursor{*static_cast<EventVTab*>(vtab)};
   return SQLITE_OK;
}

int event_close(sqlite3_vtab_cursor* cursor)
{
   delete static_cast<EventCursor*>(cursor);
   return SQLITE_OK;
}

enum class KeyResult
{
   underflow,
   overflow,
   exact,
   rounded,
};

KeyResult int64_to_key(const Int& type, sqlite_int64 value, std::vector<char>& out)
{
   auto bytes = (type.bits + 7) / 8;
   if (type.isSigned)
   {
      std::uint64_t limit = 1ull << (type.bits - 1);
      if (value < static_cast<sqlite3_int64>(-limit))
         return KeyResult::underflow;
      if (value > static_cast<sqlite3_int64>(limit - 1))
         return KeyResult::overflow;
      value ^= (1ull << (bytes * 8 - 1));
   }
   else
   {
      if (value < 0)
         return KeyResult::underflow;
      if (static_cast<std::uint64_t>(value) > (2ull << (type.bits - 1)) - 1)
         return KeyResult::overflow;
   }
   for (int i = 0; i < bytes; ++i)
   {
      out.push_back((value >> 8 * (bytes - i - 1)) & 0xFF);
   }
   return KeyResult::exact;
}

KeyResult sql_to_key(const Int& type, sqlite3_value* key, std::vector<char>& out)
{
   switch (sqlite3_value_numeric_type(key))
   {
      case SQLITE_INTEGER:
         return int64_to_key(type, sqlite3_value_int64(key), out);
      case SQLITE_FLOAT:
      {
         double value = sqlite3_value_double(key);
         if (value >= -static_cast<double>(std::numeric_limits<sqlite3_int64>::min()))
            return KeyResult::overflow;
         if (value < static_cast<double>(std::numeric_limits<sqlite3_int64>::min()))
            return KeyResult::underflow;
         // round-to-zero
         sqlite_int64 ivalue = static_cast<sqlite_int64>(value);
         // Adjust to round-to-positive-inf
         if (static_cast<double>(ivalue) < value)
         {
            ++ivalue;
         }
         auto result = int64_to_key(type, ivalue, out);
         if (result == KeyResult::exact && static_cast<double>(ivalue) != value)
            return KeyResult::rounded;
         return result;
      }
      case SQLITE_TEXT:
      case SQLITE_BLOB:
         return KeyResult::overflow;
      case SQLITE_NULL:
         return KeyResult::underflow;
      default:
         abortMessage("Unknown sqlite3_value");
   }
}

KeyResult double_to_key(const Float& type, double value, std::vector<char>& out)
{
   psio::vector_stream stream{out};
   if (type == Float{.exp = 11, .mantissa = 53})
   {
      to_key(value, stream);
      return KeyResult::exact;
   }
   else if (type == Float{.exp = 8, .mantissa = 24})
   {
      auto fvalue = static_cast<float>(value);
      auto result = KeyResult::exact;
      to_key(value, stream);
      if (fvalue != value)
      {
         result = KeyResult::rounded;
         if (fvalue < value)
            ++out.back();
      }
      return result;
   }
   abortMessage("Only single and double precision floating-point are supported");
}

KeyResult sql_to_key(const Float& type, sqlite3_value* key, std::vector<char>& out)
{
   switch (sqlite3_value_numeric_type(key))
   {
      case SQLITE_INTEGER:
      {
         auto value  = sqlite3_value_int64(key);
         auto dvalue = static_cast<double>(value);
         if (static_cast<sqlite_int64>(dvalue) < value)
         {
            dvalue = std::nextafter(dvalue, std::numeric_limits<double>::infinity());
         }
         auto result = double_to_key(type, sqlite3_value_int64(key), out);
         if (static_cast<sqlite_int64>(dvalue) < value)
            return KeyResult::rounded;
         return result;
      }
      case SQLITE_FLOAT:
         return double_to_key(type, sqlite3_value_double(key), out);
      case SQLITE_TEXT:
      case SQLITE_BLOB:
         return KeyResult::overflow;
      case SQLITE_NULL:
         return KeyResult::underflow;
      default:
         abortMessage("Unknown sqlite3_value");
   }
}

KeyResult sql_to_key(const auto& type, sqlite3_value* key, std::vector<char>& out)
{
   abortMessage("Not implemented: " + psio::convert_to_json(AnyType{type}));
}

KeyResult string_to_key(const CompiledType* type, sqlite3_value* key, std::vector<char>& out)
{
   psio::vector_stream stream(out);
   to_key(std::string_view{reinterpret_cast<const char*>(sqlite3_value_text(key)),
                           static_cast<std::size_t>(sqlite3_value_bytes(key))},
          stream);
   return KeyResult::exact;
}

KeyResult account_to_key(const CompiledType* type, sqlite3_value* key, std::vector<char>& out)
{
   psio::vector_stream stream(out);
   auto                s = std::string_view{reinterpret_cast<const char*>(sqlite3_value_text(key)),
                             static_cast<std::size_t>(sqlite3_value_bytes(key))};
   to_key(AccountNumber{s}, stream);
   return KeyResult::exact;
}

KeyResult blob_to_key(const CompiledType* type, sqlite3_value* key, std::vector<char>& out)
{
   psio::vector_stream stream(out);
   to_key(std::string_view{reinterpret_cast<const char*>(sqlite3_value_blob(key)),
                           static_cast<std::size_t>(sqlite3_value_bytes(key))},
          stream);
   return KeyResult::exact;
}

struct ToKeyCustomHandler
{
   KeyResult (*to_key)(const CompiledType*, sqlite3_value*, std::vector<char>&);
   explicit operator bool() const { return to_key != nullptr; }
};

const auto& psibase_to_key_builtins()
{
   static const ExtraCustom<ToKeyCustomHandler> result{psibase_builtins,
                                                       {{"string", {&string_to_key}},
                                                        {"hex", {&blob_to_key}},
                                                        {"AccountNumber", {&account_to_key}}}};
   return result;
}

KeyResult sql_to_key(const CompiledType* type, sqlite3_value* key, std::vector<char>& out)
{
   switch (type->kind)
   {
      case CompiledType::scalar:
         return std::visit([&](auto& t) { return sql_to_key(t, key, out); },
                           type->original_type->value);
      default:
         if (auto* handler = psibase_to_key_builtins().find(type->custom_id))
         {
            return handler->to_key(type, key, out);
         }
         abortMessage("Not implemented: " + std::to_string(type->custom_id) + " " +
                      psio::convert_to_json(*type->original_type));
   }
}

KeyResult sql_to_key(const CompiledMember& member, sqlite3_value* key, std::vector<char>& out)
{
   if (member.is_optional)
   {
      if (isOctet(member.type))
      {
         if (sqlite3_value_type(key) == SQLITE_NULL)
         {
            out.push_back(0);
            out.push_back(0);
            return KeyResult::exact;
         }
         else
         {
            auto result = sql_to_key(member.type, key, out);
            switch (result)
            {
               case KeyResult::exact:
               case KeyResult::rounded:
                  if (out.back() == 0)
                     out.push_back(1);
                  break;
               case KeyResult::overflow:
                  break;
               case KeyResult::underflow:
                  result = KeyResult::rounded;
                  out.push_back(0);
                  out.push_back(1);
                  break;
            }
            return result;
         }
      }
      if (sqlite3_value_type(key) == SQLITE_NULL)
      {
         out.push_back(0);
         return KeyResult::exact;
      }
      else
      {
         out.push_back(1);
         auto result = sql_to_key(member.type, key, out);
         if (result == KeyResult::underflow)
            return KeyResult::rounded;
         return result;
      }
   }
   else
   {
      return sql_to_key(member.type, key, out);
   }
}

int event_filter(sqlite3_vtab_cursor* cursor,
                 int                  index,
                 const char*          argTypes,
                 int                  argc,
                 sqlite3_value**      argv)
{
   auto*             c    = static_cast<EventCursor*>(cursor);
   auto*             vtab = static_cast<EventVTab*>(cursor->pVtab);
   std::vector<char> key  = vtab->key();
   key.push_back(static_cast<char>(index));
   c->prefixLen = key.size();
   c->key       = key;
   auto keyType = index >= 0 ? vtab->rowType->children[index] : CompiledMember{.type = &u64};
   auto incKey  = [&](std::vector<char>& k)
   {
      std::size_t i = k.size();
      while (i > c->prefixLen)
      {
         if (++k[--i] != 0)
         {
            return true;
         }
      }
      return false;
   };
   auto incExactKey = [&](std::vector<char>& k, KeyResult& adj)
   {
      if (adj == KeyResult::exact)
         if (!incKey(key))
            adj = KeyResult::overflow;
   };
   for (int i = 0; i < argc; ++i)
   {
      key.resize(c->prefixLen);
      auto adj = sql_to_key(keyType, argv[i], key);
      switch (argTypes[i])
      {
         case '=':
            if (adj != KeyResult::exact)
               return c->setEof();
            c->key = key;
            c->end = c->key;
            if (!incKey(c->end))
               c->end.clear();
            break;
         case '(':
            incExactKey(key, adj);
            [[fallthrough]];
         case '[':
            if (adj == KeyResult::overflow)
               return c->setEof();
            if (compare_blob(key, c->key) > 0)
               c->key = key;
            break;
         case ']':
            incExactKey(key, adj);
            [[fallthrough]];
         case ')':
            if (adj == KeyResult::underflow)
               return c->setEof();
            if (adj != KeyResult::overflow && (c->end.empty() || compare_blob(key, c->end) < 0))
               c->end = key;
            break;
      }
   }
   c->seek();
   return SQLITE_OK;
}

sqlite3_module eventModule = {
    .iVersion    = 4,
    .xCreate     = event_connect,
    .xConnect    = event_connect,
    .xBestIndex  = event_best_index,
    .xDisconnect = event_disconnect,
    .xDestroy    = event_disconnect,
    .xOpen       = event_open,
    .xClose      = event_close,
    .xFilter     = event_filter,
    .xNext       = event_next,
    .xEof        = event_eof,
    .xColumn     = event_column,
    .xRowid      = event_rowid,
};

void column_to_json(sqlite3_stmt* stmt, int i, auto& stream)
{
   to_json(sqlite3_column_name(stmt, i), stream);
   write_colon(stream);
   switch (sqlite3_column_type(stmt, i))
   {
      case SQLITE_INTEGER:
         to_json(sqlite3_column_int64(stmt, i), stream);
         break;
      case SQLITE_FLOAT:
         to_json(sqlite3_column_double(stmt, i), stream);
         break;
      case SQLITE_TEXT:
      {
         auto result = std::string_view{reinterpret_cast<const char*>(sqlite3_column_text(stmt, i)),
                                        static_cast<std::size_t>(sqlite3_column_bytes(stmt, i))};
         if (result.starts_with(jsonPrefix))
         {
            result.remove_prefix(jsonPrefix.size());
            stream.write(result.data(), result.size());
         }
         else
            to_json(result, stream);
         break;
      }
      case SQLITE_BLOB:
         to_json_hex(reinterpret_cast<const char*>(sqlite3_column_text(stmt, i)),
                     static_cast<std::size_t>(sqlite3_column_bytes(stmt, i)), stream);
         break;
      case SQLITE_NULL:
         stream.write("null", 4);
         break;
   }
}

int ignore_row(void*, int, char**, char**)
{
   return SQLITE_OK;
}

using namespace psibase;
using namespace UserService;

void load_tables(sqlite3* db, std::string_view sql)
{
   std::regex          table_re("\"(history|ui|events).([-a-zA-Z0-9]+).([_a-zA-Z0-9]+)\"");
   std::regex_iterator iter(sql.begin(), sql.end(), table_re);
   decltype(iter)      end;
   std::string         stmt;
   for (const auto& match : std::ranges::subrange(iter, end))
   {
      std::string serviceStr = match[2].str();
      if (serviceStr != AccountNumber{serviceStr}.str())
         continue;
      std::string typeStr = match[3].str();
      if (typeStr != MethodNumber{typeStr}.str())
         continue;
      stmt += "CREATE VIRTUAL TABLE IF NOT EXISTS \"";
      stmt += match[1].str();
      stmt += '.';
      stmt += serviceStr;
      stmt += '.';
      stmt += typeStr;
      stmt += "\" USING events(db=";
      stmt += match[1].str();
      stmt += ",service=";
      stmt += serviceStr;
      stmt += ",type=";
      stmt += typeStr;
      stmt += ")";
      // ignore errors. the error will be reported later as
      // accessing a table that doesn't exist in the main query
      sqlite3_exec(db, stmt.c_str(), ignore_row, nullptr, nullptr);
      stmt.clear();
   }
}

std::vector<char> REvents::sqlQuery(const std::vector<char>& query)
{
   sqlite3* db;
   if (int err = sqlite3_open(":memory:", &db))
   {
      abortMessage(std::string("sqlite3_open: ") + sqlite3_errstr(err));
   }
   if (int err = sqlite3_create_module(db, "events", &eventModule, nullptr))
   {
      abortMessage(std::string("sqlite3_create_module: ") + sqlite3_errstr(err));
   }
   if (int err = sqlite3_collation_needed(db, nullptr, &register_collation))
   {
      abortMessage(std::string("sqlite3_collation_needed: ") + sqlite3_errstr(err));
   }
   load_tables(db, {query.data(), query.size()});
   std::vector<char> result;
   {
      check(query.size() <= std::numeric_limits<int>::max(), "Query too large");
      const char*         ptr = query.data();
      const char*         end = query.data() + query.size();
      psio::vector_stream stream{result};
      bool                firstRow = true;
      stream.write('[');
      while (ptr != end)
      {
         sqlite3_stmt* stmt;
         if (int err = sqlite3_prepare_v2(db, ptr, static_cast<int>(end - ptr), &stmt, &ptr))
         {
            abortMessage(std::string("sqlite3_prepare_v2: ") + sqlite3_errmsg(db));
         }
         while (true)
         {
            int err = sqlite3_step(stmt);
            if (err == SQLITE_ROW)
            {
               if (firstRow)
                  firstRow = false;
               else
                  stream.write(',');
               stream.write('{');
               int nColumns = sqlite3_column_count(stmt);
               for (int i = 0; i < nColumns; ++i)
               {
                  if (i != 0)
                     stream.write(',');
                  column_to_json(stmt, i, stream);
               }
               stream.write('}');
            }
            else
            {
               if (err != SQLITE_DONE)
               {
                  abortMessage(std::string("sqlite3_prepare_v2: ") + sqlite3_errmsg(db));
               }
               break;
            }
         }
         if (int err = sqlite3_finalize(stmt))
         {
            abortMessage(std::string("sqlite3_prepare_v2: ") + sqlite3_errmsg(db));
         }
      }
      stream.write(']');
   }

   return result;
}

std::optional<HttpReply> REvents::serveSys(const HttpRequest& request)
{
   if (request.target != "/sql")
      return {};

   return HttpReply{.contentType = "application/json", .body = sqlQuery(request.body)};
}

PSIBASE_DISPATCH(UserService::REvents)
