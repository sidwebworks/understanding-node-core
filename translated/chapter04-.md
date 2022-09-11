# Chapter 4 Thread Pool Libuv is a single-threaded event-driven asynchronous IO library. For blocking or time-consuming operations, if executed in the main loop of Libuv, it will block the execution of subsequent tasks, so Libuv maintains a Thread pool, which is responsible for processing time-consuming or blocking operations in Libuv, such as file IO, DNS, and custom time-consuming tasks. The location of the thread pool in the Libuv architecture is shown in Figure 4-1.

![](https://img-blog.csdnimg.cn/20210420234827155.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t

The main thread of Libuv submits the task to the thread pool through the interface provided by the thread pool, and then immediately returns to the event loop to continue execution. The thread pool maintains a task queue, and multiple sub-threads will pick off the task node from it for execution. After the thread has completed the task, it will notify the main thread, and the main thread will execute the corresponding callback in the Poll IO stage of the event loop. Let's take a look at the implementation of the thread pool in Libuv.

## 4.1 Communication between main thread and sub-thread The communication between Libuv sub-thread and main thread is implemented using the uv_async_t structure. Libuv uses the loop-&gt;async_handles queue to record all uv_async_t structures, and uses loop-&gt;async_io_watcher as the IO watcher of all uv_async_t structures, that is, all handles on the loop-&gt;async_handles queue share the async_io_watcher IO watcher. When inserting a uv_async_t structure into the async_handle queue for the first time, the IO observer will be initialized. If an async_handle is registered again, only one node will be inserted into the loop-&gt;async_handle queue and handle queue, and an IO observer will not be added. When the task corresponding to the uv_async_t structure is completed, the child thread will set the IO observer to be readable. Libuv handles IO observers during the Poll IO phase of the event loop. Let's take a look at the use of uv_async_t in Libuv.

### 4.1.1 Initialization Before using uv_async_t, you need to execute uv_async_init for initialization.

```cpp
    int uv_async_init(uv_loop_t* loop,
                       uv_async_t* handle,
                       uv_async_cb async_cb) {
      int err;
      // Register an observer io with Libuv
      err = uv__async_start(loop);
      if (err)
        return err;
      // Set relevant fields and insert a handle to Libuv
      uv__handle_init(loop, (uv_handle_t*)handle, UV_ASYNC);
        // set callback handle-&gt;async_cb = async_cb;
        // Initialize the flag field, 0 means no task is completed handle-&gt;pending = 0;
      // Insert uv_async_t into the async_handle queue QUEUE_INSERT_TAIL(&amp;loop-&gt;async_handles, &amp;handle-&gt;queue);
      uv__handle_start(handle);
      return 0;
    }
```

The uv_async_init function mainly initializes some fields of the structure uv_async_t, and then executes QUEUE_INSERT_TAIL to add a node to Libuv's async_handles queue. We see that there is also a uv**async_start function. Let's look at the implementation of uv**async_start.

```cpp
    static int uv__async_start(uv_loop_t* loop) {
      int pipefd[2];
      int err;
      // uv__async_start is executed only once, if there is fd, it is not necessary to execute if (loop-&gt;async_io_watcher.fd != -1)
        return 0;
      // Get an fd for inter-process communication (Linux's eventfd mechanism)
      err = uv__async_eventfd();
      /*
         If it succeeds, save the fd. If it fails, it means that eventfd is not supported.
          Then use pipe communication as inter-process communication */
      if (err &gt;= 0) {
        pipefd[0] = err;
        pipefd[1] = -1;
      }
      else if (err == UV_ENOSYS) {
        // If eventfd is not supported, use anonymous pipe err = uv__make_pipe(pipefd, UV__F_NONBLOCK);
    #if defined(__Linux__)
        if (err == 0) {
          char buf[32];
          int fd;
          snprintf(buf, sizeof(buf), "/proc/self/fd/%d", pipefd[0]); // Reading and writing to pipes can be achieved through a fd, advanced usage fd = uv__open_cloexec(buf, O_RDWR );
          if (fd &gt;= 0) {
            // close the old uv__close(pipefd[0]);
            uv__close(pipefd[1]);// assign new pipefd[0] = fd;
            pipefd[1] = fd;
          }
        }
    #endif
      }
      // err greater than or equal to 0 means that the read and write ends of the communication are obtained if (err &lt; 0)
        return err;
      /*
          Initialize IO watcher async_io_watcher,
          Save the read file descriptor to the IO observer */
      uv__io_init(&amp;loop-&gt;async_io_watcher, uv__async_io, pipefd[0]);
      // Register the IO watcher in the loop, and register the interested event POLLIN, waiting for the read uv__io_start(loop, &amp;loop-&gt;async_io_watcher, POLLIN);
        // Save the write file descriptor loop-&gt;async_wfd = pipefd[1];
      return 0;
    }
```

uv_async_start will only be executed once, and the timing is when uv_async_init is executed for the first time. The main logic of uv**async_start is as follows: 1 Obtain the communication descriptor (generate a communication fd through eventfd (acting as both read and write ends) or the pipeline generates two fds for inter-thread communication representing the read end and the write end).
2 Encapsulate interesting events and callbacks to IO observers and then append them to the watcher_queue queue. In the Poll IO stage, Libuv will be registered in epoll. If there are tasks completed, the callback will also be executed in the Poll IO stage.
3 Save the write side descriptor. When the task is completed, the main thread is notified through the write-side fd.
We see that there is a lot of logic in the uv**async_start function to obtain the communication file descriptor. In general, it is to complete the function of communication between the two ends. After initializing the async structure, the Libuv structure is shown in Figure 4-2.

![](https://img-blog.csdnimg.cn/20210420234949238.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t

### 4.1.2 After informing the main thread to initialize the async structure, if the task corresponding to the async structure is completed, the main thread will be notified, and the sub-thread will mark the task completion by setting the pending of the handle to 1, and then write to the pipeline The terminal writes a flag to notify the main thread that a task has been completed.

```cpp
    int uv_async_send(uv_async_t* handle) {
      /* Do a cheap read first. */
      if (ACCESS_ONCE(int, handle-&gt;pending) != 0)
        return 0;
      /*
          If pending is 0, set it to 1, return 0, if it is 1, return 1,
          So if the function is called multiple times, it will be merged */
      if (cmpxchgi(&amp;handle-&gt;pending, 0, 1) == 0)
        uv__async_send(handle-&gt;loop);
      return 0;
    }

    static void uv__async_send(uv_loop_t* loop) {
      const void* buf;
      ssize_t len;
      int fd;
      int r;

      buf = "";
      len = 1;
      fd = loop-&gt;async_wfd;

    #if defined(__Linux__)
      // Indicates that eventfd is used instead of a pipe, and the read and write ends of eventfd correspond to the same fd
      if (fd == -1) {
        static const uint64_t val = 1;
        buf = &amp;val;
        len = sizeof(val);
        // see uv__async_start
        fd = loop-&gt;async_io_watcher.fd; /* eventfd */
      }
    #endif
      // notify the read end do
        r = write(fd, buf, len);
      while (r == -1 &amp;&amp; errno == EINTR);

      if (r == len)
        return;

      if (r == -1)
        if (errno == EAGAIN || errno == EWOULDBLOCK)
          return;

      abort();
    }
```

uv_async_send first gets the fd corresponding to the write end, and then calls the write function. At this time, data is written to the write end of the pipeline, and the task is marked as complete. Where there is writing, there must be reading. The logic for reading is implemented in uv**io_poll. The uv**io_poll function is the function executed in the Poll IO stage in Libuv. In uv**io_poll, the pipeline will be found to be readable, and then the corresponding callback uv**async_io will be executed.

### 4.1.3 Main thread processing callback ````cpp

     static void uv__async_io(uv_loop_t* loop,
                                uv__io_t* w,
                                unsigned int events) {
       char buf[1024];
       ssize_tr;
       QUEUE queue;
       QUEUE* q;
       uv_async_t* h;

       for (;;) {
         // consume all data r = read(w-&gt;fd, buf, sizeof(buf));
             // If the data size is greater than the buf length (1024), continue to consume if (r == sizeof(buf))
           continue;
             // After successful consumption, jump out of the logic of consumption if (r != -1)
           break;
             // read busy if (errno == EAGAIN || errno == EWOULDBLOCK)
           break;
             // read is interrupted, continue reading if (errno == EINTR)
           continue;
         abort();
       }
       // Move all nodes in the async_handles queue to the queue variable QUEUE_MOVE(&amp;loop-&gt;async_handles, &amp;queue);
       while (!QUEUE_EMPTY(&amp;queue)) {
         // Take out nodes one by one q = QUEUE_HEAD(&amp;queue);
         // Get the first address of the structure according to the structure field h = QUEUE_DATA(q, uv_async_t, queue);
         // remove the node from the queue QUEUE_REMOVE(q);
         // Reinsert the async_handles queue and wait for the next event QUEUE_INSERT_TAIL(&amp;loop-&gt;async_handles, q);
         /*
          Compare the first parameter with the second parameter, if equal,
          Then write the third parameter to the first parameter, return the value of the second parameter,
          If not equal, return the value of the first argument.
         */
         /*
               Determine which async is triggered. pending is set to 1 in uv_async_send,
               If pending is equal to 1, clear 0 and return 1. If pending is equal to 0, return 0
             */
         if (cmpxchgi(&amp;h-&gt;pending, 1, 0) ==Task. Later we will analyze the logic of the worker.

### 4.2.2 Submitting tasks to the thread pool After understanding the initialization of the thread pool, let's take a look at how to submit tasks to the thread pool ````cpp

     // Submit a task to the thread pool void uv__work_submit(uv_loop_t* loop,
                struct uv__work* w,
                enum uv__work_kind kind,
                void (*work)(struct uv__work* w),
                void (*done)(struct uv__work* w, int status)){
        /*
          It is guaranteed that the thread has been initialized and executed only once, so the thread pool is only initialized when the first task is submitted, init_once -&gt; init_threads
         */
       uv_once(&amp;once, init_once);
       w-&gt;loop = loop;
       w-&gt;work = work;
       w-&gt;done = done;
       post(&amp;w-&gt;wq, kind);
     }

`````

Here, the business-related functions and the callback function after the task is completed are encapsulated into the uv__work structure. The uv__work structure is defined as follows.

````cpp
    struct uv__work {
      void (*work)(struct uv__work *w);
      void (*done)(struct uv__work *w, int status);
      struct uv_loop_s* loop;
      void* wq[2];
    };
`````

Then call the post function to add a new task to the queue of the thread pool. Libuv divides tasks into three types, slow IO (DNS resolution), fast IO (file operations), CPU-intensive, etc. Kind is the type of task. Let's look at the post function next.

```cpp
    static void post(QUEUE* q, enum uv__work_kind kind) {
      // Lock access to the task queue, because this queue is shared by the thread pool uv_mutex_lock(&amp;mutex);
      // type is slow IO
      if (kind == UV__WORK_SLOW_IO) {
        /*
        Insert the queue corresponding to slow IO. This version of Libuv divides tasks into several types.
       For tasks of slow IO type, Libuv inserts a special node run_slow_work_message into the task queue, and then uses slow_io_pending_wq to maintain a slow IO
          The queue of tasks, when the node run_slow_work_message is processed,
          Libuv will take out task nodes one by one from the slow_io_pending_wq queue for execution.
        */
        QUEUE_INSERT_TAIL(&amp;slow_io_pending_wq, q);
        /*
          When there is a slow IO task, you need to insert a message node run_slow_work_message into the main queue wq, indicating that there is a slow IO task, so if run_slow_work_message is empty, it means that the main queue has not been inserted. q = &amp;run_slow_work_message; needs to be assigned, and then run_slow_work_message is inserted into the main queue. if run_slow_work_message
              If it is not empty, it means that it has been inserted into the task queue of the thread pool. Unlock and go straight back.
        */
        if (!QUEUE_EMPTY(&amp;run_slow_work_message)) {
          uv_mutex_unlock(&amp;mutex);
          return;
            }
            // Indicates that run_slow_work_message has not been inserted into the queue, ready to be inserted into the queue q = &amp;run_slow_work_message;
      }
      // Insert the node into the main queue, which may be a slow IO message node or a general task QUEUE_INSERT_TAIL(&amp;wq, q);
      /*
         Wake it up when there is an idle thread, if everyone is busy,
          Then wait until it is busy and then re-determine whether there are new tasks */
      if (idle_threads &gt; 0)
        uv_cond_signal(&amp;cond);
        // After operating the queue, unlock uv_mutex_unlock(&amp;mutex);
    }
```

This is the producer logic of the thread pool in Libuv. The architecture of the task queue is shown in Figure 4-3.

![](https://img-blog.csdnimg.cn/20210420235058824.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t

In addition to the above mentioned, Libuv also provides another way to produce tasks, the uv_queue_work function, which only submits CPU-intensive tasks (used in Node.js's crypto module). Let's look at the implementation of uv_queue_work.

```cpp
    int uv_queue_work(uv_loop_t* loop,
                      uv_work_t* req,
                      uv_work_cb work_cb,
                      uv_after_work_cb after_work_cb) {
      if (work_cb == NULL)
        return UV_EINVAL;

      uv__req_init(loop, req, UV_WORK);
      req-&gt;loop = loop;
      req-&gt;work_cb = work_cb;
      req-&gt;after_work_cb = after_work_cb;
      uv__work_submit(loop,
              &amp;req-&gt;work_req,
              UV__WORK_CPU,
              uv__queue_work,
              uv__queue_done);
      return 0;
    }
```

The uv_queue_work function actually doesn't have much logic. It saves the user's work function and calls it back into the request. Then encapsulate uv**queue_work and uv**queue_done into uv**work, and then submit tasks to the thread pool. So when this task is executed. It will execute the work function uv**queue_work.

```cpp
    static void uv__queue_work(struct uv__work* w) {
      // Get the structure address through a field of the structure uv_work_t* req = container_of(w, uv_work_t, work_req);
      req-&gt;work_cb(req);
    }
```

We see that uv**queue_work actually encapsulates user-defined task functions. At this time, we can guess that uv**queue_done is just a simple encapsulation of the user's callback, that is, it will execute the user's callback.

### 4.2.3 Processing tasks After we submit the task, the thread must be processed naturally. When we initialized the thread pool, we analyzed that the worker function is responsible for processing the task. Let's take a look at the logic of the worker function.

```cpp
    static void worker(void* arg) {
      struct uv__work* w;
      QUEUE* q;
      int is_slow_work;
      // Thread started successfully uv_sem_post((uv_sem_t*) arg);
      arg = NULL;
      // lock mutex access task queue uv_mutex_lock(&amp;mutex);
      for (;;) {
       Manage slow IO tasks is_slow_work = 1;
          /*
                  The number of slow IO tasks being processed is accumulated, which is used by other threads to judge whether the number of slow IO tasks reaches the threshold. slow_io_work_running is a variable shared by multiple threads*/
          slow_io_work_running++;
          // Take off a slow IO task q = QUEUE_HEAD(&amp;slow_io_pending_wq);
                // remove QUEUE_REMOVE(q) from slow IO queue;
          QUEUE_INIT(q);
          /*
              After taking out a task, if there is still a slow IO task, the slow IO marked node will be re-queued, indicating that there is still a slow IO task, because the marked node is dequeued above */
          if (!QUEUE_EMPTY(&amp;slow_io_pending_wq)) {
            QUEUE_INSERT_TAIL(&amp;wq, &amp;run_slow_work_message);
            // wake it up if there is an idle thread, because there are still tasks to process if (idle_threads &gt; 0)
              uv_cond_signal(&amp;cond);
          }
        }
        // No need to operate the queue, release the lock as soon as possible uv_mutex_unlock(&amp;mutex);
        // q is slow IO or general task w = QUEUE_DATA(q, struct uv__work, wq);
        // The task function for executing the business, which generally blocks w-&gt;work(w);
        // Prepare the task completion queue for operating loop, lock uv_mutex_lock(&amp;w-&gt;loop-&gt;wq_mutex);
            // Blanking indicates that the execution is complete, see cancel logic w-&gt;work = NULL;
        /*
              After executing the task, insert it into the wq queue of the loop, and execute the node of the queue when uv__work_done */
        QUEUE_INSERT_TAIL(&amp;w-&gt;loop-&gt;wq, &amp;w-&gt;wq);
        // Notify loop's wq_async node uv_async_send(&amp;w-&gt;loop-&gt;wq_async);
            uv_mutex_unlock(&amp;w-&gt;loop-&gt;wq_mutex);
            // Lock the next round of operation task queue uv_mutex_lock(&amp;mutex);
        /*
              After executing the slow IO task, record the number of slow IOs being executed and decrease the variable by 1.
              The above lock ensures exclusive access to this variable */
        if (is_slow_work) {
          slow_io_work_running--;
        }
      }
    }
```

We see that the logic of consumers seems to be more complicated. For tasks of slow IO type, Libuv limits the number of threads that process slow IO tasks, so as to avoid tasks that take less time from being processed. The rest of the logic is similar to the general thread pool, that is, mutual exclusive access to the task queue, then take out the node for execution, and notify the main thread after execution. The structure is shown in Figure 4-4.

![](https://img-blog.csdnimg.cn/20210420235148855.png)

### 4.2.4 Notify the main thread that after the thread has completed the task, it will not directly execute the user callback, but notify the main thread, which will be processed uniformly by the main thread. For the complex problems caused by threads, let's take a look at the logic of this piece. Everything starts from the initialization of Libuv ```cpp

uv_default_loop();-&gt;uv_loop_init();-&gt;uv_async_init(loop, &amp;loop-&gt;wq_async, uv\_\_work_done);

`````

We have just analyzed the communication mechanism between the main thread and the sub-thread. wq_async is the async handle used for the communication between the sub-thread and the main thread in the thread pool, and its corresponding callback is uv__work_done. So when the thread task of a thread pool is completed, set loop-&gt;wq_async.pending = 1 through uv_async_send(&amp;w-&gt;loop-&gt;wq_async), and then notify the IO observer, Libuv will execute the corresponding handle in the Poll IO stage Call back the uv__work_done function. So let's look at the logic of this function.

````cpp
    void uv__work_done(uv_async_t* handle) {
      struct uv__work* w;
      uv_loop_t* loop;
      QUEUE* q;
      QUEUE wq;
      int err;
      // Get the first address of the structure through the structure field loop = container_of(handle, uv_loop_t, wq_async);
      // Prepare to process the queue, lock uv_mutex_lock(&amp;loop-&gt;wq_mutex);
      /*
        loop-&gt;wq is the completed task queue. Move all the nodes of the loop-&gt;wq queue to the wp variable, so that the lock can be released as soon as possible*/
      QUEUE_MOVE(&amp;loop-&gt;wq, &amp;wq);
      // No need to use, unlock uv_mutex_unlock(&amp;loop-&gt;wq_mutex);
      // The node of the wq queue is inserted from the child thread while (!QUEUE_EMPTY(&amp;wq)) {
        q = QUEUE_HEAD(&amp;wq);
        QUEUE_REMOVE(q);
        w = container_of(q, struct uv__work, wq);
            // equal to uv__canceled means the task has been cancelled err = (w-&gt;work == uv__cancelled) ? UV_ECANCELED : 0;
        // Execute the callback w-&gt;done(w, err);
      }
    }
`````

The logic of this function is relatively simple. It processes the completed task nodes one by one and executes the callback. In Node.js, the callback here is the C++ layer, and then to the JS layer. The structure diagram is shown in Figure 4-5.

![](https://img-blog.csdnimg.cn/20210420235212281.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t

### 4.2.5 Cancellation of tasks In the design of the thread pool, canceling tasks is a relatively important capability, because some time-consuming or blocking operations are performed in threads. If a task can be canceled in time, it will reduce the A lot of unnecessary processing. However, in the Libuv implementation, the task can only be canceled when the task is still in the waiting queue. If a task is being processed by a thread, it cannot be canceled. Let's first look at how Libuv implements cancellation tasks. Libuv provides the uv\_\_work_cancel function to support the user to cancel the submitted task. Let's look at its logic.

```cpp
    static int uv__work_cancel(uv_loop_t* loop, uv_req_t* req, struct uv__work* w) {
      int cancelled;
      // lock, in order to remove the node from the queue uv_mutex_lock(&amp;mutex);
      // lock, in order to determine whether w-&gt;wq is empty uv_mutex_lock(&amp;w-&gt;loop-&gt;wq_mutex);
      /*
        cancelled is true, indicating that the task is still in the thread pool queue waiting to be processed 1. After processing, w-&gt;work == NULL
          2 During processing, QUEUE_EMPTY(&amp;w-&gt;wq) is true, because
```
