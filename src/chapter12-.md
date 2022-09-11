File manipulation is a feature that we often use when using Node.js. In Node.js, almost all APIs of the file module provide synchronous and asynchronous versions. The synchronous API directly calls the interface provided by the operating system in the main thread, which will cause the main thread to block. The asynchronous API is implemented by executing the blocking API in the thread pool provided by Libuv. This will not cause the main thread to block. File IO is different from network IO. Due to compatibility issues, file IO cannot use the capabilities provided by the operating system to directly achieve asynchrony like network IO. In Libuv, file operations are implemented with thread pools, and when operating files, a certain thread is blocked. So this asynchrony is only for the user. Although the file module provides many interfaces and thousands of lines of source code, many of the logics are similar, so we only explain the different places. Before introducing the file module, let's introduce the files in the Linux operating system.

Everything in the Linux system is a file. From the application layer, we get a file descriptor, and we operate this file descriptor. It's very easy to use, and that's because the operating system does a lot for us. In simple terms, a file descriptor is just an index. Its bottom layer can correspond to various resources, including ordinary files, network, memory, etc. Before we operate a resource, we first call the interface of the operating system to get a file descriptor, and the operating system also records the underlying resources, attributes, and operation functions of the file descriptor. When we subsequently operate this file descriptor, the operating system will perform the corresponding operation. For example, when we write, the file descriptors passed are ordinary files and network sockets, and the underlying operations are different. But we generally don't need to pay attention to these. We just need to use it from an abstract point of view. This chapter introduces the principle and implementation of file modules in Node.js.

## 12.1 Synchronous API

In Node.js, the essence of the synchronous API is to call the system calls provided by the operating system directly in the main thread. Take readFileSync as an example to see the overall process, as shown in Figure 12-1.  
 ![](https://img-blog.csdnimg.cn/30843926b91a40f28cf763d9b0656e74.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==)  
 Figure 12-1

Let's take a look at the specific code ```js
function readFileSync(path, options) {  
 options = getOptions(options, { flag: 'r' });  
 // Whether to pass fd or file path const isUserFd = isFd(path);  
 // If the path is passed, then open the file synchronously first const fd = isUserFd ? path : fs.openSync(path, options.flag, 0o666);  
 // View the stat information of the file and get the size of the file const stats = tryStatSync(fd, isUserFd);  
 // Is it a normal file const size = isFileType(stats, S_IFREG) ? stats[8] : 0;  
 let pos = 0;  
 let buffer;  
 let buffers;  
 // file size is 0 or not a normal file, size is 0  
 if (size === 0) {  
 buffers = [];  
 } else {  
 // For general files and there is a size, allocate a buffer of size size, and the size needs to be less than 2G  
 buffer = tryCreateBuffer(size, fd, isUserFd);  
 }

       let bytesRead;
       // Constantly read the file content synchronously if (size !== 0) {
         do {
           bytesRead = tryReadSync(fd, isUserFd, buffer, pos, size - pos);
           pos += bytesRead;
         } while (bytesRead !== 0 &amp;&amp; pos &lt; size);
       } else {
         do {
           /*
             The file size is 0, or it is not a normal file, try to read it,
             But because I don't know the size, I can only allocate a buffer of a certain size,
             Read a certain size of content each time */
           buffer = Buffer.allocUnsafe(8192);
           bytesRead = tryReadSync(fd, isUserFd, buffer, 0, 8192);
           // Put the read content into buffers if (bytesRead !== 0) {
             buffers.push(buffer.slice(0, bytesRead));
           }
           // record the length of the data readpos += bytesRead;
         } while (bytesRead !== 0);
       }
       // The user passed the file path, Node.js opened the file by itself, so you need to close if (!isUserFd)
         fs.closeSync(fd);
       // If the file size is 0 or a non-normal file, if the content is read if (size === 0) {
         // Put everything read into the buffer buffer = Buffer.concat(buffers, pos);
       } else if (pos &lt; size) {
         buffer = buffer. slice(0, pos);
       }
       // encoding if (options.encoding) buffer = buffer.toString(options.encoding);
       return buffer;
     }

````

tryReadSync calls fs.readSync, and then to binding.read (the Read function defined in node_file.cc). The main logic of the Read function is as follows ```cpp
    FSReqWrapSync req_wrap_sync;
    const int bytesRead = SyncCall(env,
                                       args[6],
                                       &amp;req_wrap_sync,
                                       "read",
                                       uv_fs_read,
                                       fd,
                                       &amp;uvbuf,
                                       1,
                                       pos);
````

Let's take a look at the implementation of SyncCall ```cpp
int SyncCall(Environment* env,  
 v8::Local ctx,  
 FSReqWrapSync* req_wrap,  
 const char* syscall,  
 Func fn,  
 Args... args) {  
 /*
req_wrap-&gt;req is a uv_fs_t structure, belonging to the request class,
Manage requests for a file operation \*/
int err = fn(env-&gt;event_loop(),  
 &amp;(req_wrap-&gt;req),  
 args...,  
 nullptr);  
 // ignore error handling return err;  
 }

````

We see that Libuv's uv_fs_read is finally called, and uv_fs_t is used to manage this request. Because it is a blocking call, Libuv will directly call the system call read function of the operating system. This is the process of synchronous API in Node.js.
## 12.2 Asynchronous API
In the file system API, the asynchronous implementation depends on Libuv's thread pool. Node.js puts the task into the thread pool, then returns to the main thread to continue processing other things, and when the conditions are met, the callback will be executed. We take readFile as an example to explain this process. The flowchart for asynchronously reading files is shown in Figure 12-2.
![](https://img-blog.csdnimg.cn/e85ea13f393c4e93aaa43f02512dab91.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG09nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_1RIRUFOQVJLSA==)
Figure 12-2

Let's look at the specific implementation ```js
    function readFile(path, options, callback) {
      callback = maybeCallback(callback || options);
      options = getOptions(options, { flag: 'r' });
      // object that manages file reading if (!ReadFileContext)
        ReadFileContext = require('internal/fs/read_file_context');
      const context = new ReadFileContext(callback, options.encoding)
      // Whether the file path or fd is passed
      context.isUserFd = isFd(path); // File descriptor ownership
      // The object of the C++ layer, which encapsulates the uv_fs_t structure, manages a file read request const req = new FSReqCallback();
      req.context = context;
      // Set the callback, after opening the file, execute req.oncomplete = readFileAfterOpen;
      // If fd is passed, you don't need to open the file, the next tick directly executes the callback to read the file if (context.isUserFd) {
        process.nextTick(function tick() {
          req.oncomplete(null, path);
        });
        return;
      }

      path = getValidatedPath(path);
      const flagsNumber = stringToFlags(options.flags);
      // Call the C++ layer open to open the file binding.open(pathModule.toNamespacedPath(path),
            flagsNumber,
            0o666,
            req);
    }
````

The ReadFileContext object is used to manage the entire process of file read operations. FSReqCallback is the encapsulation of uv_fs_t. Each read operation is a request for Libuv, and the context of the request is represented by uv_fs_t. After the request is completed, the oncomplete function of the FSReqCallback object is executed. So we move on to readFileAfterOpen.

```js
function readFileAfterOpen(err, fd) {
  const context = this.context;
  // If open error, execute user callback directly, pass in err
  if (err) {
    context.callback(err);
    return;
  }
  // save the fd of the open file
  context.fd = fd;
  // Create a new FSReqCallback object to manage the next asynchronous request and callback const req = new FSReqCallback();
  req.oncomplete = readFileAfterStat;
  req.context = context;
  // Get the metadata of the file and get the file size binding.fstat(fd, false, req);
}
```

After getting the metadata of the file, execute readFileAfterStat. This logic is similar to that of synchronization. According to the file size recorded in the metadata, a buffer is allocated for subsequent reading of the file content. Then perform a read operation.

```js
    read() {
        let buffer;
        let offset;
        letet(filename);

      if (stat === undefined) {
        if (!watchers)
          watchers = require('internal/fs/watchers');
        stat = new watchers.StatWatcher(options.bigint);
        // Enable monitoring stat[watchers.kFSStatWatcherStart](filename,
                                               options.persistent,
                                               options.interval);
        // Update cache statWatchers.set(filename, stat);
      }

      stat.addListener('change', listener);
      return stat;
    }
```

StatWatcher is a class that manages file monitoring. Let's take a look at the implementation of the watchers.kFSStatWatcherStart method.

```cpp
    StatWatcher.prototype[kFSStatWatcherStart] = function(filename,persistent, interval) {
      this._handle = new _StatWatcher(this[kUseBigint]);
      this._handle.onchange = onchange;
      filename = getValidatedPath(filename, 'filename');
      const err = this._handle.start(toNamespacedPath(filename),
                                          interval);
    }
```

Create a new \_StatWatcher object, \_StatWatcher is a function provided by the C++ module (node_stat_watcher.cc), and then execute its start method. The Start method executes Libuv's uv_fs_poll_start to start monitoring files.

```cpp
    int uv_fs_poll_start(uv_fs_poll_t* handle, uv_fs_poll_cb cb,
    const char* path, unsigned int interval) {
      // Data structure for managing file monitoring struct poll_ctx* ctx;
      uv_loop_t* loop;
      size_t len;
      int err;

      loop = handle-&gt;loop;
      len = strlen(path);
        // calloc will initialize memory to 0
      ctx = uv__calloc(1, sizeof(*ctx) + len);
      ctx-&gt;loop = loop;
        // C++ layer callback ctx-&gt;poll_cb = cb;
      // How often to poll ctx-&gt;interval = interval ? interval : 1;
      ctx-&gt;start_time = uv_now(loop);
      // associated handle
      ctx-&gt;parent_handle = handle;
      // Monitored file path memcpy(ctx-&gt;path, path, len + 1);
      // Initialize the timer structure err = uv_timer_init(loop, &amp;ctx-&gt;timer_handle);
      // Asynchronously query file metadata err = uv_fs_stat(loop, &amp;ctx-&gt;fs_req, ctx-&gt;path, poll_cb);

      if (handle-&gt;poll_ctx != NULL)
        ctx-&gt;previous = handle-&gt;poll_ctx;
      // Associate the object responsible for managing polling handle-&gt;poll_ctx = ctx;
      uv__handle_start(handle);
      return 0;
    }
```

The Start function initializes a poll_ctx structure to manage file monitoring, and then initiates an asynchronous request for file metadata. After the metadata is obtained, the poll_cb callback is executed.

```cpp
    static void poll_cb(uv_fs_t* req) {
      uv_stat_t* statbuf;
      struct poll_ctx* ctx;
      uint64_t interval;
      // Get the first address of the structure through the structure field ctx = container_of(req, struct poll_ctx, fs_req);
      statbuf = &amp;req-&gt;statbuf;
      /*
       The callback is not executed for the first time, because there is no comparable metadata, the second and subsequent operations may execute the callback. When busy_polling is initialized, it is 0, and busy_polling=1 when it is executed for the first time.
      */
      if (ctx-&gt;busy_polling != 0)
        // If an error occurs or the stat changes, the callback is executed if (ctx-&gt;busy_polling &lt; 0 ||
                 !statbuf_eq(&amp;ctx-&gt;statbuf, statbuf))
          ctx-&gt;poll_cb(ctx-&gt;parent_handle,
                             0,
                            &amp;ctx-&gt;statbuf,
                             statbuf);
      // Save the currently obtained stat information, set to 1
      ctx-&gt;statbuf = *statbuf;
      ctx-&gt;busy_polling = 1;

    out:
      uv_fs_req_cleanup(req);

      if (ctx-&gt;parent_handle == NULL) {
        uv_close((uv_handle_t*)&amp;ctx-&gt;timer_handle, timer_close_cb);
        return;
      }
      /*
        Suppose stat is executed with the start time point as 1 and the interval as 10, stat
            The time point when the execution is completed and poll_cb callback is executed is 3, then the timeout time of the timer is 10-3=7, that is, the timeout will be triggered after 7 units, not 10, because stat
            Blocking consumes 3 units of time, so the next time the timeout callback function is executed, it means that it starts from the start time point and has gone through each interval of x units. Then the stat function is executed in the timeout callback, and then the stat callback is executed. This The time point is now=start+x
            The time consumed by the unit interval+stat. It is concluded that now-start is x times the interval + stat consumption, that is, the stat consumption can be obtained by taking the remainder of the interval, so the current round,
            The timeout of the timer is interval - ((now-start) % interval)
      */
      interval = ctx-&gt;interval;
      interval = (uv_now(ctx-&gt;loop) - ctx-&gt;start_time) % interval;

      if (uv_timer_start(&amp;ctx-&gt;timer_handle, timer_cb, interval, 0))
        abort();
    }
```

tify creates an instance of inotify, returning a file descriptor. Similar to epoll.  
 2 inotify_add_watch registers a file to be monitored with the inotify instance (inotify_rm_watch is removed).  
 3 read(the file descriptor corresponding to the inotify instance, &amp;buf, sizeof(buf)), if no event is triggered, block (unless non-blocking is set). Otherwise, return the length of the data to be read. buf is to save the information that triggers the event.  
 Libuv does a layer of encapsulation based on the inotify mechanism. Let's take a look at the architecture diagram of inotify in Libuv as shown in Figure 12-4.  
 ![](https://img-blog.csdnimg.cn/2b745c9ea2884e0484c54e6facc39419.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6FFLy9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size)  
 Figure 12-4

Let's look at the implementation in Libuv again. Let's start with a usage example.

```cpp
    int main(int argc, char **argv) {
        // Implement the loop core structure loop
        loop = uv_default_loop();
        uv_fs_event_t *fs_event_req = malloc(sizeof(uv_fs_event_t));
        // Initialize the type of the fs_event_req structure to UV_FS_EVENT
        uv_fs_event_init(loop, fs_event_req);
            /*
              argv[argc] is the file path,
              uv_fs_event_start registers the listening file argv[argc] with the bottom layer,
              cb is the callback when the event is triggered */
        uv_fs_event_start(fs_event_req,
                              cb,
                              argv[argc],
                              UV_FS_EVENT_RECURSIVE);
        // Open the event loop return uv_run(loop, UV_RUN_DEFAULT);
    }
```

When Libuv listens to a file for the first time (when uv_fs_event_start is called), it will create an inotify instance.

```cpp
    static int init_inotify(uv_loop_t* loop) {
      int err;
      // After initialization, return if (loop-&gt;inotify_fd != -1)
        return 0;
      /*
          Call the inotify_init function of the operating system to apply for an inotify instance,
          and set UV__IN_NONBLOCK, UV__IN_CLOEXEC flags */
      err = new_inotify_fd();
      if (err &lt; 0)
        return err;
      // Record the file descriptor corresponding to the inotify instance, one event loop and one inotify instance loop-&gt;inotify_fd = err;
      /*
          inotify_read_watcher is an IO watcher,
          uv__io_init sets the IO observer's file descriptor (file to be observed) and callback */
      uv__io_init(&amp;loop-&gt;inotify_read_watcher,
                    uv__inotify_read,
                    loop-&gt;inotify_fd);
      // Register the IO watcher in Libuv, the event of interest is readable uv__io_start(loop, &amp;loop-&gt;inotify_read_watcher, POLLIN);

      return 0;
    }
```

Libuv registers the fd corresponding to the inotify instance to epoll through uv**io_start. When a file changes, the callback uv**inotify_read will be executed. After analyzing the logic of Libuv's application for an inotify instance, let's go back to the main function to see the uv_fs_event_start function. The user uses the uv_fs_event_start function to register a file to be monitored with Libuv. Let's look at the implementation.

```cpp
    int uv_fs_event_start(uv_fs_event_t* handle,
                          uv_fs_event_cb cb,
                          const char* path,
                          unsigned int flags) {
      struct watcher_list* w;
      int events;
      int err;
      int wd;

      if (uv__is_active(handle))
        return UV_EINVAL;
      // Apply for an inotify instance err = init_inotify(handle-&gt;loop);
      if (err)
        return err;
      // Listening events events = UV__IN_ATTRIB
             | UV__IN_CREATE
             | UV__IN_MODIFY
             | UV__IN_DELETE
             | UV__IN_DELETE_SELF
             | UV__IN_MOVE_SELF
             | UV__IN_MOVED_FROM
             | UV__IN_MOVED_TO;
      // Call the function of the operating system to register a file to be monitored, and return an id corresponding to the file
      wd = uv__inotify_add_watch(handle-&gt;loop-&gt;inotify_fd, path, events);
      if (wd == -1)
        return UV__ERR(errno);
      // Determine if the file has been registered w = find_watcher(handle-&gt;loop, wd);
      // If already registered, skip the inserted logic if (w)
        goto no_insert;
      // If it has not been registered, insert the red-black tree maintained by Libuv w = uv__malloc(sizeof(*w) + strlen(path) + 1);
      if (w == NULL)
        return UV_ENOMEM;

      w-&gt;wd = wd;
      w-&gt;path = strcpy((char*)(w + 1), path);
      QUEUE_INIT(&amp;w-&gt;watchers);
      w-&gt;iterating = 0;
      // Insert the red-black tree maintained by Libuv, inotify_watchers is the root node RB_INSERT(watcher_root, CAST(&amp;handle-&gt;loop-&gt;inotify_watchers), w);

    no_insert:
      // activate the handle
      uv__handle_start(handle);
      // The same file may have many callbacks registered, w corresponds to a file, and is registered in a queue with a file's callbacks QUEUE_INSERT_TAIL(&amp;w-&gt;watchers, &amp;handle-&gt;watchers);
      // Save information and callback handle-&gt;path = w-&gt;path;
      handle-&gt;cb = cb;
      handle-&gt;wd = wd;

      return 0;
   h-&gt;cb(h, path, events, 0);
          }
        }
      }
    }
```

The logic of the uv\_\_inotify_read function is to read the data from the operating system, and which files are saved in the data to trigger the events that the user is interested in. Then iterate over each file that triggered the event. Find the red-black tree node corresponding to the file from the red-black tree. Then take out a handle queue maintained in the red-black tree node, and finally execute the callback of each node in the handle queue.

## 12.4 Promise API

The API of Node.js follows the callback mode, for example, we want to read the content of a file. We usually write ```js like this
const fs = require('fs');  
 fs.readFile('filename', 'utf-8' ,(err,data) =&gt; {  
 console.log(data)  
 })  
 //In order to support Promise mode, we usually write const fs = require('fs');  
 function readFile(filename) {  
 return new Promise((resolve, reject) =&gt; {  
 fs.readFile(filename, 'utf-8' ,(err,data) =&gt; {  
 err ? reject(err) : resolve(data);  
 });  
 });  
 }

`````

But in Node.js V14, the file module supports Promise api. We can directly use await for file operations. Let's look at an example of usage.

````js
    const { open, readFile } = require('fs').promises;
    async function runDemo() {
      try {
        console.log(await readFile('11111.md', { encoding: 'utf-8' }));
      } catch (e){

      }
    }
    runDemo();
`````

From the example, we can see that it is similar to the previous API call, but the difference is that we no longer need to write callbacks, but receive the results through await. This is just one of the features of the new API. Before the new version of the API, most of the file module APIs are similar to tool functions, such as readFile, writeFile, and the new version of the API supports object-oriented calling methods.

```js
const { open, readFile } = require("fs").promises;
async function runDemo() {
  let filehandle;
  try {
    filehandle = await open("filename", "r");
    // console.log(await readFile(filehandle, { encoding: 'utf-8' }));
    console.log(await filehandle.readFile({ encoding: "utf-8" }));
  } finally {
    if (filehandle) {
      await filehandle.close();
    }
  }
}
runDemo();
```

In the object-oriented mode, we first need to get a FileHandle object (the encapsulation of the file descriptor) through the open function, and then we can call various file operation functions on the object. One thing to note when using the object-oriented API is that Node.js will not close the file descriptor for us, even if the file operation is wrong, so we need to close the file descriptor manually, otherwise it will cause file descriptor leaks, In the non-object-oriented mode, Node.js will close the file descriptor for us after the file operation is completed, regardless of success or failure. Let's look at the specific implementation below. First introduce a FileHandle class. This class is an encapsulation of file descriptors and provides an object-oriented API.

```js
    class FileHandle {
      constructor(filehandle) {
        // filehandle is a C++ object this[kHandle] = filehandle;
        this[kFd] = filehandle.fd;
      }

      get fd() {
        return this[kFd];
      }

      readFile(options) {
        return readFile(this, options);
      }

      close = () =&gt; {
        this[kFd] = -1;
        return this[kHandle].close();
      }
      // Omit part of the api that manipulates the file
    }
```

The logic of FileHandle is relatively simple. It first encapsulates a series of file operation APIs, and then implements the close function to close the underlying file descriptor.
1 Operating the file system API
Here we take readFile as an example to analyze ```js
async function readFile(path, options) {  
 options = getOptions(options, { flag: 'r' });  
 const flag = options.flag || 'r';  
 // Use in an object-oriented way, at this time you need to close the file descriptor if (path instanceof FileHandle)  
 return readFileHandle(path, options);  
 // For direct call, you need to open the file descriptor first. After reading, Node.js will actively close the file descriptor const fd = await open(path, flag, 0o666);  
 return readFileHandle(fd, options).finally(fd.close);  
 }

`````

From the readFile code, we can see that the processing of Node.js is different under different calling methods. When the FileHandle is maintained by us, the closing operation is also performed by us. When the FileHandle is maintained by Node.js, Node.js is in the file. After the operation is completed, the file descriptor will be actively closed regardless of success or failure. Then we see the implementation of readFileHandle.

````js
    async function readFileHandle(filehandle, options) {
      // Get file meta information const statFields = await binding.fstat(filehandle.fd, false, kUsePromises);

      let size;
      // Is it a normal file, get the corresponding size according to the file type if ((statFields[1/* mode */] &amp; S_IFMT) === S_IFREG) {
        size = statFields[8/* size */];
      } else {
        size = 0;
      }
      // too big if (size &gt; kIoMaxLength)
        throw new ERR_FS_FILE_TOO_LARGE(size);

      const chunks = [];
      // Calculate the size of each read const chunkSize = size === 0 ?
        kReadFileMaxChunkSize :
        MathMin(size, kReadFileMaxChunkSize);
      let endOfFile = false;
      do {
        // Allocate memory to carry data const buf = Buffer.alloc(chunkSize);
        // read data and size const { bytesRead, buffer } =
          await read(filehandle, buf, 0, chunkSize, -1);
        //ises_symbol())) {
        // Promise mode (asynchronous mode)
        if (use_bigint) {
          return FSReqPromise ::New(env, use_bigint);
        } else {
          return FSReqPromise ::New(env, use_bigint);
        }
      }
      // synchronous mode return nullptr;
    }
`````

Here we only focus on the Promise pattern. So what GetReqWrap returns is a FSReqPromise object, and we go back to the Read function. see the following code ```cpp
FSReqBase* req_wrap_async = GetReqWrap(env, args[5]);  
 AsyncCall(env, req_wrap_async, args, "read", UTF8, AfterInteger,  
 uv_fs_read, fd, &amp;uvbuf, 1, pos);  
 Continue to look at the AsyncCall function (node_file-inl.h)
template  
 FSReqBase* AsyncCall(Environment* env,  
 FSReqBase* req_wrap,  
 const v8::FunctionCallbackInfo &amp; args,  
 const char\* syscall, enum encoding enc,  
 uv_fs_cb after, Func fn, Args... fn_args) {  
 return AsyncDestCall(env, req_wrap, args,  
 syscall, nullptr, 0, enc,  
 after, fn, fn_args...);  
 }

`````

AsyncCall is a wrapper around AsyncDestCall ````cpp
    template
    FSReqBase* AsyncDestCall(Environment* env, FSReqBase* req_wrap,
                             const v8::FunctionCallbackInfo &amp; args,
                             const char* syscall, const char* dest,
                             size_t len, enum encoding enc, uv_fs_cb after,
                             Func fn, Args... fn_args) {
      CHECK_NOT_NULL(req_wrap);
      req_wrap-&gt;Init(syscall, dest, len, enc);
      // call libuv function int err = req_wrap-&gt;Dispatch(fn, fn_args..., after);
      // If it fails, execute the callback directly, otherwise return a Promise, see the SetReturnValue function if (err &lt; 0) {
        uv_fs_t* uv_req = req_wrap-&gt;req();
        uv_req-&gt;result = err;
        uv_req-&gt;path = nullptr;
        after(uv_req); // after may delete req_wrap if there is an error
        req_wrap = nullptr;
      } else {
        req_wrap-&gt;SetReturnValue(args);
      }

      return req_wrap;
    }
`````

The AsyncDestCall function mainly does two operations. First, it calls the underlying Libuv function through Dispatch, such as uv_fs_read here. If there is an error, execute the callback and return an error, otherwise execute req_wrap-&gt;SetReturnValue(args). We know that req_wrap is called by FSReqPromise in the GetReqWrap function ::New(env, use_bigint) creates.

```cpp
    template
    FSReqPromise *
    FSReqPromise ::New(Environment* env, bool use_bigint) {
      v8::Local obj;
      // Create a C++ object and store it in obj if (!env-&gt;fsreqpromise_constructor_template()
               -&gt;NewInstance(env-&gt;context())
               .ToLocal(&amp;obj)) {
        return nullptr;
      }
      // Set a promise property, the value is a Promise::Resolver
      v8::Local resolver;
      if (!v8::Promise::Resolver::New(env-&gt;context()).ToLocal(&amp;resolver) ||
          obj-&gt;Set(env-&gt;context(), env-&gt;promise_string(), resolver).IsNothing()) {
        return nullptr;
      }
      // Return another C++ object, which holds obj, and obj also holds a pointer to the FSReqPromise object return new FSReqPromise(env, obj, use_bigint);
    }
```

So req_wrap is a FSReqPromise object. Let's take a look at the SetReturnValue method of the FSReqPromise object.

```cpp
    template
    void FSReqPromise ::SetReturnValue(
        const v8::FunctionCallbackInfo &amp; args) {
      // Get the Promise::Resolver object v8::Local val =
          object()-&gt;Get(env()-&gt;context(),
                        env()-&gt;promise_string()).ToLocalChecked();
      v8::Local resolver = val.As ();
      // Get a Promise as the return value, that is, the value obtained by the JS layer args.GetReturnValue().Set(resolver-&gt;GetPromise());
    }
```

So far we have seen the core logic of the new API implementation, which is the return value of this Promise. After returning through the layers, the Promise is obtained at the JS layer, and then in the pending state waiting for a resolution. Let's continue to look at the logic of Promise resolution. In the analysis of the Read function, we see that when the uv_fs_read function of Libuv is executed, the callback set is AfterInteger. Then when the file is successfully read, the function will be executed. So let's look at the logic of the function.

`````cpp
    voidteReadStream creates a file-readable stream. A file-readable stream inherits from a readable stream, so we can use it as a readable stream.

````js
    const fs = require('fs');
    const { Writable } = require('stream');
    class DemoWritable extends Writable {
      _write(data, encoding, cb) {
        console.log(data);
        cb(null);
      }
    }
    fs.createReadStream('11111.md').pipe(new DemoWritable);
`````

or ```js
const fs = require('fs');  
 const readStream = fs.createReadStream('11111.md');  
 readStream.on('data', (data) =&gt; {  
 console.log(data)  
 });

`````

Let's look at the implementation of createReadStream.

````js
    fs.createReadStream = function(path, options) {
      return new ReadStream(path, options);
    };
`````

CreateReadStream is the encapsulation of ReadStream.

```js
    function ReadStream(path, options) {
      if (!(this instanceof ReadStream))
        return new ReadStream(path, options);

      options = copyObject(getOptions(options, {}));
      // Threshold for readable stream if (options.highWaterMark === undefined)
        options.highWaterMark = 64 * 1024;

      Readable.call(this, options);

      handleError((this.path = getPathFromURL(path)));
      // Support file path or file descriptor this.fd = options.fd === undefined ? null : options.fd;
      this.flags = options.flags === undefined ? 'r' : options.flags;
      this.mode = options.mode === undefined ? 0o666 : options.mode;
      // start and end position of the read this.start = typeof this.fd !== 'number' &amp;&amp; options.start === undefined ?
        0 : options.start;
      this.end = options.end;
      // Whether to automatically destroy the stream when the stream fails or ends this.autoClose = options.autoClose === undefined ? true : options.autoClose;
      this.pos = undefined;
      // number of bytes read this.bytesRead = 0;
      // Is the stream closed this.closed = false;
      // parameter validation if (this.start !== undefined) {
        if (typeof this.start !== 'number') {
          throw new errors.TypeError('ERR_INVALID_ARG_TYPE',
                                     'start',
                                     'number',
                                     this.start);
        }
        // read all content by default if (this.end === undefined) {
          this.end = Infinity;
        } else if (typeof this.end !== 'number') {
          throw new errors.TypeError('ERR_INVALID_ARG_TYPE',
                                     'end',
                                     'number',
                                     this.end);
        }

        // Where to start reading from the file, start is the start position, pos is the current position, initialization is equal to the start position this.pos = this.start;
      }
      // If creating a stream based on a filename, open the file first if (typeof this.fd !== 'number')
        this.open();

      this.on('end', function() {
        // Automatically destroy the stream when the stream ends if (this.autoClose) {
          this.destroy();
        }
      });
    }
```

After the ReadStream is initialized, it performs two operations. First, it calls open to open the file (if necessary), and then listens for the stream end event. The user can set the autoClose option to control whether to destroy the stream when the stream ends or an error occurs. For file streams, destroy Streaming means closing the local file descriptor. Let's take a look at the implementation of open ```js
// open file ReadStream.prototype.open = function() {  
 var self = this;  
 fs.open(this.path, this.flags, this.mode, function(er, fd) {  
 if (er) {  
 // An error occurs, do you need to automatically destroy the stream if (self.autoClose) {  
 self.destroy();  
 }  
 // notify user self.emit('error', er);  
 return;  
 }

         self.fd = fd;
         // Trigger open, generally used for Node.js internal logic self.emit('open', fd);
         // start the flow of data.
         // After the opening is successful, start streaming to read the file content self.read();
       });
     };

`````

The open function first opens the file, and then starts streaming reading after the opening is successful. As a result, the content of the file will continuously flow to the destination stream. Let's move on to the implementation of the read operation.

````js
    // Hook function to implement readable stream ReadStream.prototype._read = function(n) {
      // If open is not called but the method is called directly, execute open first
      if (typeof this.fd !== 'number') {
        return this.once('open', function() {
          this._read(n);
        });
      }
      // If the stream has been destroyed, do not handle if (this.destroyed)
        return;
      // Determine whether the pool space is enough, if not, apply for a new if (!pool || pool.lengthDestroying a file stream closes the underlying file descriptor. In addition, the close event will not be triggered if the file descriptor is destroyed or closed due to an error.
### 12.5.2 Writable File Streams Writable file streams are abstractions for streaming writing to files. We can create a file-writable stream via fs.createWriteStream. File and stream inherit from writable stream, so we can use it as writable stream.

````js
    const fs = require('fs');
    const writeStream = fs.createWriteStream('123.md');
    writeStream.end('world');
    // or const fs = require('fs');
    const { Readable } = require('stream');

    class DemoReadStream extends Readable {
        constructor() {
            super();
            this.i = 0;
        }
        _read(n) {
            this.i++;
            if (this.i &gt; 10) {
                this.push(null);
            } else {
                this.push('1'.repeat(n));
            }

        }
    }
    new DemoReadStream().pipe(fs.createWriteStream('123.md'));
`````

Let's look at the implementation of createWriteStream.

```js
fs.createWriteStream = function (path, options) {
  return new WriteStream(path, options);
};
```

createWriteStream is the encapsulation of WriteStream, let's take a look at the implementation of WriteStream ```js
function WriteStream(path, options) {  
 if (!(this instanceof WriteStream))  
 return new WriteStream(path, options);  
 options = copyObject(getOptions(options, {}));

       Writable.call(this, options);

       handleError((this.path = getPathFromURL(path)));
       this.fd = options.fd === undefined ? null : options.fd;
       this.flags = options.flags === undefined ? 'w' : options.flags;
       this.mode = options.mode === undefined ? 0o666 : options.mode;
       // start position of writing this.start = options.start;
       // Whether to destroy the stream when the stream ends and triggers an error this.autoClose = options.autoClose === undefined ? true : !!options.autoClose;
       // current write position this.pos = undefined;
       // Number of bytes successfully written this.bytesWritten = 0;
       this.closed = false;

       if (this.start !== undefined) {
         if (typeof this.start !== 'number') {
           throw new errors.TypeError('ERR_INVALID_ARG_TYPE',
                                      'start',
                                      'number',
                                      this.start);
         }
         if (this.start &lt; 0) {
           const errVal = `{start: ${this.start}}`;
           throw new errors.RangeError('ERR_OUT_OF_RANGE',
                                       'start',
                                       '&gt;= 0',
                                       errVal);
         }
         // record the start position of writing this.pos = this.start;
       }

       if (options.encoding)
         this.setDefaultEncoding(options.encoding);
       // Open a new file without passing a file descriptor if (typeof this.fd !== 'number')
         this.open();

       // Listen to the finish event of the writable stream to determine whether the destruction operation needs to be performed this.once('finish', function() {
         if (this.autoClose) {
           this.destroy();
         }
       });
     }

`````

After WriteStream initializes a series of fields, it opens the file if the file path is passed, and does not need to open the file again if the file descriptor is passed. Subsequent operations on file-writable streams are operations on file descriptors. Let's first look at the logic of writing to a file. We know that the writable stream just implements some abstract logic. The specific write logic is implemented by the specific stream through _write or _writev. Let's take a look at the implementation of _write.

````js
    WriteStream.prototype._write = function(data, encoding, cb) {
      if (!(data instanceof Buffer)) {
        const err = new errors.TypeError('ERR_INVALID_ARG_TYPE',
                                         'data',
                                         'Buffer',
                                         data);
        return this.emit('error', err);
      }
      // If the file has not been opened, wait for the opening to succeed before executing the write operation if (typeof this.fd !== 'number') {
        return this.once('open', function() {
          this._write(data, encoding, cb);
        });
      }
      // Perform the write operation, 0 represents where to start writing from data, here is all writing, so it is 0, pos represents the position of the file fs.write(this.fd, data, 0, data.length, this.pos , (er, bytes) =&gt; {
        if (er) {
          if (this.autoClose) {
            this.destroy();
          }
          return cb(er);
        }
        // write successful byte length this.bytesWritten += bytes;
        cb();
      });
      //Use end or close to notify Node.js of the end of the stream. But if we set autoClose to false, then we can only call close and not end. Otherwise, file descriptor leaks will occur. Because end just closes the stream. But the logic to destroy the stream is not triggered. And close will trigger the logic of destroying the stream. Let's look at the specific code.

````js
    const fs = require('fs');
    const stream = fs.createWriteStream('123.md');
    stream.write('hello');
    // prevent the process from exiting setInterval(() =&gt; {});
`````

The above code will cause file descriptor leaks. We execute the following code under Linux, find the process id through ps aux, and then execute lsof -p pid to see all file descriptors opened by the process. The output is shown in 12-6.  
 ![](https://img-blog.csdnimg.cn/d2697f5c3b29454aa53e20fc064d17ef.png)  
 Figure 12-6

File descriptor 17 points to the 123.md file. So the file descriptor is not closed, causing a file descriptor leak. Let's modify the code.

```js
    const fs = require('fs');
    const stream = fs.createWriteStream('123.md');
    stream.end('hello');
    setInterval(() =&gt; {});
```

Below is the output of the above code, we see that there is no file descriptor corresponding to 123.md, as shown in Figure 12-7.  
 ![](https://img-blog.csdnimg.cn/da6c69dde9424e5e9897b90462eeb300.png)  
 Figure 12-7  
 We continue to modify the code ```js
const fs = require('fs');  
 const stream = fs.createWriteStream('123.md', {autoClose: false});  
 stream.end('hello');  
 setInterval(() =&gt; {});

`````
The output of the above code is shown in Figure 12-8.
 ![](https://img-blog.csdnimg.cn/459575d162e043f1a85c81797f413977.png)
Figure 12-8
We see that the file descriptor cannot be closed using end either. Continue editing.

````js
    const fs = require('fs');
    const stream = fs.createWriteStream('123.md', {autoClose: false})
    stream.close();
    setInterval(() =&gt; {});
`````

The output of the above code is shown in Figure 12-9.  
 ![](https://img-blog.csdnimg.cn/e4fbadd8aed043a49902148d8058485a.png)  
 Figure 12-9  
 We see that the file descriptor was closed successfully.
