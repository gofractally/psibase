import gdb
import gdb.xmethod
import gdb.types

def is_wasm_pointer_type(type):
    return type.name is not None and type.name.startswith('__wasm_pointer_t')

def is_wasm_reference_type(type):
    return type.name is not None and type.name.startswith('__wasm_reference_t')

def is_wasm_rvalue_reference_type(type):
    return type.name is not None and type.name.startswith('__wasm_rvalue_reference_t')

def translate_address(ptr, type=None):
    if type is None:
        type = ptr.type.strip_typedefs().template_argument(0)
    frame = gdb.selected_frame()
    linear_memory_base = frame.read_register('rsi')
    native_address = linear_memory_base + ptr["__address"].cast(linear_memory_base.type)
    return native_address.reinterpret_cast(type.pointer())

class WasmPointerWorker_deref(gdb.xmethod.XMethodWorker):
    def __init__(self, class_type):
        gdb.xmethod.XMethodWorker.__init__(self)
        self.class_type = class_type
    def get_arg_types(self):
        return None
    def get_result_type(self, obj):
        return obj.type.template_argument(0)
    def __call__(self, obj):
        return translate_address(obj, self.class_type.template_argument(0)).dereference()

class WasmPointerWorker_arrow(gdb.xmethod.XMethodWorker):
    def __init__(self, class_type):
        gdb.xmethod.XMethodWorker.__init__(self)
        self.class_type = class_type
    def get_arg_types(self):
        return None
    def get_result_type(self, obj):
        return obj.type.template_argument(0)
    def __call__(self, obj):
        return translate_address(obj, self.class_type.template_argument(0))

class WasmPointer_deref(gdb.xmethod.XMethod):
    def __init__(self):
        gdb.xmethod.XMethod.__init__(self, 'operator*')
    def get_worker(self, method_name, class_type):
        if method_name == 'operator*':
            return WasmPointerWorker_deref(class_type)

class WasmPointer_arrow(gdb.xmethod.XMethod):
    def __init__(self):
        gdb.xmethod.XMethod.__init__(self, 'operator->')
    def get_worker(self, method_name, class_type):
        if method_name == 'operator->':
            return WasmPointerWorker_arrow(class_type)

class WasmPointerMatcher(gdb.xmethod.XMethodMatcher):
    def __init__(self):
        gdb.xmethod.XMethodMatcher.__init__(self, "__wasm_pointer_t")
        self.methods = [WasmPointer_deref(), WasmPointer_arrow()]
    def match(self, class_type, method_name):
        class_type = class_type.strip_typedefs()
        if not is_wasm_pointer_type(class_type):
            return None
        result = []
        for method in self.methods:
            if method.enabled:
                worker = method.get_worker(method_name, class_type)
                if worker is not None:
                    result.append(worker)
        return result

gdb.xmethod.register_xmethod_matcher(None, WasmPointerMatcher())

class WasmPointerTypePrinterImpl(object):
    def recognize(self, type):
        if is_wasm_pointer_type(type):
            return str(type.template_argument(0).pointer())
        elif is_wasm_reference_type(type):
            return str(type.template_argument(0).reference())
        elif is_wasm_rvalue_reference_type(type):
            return str(type.template_argument(0)) + " &&"

class WasmPointerTypePrinter(gdb.types.TypePrinter):
    def __init__(self):
        gdb.types.TypePrinter.__init__(self, "__wasm_pointer_t")
    def instantiate(self):
        return WasmPointerTypePrinterImpl()

gdb.types.register_type_printer(None, WasmPointerTypePrinter())

class WasmPointerPrinter(object):
    """Print a wasm pointer"""
    def __init__(self, val):
        self.val = val
    def to_string(self):
        return str(self.val["__address"])

def native_pretty_printer(val):
    if is_wasm_pointer_type(val.type.strip_typedefs()):
        return WasmPointerPrinter(val)
    return None

gdb.pretty_printers.append(native_pretty_printer)

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
