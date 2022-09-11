From a macro perspective, there are several ways to expand Node.js, including directly modifying the Node.js kernel, recompiling and distributing, and providing npm packages. npm packages can be further divided into JS and C++ extensions. This chapter mainly introduces modifying the Node.js kernel and writing C++ plugins.

## 20.1 Modifying the Node.js kernel There are many ways to modify the Node.js kernel. We can modify the code of the JS layer, C++, and C language layer, or add some functions or modules. This section introduces how to add a Node.js C++ module and modify the Node.js kernel. Adding a Node.js built-in module requires more knowledge than modifying the Node.js core code.

### 20.1.1 Add a built-in C++ module 1. First, add two files in the src folder.

cyb.h

```cpp
    #ifndef SRC_CYB_H_
    #define SRC_CYB_H_
    #include "v8.h"

    namespace node {
    class Environment;
    class Cyb {
     public:
        static void Initialize(v8::Local target,
                     v8::Local unused,
                     v8::Local context,
                     void* priv);
      private:
      static void Console(const v8::FunctionCallbackInfo &amp; args);
    };
    } // namespace node
    #endif
```

cyb.cc

```cpp
    #include "cyb.h"
    #include "env-inl.h"
    #include "util-inl.h"
    #include "node_internals.h"

    namespace node {
    using v8::Context;
    using v8::Function;
    using v8::FunctionCallbackInfo;
    using v8::FunctionTemplate;
    using v8::Local;
    using v8::Object;
    using v8::String;
    using v8::Value;

    void Cyb::Initialize(Local target,
               Local unused,
               Local context,
               void* priv) {
      Environment* env = Environment::GetCurrent(context);
      // Apply for a function module, the template function is Console
      Local t = env-&gt;NewFunctionTemplate(Console);
      // Apply for a string Local str = FIXED_ONE_BYTE_STRING(env-&gt;isolate(),
                                                     "console");
      // Set the function name t-&gt;SetClassName(str);
      // Export function, target is exports
      target-&gt;Set(env-&gt;context(),
                  str,
                  t-&gt;GetFunction(env-&gt;context()).ToLocalChecke
        d()).Check();
    }

    void Cyb::Console(const FunctionCallbackInfo &amp; args) {
      v8::Isolate* isolate = args.GetIsolate();
      v8::Local str = String::NewFromUtf8(isolate,
                                                       "hello world");
      args.GetReturnValue().Set(str);
    }

    } // namespace node
    // declare the module NODE_MODULE_CONTEXT_AWARE_INTERNAL(cyb_wrap, node::Cyb::Initialize)
```

We define a new module, which cannot be automatically added to the Node.js core, and we need additional operations.  
 1 First we need to modify the node.gyp file. Add our new file to the configuration, otherwise the new module will not be compiled when compiling. We can find src/tcp_wrap.cc in the node.gyp file and add our file after it.

```text
    src/cyb_wrap.cc
    src/cyb_wrap.h
```

At this point Node.js will compile our code. However, the built-in modules of Node.js have a certain mechanism. Our code has been added to the Node.js core, which does not mean that it can be used. Node.js will call the RegisterBuiltinModules function to register all built-in C++ modules during initialization.

```cpp
    void RegisterBuiltinModules() {
    #define V(modname) _register_##modname();
      NODE_BUILTIN_MODULES(V)
    #undef V
    }
```

We see that the function has only one macro. Let's look at this macro.

```cpp
    void RegisterBuiltinModules() {
    #define V(modname) _register_##modname();
      NODE_BUILTIN_MODULES(V)
    #undef V
    }
    #define NODE_BUILTIN_MODULES(V) \
      NODE_BUILTIN_STANDARD_MODULES(V) \
      NODE_BUILTIN_OPENSSL_MODULES(V) \
      NODE_BUILTIN_ICU_MODULES(V) \
      NODE_BUILTIN_REPORT_MODULES(V) \
      NODE_BUILTIN_PROFILER_MODULES(V) \
      NODE_BUILTIN_DTRACE_MODULES(V)
```

Inside the macro is a bunch of macros. All we have to do is modify this macro. Since we are custom built-in modules, we can add a macro.

```cpp
    #define NODE_BUILTIN_EXTEND_MODULES(V) \
      V(cyb_wrap)
```

Then append this macro to that bunch of macros.

```cpp
    #define NODE_BUILTIN_MODULES(V) \
      NODE_BUILTIN_STANDARD_MODULES(V) \
      NODE_BUILTIN_OPENSSL_MODULES(V) \
      NODE_BUILTIN_ICU_MODULES(V) \
      NODE_BUILTIN_REPORT_MODULES(V) \
      NODE_BUILTIN_PROFILER_MODULES(V) \
      NODE_BUILTIN_DTRACE_MODULES(V) \
      NODE_BUILTIN_EXTEND_MODULES(V)
```

At this time, Node.js can not only compile our code, but also register the modules defined in our code into the built-in C++ module. The next step is how to use the C++ module.  
 2 Create a new cyb.js in the lib folder as a Node.js native module ```js
const cyb = internalBinding('cyb_wrap');  
 module.exports = cyb;

`````

To add native modules, we also need to modify the node.gyp file, otherwise the code will not be compiled into the node kernel. We find lib/net.js of node.gyp file and append lib/cyb.js after it. The file under this configuration is used by js2c.py. If it is not modified, the module will not be found when we require it. Finally, we find the internalBindingWhitelist variable in the lib/internal/bootstrap/loader file, and add cyb_wrap at the end of the array. This configuration is used by the process.binding function. If we do not modify this configuration, we will not be able to find our module through process.binding. . process.binding is available in user JS. At this point, we have completed all the modifications and recompiled Node.js. Then write the test program.
3 Create a new test file testcyb.js

````js
    // const cyb = process.binding('cyb_wrap');
    const cyb = require('cyb');
    console.log(cyb.console())
`````

As you can see, hello world will be output.

### 20.1.2 Modifying the Node.js kernel This section describes how to modify the Node.js kernel. The modified part is mainly to improve the TCP keepalive function of Node.js. Currently, the keepalive of Node.js only supports setting switches and sending probe packets after idle time. In the new Linux kernel, TCP keepalive includes the following configuration.

```
1 How long there are no communication packets, then start sending probe packets.
2 How often, send probe packets again.
3 After how many probe packets are sent, the connection is considered disconnected.
4 TCP_USER_TIMEOUT, data is sent, and the connection is considered disconnected after a long time without receiving ack.
```

Node.js only supports the first line, so our goal is to support 2,3,4. Because this function is provided by the operating system, the code of Libuv needs to be modified first.  
 1 Modify src/unix/tcp.c  
 Add the following code in tcp.c ```js
int uv_tcp_keepalive_ex(uv_tcp_t\* handle,  
 int on,  
 unsigned int delay,  
 unsigned int interval,  
 unsigned int count) {  
 int err;

       if (uv__stream_fd(handle) != -1) {
         err =uv__tcp_keepalive_ex(uv__stream_fd(handle),
                                   on,
                                   delay,
                                   interval,
                                   count);
         if (err)
           return err;
       }

       if (on)
         handle-&gt;flags |= UV_HANDLE_TCP_KEEPALIVE;
       else
         handle-&gt;flags &amp;= ~UV_HANDLE_TCP_KEEPALIVE;
      return 0;
     }

     int uv_tcp_timeout(uv_tcp_t* handle, unsigned int timeout) {
       #ifdef TCP_USER_TIMEOUT
         int fd = uv__stream_fd(handle);
         if (fd != -1 &amp;&amp; setsockopt(fd,
                                    IPPROTO_TCP,
                                    TCP_USER_TIMEOUT,
                                    &amp;timeout,
                                    sizeof(timeout))) {
           return UV__ERR(errno);
         }
       #endif
         return 0;
     }

     int uv__tcp_keepalive_ex(int ​​fd,
                              int on,
                              unsigned int delay,
                              unsigned int interval,
                              unsigned int count) {
       if (setsockopt(fd, SOL_SOCKET, SO_KEEPALIVE, &amp;on, sizeof(on)))
         return UV__ERR(errno);

     #ifdef TCP_KEEPIDLE
         if (on &amp;&amp; delay &amp;&amp;setsockopt(fd,
                                      IPPROTO_TCP,
                                      TCP_KEEPIDLE,
                                      &amp;delay,
                                      sizeof(delay)))
           return UV__ERR(errno);
     #endif
     #ifdef TCP_KEEPINTVL
         if (on &amp;&amp; interval &amp;&amp; setsockopt(fd,
                                          IPPROTO_TCP,
                                          TCP_KEEPINTVL,
                                          &amp;interval,
                                          sizeof(interval)))
           return UV__ERR(errno);
     #endif
     #ifdefDeclare these two functions.

```cpp
    static void SetKeepAliveEx(const v8::FunctionCallbackInfo &amp; args);
    static void SetKeepAliveTimeout(const v8::FunctionCallbackInfo &amp; args);
```

```js
// Modify lib/net.js
    Socket.prototype.setKeepAliveEx = function(setting,
                                               secs,
                                               interval,
                                               count) {
      if (!this._handle) {
        this.once('connect', () =&gt; this.setKeepAliveEx(setting,
                                                       secs,
                                                       interval,
                                                       count));
        return this;
      }

      if (this._handle.setKeepAliveEx)
        this._handle.setKeepAliveEx(setting,
                                    ~~secs &gt; 0 ? ~~secs : 0,
                                    ~~interval &gt; 0 ? ~~interval : 0,
                                    ~~count &gt; 0 ? ~~count : 0);

      return this;
    };

    Socket.prototype.setKeepAliveTimeout = function(timeout) {
      if (!this._handle) {
        this.once('connect', () =&gt; this.setKeepAliveTimeout(timeout));
        return this;
      }

      if (this._handle.setKeepAliveTimeout)
        this._handle.setKeepAliveTimeout(~~timeout &gt; 0 ? ~~timeout : 0);

      return this;
    };
```

Recompiling Node.js, we can use these two new APIs to control TCP keepalive more flexibly.

```js
    const net = require('net');
    net.createServer((socket) =&gt; {
      socket.setKeepAliveEx(true, 1,2,3);
      // socket.setKeepAliveTimeout(4);
    }).listen(1101);
```

## 20.2 Using N-API to write C++ plug-ins This section introduces the knowledge of writing C++ plug-ins using N_API. The Node.js C++ plug-in is essentially a dynamic link library. After writing and compiling, a .node file is generated. We directly require use in Node.js, Node.js will handle everything for us.

First create a test.cc file ```cpp
// hello.cc using N-API  
 #include

     namespace demo {

     napi_value Method(napi_env env, napi_callback_info args) {
       napi_value greeting;
       napi_status status;

       status = napi_create_string_utf8(env, "world", NAPI_AUTO_LENGTH, &amp;greeting);
       if (status != napi_ok) return nullptr;
       return greeting;
     }

     napi_value init(napi_env env, napi_value exports) {
       napi_status status;
       napi_value fn;

       status = napi_create_function(env, nullptr, 0, Method, nullptr, &amp;fn);
       if (status != napi_ok) return nullptr;

       status = napi_set_named_property(env, exports, "hello", fn);
       if (status != napi_ok) return nullptr;
       return exports;
     }

     NAPI_MODULE(NODE_GYP_MODULE_NAME, init)

     } // namespace demo

`````

We don't need to know exactly what the code means, but from the code we know roughly what it does. All that's left is to read the API documentation for N-API. Then we create a new binding.gyp file. The gyp file is the configuration file for node-gyp. node-gyp can help us produce different compilation configuration files for different platforms. Such as makefiles under Linux.

````json
    {
      "targets": [
        {
          "target_name": "test",
          "sources": [ "./test.cc" ]
        }
      ]
    }
`````

The syntax is a bit like makefile, which is to define the current file name after we compile and which source files to depend on. Then we install node-gyp.

```sh
npm install node-gyp -g
```

There is also a node-gyp in the Node.js source code, which is used for in-place compilation when npm installs extension modules. The node-gyp we installed is to help us generate configuration files and compile them. For details, please refer to the Node.js documentation. everything's ready. We start compiling. Execute ```sh directly
node-gyp configure
node-gyp build

`````

The test.node file is generated under the path ./build/Release/. This is our extension module. We write the test program app.js.

````js
    var addon = require("./build/Release/test");
    console.log(addon.hello());
`````

implement

```text
node app.js
```

We see the output world. We have learned how to write a Node.js extension module. All that's left is to read the N-API documentation and write different modules according to your needs.
