from pathlib import Path
import json,os,resource,sys
before=resource.getrlimit(resource.RLIMIT_MEMLOCK)
resource.setrlimit(resource.RLIMIT_MEMLOCK,(65536,before[1]))
after=resource.getrlimit(resource.RLIMIT_MEMLOCK)
Path(sys.argv[1]).write_text(json.dumps({"before":before,"after":after,"pid":os.getpid()},indent=2)+"\n")
os.execv(sys.argv[2],sys.argv[2:])
