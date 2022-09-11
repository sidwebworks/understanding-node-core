**Foreword: Although Async hooks is still an experimental API, it does solve some problems in the application, such as logging and call stack traces. This article introduces the Async hooks of Node.js from the application and principle. **

#1 AsyncHooks in env
There is an AsyncHooks object in the env object of Node.js, which is responsible for the management of async_hooks in the Node.js process. Let's look at the definition.

## 1.1 Class definition ```cpp

class AsyncHooks : public MemoryRetainer {
public:

enum Fields {
// Five kinds of hooks kInit,
kBefore,
kAfter,
kDestroy,
kPromiseResolve,
// total number of hooks kTotals,
// The number of async_hooks opened kCheck,
// Record the top pointer kStackLength of the stack,
// array size kFieldsCount,
};

enum UidFields {
kExecutionAsyncId,
kTriggerAsyncId,
// The value of the current async id kAsyncIdCounter,
kDefaultTriggerAsyncId,
kUidFieldsCount,
};

private:
inline AsyncHooks();
// type std::array of asynchronous resources , AsyncWrap::PROVIDERS*LENGTH&gt; providers*;
// stack AliasedFloat64Array async*ids_stack*;
// Integer array, the meaning of each element value and Fields correspond to AliasedUint32Array fields*;
// Integer array, the meaning of each element value and UidFields correspond to AliasedFloat64Array async_id_fields*;
};

`````
The structure diagram is as follows![](https://img-blog.csdnimg.cn/e1a0a333c0224c51867bffd4cf7236f3.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly,9ibG9nLmNzZG4ubmV0L170RIRUFOQVJLSA==,size_FFFFF_QVJLSA==
Next, let's take a look at the APIs provided by the AsyncHooks object of env, which are the basis of the upper layer.
## 1.2 Read API
Let's take a look at the API for getting the fields corresponding to the AsyncHooks object in the env object.
````cpp
// Get the corresponding field inline AliasedUint32Array&amp; AsyncHooks::fields() {
  return fields_;
}

inline AliasedFloat64Array&amp; AsyncHooks::async_id_fields() {
  return async_id_fields_;
}

inline AliasedFloat64Array&amp; AsyncHooks::async_ids_stack() {
  return async_ids_stack_;
}

// Get resource type inline v8::Local AsyncHooks::provider_string(int idx) {
  return providers_[idx].Get(env()-&gt;isolate());
}

// When creating a new resource, get a new async id
inline double Environment::new_async_id() {
  async_hooks()-&gt;async_id_fields()[AsyncHooks::kAsyncIdCounter] += 1;
  return async_hooks()-&gt;async_id_fields()[AsyncHooks::kAsyncIdCounter];
}

// Get the current async id
inline double Environment::execution_async_id() {
  return async_hooks()-&gt;async_id_fields()[AsyncHooks::kExecutionAsyncId];
}

// Get the current trigger async id
inline double Environment::trigger_async_id() {
  return async_hooks()-&gt;async_id_fields()[AsyncHooks::kTriggerAsyncId];
}

// Get the default trigger async id, if not set, get the current async id
inline double Environment::get_default_trigger_async_id() {
  double default_trigger_async_id = async_hooks()-&gt;async_id_fields()[AsyncHooks::kDefaultTriggerAsyncId];
  // If defaultTriggerAsyncId isn't set, use the executionAsyncId
  if (default_trigger_async_id &lt; 0)
    default_trigger_async_id = execution_async_id();
  return default_trigger_async_id;
}
`````

## 1.3 Write API

```cpp
inline void AsyncHooks::push_async_ids(double async_id,
                                       double trigger_async_id) {
  // Get the current stack top pointer uint32_t offset = fields_[kStackLength];
  // If not enough, expand if (offset * 2 &gt;= async_ids_stack_.Length())
    grow_async_ids_stack();
  // push the old context onto the stack async_ids_stack_[2 * offset] = async_id_fields_[kExecutionAsyncId];
  async_ids_stack_[2 * offset + 1] = async_id_fields_[kTriggerAsyncId];
  // stack pointer plus one fields_[kStackLength] += 1;
  // record the current context async_id_fields_[kExecutionAsyncId] = async_id;
  async_id_fields_[kTriggerAsyncId] = trigger_async_id;
}
// Contrary to the logic above inline bool AsyncHooks::pop_async_id(double async_id) {

  if (fields_[kStackLength] == 0) return false;
  uint32_t offset = fields_[kStackLength] - 1;
  async_id_fields_[kExecutionAsyncId] = async_ids_stack_[2 * offset];
  async_id_fields_[kTriggerAsyncId] = async_ids_stack_[2 * offset + 1];
  fields_[kStackLength] = offset;

  return fields_[kStackLength] &gt; 0;
}
```

# 2 The underlying resource encapsulation class - AsyncWrap

Next, take a look at AsyncWrap, the base class for asynchronous resources. All resources (such as TCP, UDP) that depend on the implementation of the C and C++ layers will inherit AsyncWrap. Take a look at the class definition.

```cpp
class AsyncWrap : public BaseObject {
 private:
  ProviderType provider_type_ = PROVIDER_NONE;
  double async_id_ = kInvalidAsyncId;
  double trigger_async_id_;
};
```

We see that each AsyncWrap object has async*id*, trigger*async_id* and provider*type* properties, which is the data obtained in the init callback. Let's look at the constructor of AsyncWrap. Next, let's take a look at the logic when creating a new resource (AsyncWrap).

## 2.1 Resource initialization ```cpp

AsyncWrap::AsyncWrap(Environment\* env,
Local object,
ProviderType provider,
double execution*async_id,
bool silent)
: AsyncWrap(env, object) {
// resource type provider_type* = provider;
AsyncReset(execution_async_id, silent);
}

void AsyncWrap::AsyncReset(Local resource, double execution*async_id,
bool silent) {
// Get a new async id, execution_async_id defaults to kInvalidAsyncId
async_id* = execution*async_id == kInvalidAsyncId ? env()-&gt;new_async_id()
: execution_async_id;
// Get trigger async id  
 trigger_async_id* = env()-&gt;get*default_trigger_async_id();
// Execute the init hook EmitAsyncInit(env(), resource,
env()-&gt;async_hooks()-&gt;provider_string(provider_type()),
async_id*, trigger*async_id*);
}

`````
Then look at EmitAsyncInit
````cpp
void AsyncWrap::EmitAsyncInit(Environment* env,
                              Local object,
                              Local type,
                              double async_id,
                              double trigger_async_id) {
  AsyncHooks* async_hooks = env-&gt;async_hooks();
  HandleScope scope(env-&gt;isolate());
  Local init_fn = env-&gt;async_hooks_init_function();

  Local argv[] = {
    Number::New(env-&gt;isolate(), async_id),
    type,
    Number::New(env-&gt;isolate(), trigger_async_id),
    object,
  };

  TryCatchScope try_catch(env, TryCatchScope::CatchMode::kFatal);
  // Execute init callback USE(init_fn-&gt;Call(env-&gt;context(), object, arraysize(argv), argv));
}
`````

So what is the value of env-&gt;async_hooks_init_function()? This is set when Node.js is initialized.

```js
const { nativeHooks } = require("internal/async_hooks");
internalBinding("async_wrap").setupHooks(nativeHooks);
```

The implementation of SetupHooks is as follows ```cpp
static void SetupHooks(const FunctionCallbackInfo &amp; args) {
Environment\* env = Environment::GetCurrent(args);
Local fn_obj = args[0].As ();

#define SET*HOOK_FN(name) \
do { \
Local v = \
fn_obj-&gt;Get(env-&gt;context(), \
FIXED_ONE_BYTE_STRING(env-&gt;isolate(), #name)) \
.ToLocalChecked(); \
CHECK(v-&gt;IsFunction()); \
env-&gt;set_async_hooks*##name##\_function(v.As ()); \
} while (0)
// Save to env SET_HOOK_FN(init);
SET_HOOK_FN(before);
SET_HOOK_FN(after);
SET_HOOK_FN(destroy);
SET_HOOK_FN(promise_resolve);
#undef SET_HOOK_FN
}

````
The implementation of nativeHooks is as follows ```js
nativeHooks: {
  init: emitInitNative,
  before: emitBeforeNative,
  after: emitAfterNative,
  destroy: emitDestroyNative,
  promise_resolve: emitPromiseResolveNative
}
````

These Hooks will execute corresponding callbacks, such as emitInitNative

```js
function emitInitNative(asyncId, type, triggerAsyncId, resource) {
  for (var i = 0; i &lt; active_hooks.array.length; i++) {
	   if (typeof active_hooks.array[i][init_symbol] === 'function') {
	     active_hooks.array[i][init_symbol](
	       asyncId, type, triggerAsyncId,
	       resource
	    Refed) {
  initAsyncResource(this, 'Timeout');
}

function initAsyncResource(resource, type) {
  // get the new async id
  const asyncId = resource[async_id_symbol] = newAsyncId();
  const triggerAsyncId = resource[trigger_async_id_symbol] = getDefaultTriggerAsyncId();
  // Whether the init hook is set, if yes, trigger the callback if (initHooksExist())
    emitInit(asyncId, type, triggerAsyncId, resource);
}
```

When executing setTimeout, Node.js will create a Timeout object, set the context related to async_hooks and record it in the Timeout object. Then trigger the init hook.

```js
function emitInitScript(asyncId, type, triggerAsyncId, resource) {
  emitInitNative(asyncId, type, triggerAsyncId, resource);
}
```

The above code will execute the init callback of each async_hooks object (usually we only have one async_hooks object).

## 3.1 Execute callback When the timer expires, the callback will be executed, let's take a look at the related logic.

```js
// Trigger the before hook emitBefore(asyncId, timer[trigger_async_id_symbol]);
// Execute the callback timer._onTimeout();
// Trigger the after callback emitAfter(asyncId);
```

We see that the corresponding hooks are triggered before and after the timeout callback is executed.

```js
function emitBeforeScript(asyncId, triggerAsyncId) {
  // The same logic as the underlying push_async_ids pushAsyncIds(asyncId, triggerAsyncId);
  // If there is a callback, execute if (async_hook_fields[kBefore] &gt; 0)
    emitBeforeNative(asyncId);
}

function emitAfterScript(asyncId) {
  // If after callback is set, emit
  if (async_hook_fields[kAfter] &gt; 0)
    emitAfterNative(asyncId);
  // Same as underlying pop_async_ids logic popAsyncIds(asyncId);
}
```

The implementation of the JS layer is consistent with the bottom layer. If we create a new resource in the setTimeout callback, such as executing setTimeout again, the trigger async id is the async id corresponding to the first setTimeout, so it is connected. We will see specific examples later.

# 4 DefaultTriggerAsyncIdScope

Node.js designed DefaultTriggerAsyncIdScope in order to avoid too many passing async id by parameter passing. The role of DefaultTriggerAsyncIdScope is similar to maintaining a variable outside multiple functions. Multiple functions can obtain trigger async id through DefaultTriggerAsyncIdScope without passing it layer by layer. Its implementation is very simple.

```cpp
class DefaultTriggerAsyncIdScope {
   private:
    AsyncHooks* async_hooks_;
    double old_default_trigger_async_id_;
};

inline AsyncHooks::DefaultTriggerAsyncIdScope ::DefaultTriggerAsyncIdScope(
    Environment* env, double default_trigger_async_id)
    : async_hooks_(env-&gt;async_hooks()) {
  // record the old id and set the new id
  old_default_trigger_async_id_=
    async_hooks_-&gt;async_id_fields()[AsyncHooks::kDefaultTriggerAsyncId];
  async_hooks_-&gt;async_id_fields()[AsyncHooks::kDefaultTriggerAsyncId] =
    default_trigger_async_id;
}
// restore inline AsyncHooks::DefaultTriggerAsyncIdScope ::~DefaultTriggerAsyncIdScope() {
  async_hooks_-&gt;async_id_fields()[AsyncHooks::kDefaultTriggerAsyncId] =
    old_default_trigger_async_id_;
}
```

DefaultTriggerAsyncIdScope mainly records the old id, and then sets the new id to env. When other functions call get_default_trigger_async_id, the set async id can be obtained. The same JS layer also implements a similar API.

```js
function defaultTriggerAsyncIdScope(triggerAsyncId, block, ...args) {
  const oldDefaultTriggerAsyncId = async_id_fields[kDefaultTriggerAsyncId];
  async_id_fields[kDefaultTriggerAsyncId] = triggerAsyncId;

  try {
    return block(...args);
  } finally {
    async_id_fields[kDefaultTriggerAsyncId] = oldDefaultTriggerAsyncId;
  }
}
```

When executing the block function, you can get the set value without passing it, and restore it after executing the block. Let's see how to use it. The code below is taken from the net module.

```js
// Get the async id in the handle
this[async_id_symbol] = getNewAsyncId(this._handle);
defaultTriggerAsyncIdScope(
  this[async_id_symbol],
  process.nextTick,
  emitListeningNT,
  this
);
```

Let's take a look at the specifics here. In defaultTriggerAsyncIdScope, process.nextTick will be executed with emitListeningNT as input parameter. Let's look at the implementation of nextTick.

```js
function nextTick(callback) {
  // get the new async id
  const asyncId = newAsyncId();
  // Get the default trigger async id, which is the const triggerAsyncId set just now = getDefaultTriggerAsyncId();
  const tickObject = {
    [async_id_symbol]: asyncId,
    [trigger_async_id_symbol]: triggerAsyncId,
    callback,
    args,
  };
  if (initHooksExist())
    // Create a new resource, trigger the init hook emitInit(asyncId, 'TickObject', triggerAsyncId, tickObject);
    queue.push(tickObject);
}
```

We see that the trigger async id is obtained through getDefaultTriggerAsyncId in nextTick.

```js
function getDefaultTriggerAsyncId() {
  const defaultTriggerAsyncId = async_id_fields[kDefaultTriggerAsyncId];
  if (defaultTriggerAsyncId &lt; 0)
    return async_id_fields[kExecutionAsyncId];
  return defaultTriggerAsyncId;
}
```

Next createHook.

```js
function createHook(fns) {
  return new AsyncHook(fns);
}
```

createHook is an encapsulation of AsyncHook ```js
class AsyncHook {
constructor({ init, before, after, destroy, promiseResolve }) {
// record callback this[init_symbol] = init;
this[before_symbol] = before;
this[after_symbol] = after;
this[destroy_symbol] = destroy;
this[promise_resolve_symbol] = promiseResolve;
}
}

`````
The initialization of AsyncHook is very simple, create an AsyncHook object to record the callback function. After creating AsyncHook, we need to call the enable function of AsyncHook to manually open it.
````js
class AsyncHook {
  enable() {
    // Get an array of AsyncHook objects and an array of integers const [hooks_array, hook_fields] = getHookArrays();
	 // After executing enable, you don't need to execute if (hooks_array.includes(this))
      return this;
	 // do some statistics const prev_kTotals = hook_fields[kTotals];
    hook_fields[kTotals] = hook_fields[kInit] += +!!this[init_symbol];
    hook_fields[kTotals] += hook_fields[kBefore] += +!!this[before_symbol];
    hook_fields[kTotals] += hook_fields[kAfter] += +!!this[after_symbol];
    hook_fields[kTotals] += hook_fields[kDestroy] += +!!this[destroy_symbol];
    hook_fields[kTotals] +=
        hook_fields[kPromiseResolve] += +!!this[promise_resolve_symbol];
    // Insert the current object into the array hooks_array.push(this);
	 // If the previous number is 0, the underlying logic is turned on after this operation if (prev_kTotals === 0 &amp;&amp; hook_fields[kTotals] &gt; 0) {
      enableHooks();
    }

    return this;
  }
}
`````

1 hooks_array: It is an array of AsyncHook objects, which is mainly used to record which AsyncHook objects are created by the user, and which hooks are set in which AsyncHook objects. When callback, it will traverse this object array and execute the callback inside.
2 hook_fields: corresponds to the underlying async_hook_fields.
3 enableHooks:

```js
function enableHooks() {
  // Record the number of open async_hooks async_hook_fields[kCheck] += 1;
}
```

At this point, the initialization of async_hooks is complete, and we find that the logic is very simple. Let's take a look at how he string together. Below we take the TCP module as an example.

```js
const { createHook, executionAsyncId } = require('async_hooks');
const fs = require('fs');
const net = require('net');

createHook({
  init(asyncId, type, triggerAsyncId) {
    fs.writeSync(
      1,
      `${type}(${asyncId}): trigger: ${triggerAsyncId} execution: ${executionAsyncId()}\n`);
  }
}).enable();
net.createServer((conn) =&gt; {}).listen(8080);
```

The above code outputs ```text
init: type: TCPSERVERWRAP asyncId: 2 trigger id: 1 executionAsyncId(): 1 triggerAsyncId(): 0
init: type: TickObject asyncId: 3 trigger id: 2 executionAsyncId(): 1 triggerAsyncId(): 0
before: asyncId: 3 executionAsyncId(): 3 triggerAsyncId(): 2
after: asyncId: 3 executionAsyncId(): 3 triggerAsyncId(): 2

`````
Let us analyze the specific process below. We know that the init callback will be executed when the resource is created. The specific logic is in the listen function. In the listen function, new TCP will be executed through layer-by-layer calls to create a new object representing the server. TCP is a class exported by the C++ layer. As we said just now, TCP will inherit AsyncWrap. When creating a new AsyncWrap object, the init hook will be triggered. The structure diagram is as follows.
![](https://img-blog.csdnimg.cn/9278bab03a714155b75a50341cad2b9c.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6FFLy9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size)
Corresponding output ````text
init: type: TCPSERVERWRAP asyncId: 2 trigger id: 1 executionAsyncId(): 1 triggerAsyncId(): 0
`````

How did TickObject come about? Let's look at another piece of logic in listen.

```js
this[async_id_symbol] = getNewAsyncId(this._handle);
defaultTriggerAsyncIdScope(
  this[async_id_symbol],
  process.nextTick,
  emitListeningNT,
  this
);
```

We have analyzed the above code just now. When process.nextTick is executed, a TickObject object will be created to encapsulate the execution context and callback.

```js
const asyncId = newAsyncId();
const triggerAsyncId = getDefaultTriggerAsyncId();
const tickObject = {
  [async_id_symbol]: asyncId,
  [trigger_async_id_symbol]: triggerAsyncId,
  callback,
  args,
};
emitInit(asyncId, "TickObject", triggerAsyncId, tickObject);
```

This time, the init hook is triggered again, and the structure is as follows (the id obtained by nextTick through getDefaultTriggerAsyncId is the id set by defaultTriggerAsyncIdScope).
![](https://img-blog.csdnimg.cn/cfbb1aa23e0f4f1f9c482e220234da29.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6y9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size)
Corresponding output ````text
init: type: TickObject asyncId: 3 trigger id: 2 executionAsyncId(): 1 triggerAsyncId(): 0

`````
Then execute the tick task.

````js
const asyncId = tock[async_id_symbol];
emitBefore(asyncId, tock[trigger_async_id_symbol]);
try {
  tock.callback();
} finally {
  ifrequireManualDestroy = false;
    if (typeof opts !== 'number') {
      triggerAsyncId = opts.triggerAsyncId === undefined ?
        getDefaultTriggerAsyncId() : opts.triggerAsyncId;
      requireManualDestroy = !!opts.requireManualDestroy;
    }
    const asyncId = newAsyncId();
    this[async_id_symbol] = asyncId;
    this[trigger_async_id_symbol] = triggerAsyncId;

    if (initHooksExist()) {
      emitInit(asyncId, type, triggerAsyncId, this);
    }
  }

  runInAsyncScope(fn, thisArg, ...args) {
    const asyncId = this[async_id_symbol];
    emitBefore(asyncId, this[trigger_async_id_symbol]);

    const ret = thisArg === undefined ?
      fn(...args) :
      ReflectApply(fn, thisArg, args);

    emitAfter(asyncId);
    return ret;
  }

  emitDestroy() {
    if (this[destroyedSymbol] !== undefined) {
      this[destroyedSymbol].destroyed = true;
    }
    emitDestroy(this[async_id_symbol]);
    return this;
  }

  asyncId() {
    return this[async_id_symbol];
  }

  triggerAsyncId() {
    return this[trigger_async_id_symbol];
  }
}
`````

The usage is as follows.

```js
const { AsyncResource, executionAsyncId, triggerAsyncId } = require('async_hooks');
const asyncResource = new AsyncResource('Demo');
asyncResource.runInAsyncScope(() =&gt; {
  console.log(executionAsyncId(), triggerAsyncId())
});
```

In runInAsyncScope, the execution context of the asyncResource will be set as the current execution context, the async id is 2, and the trigger async id is 1, so the output of executionAsyncId in the callback is 2, and the output of triggerAsyncId is 1.
#8 AsyncLocalStorage
AsyncLocalStorage is a class based on AsyncResource that maintains the common context in asynchronous logic. We can understand him as Redis. Let's see how to use it.

## 8.1 Using ```js

const { AsyncLocalStorage } = require('async_hooks');

const asyncLocalStorage = new AsyncLocalStorage();
function logWithId(msg) {
const id = asyncLocalStorage.getStore();
console.log(`${id !== undefined ? id : '-'}:`, msg);
}

asyncLocalStorage.run(1, () =&gt; {
logWithId('start');
setImmediate(() =&gt; {
logWithId('finish');
});
});

````
Executing the above code will output ```text
1: start
1: finish
````

The public context is initialized when running, and the asynchronous code executed in the run can also get the public context, which is very useful when recording the log traceId, otherwise we need to pass the traceId everywhere in the code. Let's look at the implementation below.

## 8.2 Implementation Let's take a look at the logic of creating AsyncLocalStorage ```js

class AsyncLocalStorage {
constructor() {
this.kResourceStore = Symbol('kResourceStore');
this.enabled = false;
}
}

`````
It is very simple to create AsyncLocalStorage, mainly set the state to false, and set the value of kResourceStore to Symbol('kResourceStore'). It's important to set it to Symbol('kResourceStore') instead of 'kResourceStore', as we'll see later. Continue to look at the logic of executing AsyncLocalStorage.run.
````js
 run(store, callback, ...args) {
	 // Create a new AsyncResource
    const resource = new AsyncResource('AsyncLocalStorage', defaultAlsResourceOpts);
	 // Set the execution context of the resource to the current execution context through runInAsyncScope return resource.emitDestroy().runInAsyncScope(() =&gt; {
      this.enterWith(store);
      return ReflectApply(callback, null, args);
    });
  }
`````

After the context is set, the callback of runInAsyncScope is executed, and enterWith is executed first in the callback.

```js
enterWith(store) {
	 // Modify the state of AsyncLocalStorage this._enable();
   // Get the current execution context for multiple resources, that is, the resources created in run
   const resource = executionAsyncResource();
   // Mount the public context to the object resource[this.kResourceStore] = store;
}

_enable() {
   if (!this.enabled) {
     this.enabled = true;
     ArrayPrototypePush(storageList, this);
     storageHook.enable();
   }
}
```

After the public context is mounted, the business callback is executed. In the callback, the set public context can be obtained through asyncLocalStorage.getStore().

```js
getStore() {
  if(this.enabled) {
    const resource = executionAsyncResource();
    return resource[this.kResourceStore];
  }
}
```

The principle of getStore is very simple, that is, first get the resource corresponding to the current execution context, and then get the public context from the resource according to the value of kResourceStore of AsyncLocalStorage. If getStore is executed synchronously, then executionAsyncResource returns the AsyncResource we created during run, but what if it is asynchronous getStore? Because at this time, the executionAsyncResource returns the AsyncResource we created is no longer, so we can't get the public context it mounts. To solve this problem, Node.js passes the common context.

```js
const storageList = []; // AsyncLocalStorage object array const storageHook = createHook({
  init(asyncId, type, triggerAsyncId, resource) {
    const currentResource = executionAsyncResource();
    for (let i = 0; i &lt; storageList.length; ++i) {
      storageList[i]._propagate(resource, currentResource);
    }
  }
});

 _propagate(resource, triggerResource) {
    const) {

    const v8::HandleScope handle_scope(isolate_);
    const size_t size_in_bytes = MultiplyWithOverflowCheck(sizeof(NativeT), count);
    v8::Local ab = v8::ArrayBuffer::New(isolate_, size_in_bytes);
    // ...
  }
```

The bottom layer is an ArrayBuffer.

```cpp
Local v8::ArrayBuffer::New(Isolate* isolate, size_t byte_length) {
  i::Isolate* i_isolate = reinterpret_cast (isolate);
  LOG_API(i_isolate, ArrayBuffer, New);
  ENTER_V8_NO_SCRIPT_NO_EXCEPTION(i_isolate);
  i::MaybeHandle result =
      i_isolate-&gt;factory()-&gt;NewJSArrayBufferAndBackingStore(
          byte_length, i::InitializedFlag::kZeroInitialized);
  // ...
}
```

ArrayBuffer::New passed in i::InitializedFlag::kZeroInitialized when allocating memory. As can be seen from the V8 definition, the content of the initialized memory is 0.

```c
// Whether the backing store memory is initialied to zero or not.
enum class InitializedFlag : uint8_t { kUninitialized, kZeroInitialized };
```

Going back to the example, why would the output be 1 and 0 instead of 0 and 0? The answer is this code at Node.js startup.

```cpp
{
      InternalCallbackScope callback_scope(
          env.get(),
          Local (),
          // async id and trigger async id
          { 1, 0 },
          InternalCallbackScope::kAllowEmptyResource |
              InternalCallbackScope::kSkipAsyncHooks);
      // execute our js
      LoadEnvironment(env.get());
}
```

InternalCallbackScope has just been analyzed, it will set 1 and 0 to the current execution context. Then the values ​​obtained when executing my JS code in LoadEnvironment are 1 and 0. So what would be the output if we changed it to the following code?

```js
const async_hooks = require('async_hooks');
Promise.resolve().then(() =&gt; {
  const eid = async_hooks.executionAsyncId();
  const tid = async_hooks.triggerAsyncId();
  console.log(eid, tid);
})
```

The above code will output 0 and . Because after executing our JS code, the InternalCallbackScope is destructed and restored to 0 and 0.
