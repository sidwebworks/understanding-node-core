Node.js modules are divided into user JS modules, Node.js native JS modules, and Node.js built-in C++ modules. This chapter describes the principles of these module loading and the types and principles of module loaders in Node.js.
Let's start with an example to analyze the principle of module loading in Node.js. Suppose we have a file demo.js with the following code ```js
const myjs = require('myjs);  
 const net = require('net');

````

The code of myjs is as follows ```js
    exports.hello = 'world';
````

Let's take a look at what the process looks like when executing node demo.js. In the Node.js startup chapter, we have analyzed that when Node.js starts, the following code will be executed.
require('internal/modules/cjs/loader').Module.runMain(process.argv[1])  
 The runMain function mounts ```js in the initializeCJSLoader of pre_execution.js
function initializeCJSLoader() {  
 const CJSLoader = require('internal/modules/cjs/loader');  
 CJSLoader.Module.\_initPaths();  
 CJSLoader.Module.runMain =  
 require('internal/modules/run_main').executeUserEntryPoint;  
 }

````

We see that runMain is a function exported by run_main.js. Continue to look down ```js
    const CJSLoader = require('internal/modules/cjs/loader');
    const { Module } = CJSLoader;
    function executeUserEntryPoint(main = process.argv[1]) {
      const resolvedMain = resolveMainPath(main);
      const useESMLoader = shouldUseESMLoader(resolvedMain);
      if (useESMLoader) {
        runMainESM(resolvedMain || main);
      } else {
        Module._load(main, null, true);
      }
    }

    module.exports = {
      executeUserEntryPoint
    };
````

process.argv[1] is the JS file we want to execute. Finally, our JS is loaded through Module.\_load of cjs/loader.js. Let's take a look at the specific processing logic.

```js
    Module._load = function(request, parent, isMain) {
      const filename = Module._resolveFilename(request, parent, isMain);

      const cachedModule = Module._cache[filename];
      // If there is a cache, return directly if (cachedModule !== undefined) {
        updateChildren(parent, cachedModule, true);
        if (!cachedModule.loaded)
          return getExportsForCircularRequire(cachedModule);
        return cachedModule.exports;
      }
      // Whether it is an accessible native JS module, if yes, return const mod = loadNativeModule(filename, request);
      if (mod &amp;&amp; mod.canBeRequiredByUsers) return mod.exports;
      // For non-native JS modules, create a new Module to represent the loaded module const module = new Module(filename, parent);
      // Cache Module._cache[filename] = module;
      // load module.load(filename);
      // The caller gets the value of module.exports return module.exports;
    };
```

The \_load function is mainly three logical 1s to determine whether there is a cache, and returns if there is.  
 2 If there is no cache, it is judged whether it is a native JS module, and if it is, it is handed over to the native module for processing.  
 1 If it is not a native module, create a new Module to represent the user's JS module, and then execute the load function to load it.  
 Here we only need to focus on the logic of 3. In Node.js, user-defined modules are represented by Modules.

```js
function Module(id = "", parent) {
  // The file path corresponding to the module this.id = id;
  this.path = path.dirname(id);
  // exports variable used in the module this.exports = {};
  this.parent = parent;
  // Join the parent module's children queue updateChildren(parent, this, false);
  this.filename = null;
  // is it loaded this.loaded = false;
  this.children = [];
}
```

Then look at the logic of the load function.

```js
Module.prototype.load = function (filename) {
  this.filename = filename;
  // extension const extension = findLongestRegisteredExtension(filename);
  // Use different loading methods according to the extension Module._extensions[extension](this, filename);
  this.loaded = true;
};
```

Node.js will vary according tofile extensions are handled using different functions.

## 19.1 Loading User Modules There are three types of \_extensions in Node.js, namely js, json, and node.

### 19.1.1 Loading the JSON module Loading the JSON module is relatively simple ```js

     Module._extensions['.json'] = function(module, filename) {
       const content = fs.readFileSync(filename, 'utf8');

       try {
         module.exports = JSONParse(stripBOM(content));
       } catch (err) {
         err.message = filename + ': ' + err.message;
         throw err;
       }
     };

`````

Just read the content of the JSON file and parse it into an object.
### 19.1.2 Load JS module ````js
    Module._extensions['.js'] = function(module, filename) {
      const content = fs.readFileSync(filename, 'utf8');
      module._compile(content, filename);
    };
`````

After reading the contents of the file, then execute \_compile

```js
    Module.prototype._compile = function(content, filename) {
      // Generate a function const compiledWrapper = wrapSafe(filename, content, this);
      const dirname = path.dirname(filename);
      // require is a wrapper around the _load function const require = (path) =&gt; {
          return this.require(path);
        };
      let result;
        // The exports variable we usually use const exports = this.exports;
      const thisValue = exports;
        // The module variable we usually use const module = this;
      // Execute function result = compiledWrapper.call(thisValue,
                                        exports,
                                        require,
                                        module,
                                        filename,
                                        dirname);
      return result;
    }
```

\_compile includes several important logics 1 wrapSafe: wraps our code and generates a function 2 require: supports loading other modules within the module 3 Execute module code Let's take a look at these three logics.
1 wrapSafe

```js
    function wrapSafe(filename, content, cjsModuleInstance) {
        const wrapper = Module.wrap(content);
        return vm.runInThisContext(wrapper, {
          filename,
          lineOffset: 0,
          ...
        });
    }

    const wrapper = [
      '(function (exports, require, module, __filename, __dirname) { ',
      '\n});'
    ];

    Module.wrap = function(script) {
      return Module.wrapper[0] + script + Module.wrapper[1];
    };
```

When the first parameter of vm.runInThisContext is "(function() {})", it will return a function. So after executing Module.wrap, it will return a string, the content is as follows ```js
(function (exports, require, module, **filename, **dirname) {  
 //  
 });

`````

Next, let's take a look at the require function, which is the require we usually use in our code.
2 require

````js
    Module.prototype.require = function(id) {
      requireDepth++;
      try {
        return Module._load(id, this, /* isMain */ false);
      } finally {
        requireDepth--;
      }
    };
`````

require is the encapsulation of Module.\_load. Module.\_load will return the variables exported by the module to the require caller through the module.exports attribute. Because Module.\_load only finds the modules that users need to load from native JS modules and user JS modules, it cannot access C++ modules. To access C++ modules, process.bindng or internalBinding can be used.
3 Executing the code we go back to the \_compile function. Take a look at the function returned by executing vm.runInThisContext.

```js
compiledWrapper.call(exports, exports, require, module, filename, dirname);
```

Equivalent to executing the following code ```js
(function (exports, require, module, **filename, **dirname) {  
 const myjs = require('myjs);
const net = require('net');
});

`````

At this point, Node.js starts to execute the user's JS code. We have just analyzed that require is the encapsulation of Module._load. When executing require to load the user module, it returns to the process we are analyzing.
### 19.1.3 Loading node modules Node extensions are essentially dynamic link libraries. Let's look at the process of requiring a .node module. We start by loading the source code of the .node module.

````js
    Module._extensions['.node'] = function(module, filename) {
      // ...
      return process.dlopen(module, path.toNamespacedPath(filename));
    };
`````

Directly call process.dlopen, which is defined in node.js.

```js
const rawMethods = internalBinding("process_methods");
process.dlopen = rawMethods.dlopen;
```

Find the process_methods module corresponding to node_process_methods.cc.

```cpp
env-&gt;SetMethod(target, "dlopen", binding::DLOpen);
```

As I said before, the extension module of Node.js is actually a dynamic link library, so let's first look at how we use a dynamic link library. Below is sample code.

```cpp
    #include
    #include
    #include
    int#modname, \
          priv, \
          {0}, \
        }; \
        static void _register_modname(void) __attribute__((constructor)); \
          static void _register_modname(void) { \
          napi_module_register(&amp;_module); \
        }
```

So a node extension defines a napi_module module and a register_modname (modname is what we define) function. \_\_attribute((constructor)) means that the function will be executed first, please refer to the documentation for details. Seeing this, we know that when we open a dynamic link library, the \_register_modname function will be executed, which executes ```cpp
napi_module_register(&amp;\_module);

`````

We continue to expand.

````cpp

    // Registers a NAPI module.
    void napi_module_register(napi_module* mod) {
      node::node_module* nm = new node::node_module {
        -1,
        mod-&gt;nm_flags | NM_F_DELETEME,
        nullptr,
        mod-&gt;nm_filename,
        nullptr,
        napi_module_register_cb,
        mod-&gt;nm_modname,
        mod, // priv
        nullptr,
      };
      node::node_module_register(nm);
    }
`````

Node.js converts napi modules into node_modules. Finally call node_module_register.

```cpp

    extern "C" void node_module_register(void* m) {
      struct node_module* mp = reinterpret_cast (m);

      if (mp-&gt;nm_flags &amp; NM_F_INTERNAL) {
        mp-&gt;nm_link = modlist_internal;
        modlist_internal = mp;
      } else if (!node_is_initialized) {
        mp-&gt;nm_flags = NM_F_LINKED;
        mp-&gt;nm_link = modlist_linked;
        modlist_linked = mp;
      } else {
        thread_local_modpending = mp;
      }
    }
```

The napi module is not an NM_F_INTERNAL module, node_is_initialized is a variable set when Node.js is initialized, and it is already true at this time. So when the napi module is registered, thread_local_modpending = mp is executed. thread_local_modpending is like a global variable that holds the currently loaded module. After analyzing this, we return to the DLOpen function.

```cpp
    node_module* mp = thread_local_modpending;
    thread_local_modpending = nullptr;
```

At this time, we know the function of the variable thread_local_modpending just now. After node_module\* mp = thread_local_modpending we get the information of the napi module we just defined. Then execute the function nm_register_func of node_module.

```cpp
    if (mp-&gt;nm_context_register_func != nullptr) {
      mp-&gt;nm_context_register_func(exports,
                                     module,
                                     context,
                                     mp-&gt;nm_priv);
     } else if (mp-&gt;nm_register_func != nullptr) {
       mp-&gt;nm_register_func(exports, module, mp-&gt;nm_priv);
     }
```

From the node_module definition just now we see that the function is napi_module_register_cb.

```cpp
    static void napi_module_register_cb(v8::Local exports,
                                      v8::Local module,
                                      v8::Local context,
                                      void* priv) {
      napi_module_register_by_symbol(exports, module, context,
          static_cast (priv)-&gt;nm_register_func);
    }
```

This function calls the napi_module_register_by_symbol function and passes in the nm_register_func function of napi_module.

```cpp
    void napi_module_register_by_symbol(v8::Local exports,
                                      v8::Local module,
                                      v8::Local context,
                                      napi_addon_register_func init) {

      // Create a new napi_env for this specific module.
      napi_env env = v8impl::NewEnv(context);

      napi_value_exports;
      env-&gt;CallIntoModuleThrow([&amp;](napi_env env) {
        _exports = init(env, v8impl::JsValueFromV8LocalValue(exports));
      });

      if (_exports != nullptr &amp;&amp;
          _exports != v8impl::JsValueFromV8LocalValue(exports)) {
        napi_value _module = v8impl::JsValueFromV8LocalValue(module);
        napi_set_named_property(env, _module, "exports", _exports);
      }
    }
```

init is the function we define. The input parameters are env and exports, which can be compared to the input parameters of the functions we define. Finally we modify the exports variable. That is, set the exported content. Finally, in JS, we get the content defined by the C++ layer.

## 19.2 Loading native JS modules In the previous section, we learned about the process of Node.js executing node demo.js, in which we use require to load the net module in demo.js. net is a native JS module. At this time, it will enter the processing logic of the native module.

er::Result\* result) {

       Isolate* isolate = context-&gt;GetIsolate();
       EscapableHandleScope scope(isolate);

       Local source;
       // Find the memory address where the native JS module content is located if (!LoadBuiltinModuleSource(isolate, id).ToLocal(&amp;source)) {
         return {};
       }
       // 'net' + '.js'
       std::string filename_s = id + std::string(".js");
       Local filename =
           OneByteString(isolate,
                 filename_s.c_str(),
                 filename_s.size());
       // omit some parameter processing // script source ScriptCompiler::Source script_source(source, origin, cached_data);
       // Compile a function MaybeLocal maybe_fun =
           ScriptCompiler::CompileFunctionInContext(context,
                                                       &amp;script_source,
                                parameters-&gt;size(),
                                parameters-&gt;data(),
                                0,
                                nullptr,
                                options);
       Local fun = maybe_fun.ToLocalChecked();
       return scope.Escape(fun);
     }

`````

The LookupAndCompile function first finds the source code of the loaded module, and then compiles a function. Let's take a look at how LoadBuiltinModuleSource finds the module source code.

````cpp
    MaybeLocal NativeModuleLoader::LoadBuiltinModuleSource(Isolate* isolate, const char* id) {
      const auto source_it = source_.find(id);
      return source_it-&gt;second.ToStringChecked(isolate);
    }
`````

Here the id is net, and the corresponding data is found from \_source through this id, then what is \_source? Because Node.js directly converts the source string of the native JS module into ASCII code and stores it in memory in order to improve efficiency. In this way, when these modules are loaded, there is no need for hard disk IO. Just read directly from memory. Let's take a look at the definition of \_source (in node_javascript.cc generated by compiling Node.js source code or executing js2c.py).

```cpp
    source_.emplace("net", UnionBytes{net_raw, 46682});
    source_.emplace("cyb", UnionBytes{cyb_raw, 63});
    source_.emplace("os", UnionBytes{os_raw, 7548});
```

cyb is the test module I added. We can take a look at the contents of this module.

```cpp
    static const uint8_t cyb_raw[] = {
     99, 111, 110, 115, 116, 32, 99, 121, 98, 32, 61, 32, 105, 110, 116, 101, 114, 110, 97, 108, 66, 105, 110, 100, 105, 110, 103, 40, 39, 99,
    121, 98, 95, 119, 114, 97, 112, 39, 41, 59, 32, 10, 109, 111, 100, 117, 108, 101, 46, 101, 120, 112, 111, 114, 116, 115, 32, 61, 32, 9,
    121, 98, 59
    };
```

Let's turn it into a string and see what is ```js
Buffer.from([99,111,110,115,116, 32, 99,121, 98, 32, 61, 32,105,110,116,101,114,110, 97,108, 66,105,110,100,105,110,103, 40, 39, 99,
121, 98, 95, 119, 114, 97, 112, 39, 41, 59, 32, 10, 109, 111, 100, 117, 108, 101, 46, 101, 120, 112, 111, 114, 116, 115, 32, 61, 32, 9,
121, 98, 59].join(',').split(',')).toString('utf-8')

````

output ```js
    const cyb = internalBinding('cyb_wrap');
    module.exports = cyb;
````

So when we execute require('net'), through NativeModule's compileForInternalLoader, we will finally find the source string corresponding to the net module in \_source, and then compile it into a function.

```js
const fn = compileFunction(id);
fn(
  this.exports,
  // Loader nativeModuleRequire for loading native JS modules,
  this,
  process,
  // Load C++ module loader internalBinding,
  primordials
);
```

From the input parameters of fn, we can know that we can only load native JS modules and built-in C++ modules in net (or other native JS modules). When fn finishes executing, the native module loader returns the value of mod.exports to the caller.
19.3 Loading built-in C++ modules In native JS modules, we generally load some built-in C++ modules, which is the key to Node.js expanding JS functions. For example, when we require('net'), the net module will load the tcp_wrap module.

```js
const {
  TCP,
  TCPConnectWrap,
  constants: TCPConstants,
} = internalBinding("tcp_wrap");
```

The C++ module loader is also defined in internal/bootstrap/loaders.js and is divided into three types.  
 1 internalBinding: An interface that is not exposed to user access and can only be accessed in Node.js code, such as native JS modules (flag is NM_F_INTERNAL).

```js
let internalBinding;
{
  const bindingObj = ObjectCreate(null);
  internalBinding = function internalBinding(module) {
    let mod = bindingObj[module];
    if (typeof mod !== "object") {
      mod = bindingObj[module] = getInternalBinding(module);
      moduleLoadList.push(`Internal Binding ${module}`);
    }
    return mod;
  };
}
```

InternalBinding adds a cache function to the getInternalBinding function. getInternalBinding is the interface name of the function defined by the C++ layer exposed to JS. Its role is to find the corresponding module from the C++ module list.  
 2A module is executed, that is, the registration function static Local in it is executed InitModule(Environment* env,  
 node_module* mod,  
 Local module) {  
 Local exports = Object::New(env-&gt;isolate());  
 Local unused = Undefined(env-&gt;isolate());  
 mod-&gt;nm_context_register_func(exports, unused, env-&gt;context(), mod-&gt;nm_priv);  
 return exports;  
 }

```

Execute the function pointed to by nm_context_register_func of the C++ module. This function is the Initialize function defined on the last line of the C++ module. Initialize sets the exported object. We can access the objects exported by Initialize from JS. In V8, the rule for JS to call C++ functions is the function input parameter const FunctionCallbackInfo &amp; args (get the content from JS) and set the return value args.GetReturnValue().Set (the content returned to JS), the logic of the GetInternalBinding function is to execute the hook function of the corresponding module, and pass an exports variable in, and then The hook function will modify the value of exports, which is the value that the JS layer can get.
```
