import gdb

def is_wasm_frame(frame):
    sal = frame.find_sal()
    if (not sal.is_valid()):
        return False
    return sal.symtab is None or not sal.symtab.objfile.is_file

class WasmFilter:
    def __init__(self):
        self.name = "wasm-only"
        self.priority = 100
        self.enabled = True
        gdb.frame_filters[self.name] = self
    def filter(self, frame_iter):
        return (x for x in frame_iter if is_wasm_frame(x.inferior_frame()))

WasmFilter()

def is_wasm_address(pc):
    sal = gdb.current_progspace().find_pc_line(pc)
    if (not sal.is_valid()):
        return False
    return sal.symtab is None or not sal.symtab.objfile.is_file

def disable_native_breakpoints(breakpoint):
    if breakpoint.visible:
        for loc in breakpoint.locations:
            if loc.enabled and not is_wasm_address(loc.address):
                loc.enabled = False

gdb.events.breakpoint_created.connect(disable_native_breakpoints)
gdb.events.breakpoint_modified.connect(disable_native_breakpoints)
