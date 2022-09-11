This chapter introduces the principles and implementation of some core modules of the C++ layer in Node.js, which are used by many modules in Node.js. Only by understanding the principles of these modules can you better understand how JS calls Libuv through the C++ layer in Node.js, and how it returns from Libuv.

## 6.1 BaseObject

BaseObject is the base class for most classes in the C++ layer.

```cpp
    class BaseObject : public MemoryRetainer {
     public:
     // …
     private:
      v8::Local WrappedObject() const override;
      // Point to the encapsulated object v8::Global persistent_handle_;
      Environment* env_;
    };
```

The implementation of BaseObject is very complicated, and only some commonly used implementations are introduced here.

### 6.1.1 Constructor

```c

     // Store the object in persistent_handle_, and take it out through object() if necessary BaseObject::BaseObject(Environment* env,
                              v8::Local object)
     : persistent_handle_(env-&gt;isolate(), object),
       env_(env) {
       // Store this in object object-&gt;SetAlignedPointerInInternalField(0, static_cast (this));
     }

```

The constructor is used to save the relationship between objects (the object used by JS and the C++ layer object related to it, the object in the figure below is the object we usually create by using the C++ module in the JS layer, such as new TCP()).

We can see the usefulness later, and the relationship is shown in Figure 6-1.

![](https://img-blog.csdnimg.cn/c732bcd047c349adbb9f5d4a501a1345.png)

### 6.1.2 Get the encapsulated object

```c

    v8::Local BaseObject::object() const {
      return PersistentToLocal::Default(env()-&gt;isolate(),
                                            persistent_handle_);
    }

```

### 6.1.3 Get the saved BaseObject object from the object

```c

     // Take out the BaseObject object saved inside through obj BaseObject*

     BaseObject::FromJSObject(v8::Local obj) {
       return static_cast (obj-&gt;GetAlignedPointerFromInternalField(0));
     }

     template
     T* BaseObject::FromJSObject(v8::Local object) {
       return static_cast (FromJSObject(object));
     }

```

### 6.1.4 Unpacking

```c

    // Take the corresponding BaseObject object template from obj
    inline T* Unwrap(v8::Local obj) {
      return BaseObject::FromJSObject (obj);
    }

    // Get the corresponding BaseObject object from obj, if it is empty, return the value of the third parameter (default value)
    #define ASSIGN_OR_RETURN_UNWRAP(ptr, obj, ...) \
      do { \
        *ptr = static_cast ::type&gt;( \
            BaseObject::FromJSObject(obj)); \
        if (*ptr == nullptr) \
          return __VA_ARGS__; \
      } while (0)

```

## 6.2 AsyncWrap

AsyncWrap implements the async_hook module, but here we only focus on its function of calling back JS.

```c
    inline v8::MaybeLocal AsyncWrap::MakeCallback(
        const v8::Local symbol,
        int argc,
        v8::Local *argv) {
      v8::Local cb_v;
      // According to the property value represented by the string, get the value corresponding to the property from the object. is a function
      if (!object()-&gt;Get(env()-&gt;context(), symbol).ToLocal(&amp;cb_v))
        return v8::MaybeLocal ();
      // is a function
      if (!cb_v-&gt;IsFunction()) {
        return v8::MaybeLocal ();
      }
      // callback, see async_wrap.cc
      return MakeCallback(cb_v.As (), argc, argv);
    }
```

The above is just the entry function, let's look at the real implementation.

```cpp
    MaybeLocal AsyncWrap::MakeCallback(const Local cb,
                                              int argc,
                                              Local *argv) {

      MaybeLocal ret = InternalMakeCallback(env(), object(), cb, argc, argv, context);
      return ret;
    }
```

Then take a look at InternalMakeCallback

```cpp
    MaybeLocal InternalMakeCallback(Environment* env,
                                           Local recv,
                                           const Local callback,
                                           int argc,
                                           Local argv[],
                                           async_context asyncContext) {
      // …omit other code // execute callback callback-&gt;Call(env-&gt;context(), recv, argc, argv);}
```

## 6.3 HandleWrap

HandleWrap is the encapsulation of Libuv uv_handle_t and the base class of many C++ classes.

```cpp
    class HandleWrap : public AsyncWrap {
     public:
      // Operate and judge handle state function, see Libuv
      static void Close(const v8::FunctionCallbackInfo &amp; args);
      static void Ref(const v8::FunctionCallbackInfo &amp; args);
      static void Unref(const v8::FunctionCallbackInfo &amp; args);
      static void HasRef(const v8::FunctionCallbackInfo &amp; args);
      static inline bool IsAlive(const HandleWrap* wrap) {
        return wrap != nullptr &amp;&amp; wrap-&gt;state_ != kClosed;
      }

      static inline bool HasRef(const HandleWrap* wrap) {
        return IsAlive(wrap) &amp;&amp; uv_has_ref(wrap-&gt;GetHandle());
      }
      // Get the packaged handle
      inline uv_handle_t* GetHandle() const { return handle_; }
      // Close the handle, and execute the callback virtual void Close(
          v8::Local close_callback =
           v8::Local ());

      static v8::Local GetConstructorTemplate(
      Environment* env);

     protected:
      HandleWrap(Environment* env,
                 v8::Local object,
                 uv_handle_t* handle,
                 AsyncWrap::ProviderType provider);
      virtual void OnClose() {}
      // handle state inline bool IsHandleClosing() const {
        return state_ == kClosing || state_ == kClosed;
      }

     private:
      friend class Environment;
      friend void GetActiveHandles(const v8::FunctionCallbackInfo &amp;);
      static void OnClose(uv_handle_t* handle);

      // handle queue ListNode handle_wrap_queue_;
      // handle state enum { kInitialized, kClosing, kClosed } state_;
      // base class for all handles uv_handle_t* const handle_;
    };
```

### 6.3.1 New handle and initialization

```cpp

     Local HandleWrap::GetConstructorTemplate(Environment* env) {
       Local tmpl = env-&gt;handle_wrap_ctor_template();
       if (tmpl.IsEmpty()) {
         tmpl = env-&gt;NewFunctionTemplate(nullptr);
         tmpl-&gt;SetClassName(FIXED_ONE_BYTE_STRING(env-&gt;isolate(),
                              "HandleWrap"));
         tmpl-&gt;Inherit(AsyncWrap::GetConstructorTemplate(env));
         env-&gt;SetProtoMethod(tmpl, "close", HandleWrap::Close);
         env-&gt;SetProtoMethodNoSideEffect(tmpl,
                                             "hasRef",
                                            HandleWrap::HasRef);
         env-&gt;SetProtoMethod(tmpl, "ref", HandleWrap::Ref);
         env-&gt;SetProtoMethod(tmpl, "unref", HandleWrap::Unref);
         env-&gt;set_handle_wrap_ctor_template(tmpl);
       }
       return tmpl;
     }
     /*
       object is the object provided by the C++ layer for the JS layer handle is the specific handle type of the subclass, different modules are different*/
     HandleWrap::HandleWrap(Environment* env,
                            Local object,
                            uv_handle_t* handle,
                            AsyncWrap::ProviderType provider)
         : AsyncWrap(env, object, provider),
           state_(kInitialized),
           handle_(handle) {
       // Save the relationship between Libuv handle and C++ object handle_-&gt;data = this;
       HandleScope scope(env-&gt;isolate());
       CHECK(env-&gt;has_run_bootstrapping_code());
       // Insert handle queue env-&gt;handle_wrap_queue()-&gt;PushBack(this);
     }

```

```cpp
HandleWrap inherits the BaseObject class, and the relationship diagram after initialization is shown in Figure 6-2.
AsyncWrap::ProviderType provider);
      inline ~ReqWrap() override;
      inline void Dispatched();
      inline void Reset();
      T* req() { return &amp;req_; }
      inline void Cancel() final;
      inline AsyncWrap* GetAsyncWrap() override;
      static ReqWrap* from_req(T* req);
      template
      // call Libuv
      inline int Dispatch(LibuvFunction fn, Args... args);

     public:
      typedef void (*callback_t)();
      callback_t original_callback_ = nullptr;

     protected:
      T req_;
    };

    }
```

Let's take a look at the implementation of cpp
template

```cpp
ReqWrap ::ReqWrap(Environment\* env,
v8::Local object,
AsyncWrap::ProviderType provider)
: AsyncWrap(env, object, provider),
ReqWrapBase(env) {
// Initialize state Reset();
}

     // Save the relationship template between libuv data structure and ReqWrap instance
     void ReqWrap ::Dispatched() {
       req_.data = this;
     }

     // reset field template
     void ReqWrap ::Reset() {
       original_callback_ = nullptr;
       req_.data = nullptr;
     }

     // Find the address template of the owning object through the req member
     ReqWrap * ReqWrap ::from_req(T* req) {
       return ContainerOf(&amp;ReqWrap ::req_, req);
     }

     // Cancel the request template in the thread pool
     void ReqWrap ::Cancel() {
       if (req_.data == this)
         uv_cancel(reinterpret_cast (&amp;req_));
     }

     template
     AsyncWrap* ReqWrap ::GetAsyncWrap() {
       return this;
     }
     // Call the Libuv function template
     template
     int ReqWrap ::Dispatch(LibuvFunction fn, Args... args) {
       Dispatched();
       int err = CallLibuvFunction ::Call(
           // Libuv function fn,
           env()-&gt;event_loop(),
           req(),
           MakeLibuvRequestCallback ::For(this, args)...);
       if (err &gt;= 0)
         env()-&gt;IncreaseWaitingRequestCounter();
       return err;
     }

```

We see that ReqWrap abstracts the process of requesting Libuv, and the specifically designed data structure is implemented by subclasses. Let's look at the implementation of a subclass.

```cpp
    // When requesting Libuv, the data structure is uv_connect_t, which means a connection request class ConnectWrap : public ReqWrap {
     public:
      ConnectWrap(Environment* env,
                  v8::Local req_wrap_obj,
                  AsyncWrap::ProviderType provider);
    };
```

## 6.5 How JS uses C++

The ability of JS to call C++ modules is provided by V8, and Node.js uses this ability. In this way, we only need to face JS, and leave the rest to Node.js. This article first talks about how to use V8 to implement JS to call C++, and then talk about how Node.js does it.

1. **JS calls C++**
   First, let's introduce two very core classes in V8, FunctionTemplate and ObjectTemplate. As the names suggest, these two classes define templates, just like the design drawings when building a house. Through the design drawings, we can build the corresponding house. V8 is also, if you define a template, you can create a corresponding instance through this template. These concepts are described below (for convenience, the following is pseudocode).

1.1 **Define a function template**

```cpp
Local functionTemplate = v8::FunctionTemplate::New(isolate(), New);
// Define the name of the function functionTemplate-&gt;SetClassName('TCP')

```

First define a `FunctionTemplate` object. We see that the second parameter of FunctionTemplate is a function, and when we execute the function created by FunctionTemplate, v8 will execute the New function. Of course we can also not pass it on.

1.2 Define the prototype content of the function template The prototype is the function.prototype in JS.

If you understand the knowledge in JS, it is easy to understand the code in C++.

```cpp
    v8::Local t = v8::FunctionTemplate::New(isolate(), callback);
    t-&gt;SetClassName('test');
    // Define a property on prototype t-&gt;PrototypeTemplate()-&gt;Set('hello', 'world');
```

1.3 Define the content of the instance template corresponding to the function template An instance template is an ObjectTemplate object. It defines the properties of the return value when the function created by the function template is executed as new.

```js
function A() {
  this.a = 1;
  this.b = 2;
}
new A();
```

The instance template is similar to the code in the A function in the above code. Let's see how it is defined in V8.

```cpp
    t-&gt;InstanceTemplate()-&gt;Set(key, val);
    t-&gt;InstanceTemplate()-&gt;SetInternalFieldCount(1);
```

InstanceTemplate returns an ObjectTemplate object. The SetInternalFieldCount function is special and important. We know that an object is a piece of memory, and an object has its own memory layout. We know that in C++, when we define a class, we define the layout of the object. For example, we have the following definition.

```cpp
    class demo
    {
     private:
      intconst int kConstructorOffset = TemplateInfo::kHeaderSize;
      static const int kInternalFieldCountOffset = kConstructorOffset + kPointerSize;
      static const int kSize = kInternalFieldCountOffset + kHeaderSize;
    };
```

The memory layout is shown in Figure 6-5.

![](https://img-blog.csdnimg.cn/9cfde2c74ac24d529350ffda1bc6c2ac.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA,FF_FFt==,0)

Coming back to the question of object templates, let's see what Set(key, val) does.

```cpp
    void Template::Set(v8::Handle name, v8::Handle value, v8::PropertyAttribute attribute) {
      // ... i::Handle list(Utils::OpenHandle(this)-&gt;property_list());
     NeanderArray array(list);
     array.add(Utils::OpenHandle(*name));
     array.add(Utils::OpenHandle(*value));
     array.add(Utils::OpenHandle(*v8::Integer::New(attribute)));
    }
```

The above code is roughly to append some content to a list. Let's see how this list comes from, that is, the implementation of the property_list function.

```cpp
// Read the value of a property in the object
  #define READ_FIELD(p, offset) (*reinterpret_cast (FIELD_ADDR(p, offset))
  static Object* cast(Object* value) { return value; }
  Object* TemplateInfo::property_list() { return Object::cast(READ_FIELD(this, kPropertyListOffset)); }
```

From the above code, we know that the internal layout is shown in Figure 6-6.

![](https://img-blog.csdnimg.cn/10abb0324ce54c9eba3743e8f4e61cc2.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6FFLy9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size)
Figure 6-6

According to the memory layout, we know that the value of property_list is the value pointed to by list. Therefore, the memory operated by Set(key, val) is not the memory of the object itself. The object uses a pointer to point to a piece of memory to store the value of Set(key, val). The SetInternalFieldCount function is different, it affects (expands) the memory of the object itself. Let's take a look at its implementation.

```cpp
void ObjectTemplate::SetInternalFieldCount(int value) {
  // The modification is the value of the memory corresponding to kInternalFieldCountOffset
  Utils::OpenHandle(this)-&gt;set_internal_field_count(i::Smi::FromInt(value)); }

```

We see that the implementation of the SetInternalFieldCount function is very simple, which is to save a number in the memory of the object itself. Next we look at the use of this field. Its usefulness will be described in detail later.

```cpp

handle Factory::CreateApiFunction( handle obj, bool is_global) { int internal_field_count = 0; if (!obj-&gt;instance_template()-&gt;IsUndefined()) {
   // Get the instance template Handle of the function template
   instance_template = Handle (ObjectTemplateInfo::cast(obj-&gt;instance_template()));
    // Get the value of the internal_field_count field of the instance template (the one set by SetInternalFieldCount)
    internal_field_count = Smi::cast(instance_template-&gt;internal_field_count())-&gt;value(); }
    // Calculate the space required for the new object, if int instance_size = kPointerSize
    * internal_field_count; if (is_global) { instance_size += JSGlobalObject::kSize; } else { instance_size += JSObject::kHeaderSize; }
    InstanceType type = is_global ? JS_GLOBAL_OBJECT_TYPE : JS_OBJECT_TYPE;

     // Create a new function object Handle
     result = Factory::NewFunction(Factory::empty_symbol(), type, instance_size, code, true); }

```

We see that the meaning of the value of internal_field_count is to expand the memory of the object.

For example, an object itself has only n bytes. If the value of internal_field_count is defined as 1, the memory of the object will become n+internal_field_count \* The number of bytes of a pointer .

The memory layout is shown in Figure 6-7. ![](https://img-blog.csdnimg.cn/e3ac46175f034690a3cda19d2e61969d.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG09nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_1RIRUFOQVJLSA==)
Figure 6-7

1.4 Create a function Local through a function template functionTemplate = v8::FunctionTemplate::New(isolate(), New); global-&gt;Set('demo', functionTemplate -&gt;GetFunction()); In this way, we can directly call the demo variable in JS, and then the corresponding function will be executed. This is how JS calls C++.

2. How Node.js handles the problem of JS calling C++ Let's take the TCP module as an example.

```cpp
TCPWrap(env, args.This(), provider);
```

```js
const { TCP } = process.binding('tcp_wrap'); new TCP(...);
```

We follow the inheritance relationship of TCPWrap, all the way to HandleWrap

```cpp
    HandleWrap::HandleWrap(Environment* env,
                           Local object,
                           uv_handle_t* handle,
                           AsyncWrap::ProviderType provider)
        : AsyncWrap(env, object, provider),
          state_(kInitialized),
          handle_(handle) {
      // Save the relationship between Libuv handle and C++ object handle_-&gt;data = this;
      HandleScope scope(env-&gt;isolate());
      // Insert handle queue env-&gt;handle_wrap_queue()-&gt;PushBack(this);
    }
```

HandleWrap first saves the relationship between the Libuv structure and the C++ object. Then we continue to analyze along AsyncWrap, AsyncWrap inherits BaseObject, we look directly at BaseObject.

```cpp
    // Store the object in persistent_handle_, and take it out through object() if necessary BaseObject::BaseObject(Environment* env, v8::Local object)
        : persistent_handle_(env-&gt;isolate(), object), env_(env) {
      // Store this in object object-&gt;SetAlignedPointerInInternalField(0, static_cast (this));
      env-&gt;AddCleanupHook(DeleteMe, static_cast (this));
      env-&gt;modify_base_object_count(1);
    }
```

We look at SetAlignedPointerInInternalField.

```cpp
    void v8::Object::SetAlignedPointerInInternalField(int index, void* value) {
      i::Handle obj = Utils::OpenHandle(this);
      i::Handle ::cast(obj)-&gt;SetEmbedderField(
          index, EncodeAlignedAsSmi(value, location));
    }

    void JSObject::SetEmbedderField(int index, Smi* value) {
      // GetHeaderSize is the size of the fixed layout of the object, kPointerSize * index is the expanded memory size, find the corresponding position according to the index
      int offset = GetHeaderSize() + (kPointerSize * index);
      // Write the memory of the corresponding location, that is, save the corresponding content to the memory
      WRITE_FIELD(this, offset, value);
    }
```

After the SetAlignedPointerInInternalField function is expanded, what it does is to save a value into the memory of the V8 C++ object. What is the stored value? The input parameter object of BaseObject is the object created by the function template, and this is a TCPWrap object. So what the SetAlignedPointerInInternalField function does is to save a TCPWrap object to an object created by a function template, as shown in Figure 6-8.

![](https://img-blog.csdnimg.cn/cead0241ca5a4f02b38727ae85145fcc.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJFFt_7,size_0)
Figure 6-8

What's the use of this? We continue to analyze. At this time, the new TCP is executed. Let's look at the logic of executing the tcp.connect() function at this time.

```cpp
    // template
    void TCPWrap::Connect(const FunctionCallbackInfo &amp; args,
        std::function uv_ip_addr) {
      Environment* env = Environment::GetCurrent(args);

      TCPWrap* wrap;
      ASSIGN_OR_RETURN_UNWRAP(&amp;wrap,
                              args.Holder(),
                              args.GetReturnValue().Set(UV_EBADF));
      // Omit some irrelevant code args.GetReturnValue().Set(err);
    }
```

We just have to look at the logic of the ASSIGN_OR_RETURN_UNWRAP macro. Among them, args.Holder() represents the owner of the Connect function. According to the previous analysis, we know that the owner is the object created by the function template defined by the Initialize function. This object holds a TCPWrap object. The main logic of ASSIGN_OR_RETURN_UNWRAP is to take out the TCPWrap object saved in the C++ object. Then you can use the handle of the TCPWrap object to request Libuv.

## 6.7 C++ layer calls Libuv

Just now we analyzed how the JS calls the C++ layer and how they are linked together, and then we look at how the C++ calls Libuv and the Libuv callback C++ layer is linked together. We continue to analyze the process through the connect function of the TCP module.

```cpp
    template
    void TCPWrap::Connect(const FunctionCallbackInfo &amp; args,
        std::function uv_ip_addr) {
      Environment* env = Environment::GetCurrent(args);

      TCPWrap* wrap;
      ASSIGN_OR_RETURN_UNWRAP(&amp;wrap,
                              args.Holder(),
                              args.GetReturnValue().Set(UV_EBADF));

      // The first parameter is the TCPConnectWrap object, see the net module Local req_wrap_obj = args[0].As ();
      // The second is the ip address node::Utf8Value ip_address(env-&gt;isolate(), args[1]);

      T addr;
      // Set the port and IP to addr, the port information is in the context of uv_ip_addr int err = uv_ip_addr(*ip_address, &amp;addr);

      if (err == 0) {
        ConnectWrap* req_wrap =
            new ConnectWrap(env,
                              req_wrap_obj,
            )
```

that is because a large number of template parameters are used. CallLibuvFunction is essentially a struct, which is similar to a class in C++. There is only one class function Call. In order to adapt to the calls of various types of functions in the Libuv layer, Node.js implements Three types of CallLibuvFunction are used, and a large number of template parameters are used. We only need to analyze one. We start the analysis based on the connect function of TCP. We first specify the template parameters of the Dispatch function.

T corresponds to the type of ReqWrap, and LibuvFunction corresponds to the function type of Libuv. Here is int uv_tcp_connect(uv_connect_t\* req, ...), so it corresponds to the second case of LibuvFunction. Args is the first argument when executing Dispatch. remaining parameters. Below we concrete Dispatch.

```cpp
    int ReqWrap ::Dispatch(int(*)(uv_connect_t*, Args...), Args... args) {
      req_.data = this;
      int err = CallLibuvFunction ::Call(
          fn,
          env()-&gt;event_loop(),
          req(),
          MakeLibuvRequestCallback ::For(this, args)...);

      return err;
    }
```

Then we look at the implementation of MakeLibuvRequestCallback.

```cpp
    // Transparently pass parameters to Libuv
    template
    struct MakeLibuvRequestCallback {
      static T For(ReqWrap * req_wrap, T v) {
        static_assert(!is_callable ::value,
                      "MakeLibuvRequestCallback missed a callback");
        return v;
      }
    };

    template
    struct MakeLibuvRequestCallback {
      using F = void(*)(ReqT* req, Args... args);
      // Libuv callback static void Wrapper(ReqT* req, Args... args) {
        // Get the corresponding C++ object ReqWrap through the Libuv structure * req_wrap = ReqWrap ::from_req(req);
        req_wrap-&gt;env()-&gt;DecreaseWaitingRequestCounter();
        // Get the original callback and execute F original_callback = reinterpret_cast (req_wrap-&gt;original_callback_);
        original_callback(req, args...);
      }

      static F For(ReqWrap * req_wrap, F v) {
        // Save the original function CHECK_NULL(req_wrap-&gt;original_callback_);
        req_wrap-&gt;original_callback_=
            reinterpret_cast ::callback_t&gt;(v);
        // Return the wrapper function return Wrapper;
      }
    };
```

There are two cases for the implementation of MakeLibuvRequestCallback. The first of the template parameters is generally a ReqWrap subclass, and the second is generally a handle.

When the ReqWrap class is initialized, the number of ReqWrap instances will be recorded in the env, so as to know how many requests are being made Processed by Libuv, if the second parameter of the template parameter is a function, it means that ReqWrap is not used to request Libuv, and the second implementation is used to hijack the callback to record the number of requests being processed by Libuv (such as the implementation of GetAddrInfo). So here we are adapting the first implementation. Transparently transmit C++ layer parameters to Libuv. Let's look at Dispatch again

```cpp
    int ReqWrap ::Dispatch(int(*)(uv_connect_t*, Args...), Args... args) {
          req_.data = this;
          int err = CallLibuvFunction ::Call(
              fn,
              env()-&gt;event_loop(),
              req(),
              args...);

          return err;
      }
```

Expand further.

```cpp
    static int Call(int(*fn)(uv_connect_t*, Args...), uv_loop_t* loop, uv_connect_t* req, PassedArgs... args) {
        return fn(req, args...);
    }
```

Finally expand

```cpp
static int Call(int(_fn)(uv_connect_t_, Args...), uv_loop_t* loop, uv_connect_t* req, PassedArgs... args) {
return fn(req, args...);
}

     Call(
       uv_tcp_connect,
       env()-&gt;event_loop(),
       req(),
       &amp;wrap-&gt;handle_,
       AfterConnect
     )

     uv_tcp_connect(
       env()-&gt;event_loop(),
       req(),
       &amp;wrap-&gt;handle_,
       AfterConnect
     );

```

Then let's see what uv_tcp_connect does.

````cpp
    int uv_tcp_connect(uv_connect_t* req,
                       uv_tcp_t* handle,
                       const struct sockaddr* addr,
                       uv_connect_cb cb) {
      // ...
      return uv__tcp_connect(req, handle, addr, addrlen, cb);
    }

    int uv__tcp_connect(uv_connect_t* req,
                        uv_tcp_t* handle,
                        const struct sockaddr* addr,
                        unsigned int addrlen,
                        uv_connect_cb cb) {
      int err;
      int r;

      // Associated req-&gt;handle = (uv_stream_t*)Interestingly, the listener will be notified when there is data to read on the stream or when an event occurs.

```cpp

     class StreamResource {
      public:
       virtual ~StreamResource();
       // register/unregister waiting for stream read event virtual int ReadStart() = 0;
       virtual int ReadStop() = 0;
       // close the stream virtual int DoShutdown(ShutdownWrap* req_wrap) = 0;
       // write stream virtual int DoTryWrite(uv_buf_t** bufs, size_t* count);
       virtual int DoWrite(WriteWrap* w,
                           uv_buf_t* bufs,
                           size_t count,
                           uv_stream_t* send_handle) = 0;
       // ...ignore some // add or remove listeners to the stream void PushStreamListener(StreamListener* listener);
       void RemoveStreamListener(StreamListener* listener);

      protected:
       uv_buf_t EmitAlloc(size_t suggested_size);
       void EmitRead(ssize_t nread,
                       const uv_buf_t&amp; buf = uv_buf_init(nullptr, 0));
       // The listener of the stream, that is, the data consumer StreamListener* listener_ = nullptr;
       uint64_t bytes_read_ = 0;
       uint64_t bytes_written_ = 0;
       friend class StreamListener;
     };

````

StreamResource is a base class, one of which is an instance of the StreamListener class, which we will analyze later. Let's look at the implementation of StreamResource.
1 Add a listener

```cpp

     // add a listener
     inline void StreamResource::PushStreamListener(StreamListener* listener) {
       // header method listener-&gt;previous_listener_ = listener_;
       listener-&gt;stream_ = this;
       listener_ = listener;
     }

```

We can register multiple listeners on a stream, and the stream's listener\_ field maintains all the listener queues on the stream. The relationship diagram is shown in Figure 6-15.

![](https://img-blog.csdnimg.cn/1147406f206a481f9fc8ad8192592d06.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA)
Figure 6-15

2. delete the listener

```cpp
     inline void StreamResource::RemoveStreamListener(StreamListener* listener) {
       StreamListener* previous;
       StreamListener* current;

       // Traverse the singly linked list for (current = listener_, previous = nullptr;
            /* No loop condition because we want a crash if listener is not found */
            ; previous = current, current = current-&gt;previous_listener_) {
         if (current == listener) {
           // non-null means that the node to be deleted is not the first node if (previous != nullptr)
             previous-&gt;previous_listener_ = current-&gt;previous_listener_;
           else
             // The first node is deleted, just update the head pointer listener_ = listener-&gt;previous_listener_;
           break;
         }
       }
       // Reset the deleted listener's field listener-&gt;stream_ = nullptr;
       listener-&gt;previous_listener_ = nullptr;
```

3. Apply for storage data

```cpp
// Apply for a block of memory inline uv*buf_t
StreamResource::EmitAlloc(size_t suggested_size) {
DebugSealHandleScope handle_scope(v8::Isolate::GetCurrent());
return listener*-&gt;OnStreamAlloc(suggested_size);
}

```

StreamResource just defines the general logic of the operation stream, and the data storage and consumption are defined by the listener.

4. Data can be read

```cpp
inline void StreamResource::EmitRead(ssize*t nread, const uv_buf_t&amp; buf) {
if (nread &gt; 0)
// record the size in bytes of the data read from the stream bytes_read* += static*cast (nread);
listener*-&gt;OnStreamRead(nread, buf);
}

```

5. Write callback

```cpp
inline void StreamResource::EmitAfterWrite(WriteWrap\* w, int status) {
DebugSealHandleScope handle*scope(v8::Isolate::GetCurrent());
listener*-&gt;OnStreamAfterWrite(w, status);
}

```

6. close stream callback

```cpp
inline void StreamResource::EmitAfterShutdown(ShutdownWrap\* w, int status) {
DebugSealHandleScope handle*scope(v8::Isolate::GetCurrent());
listener*-&gt;OnStreamAfterShutdown(w, status);
}

```

7 stream destroy callback

```cpp
    inline StreamResource::~StreamResource() {
      while (listener_ != nullptr) {
        StreamListener* listener = listener_;
        listener-&gt;OnStreamDestroy();
        if (listener == listener_)
          RemoveStreamListener(listener_);
      }
    }
```

After the stream is destroyed, the listener needs to be notified and the relationship is released.

### 6.8.2 StreamBase

StreamBase is a subclass of StreamResource and extends the functionality of StreamResource.

```cpp
    class StreamBasereq_wrap-&gt;Dispose();
      }

      const char* msg = Error();
      if (msg != nullptr) {
        req_wrap_obj-&gt;Set(
            env-&gt;context(),
            env-&gt;error_string(),
             OneByteString(env-&gt;isolate(), msg)).Check();
        ClearError();
      }

      return err;
    }
```

3. write

```cpp
// Write Buffer, support sending file descriptor int StreamBase::WriteBuffer(const FunctionCallbackInfo &amp; args) {
Environment\* env = Environment::GetCurrent(args);

       Local req_wrap_obj = args[0].As ();
       uv_buf_t buf;
       // data content and length buf.base = Buffer::Data(args[1]);
       buf.len = Buffer::Length(args[1]);

       uv_stream_t* send_handle = nullptr;
       // is an object and the stream supports sending file descriptors if (args[2]-&gt;IsObject() &amp;&amp; IsIPCPipe()) {
         Local send_handle_obj = args[2].As ();

         HandleWrap* wrap;
         // Get the C++ layer object pointed to by internalField from the object returned by js ASSIGN_OR_RETURN_UNWRAP(&amp;wrap, send_handle_obj, UV_EINVAL);
         // Get the handle of the Libuv layer
         send_handle = reinterpret_cast (wrap-&gt;GetHandle());
         // Reference LibuvStreamWrap instance to prevent it from being garbage
         // collected before `AfterWrite` is called.
         // Set to the JS layer request object req_wrap_obj-&gt;Set(env-&gt;context(),
                           env-&gt;handle_string(),
                           send_handle_obj).Check();
       }

       StreamWriteResult res = Write(&amp;buf, 1, send_handle, req_wrap_obj);
       SetWriteResult(res);

       return res.err;
     }

```

```cpp

     inline StreamWriteResult StreamBase::Write(
         uv_buf_t* bufs,
         size_t count,
         uv_stream_t* send_handle,
         v8::Local req_wrap_obj) {
       Environment* env = stream_env();
       int err;

       size_t total_bytes = 0;
       // Calculate the size of the data to be written for (size_t i = 0; i &lt; count; ++i)
         total_bytes += bufs[i].len;
       // same as above bytes_written_ += total_bytes;
       // Do you need to send a file descriptor, if not, write directly if (send_handle == nullptr) {
         err = DoTryWrite(&amp;bufs, &amp;count);
         if (err != 0 || count == 0) {
           return StreamWriteResult { false, err, nullptr, total_bytes };
         }
       }

       HandleScope handle_scope(env-&gt;isolate());

       AsyncHooks::DefaultTriggerAsyncIdScope trigger_scope(GetAsyncWrap());
       // Create a write request object for requesting Libuv WriteWrap* req_wrap = CreateWriteWrap(req_wrap_obj);
       // Execute write, subclass implementation, different stream write operations are different err = DoWrite(req_wrap, bufs, count, send_handle);

       const char* msg = Error();
       if (msg != nullptr) {
         req_wrap_obj-&gt;Set(env-&gt;context(),
                           env-&gt;error_string(),
                           OneByteString(env-&gt;isolate(), msg)).Check();
         ClearError();
       }

       return StreamWriteResult { async, err, req_wrap, total_bytes };
     }

```

4. read

```cpp
// Operation stream, start reading int StreamBase::ReadStartJS(const FunctionCallbackInfo &amp; args) {
return ReadStart();
}

    // Operation stream, stop reading int StreamBase::ReadStopJS(const FunctionCallbackInfo &amp; args) {
      return ReadStop();
    }

    // Trigger stream event, there is data to read MaybeLocal StreamBase::CallJSOnreadMethod(ssize_t nread,
                                                      Local ab,
                                                     size_t offset,
                                                     StreamBaseJSChecks checks) {
      Environment* env = env_;
      env-&gt;stream_base_state()[kReadBytesOrError] = nread;
      env-&gt;stream_base_state()[kArrayBufferOffset] = offset;

      Local argv[] = {
        ab.IsEmpty() ? Undefined(env-&gt;isolate()).As () : ab.As ()
      };
      // GetAsyncWrap is implemented in the StreamBase subclass, get the StreamBase class object AsyncWrap* wrap = GetAsyncWrap();
      //Set(UV_EINVAL);

      args.GetReturnValue().Set(wrap-&gt;GetFD());
    }

    void StreamBase::GetBytesRead(const FunctionCallbackInfo &amp; args) {
      StreamBase* wrap = StreamBase::FromObject(args.This().As ());
      if (wrap == nullptr) return args.GetReturnValue().Set(0);

      // uint64_t -&gt; double. 53bits is enough for all real cases.
      args.GetReturnValue().Set(static_cast (wrap-&gt;bytes_read_));
    }

```

### 6.8.3 LibuvStreamWrap

LibuvStreamWrap is a subclass of StreamBase. It implements the interface of the parent class and also expands the capabilities of the stream.

```cpp
    class LibuvStreamWrap : public HandleWrap, public StreamBase {
     public:
      static void Initialize(v8::Local target,
                             v8::Local unused,
                             v8::Local context,
                             void* priv);

      int GetFD() override;
      bool IsAlive() override;
     bool IsClosing() override;
     bool IsIPCPipe() override;

     // JavaScript functions
     int ReadStart() override;
     int ReadStop() override;

     // Resource implementation
     int DoShutdown(ShutdownWrap* req_wrap) override;
     int DoTryWrite(uv_buf_t** bufs, size_t* count) override;
     int DoWrite(WriteWrap* w,
                 uv_buf_t* bufs,
                 size_t count,
                 uv_stream_t* send_handle) override;

     inline uv_stream_t* stream() const {
       return stream_;
     }
     // is it a Unix domain or a named pipe inline bool is_named_pipe() const {
       return stream()-&gt;type == UV_NAMED_PIPE;
     }
     // Is it a Unix domain and supports passing file descriptors inline bool is_named_pipe_ipc() const {
       return is_named_pipe() &amp;&amp;
              reinterpret_cast (stream())-&gt;ipc != 0;
     }

     inline bool is_tcp() const {
       return stream()-&gt;type == UV_TCP;
     }
     // Create object ShutdownWrap requesting Libuv* CreateShutdownWrap(v8::Local object) override;
     WriteWrap* CreateWriteWrap(v8::Local object) override;
     // Get the corresponding C++ object from the JS layer object static LibuvStreamWrap* From(Environment* env, v8::Local object);

    protected:
     LibuvStreamWrap(Environment* env,
                     v8::Local object,
                     uv_stream_t* stream,
                     AsyncWrap::ProviderType provider);

     AsyncWrap* GetAsyncWrap() override;

     static v8::Local GetConstructorTemplate(
         Environment* env);

    private:
     static void GetWriteQueueSize(
         const v8::FunctionCallbackInfo &amp; info);
     static void SetBlocking(const v8::FunctionCallbackInfo &amp; args);

     // Callbacks for libuv
     void OnUvAlloc(size_t suggested_size, uv_buf_t* buf);
     void OnUvRead(ssize_t nread, const uv_buf_t* buf);

     static void AfterUvWrite(uv_write_t* req, int status);
     static void AfterUvShutdown(uv_shutdown_t* req, int status);

     uv_stream_t* const stream_;
    };
```

1. Initialize

```
LibuvStreamWrap::LibuvStreamWrap(Environment* env,
Local object,
uv_stream_t* stream,
AsyncWrap::ProviderType provider)
: HandleWrap(env,
object,
reinterpret*cast (stream),
provider),
StreamBase(env),
stream*(stream) {
StreamBase::AttachToObject(object);
}

```

When LibuvStreamWrap is initialized, it will point the internal pointer of the object used by the JS layer to itself, see HandleWrap.
2 write operation

```cpp
    // Tool function to get the size of data bytes to be written void LibuvStreamWrap::GetWriteQueueSize(
        const FunctionCallbackInfo &amp; info) {
      LibuvStreamWrap* wrap;
      ASSIGN_OR_RETURN_UNWRAP(&amp;wrap, info.This());
      uint32_t write_queue_size =ggested_size, buf);
      }, [](uv_stream_t* stream, ssize_t nread, const uv_buf_t* buf) {
        static_cast (stream-&gt;data)-&gt;OnUvRead(nread, buf);
      });
    }

    // Implement stop reading logic int LibuvStreamWrap::ReadStop() {
      return uv_read_stop(stream());
    }

    // The callback when memory needs to be allocated is called back by Libuv, and the specific memory allocation logic is implemented by the listener void LibuvStreamWrap::OnUvAlloc(size_t suggested_size, uv_buf_t* buf) {
      HandleScope scope(env()-&gt;isolate());
      Context::Scope context_scope(env()-&gt;context());

      *buf = EmitAlloc(suggested_size);
    }
    // Process the passed file descriptor template
    static MaybeLocal AcceptHandle(Environment* env,
                                           LibuvStreamWrap* parent) {
      EscapableHandleScope scope(env-&gt;isolate());
      Local wrap_obj;
      // Create an object representing the client according to the type, then save the file descriptor in it if (!WrapType::Instantiate(env, parent, WrapType::SOCKET).ToLocal(&amp;wrap_obj))
        return Local ();
      // Solve the C++ layer object HandleWrap* wrap = Unwrap (wrap_obj);
      CHECK_NOT_NULL(wrap);
      // Get the handle encapsulated in the C++ object
      uv_stream_t* stream = reinterpret_cast (wrap-&gt;GetHandle());
      // Take a fd from the server stream and save it to steam
      if (uv_accept(parent-&gt;stream(), stream))
        ABORT();

      return scope.Escape(wrap_obj);
    }

    // Implement OnUvRead, Libuv will call back when there is data in the stream or read to the end

    void LibuvStreamWrap::OnUvRead(ssize_t nread, const uv_buf_t* buf) {
      HandleScope scope(env()-&gt;isolate());
      Context::Scope context_scope(env()-&gt;context());
      uv_handle_type type = UV_UNKNOWN_HANDLE;
      // Whether it supports passing file descriptors and there is a pending file descriptor, then determine the file descriptor type
       if (is_named_pipe_ipc() &amp;&amp;
          uv_pipe_pending_count(reinterpret_cast (stream())) &gt; 0) {
        type = uv_pipe_pending_type(reinterpret_cast (stream()));
      }

      // read successfully
      if (nread &gt; 0) {
        MaybeLocal pending_obj;
        // Create a new C++ object representing the client according to the type, and take a fd from the server and save it to the client

        if (type == UV_TCP) {
          pending_obj = AcceptHandle (env(), this);
        } else if (type == UV_NAMED_PIPE) {
          pending_obj = AcceptHandle (env(), this);
        } else if (type == UV_UDP) {
          pending_obj = AcceptHandle (env(), this);
        } else {
          CHECK_EQ(type, UV_UNKNOWN_HANDLE);
        }
        // If there is a file descriptor that needs to be processed, it is set to the JS layer object, and the JS layer uses
        if (!pending_obj.IsEmpty()) {
          object()
              -&gt;Set(env()-&gt;context(),
                    env()-&gt;pending_handle_string(),
                    pending_obj.ToLocalChecked())
              .Check();
        }
      }
      // Trigger read event, listener implements
      EmitRead(nread, *buf);
    }
```

The read operation supports not only reading general data, but also reading file descriptors. The C++ layer will create a new stream object to represent the file descriptor. It can be used in the JS layer.

### 6.8.4 ConnectionWrap

ConnectionWrap is a subclass of LibuvStreamWrap that extends the connection interface. Applies to streams with connection attributes, such as Unix domains and TCP.

```cpp
    // WrapType is the class of the C++ layer, UVType is the type template of Libuv
    class ConnectionWrap : public LibuvStreamWrap {
     public:
      static void OnConnection(uv_stream_t* handle, int status);
      static void AfterConnect(uv_connect_t* req, int status);

     protected:
      ConnectionWrap(Environment* env,
                     v8::Local object,
                     ProviderType provider);

      UVType handle_;
    };
```

1 Callback after the connection is initiated

```cpp
void ConnectionWrap ::AfterConnect(uv_connect_t* req,
int status) {
// Get the corresponding C++ object std::unique_ptr through the Libuv structure r
eq_wrap = (static_cast (req-&gt;data));
WrapType* wrap = static_cast (req-&gt;handle-&gt;data);
Environment\* env = wrap-&gt;env();

       HandleScope handle_scope(env-&gt;isolate());
      context())
                                         .ToLocalChecked();
       Local type_value = Int32::New(env-&gt;isolate(), type);
       // Equivalent to the object we get when we call new TCP() in the JS layer return handle_scope.EscapeMaybe(
           constructor-&gt;NewInstance(env-&gt;context(), 1, &amp;type_value));
     }

```

### 6.8.5 StreamReq

StreamReq represents a request to operate a stream. It mainly saves the request context and the general logic after the operation ends.

```cpp

     // Request Libuv's base class class StreamReq {
      public:
      // The internalField[1] of the object passed in by the JS layer saves the StreamReq class object static constexpr int kStreamReqField = 1;
       // stream is the stream to be operated, req_wrap_obj is the object passed in by the JS layer explicit StreamReq(StreamBase* stream,
                          v8::Local req_wrap_obj) : stream_(stream) {
         // JS layer object points to the current StreamReq object AttachToObject(req_wrap_obj);
       }
       // Subclass defines virtual AsyncWrap* GetAsyncWrap() = 0;
       // Get the associated raw js object v8::Local object();
       // The callback after the end of the request will execute the onDone of the subclass, which is implemented by the subclass
       void Done(int status, const char* error_str = nullptr);
       // The JS layer object no longer executes the StreamReq instance void Dispose();
       // Get the stream being operated inline StreamBase* stream() const { return stream_; }
       // Get the StreamReq object from the JS layer object static StreamReq* FromObject(v8::Local req_wrap_obj);
       // Request all internalFields of JS layer objects to point to static inline void ResetObject(v8::Local req_wrap_obj);

      protected:
       // Callback virtual void OnDone(int status) = 0 after the request ends;
       void AttachToObject(v8::Local req_wrap_obj);

      private:
       StreamBase* const stream_;
     };

```

StreamReq has a member stream\_, which represents the stream operated in the StreamReq request. Let's look at the implementation below.
1 JS layer request context and StreamReq relationship management.

```cpp

     inline void StreamReq::AttachToObject(v8::Local req_wrap_obj) {
       req_wrap_obj-&gt;SetAlignedPointerInInternalField(kStreamReqField, this);
     }

     inline StreamReq* StreamReq::FromObject(v8::Local req_wrap_obj) {
       return static_cast (
           req_wrap_obj-&gt;GetAlignedPointerFromInternalField(kStreamReqField));
     }

     inline void StreamReq::Dispose() {
       object()-&gt;SetAlignedPointerInInternalField(kStreamReqField, nullptr);
       delete this;
     }

     inline void StreamReq::ResetObject(v8::Local obj) {
       obj-&gt;SetAlignedPointerInInternalField(0, nullptr); // BaseObject field.
       obj-&gt;SetAlignedPointerInInternalField(StreamReq::kStreamReqField, nullptr);
     }

```

2 Get the original JS layer request object

```cpp
// Get the original js object inline v8::Local associated with the request StreamReq::object() {
return GetAsyncWrap()-&gt;object();
}

```

3 Request end callback

```cpp
inline void StreamReq::Done(int status, const char* error_str) {
AsyncWrap* async_wrap = GetAsyncWrap();
Environment\* env = async_wrap-&gt;env();
if (error_str != nullptr) {
async_wrap-&gt;object()-&gt;Set(env-&gt;context(),
env-&gt;error_string(),
OneByteString(env-&gt;isolate(),
error_str))
.Check();
}
// Execute the subclass's OnDone
OnDone(status);
}

```

After the stream operation request ends, Done will be executed uniformly, and Done will execute the OnDone function implemented by the subclass.

### 6.8.6 ShutdownWrap

ShutdownWrap is a subclass of StreamReq and represents a request to close the stream once.

```cpp

     class ShutdownWrap : public StreamReq {
      public:
       ShutdownWrap(StreamBase* stream,
                    v8::Local req_wrap_obj)
         : StreamReq(stream, req_wrap_obj) { }

       void OnDone(int status) override;
     };

```

ShutdownWrap implements the OnDone interface and is executed by the base class after closing the stream.

```cpp

     /*
       Callback at the end of the shutdown, Libuv is called by the request class (ShutdownWrap),
       Therefore, after the Libuv operation is completed, the callback of the request class is executed first, the request class notifies the stream, the stream triggers the corresponding event, and further informs the listener
     */
     inline void ShutdownWrap::OnDone(int status) {
       stream()-&gt;EmitAfterShutdown(this, status);
       Dispose();
     }

```

### 6.8.7 Processing logic when the current stream is closed

```cpp
inline void StreamListener::OnStreamAfterShutdown(ShutdownWrap* w, int status) {
      previous_listener_-&gt;OnStreamAfterShutdown(w, status);
    }
    // Implement the processing logic at the end of writing inline void StreamListener::OnStreamAfterWrite(WriteWrap* w, int status) {
      previous_listener_-&gt;OnStreamAfterWrite(w, status);
    }
```

The logic of StreamListener is not much, and the specific implementation is in the subclass.

### 6.8.11 ReportWritesToJSStreamListener

ReportWritesToJSStreamListener is a subclass of StreamListener. Covers some interfaces and expands some functions.

```cpp
    class ReportWritesToJSStreamListener : public StreamListener {
     public:
      // Implement these two interfaces of the parent class void OnStreamAfterWrite(WriteWrap* w, int status) override;
      void OnStreamAfterShutdown(ShutdownWrap* w, int status) override;

     private:
      void OnStreamAfterReqFinished(StreamReq* req_wrap, int status);
    };
```

1 OnStreamAfterReqFinished
OnStreamAfterReqFinished is a unified callback after the request operation stream ends.

```cpp
    void ReportWritesToJSStreamListener::OnStreamAfterWrite(
        WriteWrap* req_wrap, int status) {
      OnStreamAfterReqFinished(req_wrap, status);
    }

    void ReportWritesToJSStreamListener::OnStreamAfterShutdown(
        ShutdownWrap* req_wrap, int status) {
      OnStreamAfterReqFinished(req_wrap, status);
    }
```

Let's take a look at the specific implementation

```cpp
void ReportWritesToJSStreamListener::OnStreamAfterReqFinished(
StreamReq* req_wrap, int status) {
// Request the stream to operate on StreamBase* stream = static*cast (stream*);
Environment* env = stream-&gt;stream_env();
AsyncWrap* async_wrap = req_wrap-&gt;GetAsyncWrap();
HandleScope handle_scope(env-&gt;isolate());
Context::Scope context_scope(env-&gt;context());
// Get the original JS layer object Local req_wrap_obj = async_wrap-&gt;object();

      Local argv[] = {
        Integer::New(env-&gt;isolate(), status),
        stream-&gt;GetObject(),
        Undefined(env-&gt;isolate())
      };

      const char* msg = stream-&gt;Error();
      if (msg != nullptr) {
        argv[2] = OneByteString(env-&gt;isolate(), msg);
        stream-&gt;ClearError();
      }
      // Callback JS layer if (req_wrap_obj-&gt;Has(env-&gt;context(), env-&gt;oncomplete_string()).FromJust())
        async_wrap-&gt;MakeCallback(env-&gt;oncomplete_string(), arraysize(argv), argv);
    }

```

OnStreamAfterReqFinished will call back the JS layer.

### 6.8.12 EmitToJSStreamListener

EmitToJSStreamListener is a subclass of ReportWritesToJSStreamListener

```cpp
class EmitToJSStreamListener : public ReportWritesToJSStreamListener {
public:
uv_buf_t OnStreamAlloc(size_t suggested_size) override;
void OnStreamRead(ssize_t nread, const uv_buf_t&amp; buf) override;
};

```

Let's take a look at the implementation

```cpp

// Allocate a block of memory uv*buf_t
EmitToJSStreamListener::OnStreamAlloc(size_t suggested_size) {
Environment \* env = static_cast (stream*)-&gt;stream*env();
return env-&gt;AllocateManaged(suggested_size).release();
}
// Callback after reading data
void EmitToJSStreamListener::OnStreamRead(ssize_t nread, const uv_buf_t&amp; buf*) {
StreamBase* stream = static*cast (stream*);
Environment* env = stream-&gt;stream*env();
HandleScope handle_scope(env-&gt;isolate());
Context::Scope context_scope(env-&gt;context());
AllocatedBuffer buf(env, buf*);
// read failed
if (nread &lt;= 0) {
if (nread &lt; 0)
stream-&gt;CallJSOnreadMethod(nread, Local ());
return;
}

   buf.Resize(nread);
       // read success callback JS layer stream-&gt;CallJSOnreadMethod(nread, buf.ToArrayBuffer());

}

```

We see that the listener will call back the interface of the stream after processing the data, and the specific logic is implemented by the subclass. Let's look at the implementation of a subclass (stream's default listener).

```cpp

     class EmitToJSStreamListener : public ReportWritesToJSStreamListener {
      public:
       uv_buf_t OnStreamAlloc(size_t suggested_size) override;
       void OnStreamRead(ssize_t nread, const uv_buf_t&amp; buf) override;
     };

```

```cpp

= static*cast (stream*);
Environment\* env = stream-&gt;stream*env();
HandleScope handle_scope(env-&gt;isolate());
Context::Scope context_scope(env-&gt;context());
AllocatedBuffer buf(env, buf*);
stream-&gt;CallJSOnreadMethod(nread, buf.ToArrayBuffer());
}

```

Continue to call back CallJSOnreadMethod

```cpp

    MaybeLocal StreamBase::CallJSOnreadMethod(ssize_t nread,
                                                     Local ab,
                                                     size_t offset,
                                                     StreamBaseJSChecks checks) {
      Environment* env = env_;
      // ...
      AsyncWrap* wrap = GetAsyncWrap();
      CHECK_NOT_NULL(wrap);
      Local onread = wrap-&gt;object()-&gt;GetInternalField(kOnReadFunctionField);
      CHECK(onread-&gt;IsFunction());
      return wrap-&gt;MakeCallback(onread.As (), arraysize(argv), argv);
    }

```

CallJSOnreadMethod will call back the onread callback function of the JS layer. onread will push the data to the stream, and then trigger the data event.
