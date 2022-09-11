Process is a very important concept in the operating system, and it is also a concept that is not easy to understand. However, a process that looks very complicated is actually only some data structures and algorithms in the code of the operating system. The algorithm is more complicated. In the operating system, a process is represented by a task_struct structure. Because the operating system is mostly implemented in C language, there is no concept of objects. If we use JS to understand, each process is an object, and each time a new process is created, a new object is created. The task_struct structure stores some information required by a process, including execution status, execution context, open files, root directories, working directories, received signals, signal processing functions, code segments, data segment information, and process id , execution time, exit code, etc. This chapter will introduce the principle and implementation of the Node.js process module.

## 13.1 Node.js main process When we execute node index.js, the operating system will create a Node.js process, and our code is executed in this Node.js process. From a code perspective, the way we perceive processes in Node.js is through the process object. In this section we analyze this object.

### 13.1.1 Creating a process object When Node.js starts, it will execute the following code to create a process object (env.cc).

```cpp
    Local process_object = node::CreateProcessObject(this).FromMaybe(Local ());
    set_process_object(process_object);
    // The process object is created by CreateProcessObject and then saved to the env object. Let's take a look at CreateProcessObject.
    MaybeLocal CreateProcessObject(Environment* env) {
      Isolate* isolate = env-&gt;isolate();
      EscapableHandleScope scope(isolate);
      Local context = env-&gt;context();

      Local process_template = FunctionTemplate::New(isolate);
      process_template-&gt;SetClassName(env-&gt;process_string());
      Local process_ctor;
      Local process;
        // New process object if (!process_template-&gt;GetFunction(context).ToLocal(&amp;process_ctor) || !process_ctor-&gt;NewInstance(context).ToLocal(&amp;process)) {
        return MaybeLocal ();
      }
        // Set a series of properties, which are the properties we usually access through the process object // Node.js version READONLY_PROPERTY(process,"version",
                          FIXED_ONE_BYTE_STRING(env-&gt;isolate(),
                          NODE_VERSION));
       // ignore other properties return scope.Escape(process);
    }
```

This is a typical example of creating an object with V8 and setting some properties. During the startup process of Node.js, attributes are attached to the process in many places. Let's see how our commonly used process.env is mounted.

### 13.1.2 Mount env properties ````cpp

     Local env_string = FIXED_ONE_BYTE_STRING(isolate_, "env");
     Local env_var_proxy;
     // Set the env property of the process if (!CreateEnvVarProxy(context(),
                             isolate_,
                             as_callback_data())
          .ToLocal(&amp;env_var_proxy) ||
       process_object()-&gt;Set(context(),
                               env_string,
                               env_var_proxy).IsNothing()) {
       return MaybeLocal ();
     }

`````

The above code creates an object through CreateEnvVarProxy, then saves it to env_var_proxy, and finally mounts the env attribute to the process. Its value is the object created by CreateEnvVarProxy.

````cpp
    MaybeLocal CreateEnvVarProxy(Local context,
                        Isolate* isolate,
                       Local data) {
      EscapableHandleScope scope(isolate);
      Local env_proxy_template = ObjectTemplate::New(isolate);
      env_proxy_template-&gt;SetHandler(NamedPropertyHandlerConfiguration(
          EnvGetter,
                EnvSetter,
                EnvQuery,
                EnvDeleter,
                EnvEnumerator,
                data,
         PropertyHandlerFlags::kHasNoSideEffect));
      return scope.EscapeMaybe(env_proxy_template-&gt;NewInstance(context));
    }
`````

CreateEnvVarProxy first applies for an object template, and then sets the access descriptor of the object created through the object template. Let's take a look at the implementation of the getter descriptor (EnvGetter), which is similar to the one we use in JS.

```cpp
    static void EnvGetter(Local property,
                const PropertyCallbackInfo &amp; info) {
      Environment* env = Environment::GetCurrent(info);
      MaybeLocal value_string = env-&gt;env_vars()-&gt;Get(env-&gt;isolate(), property.As ());
      if (!value_string.IsEmpty()) {
        info.GetReturnValue().Set(value_string.ToLocalChecked());
      }
    }
```

We see that the getter gets data from env-&gt;env_vars(), so what is env-&gt;env_vars()? env_vars is a kv storage system, which is actually a map. It is only set when Node.js is initialized (when the env object is created).

```cpp
set_env_vars(per_process::system_environment);
```

So what is per_process::system_environment? Let's continue reading,

```cpp
std::shared_ptr system_environment = std::make_shared ();
```

We see that system_environment is a RealEnvStore object. Let's look at the implementation of the RealEnvStore class.

```cpp
    class RealEnvStore final : public KVStore {
     public:
      MaybeLocal Get(Isolate* isolate, Local key) const override;
      void Set(Isolate* isolate, Local key, Local value) override;
      int32_t Query(Isolate* isolate, Local key) const override;
      void Delete(Isolate* isolate, Local key) override;
      Local Enumerate(Isolate* isolate) const override;
    };
```

It is relatively simple, that is, adding, deleting, modifying and querying. Let's take a look at the implementation of query Get.

```cpp
    MaybeLocal RealEnvStore::Get(Isolate* isolate,
                                         Local property) const {
      Mutex::ScopedLock lock(per_process::env_var_mutex);

      node::Utf8Value key(isolate, property);
      size_t init_sz = 256;
      MaybeStackBuffer val;
      int ret = uv_os_getenv(*key, *val, &amp;init_sz);
      if (ret &gt;= 0) { // Env key value fetch success.
        MaybeLocal value_string =
            String::NewFromUtf8(isolate,
                                        *val,
                                        NewStringType::kNormal,
                                        init_sz);
        return value_string;
      }

      return MaybeLocal ();
    }
```

We see the data obtained through uv_os_getenv. uv_os_getenv is the encapsulation of the getenv function. A part of the memory layout of the process is used to store environment variables, and getenv reads the data from that piece of memory. We can set environment variables when we execute execve. Specifically, we will see it in the subprocess chapter. So far, we know that the value corresponding to the env attribute of the process is the content of the process environment variable.

### 13.1.3 Mounting other properties During the startup process of Node.js, properties are continuously mounted to the process. Mainly in bootstrap/node.js. Do not list them one by one.

```js
const rawMethods = internalBinding("process_methods");
process.dlopen = rawMethods.dlopen;
process.uptime = rawMethods.uptime;
process.nextTick = nextTick;
```

The following are the attributes exported by the process_methods module, mainly listing the commonly used ones.

```cpp
    env-&gt;SetMethod(target, "memoryUsage", MemoryUsage);
    env-&gt;SetMethod(target, "cpuUsage", CPUUsage);
    env-&gt;SetMethod(target, "hrtime", Hrtime);
    env-&gt;SetMethod(target, "dlopen", binding::DLOpen);
    env-&gt;SetMethodNoSideEffect(target, "uptime", Uptime);
```

We see that when the JS layer accesses the process attribute, it accesses these methods of the corresponding C++ layer, most of which are just the encapsulation of Libuv. In addition, PatchProcessObject is executed during the initialization of Node.js. The PatchProcessObject function will attach some additional properties to the process.

```js
    // process.argv
    process-&gt;Set(context,
           FIXED_ONE_BYTE_STRING(isolate, "argv"),
           ToV8Value(context, env-&gt;argv()).ToLocalChecked()).Check();

    READONLY_PROPERTY(process,
                      "pid",
             Integer::New(isolate, uv_os_getpid()));

    CHECK(process-&gt;SetAccessor(context,
                  FIXED_ONE_BYTE_STRING(isolate, "ppid"),
                  GetParentProcessId).FromJust())
```

During the initialization of Node.js, attributes are mounted to the process object in many places. Only a part of them are listed here. Interested students can start from the code of bootstrap/node.js to see what attributes are mounted. Because Node.js supports multi-threading, there are some special handling for the case of threads.

`````js
    const perThreadSetup = require('internal/process/per_thread');
    // rawMethods comes from the attributes exported by the process_methods module const wrapped = perThreadSetup.wrapProcessMethods(rawMethods);
   Traverse this list, and then call the Exit function, which we have analyzed just now, which is to exit the Libuv event loop. The main thread then calls JoinThread. JoinThread is mainly to block and wait for the child thread to exit, because when the child thread exits, it may be suspended by the operating system (the execution time slice arrives). At this time, the main thread is scheduled for execution, but at this time the main thread The thread cannot exit yet, so join is used to block and wait for the child thread to exit. The JoinThread of Node.js is in addition to the encapsulation of the thread join function. Also does some extra things like triggering an exit event.
## 13.2 Create a subprocess Because Node.js is a single process, but there are many things that may not be suitable for processing in the main process, so Node.js provides a subprocess module, we can create subprocesses to do some additional tasks. , In addition, the advantage of the child process is that once the child process has a problem and hangs up, it will not affect the main process. Let's first look at how to create a process in C language.

````cpp
    #include
    #include

    int main(int argc,char *argv[]){
        pid_t pid = fork();
        if (pid &lt; 0) {
          // error } else if(pid == 0) {
         // child process, you can use the exec* series of functions to execute new programs} else {
          // parent process}
    }
`````

The characteristics of the fork function, we may hear the most is to execute once and return twice, we may wonder, how can it be possible to execute a function and return twice? As we said before, a process is an instance represented by task_struct. When calling fork, the operating system will create a new task_struct instance (into two processes). The meaning of fork returning twice is that the two processes are separate Return once, and execute the line of code after fork. The operating system sets the return value of the fork function according to whether the current process is the main process or the child process. So different processes, the return value of fork is different, that is, the if else condition in our code. But fork just copies the contents of the main process, what if we want to execute another program? At this time, you need to use the exec\* series of functions, which will overwrite part of the old process (task_struct) and reload the new program content. This is also the underlying principle of creating child processes in Node.js. Although Node.js provides many ways to create processes, there are essentially two ways of synchronous and asynchronous.

### 13.2.1 Create a process asynchronously Let's first look at the relationship diagram when creating a process asynchronously, as shown in Figure 13-1.

![](https://img-blog.csdnimg.cn/b90243d1708f4167b3ad18dd442a3ed2.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6FFLy9ibG0nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size)  
 Figure 13-1  
 Let's start with the fork function and take a look at the whole process.

```js
function fork(modulePath /* , args, options */) {
  // A series of parameter processing return spawn(options.execPath, args, options);
}
```

Let's look at spawn

```js
var spawn = (exports.spawn = function (/*file, args, options*/) {
  var opts = normalizeSpawnArguments.apply(null, arguments);
  var options = opts.options;
  var child = new ChildProcess();

  child.spawn({
    file: opts.file,
    args: opts.args,
    cwd: options.cwd,
    windowsHide: !!options.windowsHide,
    windowsVerbatimArguments: !!options.windowsVerbatimArguments,
    detached: !!options.detached,
    envPairs: opts.envPairs,
    stdio: options.stdio,
    uid: options.uid,
    gid: options.gid,
  });

  return child;
});
```

We see that the spawn function is just a wrapper around ChildProcess. Then call its spawn function. Let's look at ChildProcess.

```js
function ChildProcess() {
  // C++ layer defines this._handle = new Process();
}

ChildProcess.prototype.spawn = function (options) {
  // create process const err = this._handle.spawn(options);
};
```

ChildProcess is an encapsulation of the C++ layer, but Process does not have much logic in the C++ layer. It processes parameters and then calls Libuv's uv_spawn. We came to the C language layer through uv_spawn. Let's look at the overall process of uv_spawn.

```cpp
    int uv_spawn(uv_loop_t* loop,
                 uv_process_t* process,
                 const uv_process_options_t* options) {

      uv__handle_init(loop, (uv_handle_t*)process, UV_PROCESS);
      QUEUE_INIT(&amp;process-&gt;queue);
      // handle interprocess communication for (i = 0; i &lt; options-&gt;stdio_count; i++) {
        err = uv__process_init_stdio(options-&gt;stdio + i, pipes[i]);
        if (err)
          goto error;
      }
      /*
       Create a pipe for parent-child communication during process creation,
       Set the UV__O_CLOEXEC flag, and the child process executes execvp
       when one end of the pipe is closed */
      err = uv__make_pipe(signal_pipe, 0);
      // Register the handler for the exit signal of the child process uv_signal_start(&amp;loop-&gt;child_watcher, uv__chld, SIGCHLD);

      uv_rwlock_wrlock(&amp;loop-&gt;cloexec_lock);
      // create child process pid = fork();
      // child process if (pid == 0) {
        uv__process_child_init(options,
                                  stdio_count,
                                  pipes,
                                  signal_pipe[1]);
        abort();
      }
      // parent process uv_rwlock_wrunlock(&amp;loop-&gt;cloexec_lock);
      // Close the pipe write end and wait for the child process to write uv__close(signal_pipe[1]);

      process-&gt;status = 0;
      exec_errorno = 0;
      // Determine whether the child process is successfully executed do
        r = read(signal_pipe[0],&amp;exec_errorno,sizeof(exec_errorno));
      while (r == -1 &amp;&amp; errno == EINTR);
      // ignore the logic that handles r //out of state, out of queue,
              Insert into the peding queue and wait for processing */
        process-&gt;status = status;
        QUEUE_REMOVE(&amp;process-&gt;queue);
        QUEUE_INSERT_TAIL(&amp;pending, &amp;process-&gt;queue);
      }

      h = &amp;pending;
      q = QUEUE_HEAD(h);
      // Whether there is an exiting process while (q != h) {
        process = QUEUE_DATA(q, uv_process_t, queue);
        q = QUEUE_NEXT(q);
        QUEUE_REMOVE(&amp;process-&gt;queue);
        QUEUE_INIT(&amp;process-&gt;queue);
        uv__handle_stop(process);

        if (process-&gt;exit_cb == NULL)
          continue;

        exit_status = 0;
        // Get the exit information and execute the upload callback if (WIFEXITED(process-&gt;status))
          exit_status = WEXITSTATUS(process-&gt;status);
          // whether to exit because of signal term_signal = 0;
        if (WIFSIGNALED(process-&gt;status))
          term_signal = WTERMSIG(process-&gt;status);

        process-&gt;exit_cb(process, exit_status, term_signal);
      }
    }
```

When the child process under the main process exits, the parent process is mainly responsible for collecting information such as the exit status and reason of the child process, and then executing the upper-level callback.

2 Create a child process (uv**process_child_init)  
 The main process first uses uv**make_pipe to apply for an anonymous pipe for communication between the main process and the child process. An anonymous pipe is a relatively simple type of inter-process communication. It is only used for processes with inheritance relationship, because anonymous and non-inheritance processes cannot be found. This pipeline cannot complete communication, and the process with inheritance relationship is fork out, and the parent and child process can obtain the pipeline. Further, the child process can use the resources inherited from the parent process. The principle of pipeline communication is shown in Figure 13-2.  
 ![](https://img-blog.csdnimg.cn/3ccd1855afa740a69ce0f83abc0e7589.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6FFLy9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size)  
 Figure 13-2  
 The main process and the child process can read and write to the same memory by sharing the file and inode structures. After the main process fork creates a child process, it will block the message waiting for the child process through read. Let's take a look at the logic of the child process.

```cpp
    static void uv__process_child_init(const uv_process_options_t* options,
                                         int stdio_count,
                       int (*pipes)[2],
                       int error_fd) {
      sigset_t set;
      int close_fd;
      int use_fd;
      int err;
      int fd;
      int n;
      // Omit the processing of parameter logic such as file descriptors // Process environment variables if (options-&gt;env != NULL) {
        environ = options-&gt;env;
      }
      // handle the signal for (n = 1; n &lt; 32; n += 1) {
        // When these two signals fire, the default behavior is if the process exits and cannot be blocked if (n == SIGKILL || n == SIGSTOP)
          continue; /* Can't be changed. */
        // set to default processing if (SIG_ERR != signal(n, SIG_DFL))
          continue;
        // If there is an error, notify the main process uv__write_int(error_fd, UV__ERR(errno));
        _exit(127);
      }
      // Load a new execution file execvp(options-&gt;file, options-&gt;args);
      // If the loading is successful, it will not go here. Going to this means that loading the executable file fails uv__write_int(error_fd, UV__ERR(errno));
      _exit(127);
    }
```

The logic of the child process is mainly to deal with file descriptors, signals, and set environment variables. Then load the new executable. Because the file descriptor corresponding to the pipe through which the main process and the child process communicate has the cloexec flag set. So when the child process loads a new execution file, it closes the pipe file descriptor used to communicate with the main process, which causes the main process to return 0 when reading the read end of the pipe, so that the main process knows that the child process is successfully executed.

### 13.2.2 Create a process synchronously For a process created in synchronous mode, the main process will wait for the child process to exit before continuing to execute. Next, let's see how to create processes in a synchronous manner. The entry function of the JS layer is spawnSync. spawnSync calls the spawn function of the C++ module spawn_sync to create a process. Let's take a look at the properties exported by the corresponding C++ module spawn_sync.

```cpp
    void SyncProcessRunner::Initialize(Local target,
                                       Local unused,
                                       Local context,
                                       void* priv) {
      Environment* env = Environment::GetCurrent(context);
      env-&gt;SetMethod(target, "spawn", Spawn);
    }
```

This module value exports a property spawn, when we call spawn, the C++ spawn is executed.

```cpp
    void SyncProcessRunner::Spawn(const FunctionCallbackInfo &amp; args) {
      Environment* env = Environment::GetCurrent(args);
      env-&gt;PrintSyncTrace();
      SyncProcessRunner p(env);
      Local result;
      if (!p.Run(args[0]).ToLocal(&amp;result)) return;
      args.GetReturnValue().Set(result);
    }
```

In Spawn, a new SyncProcessRunner object is mainly created and the Run method is executed. Let's take a look at what SyncProcessRunner's Run does.

```cpp
    MaybeLocal SyncProcessRunner::Run(Local options) {
      EscapableHandleScope scope(env()-&gt;isolate());
      Maybe r = TryInitializeAndRunLoop(options);
      Local result = BuildResultObject();
      return scope.Escape(result);
    }
```

Creating a child process in this way will cause the Node.js main process to block. In order to avoid problems with the child process, which will affect the execution of the main process, Node.js supports a configurable maximum execution time for the child process. We see that Node.js starts a timer and sets the callback KillTimerCallback.

```cpp
    void SyncProcessRunner::KillTimerCallback(uv_timer_t* handle) {
      SyncProcessRunner* self = reinterpret_cast (handle-&gt;data);
      self-&gt;OnKillTimerTimeout();
    }

    void SyncProcessRunner::OnKillTimerTimeout() {
      SetError(UV_ETIMEDOUT);
      Kill();
    }

    void SyncProcessRunner::Kill() {
      if (killed_)
        return;
      killed_ = true;
      if (exit_status_ &lt; 0) {
        // kill_signal_ is the user-defined signal to kill the process int r = uv_process_kill(&amp;uv_process_, kill_signal_);
        // Signals passed by the user are not supported if (r &lt; 0 &amp;&amp; r != UV_ESRCH) {
          SetError(r);
          // Fallback to kill the process with SIGKILL signal r = uv_process_kill(&amp;uv_process_, SIGKILL);
          CHECK(r &gt;= 0 || r == UV_ESRCH);
        }
      }

      // Close all stdio pipes.
      CloseStdioPipes();

      // Clear the timer CloseKillTimer();
    }
```

When the execution time reaches the set threshold, the Node.js main process will send a signal to the child process, and the default is to kill the child process.

#### 13.2.2.2 Child process exit processing Exit processing mainly records the error code when the child process exits and which signal was killed (if any).

```cpp
    void SyncProcessRunner::ExitCallback(uv_process_t* handle,
                                         int64_t exit_status,
                                         int term_signal) {
      SyncProcessRunner* self = reinterpret_cast (handle-&gt;data);
      uv_close(reinterpret_cast (handle), nullptr);
      self-&gt;OnExit(exit_status, term_signal);
    }

    void SyncProcessRunner::OnExit(int64_t exit_status, int term_signal) {
      if (exit_status &lt; 0)
        return SetError(static_cast (exit_status));

      exit_status_ = exit_status;
      term_signal_ = term_signal;
    }
```

## 13.3 Inter-process communication Inter-process communication is a very important function in a multi-process system, otherwise the process is like an island and cannot exchange information. Because the memory between processes is isolated, if the processes want to communicate, they need a common place, so that multiple processes can access and complete the transfer of information. In Linux, there are many inter-process communication methods with the host, but they basically use additional memory independent of the process as the place to carry information, and then allow multiple processes to access this common memory in some way. Such as pipes, shared memory, Unix domains, message queues, etc. However, there is another way of inter-process communication that does not belong to the above situation, and that is signals. Signal is a simple inter-process communication method. The operating system provides an interface so that a process can directly modify the data (PCB) of another process to achieve the purpose of communication. This section introduces the principle and implementation of inter-process communication in Node.js.

### 13.3.1 Create a communication channel We start with the fork function to analyze the logic of inter-process communication in Node.js.

```js
    function fork(modulePath) {
     // ignore options parameter processing if (typeof options.stdio === 'string') {
        options.stdio = stdioStringToArray(options.stdio, 'ipc');
      } else if (!ArrayIsArray(options.stdio)) {
        // If silent is true, it communicates with the main process in the form of a pipeline, otherwise it inherits options.stdio = stdioStringToArray(
          options.silent ? 'pipe' : 'inherit',
          'ipc');
      } else if (!options.stdio.includes('ipc')) {
        // IPC is required to support inter-process communication throw new ERR_CHILD_PROCESS_IPC_REQUIRED('options.stdio');
      }

      return spawn(options.execPath, args, options);
    }
```

Let's take a look at the handling of stdioStringToArray.

```js
function stdioStringToArray(stdio, channel) {
  const options = [];

  switch (stdio) {
    case "ignore":
    case "pipe":
      options.push(stdio, stdio, stdio);
      break;
    case "inherit":
      options.push(0, 1, 2);
      break;
    default:
      throw new ERR_INVALID_OPT_VALUE("stdio", stdio);
  }

  if (channel) options.push(channel);

  return options;
}
```

stdioStringToArray will return an array, such as ['pipe', 'pipe', 'pipe', 'ipc'] or [0, 1, 2, 'ipc'], ipc represents the need to create a channel for inter-process communication, and supports File description delivery. Let's move on to spawn.

```js
    ChildProcess.prototype.spawn = function(options) {
      let i = 0;
      // Data structure for preprocessing inter-process communication stdio = getValidStdio(stdio, false);
      const ipc = stdio.ipc;
      // IPC file descriptor const ipcFd = stdio.ipcFd;
      stdio = options.stdio = stdio.stdio;
      // Tell the child process IPC file descriptor and data processing mode through environment variables if (ipc !== undefined) {
        options.envPairs.push(`NODE_CHANNEL_FD=${ipcFd}`);
        options.envPairs.push(`NODE_CHANNEL_SERIALIZATION_MODE=${serialization}`);
      }
      // create child process const err =The value of andle, that is, the new Pipe (SOCKET.IPC) of the JS layer just now;
       */
       Local handle =
           stdio-&gt;Get(env-&gt;context(), handle_key).ToLocalChecked().As ();
       // Get the stream in the C++ object corresponding to the JS layer usage object
       uv_stream_t* stream = LibuvStreamWrap::From(env, handle)-&gt;stream();
       CHECK_NOT_NULL(stream);
       return stream;
     }

    // Get the associated C++ object from the object used by the JS layer ibuvStreamWrap* LibuvStreamWrap::From(Environment* env, Local object) {
     return Unwrap (object);
    }
```

The above code obtains the stream structure corresponding to IPC. In Libuv, the file descriptor is saved to the stream. Let's look at the C++ layer calling Libuv's uv_spawn.

```cpp
    int uv_spawn(uv_loop_t* loop,
                 uv_process_t* process,
                 const uv_process_options_t* options) {

      int pipes_storage[8][2];
      int (*pipes)[2];
      int stdio_count;
      // Initialize the data structure for inter-process communication stdio_count = options-&gt;stdio_count;
      if (stdio_count &lt; 3)
        stdio_count = 3;

      for (i = 0; i &lt; stdio_count; i++) {
        pipes[i][0] = -1;
        pipes[i][1] = -1;
      }
      // Create a file descriptor for inter-process communication for (i = 0; i &lt; options-&gt;stdio_count; i++) {
        err = uv__process_init_stdio(options-&gt;stdio + i, pipes[i]);
        if (err)
          goto error;
      }

      // Set the inter-process communication file descriptor to the corresponding data structure for (i = 0; i &lt; options-&gt;stdio_count; i++) {
        uv__process_open_stream(options-&gt;stdio + i, pipes[i]);

      }

    }
```

Libuv will create a file descriptor for inter-process communication, and then set it to the corresponding data structure.

```cpp
    static int uv__process_open_stream(uv_stdio_container_t* container,
                                       int pipefds[2]) {
      int flags;
      int err;

      if (!(container-&gt;flags &amp; UV_CREATE_PIPE) || pipefds[0] &lt; 0)
        return 0;

      err = uv__close(pipefds[1]);
      if (err != 0)
        abort();

      pipefds[1] = -1;
      uv__nonblock(pipefds[0], 1);

      flags = 0;
      if (container-&gt;flags &amp; UV_WRITABLE_PIPE)
        flags |= UV_HANDLE_READABLE;
      if (container-&gt;flags &amp; UV_READABLE_PIPE)
        flags |= UV_HANDLE_WRITABLE;

      return uv__stream_open(container-&gt;data.stream, pipefds[0], flags);
    }
```

After executing uv\_\_process_open_stream, the file descriptor for IPC is saved to new Pipe (SOCKET.IPC). With the file descriptor for the IPC channel, the process needs further processing. We see that after the JS layer executes spawn, the main process further processes the inter-process communication through setupChannel. Let's take a look at the processing of inter-process communication in the main process setupChannel.

### 13.3.2 The main process handles the communication channel 1 read end ```js

     function setupChannel(target, channel, serializationMode) {
       // channel is new Pipe(PipeConstants.IPC);
       const control = new Control(channel);
       target.channel = control;
       // …
       channel.pendingHandle = null;
       // Register the function for processing data channel.onread = function(arrayBuffer) {
         // Received file descriptor const recvHandle = channel.pendingHandle;
         channel.pendingHandle = null;
         if (arrayBuffer) {
           const nread = streamBaseState[kReadBytesOrError];
           const offset = streamBaseState[kArrayBufferOffset];
           const pool = new Uint8Array(arrayBuffer, offset, nread);
           if (recvHandle)
             pendingHandle = recvHandle;
           // Parse the received message for (const message of parseChannelMessages(channel, pool)) {
             // Is it an internal communication event if (isInternal(message)) {
                // receive handle
               if (message.cmd === 'NODE_HANDLE') {
                 handleMessage(message, pendingHandle, true);
                 pendingHandle = null;
               } else {
                 handleMessage(message, undefined, true);
               }
             } else {
               handleMessage(message, undefined, false);
             }
           }
         }

       };

       function handleMessage(message, handle, internal) {
         const eventName = (internal ? 'internalMessage' : 'message');
        descriptor, handle is the encapsulation of the file descriptor if (handle) {
           message = {
             cmd: 'NODE_HANDLE',
             type: null,
             msg: message
           };
           // handle type if (handle instanceof net.Socket) {
             message.type = 'net.Socket';
           } else if (handle instanceof net.Server) {
             message.type = 'net.Server';
           } else if (handle instanceof TCP || handle instanceof Pipe) {
             message.type = 'net.Native';
           } else if (handle instanceof dgram.Socket) {
             message.type = 'dgram.Socket';
           } else if (handle instanceof UDP) {
             message.type = 'dgram.Native';
           } else {
             throw new ERR_INVALID_HANDLE_TYPE();
           }
           // Convert object obj according to type = handleConversion[message.type];

           // Convert the object used by the JS layer to the C++ layer object handle=handleConversion[message.type].send.call(target,
                                                           message,
                                                           handle,
                                                           options);
         }
         // send const req = new WriteWrap();
         // Send to peer const err = writeChannelMessage(channel, req, message, handle);

       }

`````

Before Node.js sends an object that encapsulates a file descriptor, it first converts the object used by the JS layer into the object used by the C++ layer. such as TCP

````js
    send(message, server, options) {
          return server._handle;
    }
`````

Let's look at writeChannelMessage next.

```js
    // channel is new Pipe(PipeConstants.IPC);
    writeChannelMessage(channel, req, message, handle) {
        const string = JSONStringify(message) + '\n';
        return channel.writeUtf8String(req, string, handle);
    }
```

Let's take a look at writeUtf8String

```cpp
    template
    int StreamBase::WriteString(const FunctionCallbackInfo &amp; args) {
      Environment* env = Environment::GetCurrent(args);
      // new WriteWrap()
      Local req_wrap_obj = args[0].As ();
      Local string = args[1].As ();
      Local send_handle_obj;
      // Need to send file descriptor, C++ layer object if (args[2]-&gt;IsObject())
        send_handle_obj = args[2].As ();

      uv_stream_t* send_handle = nullptr;
      // is Unix domain and supports passing file descriptors if (IsIPCPipe() &amp;&amp; !send_handle_obj.IsEmpty()) {
        HandleWrap* wrap;
        /*
          send_handle_obj is an object created by the C++ layer and used in the JS layer.
          Unpack the object actually used in the C++ layer */
        ASSIGN_OR_RETURN_UNWRAP(&amp;wrap, send_handle_obj, UV_EINVAL);
        // Get the handle structure of the Libuv layer send_handle = reinterpret_cast (wrap-&gt;GetHandle());
        /*
          Reference LibuvStreamWrap instance to prevent it
          from being garbage, collected before `AfterWrite` is
          called.
        */
        req_wrap_obj-&gt;Set(env-&gt;context(),
                          env-&gt;handle_string(),
                          send_handle_obj).Check();
      }

      Write(&amp;buf, 1, send_handle, req_wrap_obj);
    }
```

Write will call uv**write of Libuv, and uv**write will take out the fd in the handle of the Libuv layer and pass it to other processes using sendmsg. The essence of the entire sending process is to uncover the object to be sent layer by layer from the JS layer to Libuv, finally get a file descriptor, and then pass the file descriptor to another process through the API provided by the operating system, as shown in Figure 13- 4 shown.  
 ![](https://img-blog.csdnimg.cn/21cecfca8d244b33810f151860327058.png)  
 Figure 13-4

### 13.4.2 Receive file descriptor After analyzing and sending, let's look at the logic of receiving. We have analyzed earlier that when the file descriptor receives data, it will encapsulate the file file descriptor into a corresponding object.

```cpp
    void LibuvStreamWrap::OnUvRead(ssize_t nread, const uv_buf_t* buf) {
      HandleScope scope(env()-&gt;isolate());
      Context::Scope context_scope(env()-&gt;context());
      uv_handle_type type = UV_UNKNOWN_HANDLE;
      // Whether it supports passing file descriptors and there is a pending file descriptor, then determine the file descriptor type if (is_named_pipe_ipc() &amp;&amp;
          uv_pipe_pending_count(reinterpret_cast (stream())) &gt; 0) {
        type = uv_pipe_pending_type(reinterpret_cast (stream()));
      }

      // read successfully if (nread &gt; 0) {
        MaybeLocal pending_obj;
        //Passed to another process via the underlying API. When receiving, it wraps an fd layer by layer and turns it into an object used by the JS layer.
```
