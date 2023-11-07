# Account numbers

Psibase exposes "names" to end users. In fact, these string-like names are ompressed into 64-bit numeric values using a custom name compression algorithm. 
This custom account-name encoding allows for names that still compress into 64-bit values but may be from 0 to 18 characters long and contain the characters a-z, 0-9, and - (hyphen). Non-empty names must begin with a letter.

To get 64-bit values out of 18-character names, some names will fail to compress down to 64 bits. The compression algorithm is designed to prefer names that are more likely to appear in user handles, and less likely to compress names that look non-human (e.g. no vowels).

For a reference implementation of the account name encoding, see [the C++ reference](../services/cpp-service/reference/magic-numbers.md#psibaseaccountnumber).