Node.js V14 refactored the timer module. The previous version used a map with the timeout time as the key, and each key corresponds to a queue. That is, nodes with the same timeout period are in the same queue. Each queue corresponds to a node at the bottom (a node in the binary heap). Node.js will find the timeout node from the binary heap in the timer phase of the event loop, and then execute the callback. The callback will traverse the queue and judge. Which node timed out. 14 After refactoring, only one binary heap node is used. Let's take a look at its implementation, first look at the overall relationship diagram of the timer module, as shown in Figure 10-1.  
 ![](https://img-blog.csdnimg.cn/2834e17d10244f93861a062f659afa28.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA)  
 Figure 10-1

Let's take a look at several important data structures of the timer module.

## 10.1 Implementation of Libuv Libuv uses a binary heap to implement a timer. The fastest expiring node is the root node.

### 10.1.1 The data structure for maintaining timers in Libuv ```cpp

     // Take out the timer heap pointer in the loop static struct heap *timer_heap(const uv_loop_t* loop) {
       return (struct heap*) &amp;loop-&gt;timer_heap;
     }

`````

### 10.1.2 Comparison function Because Libuv uses a binary heap to implement timers, this involves the rules when nodes are inserted into the heap.

````cpp
    static int timer_less_than(const struct heap_node* ha,
                   const struct heap_node* hb) {
      const uv_timer_t* a;
      const uv_timer_t* b;
      // Find the first address of the structure through the structure members a = container_of(ha, uv_timer_t, heap_node);
      b = container_of(hb, uv_timer_t, heap_node);
      // Compare the timeouts in the two structures if (a-&gt;timeout &lt; b-&gt;timeout)
        return 1;
      if (b-&gt;timeout &lt; a-&gt;timeout)
        return 0;
      // If the timeout is the same, see who creates the first if (a-&gt;start_id &lt; b-&gt;start_id)
        return 1;
      if (b-&gt;start_id &lt; a-&gt;start_id)
        return 0;

      return 0;
    }
`````

### 10.1.3 Initializing the Timer Structure If you need to use a timer, you must first initialize the timer structure.

```cpp
    // Initialize uv_timer_t structure int uv_timer_init(uv_loop_t* loop, uv_timer_t* handle) {
      uv__handle_init(loop, (uv_handle_t*)handle, UV_TIMER);
      handle-&gt;timer_cb = NULL;
      handle-&gt;repeat = 0;
      return 0;
    }
```

### 10.1.4 Insert a timer ````cpp

     // start a timer int uv_timer_start(uv_timer_t* handle,
                        uv_timer_cb cb,
                        uint64_t timeout,
                        uint64_t repeat) {
       uint64_t clamped_timeout;

       if (cb == NULL)
         return UV_EINVAL;
       // When re-executing start, stop the previous one first if (uv__is_active(handle))
         uv_timer_stop(handle);
       // timeout, absolute value clamped_timeout = handle-&gt;loop-&gt;time + timeout;
       if (clamped_timeout &lt; timeout)
         clamped_timeout = (uint64_t) -1;
       // Initialize the callback, timeout, whether to repeat the timing, and assign an independent id
       handle-&gt;timer_cb = cb;
       handle-&gt;timeout = clamped_timeout;
       handle-&gt;repeat = repeat;
       // When the timeout time is the same, compare the position of the timer in the binary heap, see cmp function handle-&gt;start_id = handle-&gt;loop-&gt;timer_counter++;
       // Insert the min heap heap_insert(timer_heap(handle-&gt;loop),
                   (struct heap_node*) &amp;handle-&gt;heap_node,
                   timer_less_than);
       // activate the handle
       uv__handle_start(handle);

       return 0;
     }

`````

### 10.1.5 Stop a timer ````cpp
    // stop a timer int uv_timer_stop(uv_timer_t* handle) {
      if (!uv__is_active(handle))
        return 0;
      // Remove the timer node from the min heap heap_remove(timer_heap(handle-&gt;loop),
                  (struct heap_node*) &amp;handle-&gt;heap_node,
                  timer_less_than);
      // Clear the active state and the active number of handle minus one uv__handle_stop(handle);

      return 0;
    }
`````

### 10.1.6 Resetting a timer Resetting a timer is similar to inserting a timer, it first needs to remove the previous timer from the binary heap, and then reinsert it into the binary heap.

```cpp
    // To restart a timer, you need to set the repeat flag int uv_timer_again(uv_timer_t* handle) {
      if (handle-&gt;timer_cb == NULL)
        return UV_EINVAL;
      // If the repeat flag is set, the timer needs to be triggered repeatedly if (handle-&gt;repeat) {
        // First remove the old node from the min heap, and then restart a timer uv_timer_stop(handle);
        uv_timer_start(handle,
                           handle-&gt;timer_cb,
                           handle-&gt;repeat,
                           handle-&gt;repeat);
      }

      return 0;
    }
```

### 10.1.7 Calculate the minimum timeout time in the binary heap, which is mainly used to determine whether the Poll IO node is blocked for the longest time.

```cpp
    // Calculate the timeout time of the smallest node in the min heap, that is, the smallest timeout time int uv__next_timeout(const uv_loop_t* loop) {
      const struct heap_node* heap_node;
      const uv_timer_t* handle;
      uint64_t diff;
      // Take out the root node of the heap, that is, heap_node with the smallest timeout = heap_min(timer_heap(loop));
      if (heap_node == NULL)
        return -1; /* block indefinitely */

      handle = container_of(heap_node, uv_timer_t, heap_node);
      // If the minimum timeout time is less than the current time, it will return 0, indicating that it has timed out if (handle-&gt;timeout &lt;= loop-&gt;time)
        return 0;
      // Otherwise, calculate how long it will timeout and return it to epoll. The timeout of epoll cannot be greater than diff
      diff = handle-&gt;timeout - loop-&gt;time;
      if (diff &gt; INT_MAX)
        diff = INT_MAX;

      return diff;
    }
```

### 10.1.8 Processing timer The processing timeout timer is to traverse the binary heap to determine which node has timed out.

```cpp
    // Find the node that has timed out and execute the callback inside void uv__run_timers(uv_loop_t* loop) {
      struct heap_node* heap_node;
      uv_timer_t* handle;

      for (;;) {
        heap_node = heap_min(timer_heap(loop));
        if (heap_node == NULL)
          break;

        handle = container_of(heap_node, uv_timer_t, heap_node);
        // If the time of the current node is greater than the current time, it will return, indicating that the following nodes have not timed out if (handle-&gt;timeout &gt; loop-&gt;time)
          break;
        // Remove the timer node, re-insert the min heap, if repeat is set uv_timer_stop(handle);
        uv_timer_again(handle);
        // Execute timeout callback handle-&gt;timer_cb(handle);
      }
    }
```

## 10.2 Core Data Structures ### 10.2.1 TimersList

Timers with the same relative timeout will be placed in the same queue, such as the current execution of setTimeout(()=&gt;{}, 10000}) and the execution of setTimeout(()=&gt;{}, 10000}) after 5 seconds. These two Each task will be in the same List, and this queue is managed by TimersList. Corresponds to the queue of List in Figure 1.

```js
function TimersList(expiry, msecs) {
  // for linked list this._idleNext = this;
  this._idlePrev = this;
  this.expiry = expiry;
  this.id = timerListId++;
  this.msecs = msecs;
  // position in the priority queue this.priorityQueuePosition = null;
}
```

Expiry records the absolute time of the node with the fastest timeout in the linked list. Dynamically updated each time the timer stage is executed, msecs is a relative value of the timeout (relative to the current time at the time of insertion). Used to calculate whether the nodes in the linked list have timed out. Later we will see the specific use.

### 10.2.2 Priority queue ````js

     const timerListQueue = new PriorityQueue(compareTimersLists, setPosition)

`````

Node.js uses the priority queue to manage all TimersList linked lists. The priority queue is essentially a binary heap (small root heap), and each TimersList linked list corresponds to a node in the binary heap. According to the structure of TimersList, we know that each linked list holds the expiration time of the fastest expiring node in the linked list. The binary heap is based on this time, that is, the list with the fastest expiration corresponds to the root node in the binary heap. The expiration time of the root node is the fastest expiration time of the entire Node.js timer. Node.js sets the timeout time of the timer node in Libuv to this value, and the timer node will be processed in the timer stage of the event loop. , and constantly traverse the priority queue to determine whether the current node has timed out. If it times out, it needs to be processed. If there is no time out, it means that the nodes of the entire binary heap have not timed out. Then reset the new expiration time of the Libuv timer node.

In addition, Node.js uses a map to save the mapping relationship between the timeout time and the TimersList linked list. In this way, you can quickly find the corresponding list according to the relative timeout time, and use space to exchange time. After understanding the overall organization and core data structure of the timer, we can start to enter the real source code analysis.
## 10.3 Setting the timer processing function Node.js sets the timer processing function during initialization.
setupTimers(processImmediate, processTimers);
The C++ function corresponding to setupTimers is ````cpp
    void SetupTimers(const FunctionCallbackInfo &amp; args) {
      auto env = Environment::GetCurrent(args);
      env-&gt;set_immediate_callback_function(args[0].As ());
      env-&gt;set_timers_callback_function(args[1].As ());
    }
`````

SetupTimers saves two functions in env, processImmediate handles setImmediate and processTimers handles timers. When a node times out, Node.js will execute this function to process the timed out node, and you will see the specific processing logic of this function later. Let's take a look at how to set up a timer.

## 10.4 Set timer ```js

     function setTimeout(callback, after, arg1, arg2, arg3) {
       // Ignore processing parameter args logic // Create a new Timeout object constfCount();

```cpp
    function incRefCount() {
      if (refCount++ === 0)
        toggleTimerRef(true);
    }

    void ToggleTimerRef(const FunctionCallbackInfo &amp; args) {
      Environment::GetCurrent(args)-&gt;ToggleTimerRef(args[0]-&gt;IsTrue());
    }

    void Environment::ToggleTimerRef(bool ref) {
      if (started_cleanup_) return;
      // mark ref,
      if (ref) {
        uv_ref(reinterpret_cast (timer_handle()));
      } else {
        uv_unref(reinterpret_cast (timer_handle()));
      }
    }
```

We see that the uv_ref or uv_unref of Libuv will eventually be called to modify the state of the timer-related handle, because Node.js will only register a timer handle in Libuv and it is resident. If the JS layer does not currently set a timer, it needs to be Modify the state of the timer handle to unref, otherwise it will affect the exit of the event loop. The refCount value is the number of timers that record the ref state of the JS layer. So when we execute setTimeout for the first time, Node.js will activate Libuv's timer node. Then we look at insert.

```js
    let nextExpiry = Infinity;
    function insert(item, msecs, start = getLibuvNow()) {
      msecs = MathTrunc(msecs);
      // Record the start time of the timer, see the definition of the Timeout function item._idleStart = start;
      // Does the relative timeout already exist in the corresponding linked list let list = timerListMap[msecs];
      // no if (list === undefined) {
        // Calculate the absolute timeout, the first node is the earliest expired node in the list const expiry = start + msecs;
        // Create a new linked list timerListMap[msecs] = list = new TimersList(expiry, msecs);
        // Insert into the priority queue timerListQueue.insert(list);
        /*
              nextExpiry records the fastest expired node among all timeout nodes,
              If there is a faster expiration, modify the expiration time of the underlying timer node */
        if (nextExpiry &gt; expiry) {
          // Modify the timeout time of the underlying timeout node scheduleTimer(msecs);
          nextExpiry = expiry;
        }
      }
      // Add the current node to the linked list L.append(list, item);
    }
```

The main logic of Insert is as follows: 1 If there is no corresponding linked list for the timeout period, a new linked list will be created, and each linked list will record the value of the fastest expiring node in the linked list, that is, the first inserted value. Then insert the linked list into the priority queue, and the priority queue will adjust the corresponding node of the linked list to the corresponding position according to the value of the fastest expiration time of the linked list.  
 2 If the currently set timer expires sooner than all previous timers, you need to modify the underlying timer node to trigger the timeout faster.  
 3 Insert the current timer node into the tail of the corresponding linked list. That is, the node with the longest timeout in the linked list.  
 Suppose we insert a node at 0s, the following is the structure diagram when inserting the first node, as shown in Figure 10-2.
![](https://img-blog.csdnimg.cn/8088834776f84585a4d5ef050c73fbee.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG09nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_1RIRUFOQVJLSA==)

Figure 10-2

Let's take a look at the case of multiple nodes. Assume that two nodes are inserted at 0s when 10s expires and 11s expires. As shown in Figure 10-3.
![Insert image description here](https://img-blog.csdnimg.cn/0e5e072cd20f40ba9ef60780d254ca7b.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L16RIRUFF_FFQVJLSA,size_16RIRUFF_FFQVJLSA

Figure 10-3

Then at 1s, insert a new 11s expired node, and at 9s insert a new 10s expired node. Let's take a look at the relationship diagram at this time as shown in Figure 10-4.
![](https://img-blog.csdnimg.cn/d32f8c30193b4123b7cd8415caee82bc.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6FFLy9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size)

Figure 10-4

We see that in the priority queue, each node is a linked list, and the first element of the linked list corresponding to the parent node times out before the first element of the child node linked list, but the timeout of subsequent nodes in the linked list is not necessarily. For example, the node starting from the child node 1s will time out earlier than the node starting from the parent node 9s. Because of the same queue, only the relative timeout time is the same, and another important factor is the start time. Although a node has a long relative timeout, if it starts earlier than another node, it may time out before it. Later we will see how it is implemented.

## 10.5 Handling the timer Earlier we talked about setting the timer handler function and setting a timer, but where to trigger the function that handles the timer? The answer is in the scheduleTimer function. In the implementation of Node.js, all timers set in the JS layer correspond to a timer node of Libuv, and Node.js maintains the minimum timeout value of all timers in the JS layer. When setting a timer for the first time or setting a new timer, if the newly set timer is smaller than the current minimum value, the timeout time will be modified by scheduleTimer. When the timeout expires, the callback will be executed. The scheduleTimer function is a wrapper around the C++ function.

```cpp
    void ScheduleTimer(const FunctionCallbackInfo &amp; args) {
      auto env = Environment::GetCurrent(args);
      env-&gt;ScheduleTimer(args[0]-&gt;IntegerValue(env-&gt;context()).FromJust());
    }

    void Environment::ScheduleTimer(int64_t duration_ms) {
      if (started_cleanup_) return;
      uv_timer_start(timer_handle(), RunTimers, duration_ms, 0);
    }
```

uv_timer_start is to start the underlying timing, that is, insert a node into the binary heap of Libuv (if the handle already exists in the binary heap, delete it first). The timeout time is duration_ms, which is the fastest expiration time. The timeout callback is RunTimers, which will determine whether it expires in the timer stage. If so, execute the RunTimers function. Let's first look at the main code of the RunTimers function.

```cpp
    Local cb = env-&gt;timers_callback_function();
    ret = cb-&gt;Call(env-&gt;context(), process, 1, &amp;arg);
```

the active state of the device (it does not affect if it was active before),  
 2 If it is less than 0, it means that the timer does not affect the end of Libuv's event loop and is changed to an inactive state\*/  
 if (expiry_ms &gt; 0)  
 uv_ref(h);  
 else  
 uv_unref(h);  
 } else {  
 uv_unref(h);  
 }  
 }

`````

This function mainly executes the callback, and then resets the time of the Libuv timer if there are still nodes that have not timed out. Look at the JS level.

````js
     function processTimers(now) {
        nextExpiry = Infinity;
        let list;
        let ranAtLeastOneList = false;
        // Take out the root node of the priority queue, which is the fastest expiring node while (list = timerListQueue.peek()) {
          // If it has not expired, get the next expiration time and reset the timeout time if (list.expiry &gt; now) {
            nextExpiry = list.expiry;
            // Returns the next expiration time, a negative specification allows the event loop to exit return refCount &gt; 0 ? nextExpiry : -nextExpiry;
          }

             // Process timeout node listOnTimeout(list, now);
        }
            // all nodes are processed return 0;
      }

      function listOnTimeout(list, now) {
        const msecs = list.msecs;
        let ranAtLeastOneTimer = false;
        let timer;
        // Traverse the queue with uniform relative expiration time while (timer = L.peek(list)) {
          // Calculate the elapsed time const diff = now - timer._idleStart;
          // The expiration time is less than the timeout time, and it has not expired if (diff &lt; msecs) {
            /*
                        The fastest expiration time of the entire linked list node is equal to the value of the node that has not yet expired, and the linked list is ordered */
            list.expiry = MathMax(timer._idleStart + msecs,
                                            now + 1);
            // update id, used to determine the position in the priority queue list.id = timerListId++;
            /*
                     After adjusting the expiration time, the node corresponding to the current linked list is not necessarily the root node in the priority queue, it may expire sooner, that is, the node corresponding to the current linked list may need to sink*/
            timerListQueue.percolateDown(1);
            return;
          }

          // Prepare to execute the callback set by the user, delete this node L.remove(timer);

          let start;
          if (timer._repeat)
            start = getLibuvNow();
          try {
            const args = timer._timerArgs;
            // Execute the callback set by the user if (args === undefined)
              timer._onTimeout();
            else
              timer._onTimeout(...args);
          } finally {
            /*
                        The repeat execution callback is set, i.e. from setInterval.
                        You need to rejoin the list.
                    */
            if (timer._repeat &amp;&amp;
                         timer._idleTimeout !== -1) {
              // Update the timeout, the same time interval timer._idleTimeout = timer._repeat;
              // Re-insert the linked list insert(timer, timer._idleTimeout, start);
            } else if (!timer._idleNext &amp;&amp;
                                  !timer._idlePrev &amp;&amp;
                                  !timer._destroyed) {
                        timer._destroyed = true;
                        // If it is a ref type, subtract one to prevent the event loop from exiting if (timer[kRefed])
                refCount--;
        }
        // delete if empty if (list === timerListMap[msecs]) {
          delete timerListMap[msecs];
                // Remove the node from the priority queue and adjust the queue structure timerListQueue.shift();
        }
      }
`````

The above code is mainly to traverse priority queue 1. If the current node times out, traverse its corresponding linked list. When traversing the linked list, if it encounters a timeout node, it will be executed. If you encounter a node that does not time out, it means that the following nodes will not time out, because the linked list is in order, then recalculate the fastest timeout time, and modify the expiry field of the linked list. Adjust the position in the priority queue. Because the modified expiry may cause the position to change. If all the nodes of the linked list have timed out, the node corresponding to the linked list is deleted from the priority queue. The node that rescales the priority queue.  
 2 If the current node does not time out, it means that the following nodes will not time out either. Because the current node is the fastest expiring (smallest) node in the priority queue. Then set the timer time of Libuv to the time of the current node. Wait for the next timeout to be processed.
##10.6 refs and unrefs
What setTimeout returns is a Timeout object, which provides the ref and unref interfaces. I just mentioned that the timer affects the exit of the event loop. Let's take a look at this principle. Just mentioned that the Node.js timer module corresponds to only one timer node in Libuv. When Node.js is initialized, the node is initialized.

```cpp
    void Environment::InitializeLibuv(bool start_profiler_idle_notifier) ​​{
      // Initialize timer CHECK_EQ(0, uv_timer_init(event_loop(), timer_handle()));
      // Set unref state uv_unref(reinterpret_cast (timer_handle()));
    }
```
