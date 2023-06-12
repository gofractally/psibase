import gdb
import sys
import os.path

prefixdir = os.path.dirname(gdb.current_objfile().filename)
if os.path.basename(prefixdir) == 'bin':
    prefixdir = os.path.dirname(prefixdir)
pyroot = os.path.join(prefixdir, 'share/psibase/python')
if not pyroot in sys.path:
    sys.path.insert(0, pyroot)

import psibase
psibase.register(gdb.current_objfile())
