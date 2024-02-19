#include <cstdint>
#include <cstring>
#include <iterator>
#include <psibase/check.hpp>
#include <psio/reflect.hpp>
#include <ranges>
#include <span>
#include <type_traits>

#include <psibase/zip.hpp>

#include <zlib.h>

namespace psibase::zip
{

   template <typename I, typename T>
      requires(std::is_integral_v<T>)
   bool read(I& iter, I end, T& out)
   {
      if (end - iter < sizeof(T))
         return false;
      std::make_unsigned_t<T> result = 0;
      for (int i = 0; i < sizeof(T); ++i, ++iter)
      {
         result = result |
                  (static_cast<std::make_unsigned_t<T>>(static_cast<std::uint8_t>(*iter)) << i * 8);
      }
      out = static_cast<T>(result);
      return true;
   }

   bool read(auto& iter, auto end, std::size_t size, std::span<const char>& out)
   {
      if (end - iter < size)
         return false;
      out = {&*iter, size};
      iter += size;
      return true;
   }

   bool read(auto& iter, auto end, std::size_t size, std::string_view& out)
   {
      std::span<const char> tmp;
      if (!read(iter, end, size, tmp))
         return false;
      out = {tmp.data(), tmp.size()};
      return true;
   }

   template <typename T>
   bool readStruct(auto& iter, auto end, T& obj)
   {
      bool ok = true;
      psio::reflect<T>::for_each([&](const psio::meta&, auto member)
                                 { ok = ok && read(iter, end, obj.*member(&obj)); });
      return ok;
   }

   enum class CompressionMethod : std::uint16_t
   {
      stored   = 0,
      deflated = 8,
   };

   constexpr bool operator==(CompressionMethod lhs, std::uint16_t rhs)
   {
      return static_cast<std::uint16_t>(lhs) == rhs;
      ;
   }

   enum class ExtraId : std::uint16_t
   {
      zip64ExtendedInfo = 0x0001,
   };

   constexpr bool operator==(ExtraId lhs, std::uint16_t rhs)
   {
      return static_cast<std::uint16_t>(lhs) == rhs;
      ;
   }

   struct ExtraHeader
   {
      std::uint16_t         id;
      std::uint16_t         size;
      std::span<const char> data;
   };
   PSIO_REFLECT(ExtraHeader, id, size)

   bool read(auto& iter, auto end, ExtraHeader& out)
   {
      if (!readStruct(iter, end, out))
         return false;
      if (!read(iter, end, out.size, out.data))
         return false;
      return true;
   }

   std::optional<std::span<const char>> findZip64(std::span<const char> extra)
   {
      auto iter = extra.begin();
      auto end  = extra.end();
      while (iter != end)
      {
         ExtraHeader header;
         if (!read(iter, end, header))
         {
            check(false, "malformed extra field");
         }
         if (header.id == ExtraId::zip64ExtendedInfo)
         {
            return header.data;
         }
      }
      return {};
   }

   Zip64ExtendedInfo LocalFileHeader::zip64() const
   {
      Zip64ExtendedInfo result = {uncompressedSize, compressedSize};
      if (auto field = findZip64(extra))
      {
         auto iter = field->begin();
         auto end  = field->end();
         if (uncompressedSize == 0xffffffffu)
         {
            if (!read(iter, end, result.uncompressedSize))
               check(false, "Invalid zip64 extended info");
         }
         if (compressedSize == 0xffffffffu)
         {
            if (!read(iter, end, result.compressedSize))
               check(false, "Invalid zip64 extended info");
         }
      }
      return result;
   }

   bool read(auto& iter, auto end, LocalFileHeader& out)
   {
      if (!readStruct(iter, end, out))
         return false;
      if (!read(iter, end, out.filenameLength, out.filename))
         return false;
      if (!read(iter, end, out.extraLength, out.extra))
         return false;
      return true;
   }

   struct DataDescriptor
   {
      std::uint32_t signature = 0x08074b50;
      std::uint32_t crc32;
      std::uint32_t compressedSize;
      std::uint32_t uncompressedSize;
   };

   bool FileHeader::isFile() const
   {
      switch ((versionMadeBy >> 8) & 0xFF)
      {
         case 3:   // Unix
         case 19:  // OSX
            return ((externalAttributes >> 16) & 0170000) == 0100000;
         case 0:  // MS-DOS
            return (externalAttributes & 0x10) == 0;
         case 10:  // NTFS
            return (externalAttributes & 0x410) == 0;
         default:
            // Fall back on whether the path looks like a directory
            return !filename.ends_with('/') && !filename.ends_with('\\');
      }
   }

   Zip64ExtendedInfo FileHeader::zip64() const
   {
      Zip64ExtendedInfo result = {uncompressedSize, compressedSize, localHeaderOffset, disknoStart};
      if (auto field = findZip64(extra))
      {
         auto iter = field->begin();
         auto end  = field->end();
         if (uncompressedSize == 0xffffffffu)
         {
            if (!read(iter, end, result.uncompressedSize))
               check(false, "Invalid zip64 extended info");
         }
         if (compressedSize == 0xffffffffu)
         {
            if (!read(iter, end, result.compressedSize))
               check(false, "Invalid zip64 extended info");
         }
         if (localHeaderOffset == 0xffffffffu)
         {
            if (!read(iter, end, result.localHeaderOffset))
               check(false, "Invalid zip64 extended info");
         }
         if (disknoStart == 0xffffu)
         {
            if (!read(iter, end, result.disknoStart))
               check(false, "Invalid zip64 extended info");
         }
      }
      return result;
   }

   bool read(auto& iter, auto end, FileHeader& out)
   {
      if (!readStruct(iter, end, out))
         return false;
      if (!read(iter, end, out.filenameLength, out.filename))
         return false;
      if (!read(iter, end, out.extraLength, out.extra))
         return false;
      if (!read(iter, end, out.commentLength, out.comment))
         return false;
      return true;
   }

   struct Zip64EndOfCentralDirectoryRecord
   {
      std::uint32_t         signature = 0x06064b50;
      std::uint64_t         size;
      std::uint16_t         versionMadeBy;
      std::uint16_t         versionNeededToExtract;
      std::uint32_t         diskno;
      std::uint32_t         centralDirectoryStartDisk;
      std::uint64_t         centralDirectoryThisDisk;
      std::uint64_t         centralDirectoryTotal;
      std::uint64_t         centralDirectorySize;
      std::uint64_t         centralDirectoryOffset;
      std::span<const char> extData;
   };
   PSIO_REFLECT(Zip64EndOfCentralDirectoryRecord,
                signature,
                size,
                diskno,
                centralDirectoryStartDisk,
                centralDirectoryThisDisk,
                centralDirectoryTotal,
                centralDirectorySize,
                centralDirectoryOffset)

   bool read(auto& iter, auto end, Zip64EndOfCentralDirectoryRecord& out)
   {
      if (!readStruct(iter, end, out))
         return false;
      if (!read(iter, end, out.size - 44, out.extData))
         return false;
      return iter == end;
   }

   struct Zip64EndOfCentralDirectoryLocator
   {
      std::uint32_t                signature = 0x07064b50;
      std::uint32_t                endOfCentralDirectoryDiskno;
      std::uint64_t                endOfCentralDirectoryOffset;
      std::uint32_t                numDisks;
      static constexpr std::size_t fixedSize = 20;
   };
   PSIO_REFLECT(Zip64EndOfCentralDirectoryLocator,
                signature,
                endOfCentralDirectoryDiskno,
                endOfCentralDirectoryOffset,
                numDisks)

   bool read(auto& iter, auto end, Zip64EndOfCentralDirectoryLocator& out)
   {
      return readStruct(iter, end, out);
   }

   struct EndOfCentralDirectoryRecord
   {
      std::uint32_t         signature = 0x06054b50;
      std::uint16_t         diskno;
      std::uint16_t         centralDirectoryStartDisk;
      std::uint16_t         centralDirectoryThisDisk;
      std::uint16_t         centralDirectoryTotal;
      std::uint32_t         centralDirectorySize;
      std::uint32_t         centralDirectoryOffset;
      std::uint16_t         commentLength;
      std::span<const char> comment;
      // char comment[];
      static constexpr std::size_t fixedSize = 22;
   };
   PSIO_REFLECT(EndOfCentralDirectoryRecord,
                signature,
                diskno,
                centralDirectoryStartDisk,
                centralDirectoryThisDisk,
                centralDirectoryTotal,
                centralDirectorySize,
                centralDirectoryOffset,
                commentLength)

   bool read(auto& iter, auto end, EndOfCentralDirectoryRecord& out)
   {
      if (!readStruct(iter, end, out))
         return false;
      if (!read(iter, end, out.commentLength, out.comment))
         return false;
      return iter == end;
   }

   bool read(auto&& r, auto& out)
   {
      auto iter = std::begin(r);
      return read(iter, std::end(r), out);
   }

   std::span<const char> getCentralDirectory(std::span<const char> r)
   {
      auto begin = std::begin(r);
      auto iter  = begin;
      auto end   = std::end(r);
      auto size  = end - iter;
      if (size < 22)
         return {};
      iter += 20;
      std::uint16_t commentLength;
      read(iter, end, commentLength);
      if (size != commentLength + 22)
         return {};
      return {begin, begin + commentLength + 22};
   }

   std::span<const char> findCentralDirectory(std::span<const char> buf)
   {
      char          signature[] = {0x50, 0x4b, 0x05, 0x06};
      std::uint32_t maxSearch   = EndOfCentralDirectoryRecord::fixedSize + 0xffff;
      if (buf.size() > maxSearch)
      {
         buf = buf.subspan(buf.size() - maxSearch);
      }
      std::span<const char> result = {};
      while (true)
      {
         auto match = std::ranges::search(buf, signature);
         if (auto cd = getCentralDirectory({match.begin(), buf.end()}); !cd.empty())
         {
            result = cd;
            buf    = {cd.begin() + EndOfCentralDirectoryRecord::fixedSize, buf.end()};
         }
         else
         {
            break;
         }
      }
      return result;
   }

   struct Inflater
   {
      Inflater(std::span<const char> input)
      {
         stream.next_in  = const_cast<Bytef*>(reinterpret_cast<const Bytef*>(input.data()));
         stream.avail_in = input.size();
         handleError(inflateInit2(&stream, -15));
      }
      void read(std::span<char> output)
      {
         stream.next_out  = reinterpret_cast<Bytef*>(output.data());
         stream.avail_out = output.size();
         int err          = inflate(&stream, Z_FINISH);
         if (err != Z_STREAM_END)
            handleError(err);
         if (stream.avail_out != 0 || stream.avail_in != 0)
            check(false, "size mismatch");
      }
      ~Inflater() { inflateEnd(&stream); }
      void handleError(int err)
      {
         if (err != Z_OK)
         {
            if (stream.msg)
            {
               check(false, "zlib error: " + std::string(stream.msg));
            }
            else
            {
               check(false, "zlib error: " + std::string(zError(err)));
            }
         }
      }
      z_stream stream = {};
   };

   ZipReader::ZipReader(std::span<const char> buf)
       : buf(buf), endOfCentralDirectory(findCentralDirectory(buf))
   {
      check(!endOfCentralDirectory.empty(), "Invalid zip");
   }

   std::vector<char> ZipReader::Entry::read() const
   {
      std::vector<char> result;
      result.resize(cdUncompressedSize);
      read(result);
      return result;
   }
   void ZipReader::Entry::read(std::span<char> out) const
   {
      if (header.compression == CompressionMethod::stored)
      {
         if (data.size() != out.size())
            check(false, "size mismatch");
         std::memcpy(out.data(), data.data(), data.size());
      }
      else if (header.compression == CompressionMethod::deflated)
      {
         Inflater{data}.read(out);
      }
      else
      {
         check(false, "compression method not implemented");
      }
   }
   std::size_t ZipReader::Entry::compressedSize() const
   {
      return cdCompressedSize;
   }
   std::size_t ZipReader::Entry::uncompressedSize() const
   {
      return ZipReader::Entry::cdUncompressedSize;
   }

   ZipReader::Entry ZipReader::getEntry(const FileHeader& cdHeader)
   {
      auto info = cdHeader.zip64();
      check(info.localHeaderOffset <= buf.size(), "local header offset out-of-range");
      Entry result;
      auto  local = buf.subspan(info.localHeaderOffset);
      auto  iter  = local.begin();
      auto  end   = local.end();
      if (!read(iter, end, result.header))
      {
         check(false, "Invalid local header");
      }
      if (!read(iter, end, info.compressedSize, result.data))
      {
         check(false, "failed to read data");
      }
      result.cdCompressedSize   = info.compressedSize;
      result.cdUncompressedSize = info.uncompressedSize;
      return result;
   }

   bool ZipReader::CentralDirectoryIterator::hasNext() const
   {
      return idx < cdCount;
   }
   FileHeader ZipReader::CentralDirectoryIterator::next()
   {
      FileHeader header;
      if (!read(cdIter, cdEnd, header))
      {
         check(false, "invalid file header");
      }
      ++idx;
      return header;
   }

   ZipReader::CentralDirectoryIterator ZipReader::centralDirectory()
   {
      Zip64EndOfCentralDirectoryRecord endRecord64;
      EndOfCentralDirectoryRecord      endRecord;
      read(endOfCentralDirectory, endRecord);
      if (endOfCentralDirectory.data() - buf.data() >= Zip64EndOfCentralDirectoryLocator::fixedSize)
      {
         Zip64EndOfCentralDirectoryLocator locator;
         read(std::span{endOfCentralDirectory.data() - Zip64EndOfCentralDirectoryLocator::fixedSize,
                        endOfCentralDirectory.data()},
              locator);
         if (locator.signature == Zip64EndOfCentralDirectoryLocator{}.signature)
         {
            if (locator.numDisks != 1 || locator.endOfCentralDirectoryDiskno != 0)
            {
               check(false, "Split archives not supported");
            }
            check(locator.endOfCentralDirectoryOffset < buf.size(), "bad end of central directory");
            if (read(buf.subspan(locator.endOfCentralDirectoryOffset), endRecord64) &&
                endRecord64.signature == Zip64EndOfCentralDirectoryRecord{}.signature)
            {
               auto overwrite = [](auto val, auto& val64)
               {
                  if (val != std::numeric_limits<decltype(val)>::max())
                  {
                     val64 = val;
                  }
               };
               overwrite(endRecord.diskno, endRecord64.diskno);
               overwrite(endRecord.centralDirectoryStartDisk,
                         endRecord64.centralDirectoryStartDisk);
               overwrite(endRecord.centralDirectoryThisDisk, endRecord64.centralDirectoryThisDisk);
               overwrite(endRecord.centralDirectoryTotal, endRecord64.centralDirectoryTotal);
               overwrite(endRecord.centralDirectorySize, endRecord64.centralDirectorySize);
               overwrite(endRecord.centralDirectoryOffset, endRecord64.centralDirectoryOffset);

               return centralDirectory(endRecord64);
            }
         }
      }
      return centralDirectory(endRecord);
   }
   ZipReader::CentralDirectoryIterator ZipReader::centralDirectory(const auto& endRecord)
   {
      check(endRecord.diskno == 0 && endRecord.centralDirectoryStartDisk == 0,
            "Split archives not supported");
      check(endRecord.centralDirectoryThisDisk == endRecord.centralDirectoryTotal,
            "Mismatched central directory count");
      check(endRecord.centralDirectoryOffset <= buf.size(), "bad central directory offset");
      auto                     cdIter = buf.data() + endRecord.centralDirectoryOffset;
      auto                     cdEnd  = buf.data() + buf.size();
      CentralDirectoryIterator result;
      result.idx     = 0;
      result.cdCount = endRecord.centralDirectoryThisDisk;
      result.cdIter  = cdIter;
      result.cdEnd   = cdEnd;
      return result;
   }

}  // namespace psibase::zip
