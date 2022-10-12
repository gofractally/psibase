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

   std::string editLine(std::string_view key, std::string_view value, std::string_view comment)
   {
      std::string result(key);
      result += " = ";
      result += value;
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
      static constexpr auto ws    = " \t\r\n";
      auto                  start = s.find_first_not_of(ws);
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
      auto pos     = s.find_first_not_of(" \t\r\n");
      bool enabled = true;
      if (pos != std::string::npos && s[pos] == '#')
      {
         enabled = false;
         s       = s.substr(pos + 1);
      }
      auto [kv, comment] = splitComment(s);
      pos                = kv.find('=');
      if (pos == std::string::npos)
      {
         return {};
      }
      else
      {
         return {trim(kv.substr(0, pos)), trim(kv.substr(pos + 1)), comment, enabled};
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
         for (; iter != nextSection; ++iter)
         {
            iter->clear();
         }
      }
      iter = nextSection;
   }
}

void ConfigFile::write(std::ostream& out)
{
   postProcess();
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

//void ConfigFile::set(std::string_view key, std::span<std::string_view> values, std::string_view comment)
//{
// If existing values match
//}
