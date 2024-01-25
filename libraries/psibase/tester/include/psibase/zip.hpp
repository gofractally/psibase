#pragma once

#include <cstdint>
#include <psio/reflect.hpp>
#include <span>
#include <string_view>
#include <vector>

namespace psibase::zip
{

   struct Zip64ExtendedInfo
   {
      std::uint64_t uncompressedSize;
      std::uint64_t compressedSize;
      std::uint64_t localHeaderOffset;
      std::uint32_t disknoStart;
   };

   struct LocalFileHeader
   {
      std::uint32_t         signature = 0x04034b50u;
      std::uint16_t         version;
      std::uint16_t         flags;
      std::uint16_t         compression;
      std::uint16_t         mtime;
      std::uint16_t         mdate;
      std::uint32_t         crc32;
      std::uint32_t         compressedSize;
      std::uint32_t         uncompressedSize;
      std::uint16_t         filenameLength;
      std::uint16_t         extraLength;
      std::string_view      filename;
      std::span<const char> extra;

      Zip64ExtendedInfo zip64() const;
   };
   PSIO_REFLECT(LocalFileHeader,
                signature,
                version,
                flags,
                compression,
                mtime,
                mdate,
                crc32,
                compressedSize,
                uncompressedSize,
                filenameLength,
                extraLength)

   struct FileHeader
   {
      std::uint32_t         signature = 0x02014b50;
      std::uint16_t         versionMadeBy;
      std::uint16_t         versionNeededToExtract;
      std::uint16_t         flags;
      std::uint16_t         compression;
      std::uint16_t         mtime;
      std::uint16_t         mdate;
      std::uint32_t         crc32;
      std::uint32_t         compressedSize;
      std::uint32_t         uncompressedSize;
      std::uint16_t         filenameLength;
      std::uint16_t         extraLength;
      std::uint16_t         commentLength;
      std::uint16_t         disknoStart;
      std::uint16_t         internalAttributes;
      std::uint32_t         externalAttributes;
      std::uint32_t         localHeaderOffset;
      std::string_view      filename;
      std::span<const char> extra;
      std::span<const char> comment;

      bool              isFile() const;
      Zip64ExtendedInfo zip64() const;
   };
   PSIO_REFLECT(FileHeader,
                signature,
                versionMadeBy,
                versionNeededToExtract,
                flags,
                compression,
                mtime,
                mdate,
                crc32,
                compressedSize,
                uncompressedSize,
                filenameLength,
                extraLength,
                commentLength,
                disknoStart,
                internalAttributes,
                externalAttributes,
                localHeaderOffset);

   class ZipReader
   {
     public:
      ZipReader(std::span<const char> buf);

      class Entry
      {
        public:
         std::vector<char> read() const;
         void              read(std::span<char> out) const;
         std::string_view  filename() const { return header.filename; }
         std::size_t       compressedSize() const;
         std::size_t       uncompressedSize() const;

        private:
         friend class ZipReader;
         LocalFileHeader       header;
         std::size_t           cdCompressedSize;
         std::size_t           cdUncompressedSize;
         std::span<const char> data;
      };

      Entry getEntry(const FileHeader& cdHeader);

      struct CentralDirectoryIterator
      {
        public:
         bool       hasNext() const;
         FileHeader next();

        private:
         friend class ZipReader;
         std::uint32_t idx;
         std::uint32_t cdCount;
         const char*   cdIter;
         const char*   cdEnd;
      };
      CentralDirectoryIterator centralDirectory();

     private:
      CentralDirectoryIterator centralDirectory(const auto& endRecord);
      std::span<const char>    buf;
      std::span<const char>    endOfCentralDirectory;
   };

}  // namespace psibase::zip
