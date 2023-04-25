import gdb

class HideNative(gdb.Parameter):
    """Controls whether native frames and functions are visible"""
    def __init__(self, name):
        super (HideNative, self).__init__(name, gdb.COMMAND_BREAKPOINTS, gdb.PARAM_BOOLEAN)
        self.value = True

hide_native = HideNative("hide-native")

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
        if hide_native.value:
            return (x for x in frame_iter if is_wasm_frame(x.inferior_frame()))
        else:
            return frame_iter

WasmFilter()

def is_wasm_address(pc):
    sal = gdb.current_progspace().find_pc_line(pc)
    if (not sal.is_valid()):
        return False
    return sal.symtab is None or not sal.symtab.objfile.is_file

def disable_native_breakpoints(breakpoint):
    if hide_native.value and breakpoint.visible:
        for loc in breakpoint.locations:
            if loc.enabled and not is_wasm_address(loc.address):
                loc.enabled = False

gdb.events.breakpoint_created.connect(disable_native_breakpoints)
gdb.events.breakpoint_modified.connect(disable_native_breakpoints)

gdb.set_parameter("breakpoint pending", True)
