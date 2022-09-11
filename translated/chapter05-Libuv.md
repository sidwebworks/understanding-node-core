# Chapter 5 The implementation of Libuv stream occupies a lot of space in Libuv and is a very core logic. The essence of a stream is to encapsulate operations on file descriptors, such as reading, writing, connecting, and listening. Let's first look at the data structure. The stream is represented by uv_stream_s in Libuv, which is inherited from uv_handle_s.

```cpp
	 struct uv_stream_s {
        // Field void* data of uv_handle_s;
        // belongs to the event loop uv_loop_t* loop;
        // handle type uv_handle_type type;
        // Callback when the handle is closed uv_close_cb close_cb;
        // handle queue for inserting event loop void* handle_queue[2];
        union {
            int fd;
            void* reserved[4];
        } u;
        // used to insert the closing phase of the event loop uv_handle_t* next_closing;
        // various flags unsigned int flags;
        // stream extended fields/*
            the size in bytes the user writes to the stream, the stream buffers the user's input,
            Then wait until it is writable to perform the real write */
        size_t write_queue_size;
        // The function of allocating memory, the memory is defined by the user, used to save the read data uv_alloc_cb alloc_cb;
        // read callback uv_read_cb read_cb;
        // The structure corresponding to the connection request uv_connect_t *connect_req;
        /*
            When the write end is closed, the cached data is sent,
            Execute the callback of shutdown_req (shutdown_req is assigned when uv_shutdown)
            */
        uv_shutdown_t *shutdown_req;
        /*
            The IO observer corresponding to the stream */
        uv__io_t io_watcher;
        // Cache the data to be written, this field is used to insert the queue void* write_queue[2];
        // The queue to which data writing has been completed, this field is used to insert the queue void* write_completed_queue[2];
        // After a connection arrives and the three-way handshake is completed, the callback uv_connection_cb connection_cb is executed;
        // Error code when operating stream int delayed_error;
        // The file description corresponding to the communication socket returned by accept int accepted_fd;
        // Same as above, when used for IPC, cache multiple passed file descriptors void* queued_fds;
	 }
```

In the implementation of the stream, the core field is the IO observer, and the rest of the fields are related to the nature of the stream. The IO observer encapsulates the file descriptor corresponding to the stream and the callback when the file descriptor event is triggered. For example, read a stream, write a stream, close a stream, connect a stream, listen to a stream, there are corresponding fields in uv_stream_s to support. But it is essentially driven by IO observers.

1 To read a stream, that is, when the readable event of the file descriptor in the IO observer is triggered, the user's read callback is executed.
2 Write a stream, first write the data to the stream, wait until the file descriptor writable event in the IO observer is triggered, execute the real write, and execute the user's write end callback.
3 To close a stream, that is, when the file descriptor writable event in the IO observer is triggered, the write end of the closed stream will be executed. If there is still data in the stream that has not been written, it will be written (such as sending) before the close operation is performed, and then the user's callback will be executed.
4 Connection streams, such as connecting to a server as a client. That is, when the file descriptor readable event in the IO observer is triggered (for example, the establishment of the three-way handshake is successful), the user's callback is executed.
5 Listening to the stream, that is, when the file descriptor readable event in the IO observer is triggered (for example, there is a connection that completes the three-way handshake), the user's callback is executed.

Let's take a look at the specific implementation of the stream ## 5.1 Initializing the stream Before using uv_stream_t, it needs to be initialized first. Let's take a look at how to initialize a stream.

```cpp
	 void uv__stream_init(uv_loop_t* loop,
	                       uv_stream_t* stream,
	                       uv_handle_type type) {
        int err;
        // Record the type of handle uv__handle_init(loop, (uv_handle_t*)stream, type);
        stream-&gt;read_cb = NULL;
        stream-&gt;alloc_cb = NULL;
        stream-&gt;close_cb = NULL;
        stream-&gt;connection_cb = NULL;
        stream-&gt;connect_req = NULL;
        stream-&gt;shutdown_req = NULL;
        stream-&gt;accepted_fd = -1;
        stream-&gt;queued_fds = NULL;
        stream-&gt;delayed_error = 0;
        QUEUE_INIT(&amp;stream-&gt;write_queue);
        QUEUE_INIT(&amp;stream-&gt;write_completed_queue);
        stream-&gt;write_queue_size = 0;
        /*
            Initialize the IO watcher, record the file descriptor (there is none here, so it is -1) and the callback uv_stream_io on the io_watcher. When the fd event is triggered, it will be handled by the uv_stream_io function, but there are also special cases (will be discussed below). )
            */
        uv__io_init(&amp;stream-&gt;io_watcher, uv__stream_io, -1);
	 }
```

The logic of initializing a stream is very simple and clear, which is to initialize the relevant fields. It should be noted that when initializing the IO observer, the set processing function is uv\_\_stream_io, and we will analyze the specific logic of this function later.

## 5.2 Open stream ````cpp

     int uv__stream_open(uv_stream_t* stream, int fd, int flags) {
         // If the fd has not been set or the same fd is set, continue, otherwise return UV_EBUSY
         if (!(stream-&gt;io_watcher.fd == -1 ||
                 stream-&gt;io_watcher.fd == fd))
             return UV_EBUSY;
         // Set the flags of the stream stream-&gt;flags |= flags;
         // If it is a TCP stream, you can set the following properties if (stream-&gt;type == UV_TCP) {
         // Turn off the nagle algorithm if ((stream-&gt;flags &amp; UV_HANDLE_TCP_NODELAY) &amp;&amp;
                 uv__tcp_nodelay(fd, 1))
         return UV__ERR(errno);
         /*
             Enable keepalive mechanism*/
         if ((stream-&gt;flags &amp; UV_HANDLE_TCP_KEEPALIVE) &amp;&amp;
         uv__tcp_keepalive(fd, 1, 60)) {
         return UV__ERR(errno);
         }
         }
         /*
         Save the file descriptor corresponding to the socket to the IO observer, and Libuv will monitor the file descriptor in the Poll IO stage */
         stream-&gt;io_watcher.fd = fd;
         return 0;
     }

`````

Opening a stream is essentially associating a file descriptor with the stream. Subsequent operations are based on this file descriptor, as well as some attribute settings.
## 5.3 Reading Streams After we execute uv_read_start on a stream, the stream's data (if any) will flow continuously to the caller through the read_cb callback.

````cpp
	 int uv_read_start(uv_stream_t* stream,
	                    uv_alloc_cb alloc_cb,
	                    uv_read_cb read_cb) {
        // stream is closed, can't read if (stream-&gt;flags &amp; UV_HANDLE_CLOSING)
            return UV_EINVAL;
        // The stream is unreadable, indicating that it may be a write-only stream if (!(stream-&gt;flags &amp; UV_HANDLE_READABLE))
            return -ENOTCONN;
        // Flag reading stream-&gt;flags |= UV_HANDLE_READING;
        // Record the read callback, this callback will be executed when there is data stream-&gt;read_cb = read_cb;
        // Allocating memory function to store read data stream-&gt;alloc_cb = alloc_cb;
        // Register waiting for read event uv__io_start(stream-&gt;loop, &amp;stream-&gt;io_watcher, POLLIN);
        // Activate handle, if there is an activated handle, the event loop will not exit uv__handle_start(stream);
        return 0;
	 }
`````

Executing uv_read_start essentially registers a waiting read event in epoll for the file descriptor corresponding to the stream, and records the corresponding context, such as the read callback function and the function of allocating memory. Then mark it as doing a read operation. When the read event is triggered, the read callback will be executed. In addition to reading data, there is also a read operation that stops reading. The corresponding function is uv_read_stop.

```cpp
	 int uv_read_stop(uv_stream_t* stream) {
        // Whether a read operation is being performed, if not, there is no need to stop if (!(stream-&gt;flags &amp; UV_HANDLE_READING))
            return 0;
        // Clear the flags being read stream-&gt;flags &amp;= ~UV_HANDLE_READING;
        // Cancel waiting for read event uv__io_stop(stream-&gt;loop, &amp;stream-&gt;io_watcher, POLLIN);
        // Not interested in writing events, stop handle. Allow event loop to exit if (!uv__io_active(&amp;stream-&gt;io_watcher, POLLOUT))
            uv__handle_stop(stream);
        stream-&gt;read_cb = NULL;
        stream-&gt;alloc_cb = NULL;
        return 0;
	 }
```

There is also a helper function that determines whether the stream has the readable property set.

```cpp
	 int uv_is_readable(const uv_stream_t* stream) {
	   return !!(stream-&gt;flags &amp; UV_HANDLE_READABLE);
	 }
```

The above function just registers and deregisters the read event. If the read event is triggered, we also need to read the data ourselves. Let's take a look at the real read logic ```cpp
static void uv**read(uv_stream_t\* stream) {  
 uv_buf_t buf;  
 ssize_t nread;  
 struct msghdr msg;  
 char cmsg_space[CMSG_SPACE(UV**CMSG_FD_SIZE)];  
 int count;  
 int err;  
 int is_ipc;  
 // clear read part flag stream-&gt;flags &amp;= ~UV_STREAM_READ_PARTIAL;  
 count = 32;  
 /_
Streams are Unix domain types and are used for IPC, Unix domains are not necessarily used for IPC,
Used as IPC to support passing file descriptors _/
is_ipc = stream-&gt;type == UV_NAMED_PIPE &amp;&amp;  
 ((uv_pipe_t\*)//img-blog.csdnimg.cn/20210420235737186.png)

Let's take a look at the structure after fork as shown in Figure 5-2.

![](https://img-blog.csdnimg.cn/20210420235751592.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t

If the parent process or the child process creates a new file descriptor after fork, the parent and child processes cannot share it. Suppose the parent process wants to pass a file descriptor to the child process, what should we do? According to the relationship between process and file descriptor. The thing to do when passing the file descriptor is not only to create a new fd in the child process, but also to establish the association of fd-&gt;file-&gt;inode, but we don't need to pay attention to these, because the operating system handles it for us, We just need to send the file descriptor we want to pass to the other end of the Unix domain via sendmsg. The other end of the Unix domain can then read the file descriptor from the data via recvmsg. Then use the uv\_\_stream_recv_cmsg function to save the file descriptor parsed from the data.

```cpp
	 static int uv__stream_recv_cmsg(uv_stream_t* stream,
	                                    struct msghdr* msg) {
	   struct cmsghdr* cmsg;
	   // iterate over msg
	   for (cmsg = CMSG_FIRSTHDR(msg);
	         cmsg != NULL;
	         cmsg = CMSG_NXTHDR(msg, cmsg)) {
	      char* start;
	      char* end;
	     int err;
	     void* pv;
	     int* pi;
	     unsigned int i;
	     unsigned int count;

	     pv = CMSG_DATA(cmsg);
	     pi = pv;
	     start = (char*) cmsg;
	     end = (char*) cmsg + cmsg-&gt;cmsg_len;
	     count = 0;
	     while (start + CMSG_LEN(count * sizeof(*pi)) &lt; end)
	       count++;
	     for (i = 0; i &lt; count; i++) {
	       /*
	         accepted_fd represents the currently pending file descriptor,
	         If there is already a value, the remaining descriptors are queued through uv__stream_queue_fd If there is no value, it will be assigned first */
	       if (stream-&gt;accepted_fd != -1) {
	         err = uv__stream_queue_fd(stream, pi[i]);
	       } else {
	         stream-&gt;accepted_fd = pi[i];
	       }
	     }
	   }

	   return 0;
	 }
```

uv**stream_recv_cmsg will parse out the file descriptors from the data and store them in the stream. The first file descriptor is stored in accepted_fd, and the rest are processed by uv**stream_queue_fd.

```cpp
	 struct uv__stream_queued_fds_s {
	   unsigned int size;
	   unsigned int offset;
	   int fds[1];
	 };

	 static int uv__stream_queue_fd(uv_stream_t* stream, int fd) {
	   uv__stream_queued_fds_t* queued_fds;
	   unsigned int queue_size;
	   // original memory queued_fds = stream-&gt;queued_fds;
	   // no memory, allocate if (queued_fds == NULL) {
	     // default 8 queue_size = 8;
	     /*
	       One metadata memory + multiple fd memory (prefixed with * represents the memory size occupied by the type of the dereferenced value,
	       Minus one because uv__stream_queued_fds_t
	       The struct itself has a space)
	     */
	     queued_fds = uv__malloc((queue_size - 1) *
	                                sizeof(*queued_fds-&gt;fds) +
	                             sizeof(*queued_fds));
	     if (queued_fds == NULL)
	       return UV_ENOMEM;
	     // Capacity queued_fds-&gt;size = queue_size;
	     // The number of used queued_fds-&gt;offset = 0;
	     // Point to available memory stream-&gt;queued_fds = queued_fds;
	   // The previous memory is used up, expand the capacity } else if (queued_fds-&gt;size == queued_fds-&gt;offset) {
	     // Add 8 each time queue_size = queued_fds-&gt;size + 8;
	     queued_fds = uv__realloc(queued_fds,
	                              (queue_size - 1) * sizeof(*queued_fds-&gt;fds) + sizeof(*queued_fds));

	     if (queued_fds == NULL)
	       return UV_ENOMEM;
	     // Update capacity size queued_fds-&gt;size = queue_size;
	     // save new memory stream-&gt;queued_fds = queued_fds;
	   }

	   /* Put fd in a queue */
	   // save fd
	   queued_fds-&gt;fds[queued_fds-&gt;offset++] = fd;

	   return 0;
	 }
```

The memory structure is shown in Figure 5-3.

![](https://img-blog.csdnimg.cn/20210420235824605.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_16,color_FFFFFF,t

Finally, let's look at the processing after reading,

```cpp
	 static void uv__stream_eof(uv_stream_t* stream,
	                              const uv_buf_t* buf) {
	   // Mark the read end stream-&gt;flags |= UV_STREAM_READ_EOF;
	   // Log out waiting for readable events uv__io_stop(stream-&gt;loop, &amp;stream-&gt;io_watcher, POLLIN);
	   // If there is no registration to wait for a writable event, stop the handle, otherwise it will affect the exit of the event loop if (!uv__io_active(&amp;stream-&gt;io_watcher, POLLOUT))
	     uv__handle_stop(stream);
	   uv__stream_osx_interrupt_select(stream);
	   // Execute read callback stream-&gt;read_cb(stream, UV_EOF, buf);
	   // clear reading flag stream-&gt;flags &amp;= ~UV_STREAM_READING;
	 }
```

We see that when the stream ends, first log out and wait for a readable event, and then notify the upper layer through a callback.

## 5.4 Write stream We can write data to the stream by executing uv_write on the stream.

```cpp
	 int uv_write(
	         /*
	              return;
	   q = QUEUE_HEAD(&amp;stream-&gt;write_queue);
	   req = QUEUE_DATA(q, uv_write_t, queue);
	   // where to start writing iov = (struct iovec*) &amp;(req-&gt;bufs[req-&gt;write_index]);
	   // How many are left unwritten iovcnt = req-&gt;nbufs - req-&gt;write_index;
	   // how many iovmax can write = uv__getiovmax();
	   // take the minimum value if (iovcnt &gt; iovmax)
	     iovcnt = iovmax;
	   // Need to pass file descriptor if (req-&gt;send_handle) {
	     int fd_to_send;
	     struct msghdr msg;
	     struct cmsghdr *cmsg;
	     union {
	       char data[64];
	       struct cmsghdr alias;
	     } scratch;

	     if (uv__is_closing(req-&gt;send_handle)) {
	       err = -EBADF;
	       goto error;
	     }
	     // File descriptor to be sent fd_to_send = uv__handle_fd((uv_handle_t*) req-&gt;send_handle);
	     memset(&amp;scratch, 0, sizeof(scratch));

	     msg.msg_name = NULL;
	     msg.msg_namelen = 0;
	     msg.msg_iov = iov;
	     msg.msg_iovlen = iovcnt;
	     msg.msg_flags = 0;

	     msg.msg_control = &amp;scratch.alias;
	     msg.msg_controllen = CMSG_SPACE(sizeof(fd_to_send));

	     cmsg = CMSG_FIRSTHDR(&amp;msg);
	     cmsg-&gt;cmsg_level = SOL_SOCKET;
	     cmsg-&gt;cmsg_type = SCM_RIGHTS;
	     cmsg-&gt;cmsg_len = CMSG_LEN(sizeof(fd_to_send));

	     {
	       void* pv = CMSG_DATA(cmsg);
	       int* pi = pv;
	       *pi = fd_to_send;
	     }

	     do {
	       // Send the file descriptor using the sendmsg function n = sendmsg(uv__stream_fd(stream), &amp;msg, 0);
	     }
	     while (n == -1 &amp;&amp; errno == EINTR);
	   } else {
	     do {
	       // write one or write batches if (iovcnt == 1) {
	         n = write(uv__stream_fd(stream),
	                             iov[0].iov_base,
	                             iov[0].iov_len);
	       } else {
	         n = writev(uv__stream_fd(stream), iov, iovcnt);
	       }
	     }
	     while (n == -1 &amp;&amp; errno == EINTR);
	   }
	   // write failed if (n &lt; 0) {
	     /*
	         If it is not busy writing, an error will be reported.
	          else if the synchronous write flag is set, keep trying to write */
	     if (errno != EAGAIN &amp;&amp;
	              errno != EWOULDBLOCK &amp;&amp;
	              errno != ENOBUFS) {
	       err = -errno;
	       goto error;
	     } else if (stream-&gt;flags &amp; UV_STREAM_BLOCKING) {
	       /* If this is a blocking stream, try again. */
	       goto start;
	     }
	   } else {
	     // write successfully while (n &gt;= 0) {
	       // Current buf first address uv_buf_t* buf = &amp;(req-&gt;bufs[req-&gt;write_index]);
	       // The data length of the current buf size_t len ​​= buf-&gt;len;
	       // Less than that means the current buf has not been written yet (has not been consumed)
	       if ((size_t)n &lt; len) {
	         // Update the first address to be written buf-&gt;base += n;
	         // Update the length of the data to be written buf-&gt;len -= n;
	         /*
	                  Update the length of the queue to be written, which is the total length of the data to be written, equal to the sum of multiple bufs */
	         stream-&gt;write_queue_size -= n;
	         n = 0;
	         /*
	                   If you haven't finished writing, and set up synchronous writing, continue to try to write,
	                   Otherwise, exit and register the event to be written */
	         if (stream-&gt;flags &amp; UV_STREAM_BLOCKING) {
	           goto start;
	         } else {
	           break;
	         }
	       } else {
	         /*
	                   The data of the current buf is all written, then update the first address of the data to be written, that is, the next buf, because the current buf is finished */
	         req-&gt;write_index++;
	         // update n for the calculation of the next loop n -= len;
	         // Update the length of the queue to be written stream-&gt;write_queue_size -= len;
	         /*
	                  It is equal to the last buf, indicating that the data to be written in the queue is all written */
	         if (req-&gt;write_index == req-&gt;nbufs) {
	           /*
	                       Release the memory corresponding to buf, insert the request into the write completion queue, and prepare to trigger the write completion callback */
	           uv__write_req_finish(req);
	           return;
	         }
	       }
	     }
	   }
	   /*
	       The writing is successful, but it is not finished yet, register the event to be written,
	       Continue writing while waiting for writable */
	   uv__io_start(stream-&gt;loop, &amp;stream-&gt;io_watcher, POLLOUT);
	   uv__stream_osx_interrupt_select(stream);

	   return;
	 // write error error:
	   // log errors req-&gt;error = err;
	   /*
	      free memory, discard data, insert write completion queue,
	       Insert the IO observer into the pending queue and wait for the pending phase to execute the callback */
	   uv__write_req_finish(req);
	   //eq,
                     uv_stream_t* stream,
                     uv_shutdown_cb cb) {
      // Initialize a close request, the associated handle is stream
      uv__req_init(stream-&gt;loop, req, UV_SHUTDOWN);
      req-&gt;handle = stream;
      // Callback executed after closing req-&gt;cb = cb;
      stream-&gt;shutdown_req = req;
      // Set the flag being closed stream-&gt;flags |= UV_HANDLE_SHUTTING;
      // Register to wait for writable events uv__io_start(stream-&gt;loop, &amp;stream-&gt;io_watcher, POLLOUT);
      return 0;
    }
```

Closing the write side of the stream is equivalent to sending a close request to the stream, mounting the request to the stream, and then registering to wait for a writable event, and the closing operation will be performed when the writable event is triggered. In the chapter on analyzing the write stream, we mentioned that when a writable event is triggered, uv**drain will be executed to log out and wait for the writable event. In addition, uv**drain also does one thing, which is to close the write end of the stream. Let's look at the specific logic.

```cpp
    static void uv__drain(uv_stream_t* stream) {
      uv_shutdown_t* req;
      int err;
      // Cancel waiting for writable events, because no data needs to be written uv__io_stop(stream-&gt;loop, &amp;stream-&gt;io_watcher, POLLOUT);
      uv__stream_osx_interrupt_select(stream);

      // The close write end is set, but it has not been closed, then execute the close write end if ((stream-&gt;flags &amp; UV_HANDLE_SHUTTING) &amp;&amp;
          !(stream-&gt;flags &amp; UV_HANDLE_CLOSING) &amp;&amp;
          !(stream-&gt;flags &amp; UV_HANDLE_SHUT)) {
        req = stream-&gt;shutdown_req;
        stream-&gt;shutdown_req = NULL;
        // clear flags stream-&gt;flags &amp;= ~UV_HANDLE_SHUTTING;
        uv__req_unregister(stream-&gt;loop, req);

        err = 0;
        // close the write end if (shutdown(uv__stream_fd(stream), SHUT_WR))
          err = UV__ERR(errno);
        // mark closed write end if (err == 0)
          stream-&gt;flags |= UV_HANDLE_SHUT;
        // execute callback if (req-&gt;cb != NULL)
          req-&gt;cb(req, err);
      }
    }
```

The write end of the stream can be closed by calling shutdown, for example, the write end of the TCP stream can be closed after sending data. But still readable.

## 5.6 close stream ```cpp

     void uv__stream_close(uv_stream_t* handle) {
       unsigned int i;
       uv__stream_queued_fds_t* queued_fds;
       // Remove the IO watcher from the event loop and move out of the pending queue uv__io_close(handle-&gt;loop, &amp;handle-&gt;io_watcher);
       // stop reading uv_read_stop(handle);
       // stop handle
       uv__handle_stop(handle);
       // unreadable, write handle-&gt;flags &amp;= ~(UV_HANDLE_READABLE | UV_HANDLE_WRITABLE);
       // Close the file descriptor of the non-standard stream if (handle-&gt;io_watcher.fd != -1) {
         /*
               Don't close stdio file descriptors.
               Nothing good comes from it.
              */
         if (handle-&gt;io_watcher.fd &gt; STDERR_FILENO)
           uv__close(handle-&gt;io_watcher.fd);
         handle-&gt;io_watcher.fd = -1;
       }
       // Close the file descriptor corresponding to the communication socket if (handle-&gt;accepted_fd != -1) {
         uv__close(handle-&gt;accepted_fd);
         handle-&gt;accepted_fd = -1;
       }
       // Same as above, this is the file descriptor queued for processing if (handle-&gt;queued_fds != NULL) {
         queued_fds = handle-&gt;queued_fds;
         for (i = 0; i &lt; queued_fds-&gt;offset; i++)
           uv__close(queued_fds-&gt;fds[i]);
         uv__free(handle-&gt;queued_fds);
         handle-&gt;queued_fds = NULL;
       }
     }

`````

Closing a stream is to unregister the stream registered in epoll and close the file descriptor it holds.
## 5.7 Connection flow Connection flow is for TCP and Unix domains, so we first introduce some network programming related content, first of all, we must have a socket. Let's see how to create a new socket in Libuv.

````cpp
    int uv__socket(int domain, int type, int protocol) {
      int sockfd;
      int err;
      // Create a new socket and set the non-blocking and LOEXEC flags sockfd = socket(domain, type | SOCK_NONBLOCK | SOCK_CLOEXEC, protocol);
      // Do not trigger the SIGPIPE signal, for example, the peer end has been closed, and the local end executes the write #if defined(SO_NOSIGPIPE)
      {
        int on = 1;
        setsockopt(sockfd, SOL_SOCKET, SO_NOSIGPIPE, &amp;on, sizeof(on));
      }
    #endif

      return sockfd;
    }
`````

In Libuv, the socket mode is non-blocking. uv_socket is the function to apply for socket in Libuv, but Libuv does not directly call this function, but encapsulates it.

```cpp
    /*
      1 Get a new socket fd
      2 Save the fd in the handle, and set the relevant settings according to the flag 3 Bind to the random address of the machine (if the flag is set)
    */
    static int new_socket(uv_tcp_t* handle,
                            int domain,
                            unsigned long flags) {
      struct sockaddr_storage saddr;
      socklen_t slen;
      int sockfd;
      // get a socket
      sockfd = uv__socket(domain, SOCK_STREAM, 0);

      // Set options and save the socket's file descriptor to the IO observernew_socket(handle, domain, flags);
    }
```

There are many logical branches of the maybe_new_socket function, mainly as follows 1 If the stream has not been associated with fd, apply for a new fd to be associated with the stream 2 If the stream has been associated with an fd.
If the stream is marked with a binding address, but an address has been bound by Libuv (Libuv will set the UV_HANDLE_BOUND flag, the user may also directly call the bind function to bind). You do not need to bind again, just update the flags.
If the stream is marked with a binding address, but an address has not been bound through Libuv, at this time, getsocketname is used to determine whether the user has bound an address through the bind function. If yes, there is no need to perform the binding operation again. Otherwise bind to an address randomly.

The logic of the above two functions is mainly to apply for a socket and bind an address to the socket. Let's take a look at the implementation of the connection flow.

```cpp
    int uv__tcp_connect(uv_connect_t* req,
               uv_tcp_t* handle,
               const struct sockaddr* addr,
               unsigned int addrlen,
               uv_connect_cb cb) {
      int err;
      int r;

      // The connect has been initiated if (handle-&gt;connect_req != NULL)
        return UV_EALREADY;
      // Apply for a socket and bind an address, if not yet err = maybe_new_socket(handle, addr-&gt;sa_family,
                   UV_HANDLE_READABLE | UV_HANDLE_WRITABLE
        if (err)
        return err;
      handle-&gt;delayed_error = 0;

      do {
        // clear the value of the global error variable errno = 0;
        // Non-blocking three-way handshake r = connect(uv__stream_fd(handle), addr, addrlen);
      } while (r == -1 &amp;&amp; errno == EINTR);

      if (r == -1 &amp;&amp; errno != 0) {
        // The three-way handshake has not been completed if (errno == EINPROGRESS)
          ; /* not an error */
        else if (errno == ECONNREFUSED)
          // The other party refuses to establish a connection and delays reporting an error handle-&gt;delayed_error = UV__ERR(errno);
        else
          // Directly report an error return UV__ERR(errno);
      }
      // Initialize a connection request and set some fields uv__req_init(handle-&gt;loop, req, UV_CONNECT);
      req-&gt;cb = cb;
      req-&gt;handle = (uv_stream_t*) handle;
      QUEUE_INIT(&amp;req-&gt;queue);
        // Connection request handle-&gt;connect_req = req;
      // Register to the Libuv watcher queue uv__io_start(handle-&gt;loop, &amp;handle-&gt;io_watcher, POLLOUT);
      // Connection error, insert pending queue tail if (handle-&gt;delayed_error)
        uv__io_feed(handle-&gt;loop, &amp;handle-&gt;io_watcher);

      return 0;
    }
```

The logic of the connection flow is roughly as follows: 1 Apply for a socket and bind an address.
2 According to the given server address, initiate a three-way handshake, non-blocking, it will return directly to continue execution, and will not wait until the three-way handshake is completed.
3 Mount a connect request to the stream.
4 Set the events of interest to the IO observer as writable. Then insert the IO observer into the IO observer queue of the event loop. When waiting for writability (complete the three-way handshake), the cb callback will be executed.

When a writable event is triggered, uv\_\_stream_io will be executed. Let's take a look at the specific logic.

```cpp
    if (stream-&gt;connect_req) {
        uv__stream_connect(stream);
        return;
    }
```

We continue to look at uv\_\_stream_connect.

```cpp
    static void uv__stream_connect(uv_stream_t* stream) {
      int error;
      uv_connect_t* req = stream-&gt;connect_req;
      socklen_t errorsize = sizeof(int);
      // Connection error if (stream-&gt;delayed_error) {
        error = stream-&gt;delayed_error;
        stream-&gt;delayed_error = 0;
      } else {
        // Still need to judge whether there is an error getsockopt(uv__stream_fd(stream),
                   SOL_SOCKET,
                   SO_ERROR,
                   &amp;error,
                   &amp;errorsize);
        error = UV__ERR(error);
      }
      // If the connection is not successful, return first and wait for the next writable event to trigger if (error == UV__ERR(EINPROGRESS))
        return;
      // clear stream-&gt;connect_req = NULL;
      uv__req_unregister(stream-&gt;loop, req);
      /*
       If there is a connection error, the previously registered waiting writable queue will be cancelled.
       If the connection is successful, if the queue to be written is empty, log out the event, and register when there is data to be written*/
      if (error &lt; 0 || QUEUE_EMPTY(&amp;stream-&gt;write_queue)) {
        uv__io_stop(stream-&gt;loop, &amp;stream-&gt;io_watcher, POLLOUT);
      }
      // Execute the callback to notify the upper layer of the connection result if (req-&gt;cb)
        req-&gt;cb(req, error);

      if (uv__stream_fd(stream) == -1)
        return;
      // Connection failed, flush data to be written and execute callback for write request (if any)
      if (error &lt; 0) {
        uv__stream_flush_write_queue(stream, UV_ECANCELED);
        uv__write_callbacks(stream);
      }
    }
```

The logic of the connection flow is 1. Initiate a non-blocking connection 2. Register and wait for a writable event. 3. When the writable event is triggered, tell the caller the connection result. 4. If the connection is successful, the data of the write queue is sent. The callback (if any) for each write request.

## 5.8 Listening stream Listening stream is for TCP or Unix domain, mainly to change a socket to listen state. and set some properties.

```cpp
    int uv_tcp_listen(uv_tcp_t* tcp, int backlog, uv_connection_cb cb) {
      static int single_accept = -1;
      unsigned longerr = uv__accept(uv__stream_fd(stream));
            // error handling if (err &lt; 0) {
                /*
                   The fd corresponding to uv__stream_fd(stream) is non-blocking,
                   Returning this error means that there is no connection available to accept, return directly */
          if (err == -EAGAIN || err == -EWOULDBLOCK)
            return; /* Not an error. */
          if (err == -ECONNABORTED)
            continue;
                // The number of open file descriptors of the process reaches the threshold to see if there is a spare if (err == -EMFILE || err == -ENFILE) {
            err = uv__emfile_trick(loop, uv__stream_fd(stream));
            if (err == -EAGAIN || err == -EWOULDBLOCK)
              break;
          }
          // An error occurs, execute the callback stream-&gt;connection_cb(stream, err);
          continue;
        }
        // Record the fd corresponding to the communication socket obtained
        stream-&gt;accepted_fd = err;
        // Execute upload callback stream-&gt;connection_cb(stream, 0);
        /*
              If stream-&gt;accepted_fd is -1, it means that accepted_fd has been consumed in the callback connection_cb. Otherwise, the read event of the fd in the epoll of the server will be cancelled first, and then registered after consumption, that is, the request will not be processed any more*/
        if (stream-&gt;accepted_fd != -1) {
          /*
                  The user hasn't yet accepted called uv_accept()
                */
          uv__io_stop(loop, &amp;stream-&gt;io_watcher, POLLIN);
          return;
        }
        /*
          It is a TCP type stream and only one connection is set to accpet at a time, then it is blocked regularly.
              Accept after being woken up, otherwise accept all the time (if the user consumes accept_fd in the connect callback), timing blocking is used for multi-process competition to process connections*/
        if (stream-&gt;type == UV_TCP &amp;&amp;
                 (stream-&gt;flags &amp; UV_TCP_SINGLE_ACCEPT)) {
          struct timespec timeout = { 0, 1 };
          nanosleep(&amp;timeout, NULL);
        }
      }
    }
```

When we see a connection coming, Libuv will pick a node from the queue of completed connections and then execute the connection_cb callback. In the connection_cb callback, uv_accept needs to consume accpet_fd.

```cpp
    int uv_accept(uv_stream_t* server, uv_stream_t* client) {
      int err;
      switch (client-&gt;type) {
        case UV_NAMED_PIPE:
        case UV_TCP:
          // save the file descriptor to the client
          err = uv__stream_open(client,
                                        server-&gt;accepted_fd,
                                        UV_STREAM_READABLE
                                        | UV_STREAM_WRITABLE);
          if (err) {
            uv__close(server-&gt;accepted_fd);
            goto done;
          }
          break;

        case UV_UDP:
          err = uv_udp_open((uv_udp_t*) client,
                                    server-&gt;accepted_fd);
          if (err) {
            uv__close(server-&gt;accepted_fd);
            goto done;
          }
          break;
        default:
          return -EINVAL;
      }
      client-&gt;flags |= UV_HANDLE_BOUND;

    done:
      // If it is not empty, continue to put one in accpet_fd and wait for accept, which is used for file descriptor transfer if (server-&gt;queued_fds != NULL) {
        uv__stream_queued_fds_t* queued_fds;
        queued_fds = server-&gt;queued_fds;
        // assign the first one to accept_fd
        server-&gt;accepted_fd = queued_fds-&gt;fds[0];
        /*
             offset minus one unit, if there is no more, free the memory,
              Otherwise, you need to move the next one forward, and the offset executes the last one */
        if (--queued_fds-&gt;offset == 0) {
          uv__free(queued_fds);
          server-&gt;queued_fds = NULL;
        } else {
          memmove(queued_fds-&gt;fds,
                  queued_fds-&gt;fds + 1,
                  queued_fds-&gt;offset * sizeof(*queued_fds-&gt;fds));
        }
      } else {
        // If there is no queued fd, then register to wait for readable events, wait for accept new fd
        server-&gt;accepted_fd = -1;
        if (err == 0)
          uv__io_start(server-&gt;loop, &amp;server-&gt;io_watcher, POLLIN);
      }
      return err;
    }
```

The client is the stream used to communicate with the client, and accept is to save the accept_fd to the client, and the client can communicate with the peer through fd. After consuming accept_fd, if there are still pending fds, you need to add one to accept_fd (for Unix domain), and the others continue to be queued for processing. If there are no pending fds, register and wait for readable events and continue to process new connections.

## 5.9 Destroying a stream When we no longer need a stream, we will first call uv_close to close the stream. Closing the stream just cancels the event and releases the file descriptor. After calling uv_close, the structure corresponding to the stream will be added. When it comes to the closing queue, in the closing phase, the operation of destroying the stream will be performed, such as discarding the data that has not been written yet, and executing the callback of the corresponding stream. Let's take a look at the function uv\_\_stream_destroy that destroys the stream.

```cpp
    voidIf the mode of the stream is read continuously,
          1 If only part is read (UV_STREAM_READ_PARTIAL is set),
                  and did not read to the end (UV_STREAM_READ_EOF is not set),
           Then it is directly processed for the end of reading,
          2 If only part of it is read, the above read callback executes the read end operation,
                  Then there is no need to process 3. If the read-only part is not set, and the read end operation has not been performed,
                  The read end operation cannot be performed, because although the peer end is closed, the previously transmitted data may not have been consumed. 4 If the read-only part is not set and the read end operation is performed, then there is no need to process it here*/
      if ((events &amp; POLLHUP) &amp;&amp;
          (stream-&gt;flags &amp; UV_STREAM_READING) &amp;&amp;
          (stream-&gt;flags &amp; UV_STREAM_READ_PARTIAL) &amp;&amp;
          !(stream-&gt;flags &amp; UV_STREAM_READ_EOF)) {
        uv_buf_t buf = { NULL, 0 };
        uv__stream_eof(stream, &amp;buf);
      }

      if (uv__stream_fd(stream) == -1)
        return; /* read_cb closed stream. */
      // writable event trigger if (events &amp; (POLLOUT | POLLERR | POLLHUP)) {
        // write data uv__write(stream);
        // Do post-processing after writing, release memory, execute callbacks, etc. uv__write_callbacks(stream);
        // If the queue to be written is empty, log out and wait for the write event if (QUEUE_EMPTY(&amp;stream-&gt;write_queue))
          uv__drain(stream);
      }
    }
```
