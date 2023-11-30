# Account numbers

Account names on a psibase network are, in fact, numbers. These string-like names are compressed into 64-bit numeric values using a custom name compression algorithm. 

This custom account-name encoding allows for names that still compress into 64-bit values but may be from 0 to 18 characters long and contain the characters a-z, 0-9, and - (hyphen). Non-empty names must begin with a letter.

To get 64-bit values out of 18-character names, some names will fail to compress down to 64 bits. The compression algorithm is designed to prefer names that are more likely to appear in user handles, and less likely to compress names that look non-human (e.g. no vowels).

> Note: Detailed specification documentation on Account Number encoding is currently missing. Currently the best resource for further understanding is found in the C++ [reference implementation](../../development/services/cpp-service/reference/magic-numbers.md#psibaseaccountnumber).
