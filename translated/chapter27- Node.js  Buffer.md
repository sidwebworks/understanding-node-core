Foreword: The Buffer module is a very important module in Node.js, and many modules rely on it. This article introduces the underlying principles of the Buffer module, including the core implementation of Buffer and V8 off-heap memory.

# 1 Buffer implementation## 1.1 Buffer's JS layer implementation Although the implementation of the Buffer module is very complex and has a lot of code, many of them are the logic of encoding, decoding and memory allocation management. Let's look at the commonly used way of using Buffer.from See the core implementation of Buffer.

```c
Buffer.from = function from(value, encodingOrOffset, length) {
  return fromString(value, encodingOrOffset);
};

function fromString(string, encoding) {
  return fromStringFast(string, ops);
}

function fromStringFast(string, ops) {
  const length = ops.byteLength(string);
  // Length is too long, allocate from C++ layer if (length &gt;= (Buffer.poolSize &gt;&gt;&gt; 1))
    return createFromString(string, ops.encodingVal);
  // not enough left, expand if (length &gt; (poolSize - poolOffset))
    createPool();
  // allocate memory from allocPool (ArrayBuffer) let b = new FastBuffer(allocPool, poolOffset, length);
  const actual = ops.write(b, string, 0, length);
  poolOffset += actual;
  alignPool();
  return b;
}
```

The logic of from is as follows:

1.  If the length is greater than the threshold set by Node.js, call createFromString to allocate memory directly through the C++ layer.
2.  Otherwise, judge whether the memory left before is enough, and if it is enough, allocate it directly. When Node.js is initialized, it will first allocate a large piece of memory to be managed by JS, and each time a part of this memory is divided to the user, and if it is not enough, it will be expanded.
    Let's look at createPool.

```c
// Allocate a memory pool function createPool() {
  poolSize = Buffer.poolSize;
  // Get the underlying ArrayBuffer
  allocPool = createUnsafeBuffer(poolSize).buffer;
  poolOffset = 0;
}

function createUnsafeBuffer(size) {
  zeroFill[0] = 0;
  try {
    return new FastBuffer(size);
  } finally {
    zeroFill[0] = 1;
  }
}

class FastBuffer extends Uint8Array {}
```

We see that the final call to Uint8Array implements the memory allocation. 3. Allocate a block of memory from the memory pool through new FastBuffer(allocPool, poolOffset, length). As shown below.
![](https://img-blog.csdnimg.cn/926ba056c76f417d8a515dfbbe4bfe36.png)

## 1.2 Buffer's C++ layer implementation Before analyzing the C++ layer, let's take a look at the relationship diagram of the following objects in V8.

![Insert picture description here](https://img-blog.csdnimg.cn/a50fdf50695b453e94fbba2a86802cd7.png) Next, let's take a look at the implementation of requesting memory directly from C++ through createFromString.

```c
void CreateFromString(const FunctionCallbackInfo &amp; args) {
  enum encoding enc = static_cast (args[1].As ()-&gt;Value());
  Local buf;
  if (New(args.GetIsolate(), args[0].As (), enc).ToLocal(&amp;buf))
    args.GetReturnValue().Set(buf);
}

MaybeLocal New(Isolate* isolate,
                       Local string,
                       enum encoding enc) {
  EscapableHandleScope scope(isolate);

  size_t length;
  // Calculate length if (!StringBytes::Size(isolate, string, enc).To(&amp;length))
    return Local ();
  size_t actual = 0;
  char* data = nullptr;
  // Apply for a piece of memory on the process heap directly through realloc data = UncheckedMalloc(length);
  // Convert data according to encoding actual = StringBytes::Write(isolate, data, length, string, enc);
  return scope.EscapeMaybe(New(isolate, data, actual));
}

MaybeLocal New(Isolate* isolate, char* data, size_t length) {
  EscapableHandleScope handle_scope(isolate);
  Environment* env = Environment::GetCurrent(isolate);
  Local obj;
  if (Buffer::New(env, data, length).ToLocal(&amp;obj))
    return handle_scope.Escape(obj);
  return Local ();
}

MaybeLocal New(Environment* env,
                       char* data,
                       size_t length) {
  // After the JS layer variable is released, this memory is no longer used, and the memory is released in the callback during GC auto free_callback = [](char* data, void* hint) { free(data); };
  return New(env, data, length, free_callback, nullptr);
}
MaybeLocal New(Environment* env,
                       char* data,
                       size_t length,
                       FreeCallback callback,
                       void* hint) {
  EscapableHandleScope scope(env-&gt;isolate());
  // create an ArrayBuffer
  Local ab =
      CallbackInfo::CreateTrackedArrayBuffer(env, data, length, callback, hint);
  /*
 	 Create a Uint8Array
 	 Buffer::New =&gt; Local ui = Uint8Array::New(ab, byte_offset, length)
  */
  MaybeLocal maybe_ui = Buffer::New(env, ab, 0, length);

  Local ui;
  if (!maybe_ui.ToLocal(&amp;ui))
    return MaybeLocal ();

  return scope.Escape(ui);
}
```

Through a series of calls, an ArrayBuffer is finally created through CreateTrackedArrayBuffer, and a Uint8Array is created through ArrayBuffer. Then look at the implementation of CreateTrackedArrayBuffer.

```c
Local CallbackInfo::CreateTrackedArrayBuffer(
    Environment* env,
    char* data,
    size_t length,
    FreeCallback callback,
    void* hint) {
  // management callback CallbackInfo* self = new CallbackInfo(env, callback, data, hint);
  // Create a BackingStore with the memory you applied for, and set the GC callback std::unique_ptr bs =
      ArrayBuffer::NewBackingStore(data, length, [](void*, size_t, void* arg) {
        static_cast (arg)-&gt;OnBackingStoreFree();
      }, self);
  // Create ArrayBuffer via BackingStore
  Local ab = ArrayBuffer::New(env-&gt;isolate(), std::move(bs));
  return ab;
}
```

Take a look at the implementation of NewBackingStore.

```c
std::unique_ptr v8::ArrayBuffer::NewBackingStore(
    void* data, size_t byte_length, v8::BackingStore::DeleterCallback deleter,
    void* deleter_data) {
  std::unique_ptr backing_store = i::BackingStore::WrapAllocation(data, byte_length, deleter, deleter_data,
                                      i::SharedFlag::kNotShared);
  return std::unique_ptr (
      static_cast (backing_store.release()));
}

std::unique_ptr BackingStore::WrapAllocation(
    void* allocation_base, size_t allocation_length,
    v8::BackingStore::DeleterCallback deleter, void* deleter_data,
    SharedFlag shared) {
  bool is_empty_deleter = (deleter == v8::BackingStore::EmptyDeleter);
  // Create a new BackingStore
  auto result = new BackingStore(allocation_base, // start
                                 allocation_length, // length
                                 allocation_length, // capacity
                                 shared, // shared
                                 false, // is_wasm_memory
                                 true, // free_on_destruct
                                 false, // has_guard_regions
                                 // Indicates that releasing memory is performed by the caller true, // custom_deleter
                                 is_empty_deleter); // empty_deleter
  // Save the information required by the callback result-&gt;type_specific_data_.deleter = {deleter, deleter_data};
  return std::unique_ptr (result);
}
```

NewBackingStore finally creates a BackingStore object. Let's take a look at what's done in the BackingStore's destructor during GC.

```c
BackingStore::~BackingStore() {
  if (custom_deleter_) {
    type_specific_data_.deleter.callback(buffer_start_, byte_length_,
                                         type_specific_data_.deleter.data);
    Clear();
    return;
  }
}
```

When destructing, the callback saved when the BackingStore was created will be executed. Let's look at the implementation of CallbackInfo that manages callbacks.

```c
CallbackInfo::CallbackInfo(Environment* env,
                           FreeCallback callback,
                           char* data,
                           void* hint)
    : callback_(callback),
      data_(data),
      hint_(hint),
      env_(env) {
  env-&gt;AddCleanupHook(CleanupHook, this);
  env-&gt;isolate()-&gt;AdjustAmountOfExternalAllocatedMemory(sizeof(*this));
}
```

The implementation of CallbackInfo is very simple, the main place is AdjustAmountOfExternalAllocatedMemory. This function tells V8 how many bytes the off-heap memory has increased, and V8 will do appropriate GC based on the memory data. CallbackInfo mainly saves callbacks and memory addresses. Then the OnBackingStoreFree of CallbackInfo will be called back during GC.

```c
isolate-&gt;heap()-&gt;AllocateExternalBackingStore(allocate_buffer, byte_length);
  }
  // Create a new BackingStore to manage memory auto result = new BackingStore(buffer_start, // start
                                 byte_length, // length
                                 byte_length, // capacity
                                 shared, // shared
                                 false, // is_wasm_memory
                                 true, // free_on_destruct
                                 false, // has_guard_regions
                                 false, // custom_deleter
                                 false); // empty_deleter

  return std::unique_ptr (result);
}

```

BackingStore::Allocate allocates a piece of memory and creates a new BackingStore object to manage this memory. The memory allocator is set when V8 is initialized. Here we look again at the logic of the AllocateExternalBackingStore function.

```c
void* Heap::AllocateExternalBackingStore(
    const std::function &amp; allocate, size_t byte_length) {
   // may need to trigger GC
   if (!always_allocate()) {
    size_t new_space_backing_store_bytes =
        new_space()-&gt;ExternalBackingStoreBytes();
    if (new_space_backing_store_bytes &gt;= 2 * kMaxSemiSpaceSize &amp;&amp;
        new_space_backing_store_bytes &gt;= byte_length) {
      CollectGarbage(NEW_SPACE,
                     GarbageCollectionReason::kExternalMemoryPressure);
    }
  }
  // allocate memory void* result = allocate(byte_length);
  // If successful, return if (result) return result;
  // fail GC
  if (!always_allocate()) {
    for (int i = 0; i &lt; 2; i++) {
      CollectGarbage(OLD_SPACE,
                     GarbageCollectionReason::kExternalMemoryPressure);
      result = allocate(byte_length);
      if (result) return result;
    }
    isolate()-&gt;counters()-&gt;gc_last_resort_from_handles()-&gt;Increment();
    CollectAllAvailableGarbage(
        GarbageCollectionReason::kExternalMemoryPressure);
  }
  // Allocate again, fail if it fails return allocate(byte_length);
}
```

We see that when the memory request through the BackingStore fails, the GC is triggered to free up more available memory. After allocating the memory, finally return an AllocatedBuffer object with the BackingStore object as a parameter.

```c
AllocatedBuffer::AllocatedBuffer(
    Environment* env, std::unique_ptr bs)
    : env_(env), backing_store_(std::move(bs)) {}
```

Then convert the AllocatedBuffer object into an ArrayBuffer object.

```c
v8::Local AllocatedBuffer::ToArrayBuffer() {
  return v8::ArrayBuffer::New(env_-&gt;isolate(), std::move(backing_store_));
}
```

Finally, pass the ArrayBuffer object into Uint8Array and return a Uint8Array object to the caller.

# 2 Use and implementation of Uint8Array From the previous implementation, we can see that in the implementation of the C++ layer, the memory is allocated from the process heap, so is the memory applied by the JS layer through the Uint8Array also applied in the process heap? Let's take a look at the implementation of Uint8Array in V8. There are many ways to create Uint8Array, we only look at the implementation of new Uint8Array(length).

```c
transitioning macro ConstructByLength(implicit context: Context)(
    map: Map, lengthObj: JSAny,
    elementsInfo: typed_array::TypedArrayElementsInfo): JSTypedArray {
  try {
 	 // Requested memory size const length: uintptr = ToIndex(lengthObj);
    // Get the function that creates the ArrayBuffer const defaultConstructor: Constructor = GetArrayBufferFunction();
    const initialize: constexpr bool = true;
    return TypedArrayInitialize(
        initialize, map, length, elementsInfo, defaultConstructor)
        otherwise RangeError;
  }
}

transitioning macro TypedArrayInitialize(implicit context: Context)(
    initialize: constexpr bool, map: Map, length: uintptr,
    elementsInfo: typed_array::TypedArrayElementsInfo,
    bufferConstructor: JSReceiver): JSTypedArray labels IfRangeError {

  const byteLength = elementsInfo.CalculateByteLength(length);
  const byteLengthNum = Convert (byteLength);
  const defaultConstructor = GetArrayBufferFunction();
  const byteOffset: uintptr = 0;

  try {
    // create JSArrayBuffer
    const buffer = AllocateEmptyOnHeapBuffer(byteLength);
    const isOnHeap: constexpr bool = true;
    // Create TypedArray from buffer
    const typedArray = AllocateTypedArray(
        isOnHeap, map, buffer, byteOffset, byteLength, length);
	 // set 0 in memory
    if constexpr(initialize) {
      const backingStore = typedArray.data_ptr;
      typed_array::CallCMemset(backingStore, 0,etBuffer();
}
```

Then look at the implementation of GetBuffer.

```c
handle JSTypedArray::GetBuffer() {
  Isolate* isolate = GetIsolate();
  handle self(*this, isolate);
  // Get the Handle of the JSArrayBuffer object corresponding to TypeArray array_buffer(JSArrayBuffer::cast(self-&gt;buffer()), isolate);
  // Assigned and return directly if (!is_on_heap()) {
   return array_buffer;
  }
  size_t byte_length = self-&gt;byte_length();
  // Apply for byte_length bytes of memory to store data auto backing_store = BackingStore::Allocate(isolate, byte_length, SharedFlag::kNotShared, InitializedFlag::kUninitialized);
  // Associate backing_store to array_buffer
  array_buffer-&gt;Setup(SharedFlag::kNotShared, std::move(backing_store));
  return array_buffer;
}
```

We see that when using buffer, V8 will apply for memory outside the V8 heap to replace the memory allocated in the V8 heap when the Uint8Array is initialized, and copy the original data. Take a look at the example below.

```c
console.log(process.memoryUsage().arrayBuffers)
let a = new Uint8Array(10);
a[0] = 65;
console.log(process.memoryUsage().arrayBuffers)
```

We will find that the values ​​of arrayBuffers are the same, indicating that Uint8Array did not apply for off-heap memory through arrayBuffers during initialization. Then look at the next example.

```c
console.log(process.memoryUsage().arrayBuffers)
let a = new Uint8Array(1);
a[0] = 65;
a.buffer
console.log(process.memoryUsage().arrayBuffers)
console.log(new Uint8Array(a.buffer))
```

We see that the output memory has increased by one byte, and the output a.buffer is [ 65 ] (the requested memory larger than 64 bytes will be allocated in off-heap memory).

# 3 Management of off-heap memory From the previous analysis, we can see that Node.js Buffer is implemented based on off-heap memory (apply for process heap memory by yourself or use V8's default memory allocator), we know that the variables that are usually used V8 is responsible for managing memory, so how is the off-heap memory represented by Buffer managed? The memory release of Buffer is also tracked by V8, but the logic of release is not the same as in-heap memory. Let's analyze it with some examples.

```c
function forceGC() {
    new ArrayBuffer(1024 * 1024 * 1024);
}
setTimeout(() =&gt; {
	 /*
		 Call V8 object from C++ layer to create memory let a = process.binding('buffer').createFromString("Hello", 1);
	 */
	 /*
		 Use V8 built-in objects directly let a = new ArrayBuffer(10);
	 */
	 // Manage memory yourself from the C++ layer let a = process.binding('buffer').encodeUtf8String("Hello");
	 // empty and wait for GC
	 a = null;
	 // Allocate a large memory to trigger GC
	 process.nextTick(forceGC);
}, 1000);
const net = require('net');
net.createServer((socket) =&gt; {}).listen()
```

Break the code in V8, and then debug the above code.
![](https://img-blog.csdnimg.cn/325620e7d4764644a11fe23d514fecf3.png)
We see that in the timeout callback V8 allocates an ArrayBufferExtension object and logs it to the ArrayBufferSweeper. Then look at the logic when triggering GC.
![](https://img-blog.csdnimg.cn/0a66808e50c94fd9a322cc8b2597a780.png?x-oss-process=image/watermark,type_ZHJvaWRzYW5zZmFsbGJhY2s,shadow_50,text_1NETiBAdGhlYW5hcmto,size_20,color_FFFFg_t_70)
![](https://img-blog.csdnimg.cn/1e43fda36dc94892832758693bc761f4.png?x-oss-process=image/watermark,type_ZHJvaWRzYW5zZmFsbGJhY2s,shadow_50,text_Q1NETiBAdGhlYW5hcmto,size_20,color_FFFF16,t_70,g
V8 will call heap\_-&gt;array_buffer_sweeper()-&gt;RequestSweepYoung() in GC to reclaim off-heap memory, and Node.js itself seems to use threads to reclaim off-heap memory. Let's take a look at the triggering of the callback in the case of managing memory by ourselves.
![](https://img-blog.csdnimg.cn/f0e63e78f0fe4ec7abdb50bf32c60997.png)
If this is written, it will not trigger the execution of BackingStore::~BackingStore, once again verifying that BackingStore is not used when Uint8Array is initialized.

```c
setTimeout(() =&gt; {
   let a = new Uint8Array(1);
   // a.buffer;
   a = null;
   process.nextTick(forceGC);
});
```

But if you turn on comments you can.

# 4 Summary Buffer may be relatively simple to use at ordinary times, but if you study its implementation in depth, you will find that it involves not only a lot of content, but also complexity. The memory of Buffer is off-heap memory. If we find that the memory of the process keeps growing but the size of the V8 heap snapshot does not change much, it may be that the Buffer variable has not been released. Understanding the implementation can help us better think about and solve problems.
