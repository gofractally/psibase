#include <psibase/ConfigFile.hpp>

#include <algorithm>
#include <istream>
#include <limits>
#include <ostream>

using namespace psibase;

namespace
{

   std::string_view getComment(std::string_view s)
   {
      auto pos = s.find("#");
      if (pos != std::string::npos)
      {
         return s.substr(pos, s.size() - pos - 1);
      }
      return "";
   }

   std::string_view enable(std::string_view s)
   {
      auto pos = s.find_first_not_of(" \t\r\n");
      if (pos == std::string::npos || s[pos] != '#')
      {
         return s;
      }
      else
      {
         return s.substr(pos + 1);
      }
   }

   constexpr std::string_view ws(" \t\r\n");

   bool needsQuote(std::string_view s)
   {
      if (!s.empty())
      {
         // If the string has leading or trailing whitespace, quotes are
         // necessary to prevent trimming
         if (ws.find(s.front()) != std::string::npos)
            return true;
         if (ws.find(s.back()) != std::string::npos)
            return true;
         // - \n would end the line
         // - unquoted # would be a comment
         // - A single double quoted string would be unquoted
         bool quoted         = false;
         bool isQuotedString = s.starts_with('"');
         for (std::size_t i = 0; i < s.size(); ++i)
         {
            auto ch = s[i];
            if (ch == '"')
            {
               if (quoted && i + 1 != s.size())
               {
                  isQuotedString = false;
               }
               quoted = !quoted;
            }
            else if (ch == '#')
            {
               if (!quoted)
               {
                  return true;
               }
            }
            else if (ch == '\n')
            {
               return true;
            }
            else if (ch == '\\')
            {
               ++i;
               if (i == s.size())
               {
                  return false;
               }
            }
         }
         return !quoted && isQuotedString;
      }
      return false;
   }

   std::string maybeQuoteValue(std::string_view s)
   {
      if (!needsQuote(s))
      {
         return std::string(s);
      }
      std::string result;
      result.push_back('"');
      for (char ch : s)
      {
         if (ch == '\n')
         {
            result += "\\n";
         }
         else if (ch == '\"')
         {
            result += "\\\"";
         }
         else if (ch == '\\')
         {
            result += "\\\\";
         }
         else
         {
            result += ch;
         }
      }
      result.push_back('"');
      return result;
   }

   // If s is a single double quoted string, removes the quotes and processes escape sequences
   // This is the inverse of maybeQuoteValue
   std::string unquoteValue(std::string_view s, const std::string& filename, std::size_t line)
   {
      std::string result;
      if (!s.starts_with('"'))
      {
         return std::string(s);
      }
      for (std::size_t i = 1; i < s.size(); ++i)
      {
         if (s[i] == '"')
         {
            if (i + 1 == s.size())
            {
               return result;
            }
            else
            {
               break;
            }
         }
         else if (s[i] == '\\')
         {
            ++i;
            if (i == s.size())
            {
               break;
            }
            if (s[i] == 'n')
            {
               result.push_back('\n');
            }
            else
            {
               result.push_back(s[i]);
            }
         }
         else
         {
            result.push_back(s[i]);
         }
      }
      return std::string(s);
   }

   std::string editLine(std::string_view key, std::string_view value, std::string_view comment)
   {
      std::string result(key);
      result += " = ";
      result += maybeQuoteValue(value);
      if (!comment.empty())
      {
         result += " ";
         result += comment;
      }
      result += "\n";
      return result;
   }

   std::string fullKey(std::string_view section, std::string_view key)
   {
      if (section.empty())
      {
         return std::string(key);
      }
      else
      {
         return std::string(section) + "." + std::string(key);
      }
   }

   std::string_view trim(std::string_view s)
   {
      auto start = s.find_first_not_of(ws);
      if (start == std::string::npos)
      {
         return "";
      }
      else
      {
         auto end = s.find_last_not_of(ws) + 1;
         return s.substr(start, end - start);
      }
   }

   std::string_view trimLine(std::string_view s)
   {
      auto commentStart = s.find('#');
      if (commentStart != std::string::npos)
      {
         s = s.substr(0, commentStart);
      }
      return trim(s);
   }

   bool isSection(std::string_view line)
   {
      line = trimLine(line);
      return !line.empty() && line.front() == '[' && line.back() == ']';
   }

   std::string_view parseSection(std::string_view line)
   {
      line = trimLine(line);
      line = line.substr(1, line.size() - 2);
      if (line.ends_with('.'))
      {
         line.remove_suffix(1);
      }
      return line;
   }

   std::tuple<std::string_view, std::string_view> splitComment(std::string_view line)
   {
      auto commentStart = line.find('#');
      if (commentStart != std::string::npos)
      {
         return {line.substr(0, commentStart), line.substr(commentStart)};
      }
      else
      {
         return {line, ""};
      }
   }

   std::tuple<std::string_view, std::string_view, std::string_view, bool> parseLine(
       std::string_view s)
   {
      auto pos     = s.find_first_not_of(ws);
      bool enabled = true;
      if (pos != std::string::npos && s[pos] == '#')
      {
         enabled = false;
         s       = s.substr(pos + 1);
      }
      pos = s.find('=');
      if (pos == std::string::npos)
      {
         return {};
      }
      else
      {
         auto        k       = s.substr(0, pos);
         auto        v       = s.substr(pos + 1);
         bool        quoted  = false;
         std::size_t comment = v.size();
         for (std::size_t i = pos; i < v.size(); ++i)
         {
            if (v[i] == '\"')
            {
               quoted = !quoted;
            }
            else if (quoted && v[i] == '\\')
            {
               if (++i == v.size())
               {
                  break;
               }
            }
            else if (!quoted && v[i] == '#')
            {
               comment = i;
               break;
            }
         }
         return {trim(k), trim(v.substr(0, comment)), v.substr(comment), enabled};
      }
   }

}  // namespace

void ConfigFile::parse(std::istream& file)
{
   std::string line;
   std::string section;
   bool        defaultSectionSet = false;
   while (!std::getline(file, line).fail())
   {
      if (!defaultSectionSet)
      {
         auto trimmed = trim(line);
         if (trimmed.empty())
         {
            sectionInsertPoints.try_emplace("", lines.size() + 1);
            defaultSectionSet = true;
         }
         else if (trimmed.front() != '#')
         {
            sectionInsertPoints.try_emplace("", lines.size());
            defaultSectionSet = true;
         }
      }
      if (isSection(line))
      {
         section = parseSection(line);
         sectionInsertPoints.try_emplace(section, lines.size() + 1);
      }
      else
      {
         auto [key, value, comment, enabled] = parseLine(line);
         if (!key.empty())
         {
            auto& info = keys[fullKey(section, std::string(key))];
            if (enabled)
            {
               info.enabled.push_back(lines.size());
            }
            else
            {
               info.disabled.push_back(lines.size());
            }
         }
      }
      line += '\n';
      lines.push_back(std::move(line));
   }
}

void ConfigFile::postProcess()
{
   // disable formerly enabled keys
   for (const auto& [key, info] : keys)
   {
      for (auto line : info.enabled)
      {
         if (!lines[line].empty())
         {
            lines[line] = "# " + lines[line];
         }
      }
   }
   // delete empty sections
   auto iter = std::find_if(lines.begin(), lines.end(),
                            [](const std::string& line) { return isSection(line); });
   auto end  = lines.end();
   while (iter != end)
   {
      auto nextSection     = std::find_if(iter + 1, lines.end(),
                                          [](const std::string& line) { return isSection(line); });
      auto nextInsertPoint = insertions.lower_bound(iter - lines.begin() + 1);
      if (nextInsertPoint == insertions.end() ||
          nextInsertPoint->first > nextSection - lines.begin())
      {
         // If the section is preceded by a blank line, remove it
         if (auto insertHere = insertions.find(iter - lines.begin());
             insertHere != insertions.end())
         {
            if (insertHere->second.ends_with("\n\n"))
            {
               insertHere->second.pop_back();
            }
         }
         else if (iter != lines.begin())
         {
            auto prev = iter;
            --prev;
            if (*prev == "\n")
            {
               prev->clear();
            }
         }
         // If the section ends with a blank line, do not remove it
         auto sectionEnd = nextSection;
         --sectionEnd;
         if (*sectionEnd != "\n")
         {
            ++sectionEnd;
         }
         for (; iter != sectionEnd; ++iter)
         {
            iter->clear();
         }
      }
      iter = nextSection;
   }
}

void ConfigFile::write(std::ostream& out, bool preserve)
{
   if (!preserve)
   {
      postProcess();
   }
   for (std::size_t i = 0; i < lines.size(); ++i)
   {
      if (auto iter = insertions.find(i); iter != insertions.end())
      {
         out << iter->second;
      }
      out << lines[i];
   }
   // handle all insertions past the end of the original file
   for (auto iter = insertions.lower_bound(lines.size()), end = insertions.end(); iter != end;
        ++iter)
   {
      out << iter->second;
   }
}

void ConfigFile::set(std::string_view section,
                     std::string_view key,
                     std::string_view value,
                     std::string_view comment)
{
   auto pos = keys.find(fullKey(section, key));
   if (pos == keys.end())
   {
      // figure out where to insert the new key
      std::string& line = insertions[findSection(section)];
      if (!comment.empty())
      {
         line += "# ";
         line += comment;
         line += '\n';
      }
      line += editLine(key, value, "");
   }
   else
   {
      auto location =
          !pos->second.enabled.empty() ? pos->second.enabled.front() : pos->second.disabled.front();
      auto [old_key, old_value, old_comment, enabled] = parseLine(lines[location]);
      std::string& ins                                = insertions[location + 1];
      // Using old_key instead of key handles the case where a key is
      // defined outside its regular section
      ins = editLine(old_key, value, old_comment) + ins;
      // This allows postProcess to know which keys have been updated
      lines[location].clear();
      sectionInsertPoints[std::string(section)] = location + 1;
   }
}

void ConfigFile::keep(std::string_view section, std::string_view key)
{
   auto pos = keys.find(fullKey(section, key));
   if (pos != keys.end())
   {
      for (auto location : pos->second.enabled)
      {
         std::string& ins = insertions[location + 1];
         ins              = lines[location] + ins;
         lines[location].clear();
         sectionInsertPoints[std::string(section)] = location + 1;
      }
   }
}

std::size_t ConfigFile::findSection(std::string_view section)
{
   auto iter = sectionInsertPoints.find(section);
   if (iter == sectionInsertPoints.end())
   {
      auto result = std::numeric_limits<std::size_t>::max();
      sectionInsertPoints.try_emplace(std::string(section), result);
      auto& ins = insertions[result];
      ins += "\n[";
      ins += section;
      ins += "]\n";
      return result;
   }
   else
   {
      return iter->second;
   }
}

void ConfigFile::set(std::string_view                             section,
                     std::string_view                             key,
                     const std::vector<std::string>&              values,
                     std::function<std::string(std::string_view)> normalize,
                     std::string_view                             comment)
{
   auto pos = keys.find(fullKey(section, key));
   if (pos == keys.end())
   {
      // figure out where to insert the new key
      std::string& line = insertions[findSection(section)];
      if (!comment.empty())
      {
         line += "# ";
         line += comment;
         line += '\n';
      }
      for (auto value : values)
      {
         line += editLine(key, value, "");
      }
   }
   else
   {
      std::map<std::string, std::size_t> locations;
      for (const auto* group : {&pos->second.enabled, &pos->second.disabled})
      {
         for (auto loc : *group)
         {
            auto [key, value, comment, enabled] = parseLine(lines[loc]);
            locations.try_emplace(normalize(value), loc);
         }
      }

      auto insertPoint = findSection(section);
      for (auto value : values)
      {
         auto iter = locations.find(normalize(value));
         if (iter == locations.end())
         {
            insertions[insertPoint] += editLine(key, value, "");
         }
         else
         {
            auto location                                   = iter->second;
            auto [old_key, old_value, old_comment, enabled] = parseLine(lines[location]);
            std::string& ins                                = insertions[location + 1];
            ins = editLine(old_key, value, old_comment) + ins;
            lines[location].clear();
            insertPoint = location + 1;
         }
      }
      // Finally, delete any values that were not overwritten
      for (auto location : pos->second.enabled)
      {
         lines[location].clear();
      }
   }
}

boost::program_options::parsed_options psibase::parse_config_file(
    std::istream&                                      file,
    const boost::program_options::options_description& opts,
    const std::string&                                 filename)
{
   boost::program_options::parsed_options result{&opts};
   std::string                            line;
   std::string                            section;
   bool                                   defaultSectionSet = false;
   std::size_t                            line_number       = 0;
   std::vector<std::string_view>          exact_options;
   std::vector<std::string_view>          prefix_options;
   for (auto opt : opts.options())
   {
      std::string_view name = opt->long_name();
      if (!name.empty())
      {
         if (name.ends_with("*"))
         {
            prefix_options.push_back(name.substr(0, name.size() - 1));
         }
         else
         {
            exact_options.push_back(name);
         }
      }
   }
   std::sort(exact_options.begin(), exact_options.end());
   std::sort(prefix_options.begin(), prefix_options.end());
   auto allowedOption = [&](std::string_view key)
   {
      if (std::binary_search(exact_options.begin(), exact_options.end(), key))
      {
         return true;
      }
      auto next = std::upper_bound(prefix_options.begin(), prefix_options.end(), key);
      if (next != prefix_options.begin())
      {
         --next;
         if (key.starts_with(*next))
         {
            return true;
         }
      }
      return false;
   };
   while (!std::getline(file, line).fail())
   {
      ++line_number;
      if (isSection(line))
      {
         section = parseSection(line);
      }
      else
      {
         auto [key, value, comment, enabled] = parseLine(line);
         if (enabled)
         {
            auto k = fullKey(section, key);
            if (!allowedOption(k))
            {
               throw std::runtime_error(filename + ":" + std::to_string(line_number) +
                                        ": Unknown option " + k);
            }
            boost::program_options::option opt{k, {unquoteValue(value, filename, line_number)}};
            opt.original_tokens = {k, std::string(value)};
            result.options.push_back(std::move(opt));
         }
      }
   }
   return result;
}
