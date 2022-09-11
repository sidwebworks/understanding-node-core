A stream is an abstraction of the process of producing and consuming data. The stream itself does not produce and consume data, it just defines the process of data processing. Readable stream is an abstraction of the process of data source flowing to other places and belongs to the producer. Readable stream is an abstraction of the process of data flowing to a certain destination. Streams in Node.js are divided into readable, writable, readable and writable, and transform streams. Let me first look at the base class of streams.

## 21.1 Stream base class and stream common logic ```js

     const EE = require('events');
     const util = require('util');
     // base class for streams function Stream() {
       EE.call(this);
     }
     // Inherit the ability of event subscription distribution util.inherits(Stream, EE);

`````

The base class for streams provides only one function, pipe. Used to implement pipelining. Pipelining is the abstraction of data flowing from one place to another. This method has a lot of code and is said separately.
### 21.1.1 Handling data events ````js
    // data source object var source = this;

    // Listen to the data event, when the readable stream has data, the data event will be triggered source.on('data', ondata);
    function ondata(chunk) {
      // The source stream has data arriving, and the destination stream is writable if (dest. writable) {
         /*
          The destination stream is overloaded and the source stream implements the pause method,
          Then suspend the read operation of the readable stream and wait for the destination stream to trigger the drain event*/
        if (false === dest.write(chunk) &amp;&amp; source.pause) {
          source.pause();
        }
      }
    }

    // Listen to the drain event, the event will be triggered when the destination stream can consume data dest.on('drain', ondrain);
    function ondrain() {
      // The destination stream can continue to be written, and the readable stream is readable, switch to automatic read mode if (source.readable &amp;&amp; source.resume) {
        source.resume();
      }
    }
`````

This is where the flow control is implemented when pipelined, mainly using the write return value and the drain event.

### 21.1.2 Stream Closure/End Handling ```js

     /*
       1 dest._isStdio is true indicating that the destination stream is standard output or standard error (see process/stdio.js),
       2 The configured end field represents whether the writable stream is automatically closed when the readable stream triggers the end or close event. The default is to automatically close. If the configured end is false, when the two events of the readable stream are triggered, we need to close the writable stream by ourselves.
       3 When we see that the error event of the readable stream is triggered, the writable stream will not be closed automatically. We need to listen to the error event of the readable stream by ourselves, and then manually close the writable stream. So the judgment of if means whether the standard output or standard error stream is not configured, and when the end is not configured to be false, the writable stream will be automatically closed. The standard output and standard error streams are closed when the process exits.
     */
     if (!dest._isStdio &amp;&amp; (!options || options.end !== false)) {
       // The source stream has no data to read, execute the end callback source.on('end', onend);
       // The source stream is closed, execute the close callback source.on('close', onclose);
     }

     var didOnEnd = false;
     function onend() {
       if (didOnEnd) return;
       didOnEnd = true;
     // Execute the end of the destination stream, indicating that writing data is completed dest.end();
     }

     function onclose() {
       if (didOnEnd) return;
       didOnEnd = true;
       // Destroy the destination stream if (typeof dest.destroy === 'function') dest.destroy();
     }

`````

The above is the logic of how to process the writable stream after the readable source stream ends or is closed. By default, we only need to listen for the error event of the readable stream, and then perform the close operation of the writable stream.
### 21.1.3 Error handling ````js
    // When there is an error in the readable stream or the writable stream, you need to stop the data processing source.on('error', onerror);
    dest.on('error', onerror);
    // The processing logic when the readable stream or the writable stream triggers the error event function onerror(er) {
      // An error occurs, clear the registered events, including the executing onerror function cleanup();
      /*
        Throws an error if the user is not listening to the stream's error event,
  So our business code needs to listen to the error event */
      if (EE.listenerCount(this, 'error') === 0) {
        throw er; // Unhandled stream error in pipe.
      }
    }
`````

In the processing function of the error event, the error event registered by Node.js itself is cleared through the cleanup function, so if the user does not register the error event at this time, the number of processing functions for the error event is 0, so we need to register the error event. . Next, we analyze the logic of the cleanup function.

### 21.1.4 Clear registered events ````js

     // Ensure that the registered event is cleared when the source stream is closed, the data is read, and the destination stream is closed source.on('end', cleanup);
     source.on('close', cleanup);
     dest.on('close', cleanup);
     // Clear all events that may be bound, if not bound, it is harmless to perform cleanup function cleanup() {
       source.removeListener('data', ondata);
       dest.removeListener('drain', ondrain);

       source.removeListener('end', onend);
       source.removeListener('close', onclose);

       source.removeListener('error', onerror);
       dest.removeListener('error', onerror);

       source.removeListener('end', cleanup);
       source.removeListener('close', cleanup);

       dest.removeListener('close', cleanup);
     }

     // Trigger the pipe event of the destination stream dest.emit('pipe', source);
     // Support continuous pipeline A.pipe(B).pipe(C)
     return dest;

`````

### 21.1.5 Stream Threshold The stream threshold can be calculated through the `getHighWaterMark(lib\internal\streams\state.js)` function, and the threshold is used to control the speed of the user reading and writing data. Let's look at the implementation of this function.

````js
    function getHighWaterMark(state, options, duplexKey, isDuplex) { // user defined threshold let hwm = options.highWaterMark;
      // User defined, check whether it is legal if (hwm != null) {
        if (typeof hwm !== 'number' || !(hwm &gt;= 0))
          throw new errors.TypeError('ERR_INVALID_OPT_VALUE',
                                       'highWaterMark',
                                       hwm);
        return Math.floor(hwm);
      } else if (isDuplex) {
        // The user has not defined a common threshold, that is, the common threshold of the read and write streams. // Whether the user has defined a separate threshold for the stream, such as the threshold of the read stream or the threshold of the write stream hwm = options[duplexKey];
        // user defined if (hwm != null) {
          if (typeof hwm !== 'number' || !(hwm &gt;= 0))
            throw new errors.TypeError('ERR_INVALID_OPT_VALUE',
                                          duplexKey,
                                          hwm);
          return Math.floor(hwm);
        }
      }

      // The default value, the object is 16, the buffer is 16KB
      return state.objectMode ? 16 : 16 * 1024;
    }
`````

The logic of the getHighWaterMark function is as follows 1 If the user defines a valid threshold, the user-defined (readable stream, writable stream, and bidirectional stream) are used.  
 2 If it is a bidirectional stream, and the user does not have a defined threshold shared by the readable stream and the writable stream, determine whether the user sets the threshold for the corresponding stream according to whether the current stream is readable or writable. If there is, take the value set by the user as the threshold.  
 3 If 1,2 are not satisfied, return the default value.

### 21.1.6 Destroying a stream A stream, including readable and writable streams, can be destroyed by calling the destroy function. And you can implement the \_destroy function to customize the destruction behavior. Let's look at the definition of the destroy function for writable streams.

```js
    function destroy(err, cb) {
      // read stream, write stream, bidirectional stream const readableDestroyed = this._readableState &amp;&amp;
        this._readableState.destroyed;
      const writableDestroyed = this._writableState &amp;&amp;
        this._writableState.destroyed;
      // Whether the stream has been destroyed, execute the callback directly if (readableDestroyed || writableDestroyed) {
        // If cb is passed, execute, optionally pass in err, user-defined err
        if (cb) {
          cb(err);
        } else if (err &amp;&amp;
                   (!this._writableState ||
                     !this._writableState.errorEmitted)) {
          /*
          If err is passed, it is a read stream or a write stream that has not triggered an error event.
             then trigger the error event */
          process.nextTick(emitErrorNT, this, err);
        }
        return this;
      }

      // If not destroyed, start the destruction process if (this._readableState) {
        this._readableState.destroyed = true;
      }

      if (this._writableState) {
        this._writableState.destroyed = true;
      }
      // User can customize the _destroy function this._destroy(err || null, (err) =&gt; {
        // There is no cb but there is an error, then the error event is triggered if (!cb &amp;&amp; err) {
          process.nextTick(emitErrorNT, this, err);
          // If the writable stream is marked, the error event has been triggered if (this._writableState) {
            this._writableState.errorEmitted = true;
          }
        } else if (cb) { // with cb or without err
          cb(err);
        }
      });

      return this;
    }
```

The destroy function destroys the general logic of the stream. The different streams of the \_destroy function are different. The following are the implementations of the readable stream and the writable stream.
1 Readable stream ```js
= false;  
 this.decoder = null;  
 this.encoding = null;  
 // codec if (options.encoding) {  
 if (!StringDecoder)  
 StringDecoder = require('string_decoder').StringDecoder;
this.decoder = new StringDecoder(options.encoding);  
 this.encoding = options.encoding;  
 }  
 }

`````

ReadableState contains a lot of fields, we can leave it alone, wait for it to be used, and then look back. Then we start to look at the implementation of readable streams.

````js
    function Readable(options) {
      if (!(this instanceof Readable))
        return new Readable(options);

      this._readableState = new ReadableState(options, this);
      // readable this.readable = true;
      // Two functions implemented by the user if (options) {
        if (typeof options.read === 'function')
          this._read = options.read;
        if (typeof options.destroy === 'function')
          this._destroy = options.destroy;
      }
      // Initialize the parent class Stream.call(this);
    }
`````

The above logic is not much. The two functions that need to be paid attention to are read and destroy. If we use Readable directly to use readable stream, then the read function must be passed in the options, and destroy is optional. If we use Readable in an inherited way, we must implement the \_read function. Node.js just abstracts the logic of the stream, and the specific operations (for example, readable stream is to read data) are implemented by the user, because the read operation is business-related. Let's analyze the operation of the readable stream.

### 21.2.1 The readable stream obtains data from the underlying resource For the user, the readable stream is the place where the user obtains the data, but for the readable stream, the premise of providing data to the user is that it has its own data. So readable streams need to produce data first. The logic for producing data is implemented by the \_read function. The logic of the \_read function is probably ```js

     const data = getSomeData();
     readableStream.push(data);

`````

Through the push function, data is written into the readable stream, and then data can be provided to the user. Let's look at the implementation of push and only list the main logic.
    Read

````js
able.prototype.push = function(chunk, encoding) {
      // code that omits encoding processing return readableAddChunk(this,
                                 chunk,
                                 encoding,
                                 false,
                                 skipChunkCheck);
    };

    function readableAddChunk(stream,
                               chunk,
                               encoding,
                               addToFront,
                               skipChunkCheck) {
      var state = stream._readableState;
      // push null means the end of the stream if (chunk === null) {
        state.reading = false;
        onEofChunk(stream, state);
      } else {
        addChunk(stream, state, chunk, false);
      }
      // Return whether more data can be read return needMoreData(state);
    }

    function addChunk(stream, state, chunk, addToFront) {
      // In streaming mode and there is no cached data, the data event is triggered directly if (state.flowing &amp;&amp; state.length === 0 &amp;&amp; !state.sync) {
        stream.emit('data', chunk);
      } else {
        // Otherwise cache the data first state.length += state.objectMode ? 1 : chunk.length;
        if (addToFront)
          state.buffer.unshift(chunk);
        else
          state.buffer.push(chunk);
        // If the readable event is monitored, the readable event is triggered, and the read is actively read if (state.needReadable)
          emitReadable(stream);
      }
      // Continue reading data, if possible maybeReadMore(stream, state);
    }
`````

In general, a readable stream must first obtain data from somewhere, deliver it directly to the user according to the current working mode, or cache it first. Continue to acquire data if possible.

## 21.2.2 Users get data from readable streams Users can get data from readable streams through the read function or by listening to the data event ```js

     Readable.prototype.read = function(n) {
       n = parseInt(n, 10);
       var state = this._readableState;
       // Calculate readable size n = howMuchToRead(n, state);
       var ret;
       // If what needs to be read is greater than 0, then take the read data to ret and return if (n &gt; 0)
         ret = fromList(n, state);
       else
         ret = null;
       // subtract the length just read state.length -= n;
       /*
          If there is no data in the cache or it is less than the threshold after reading,
           Then the readable stream can continue to get data from the underlying resource */
       if (state.length === 0 ||
              state.length - n &lt; state.highWaterMark) {
          this._read(state.highWaterMark);
       }
       // trigger data event if (ret !== null)
         this.emit('data', ret);
       return ret;
     };

```

The operation of reading data is to calculate how much data can be read in the cache, and the data size required by the user, take the smaller one, return it to the user, and trigger the data event. If the data has not reached the threshold, trigger a readable stream to fetch data from the underlying resource. As a result, data is continuously generated.
## 21.3 Writable Streams A writable stream is an abstraction of the data flow direction. The user calls the interface of a writable stream, and the writable stream is responsible for controlling the writing of data. The process is shown in Figure 21-1.
Whether to call the callback function onwrite of the writable stream asynchronously or asynchronously
      this.sync = true;

      // Whether the cached data is being processed this.bufferProcessing = false;

      // The callback that needs to be executed in the hook _write function implemented by the user, telling the write stream to complete this.onwrite = onwrite.bind(undefined, stream);

      // The callback corresponding to the current write operation this.writecb = null;

      // The data length or number of objects of the current write operation this.writelen = 0;

      // Cached data list header pointer this.bufferedRequest = null;

      // Point to the last node of the cached data list this.lastBufferedRequest = null;

      // The number of callback functions to be executed this.pendingcb = 0;

      // Has the prefinished event been triggered this.prefinished = false;

      // Whether the error event has been triggered this.errorEmitted = false;

      // count buffered requests
      // The number of buffers cached this.bufferedRequestCount = 0;

      /*
        Idle node linked list, when the cache data is written to the bottom layer, corkReq preserves the context of the data (such as user callback), because at this time, the cache linked list has been emptied,
        this.corkedRequestsFree always maintains one free node, up to two */
      var corkReq = { next: null, entry: null, finish: undefined };
      corkReq.finish = onCorkedFinish.bind(undefined, corkReq, this);
      this.corkedRequestsFree = corkReq;
    }
```

### 21.3.2 Writable

Writable is a specific implementation of writable stream. We can use Writable directly as a writable stream, or we can inherit Writable to implement our own writable stream.

```js
    function Writable(options) {
      this._writableState = new WritableState(options, this);
      // writable this.writable = true;
      // support user-defined hooks if (options) {
        if (typeof options.write === 'function')
          this._write = options.write;

        if (typeof options.writev === 'function')
          this._writev = options.writev;

        if (typeof options.destroy === 'function')
          this._destroy = options.destroy;

        if (typeof options.final === 'function')
          this._final = options.final;
      }

      Stream.call(this);
    }
```

Writable streams inherit from the stream base class and provide several hook functions. Users can customize the hook functions to implement their own logic. If the user directly uses the Writable class as the writable stream, the options.write function must be passed. The options.wirte function controls where the data is written and notifies whether the writable stream has been written. If the user uses the writable stream in the form of inheriting the Writable class, the \_write function must be implemented. The \_write function has the same function as the options.write function.

### 21.3.3 Data writing The writable stream provides the write function for users to write data. There are two ways to write. One is to write one by one, and the other is to write in batches. Batch writing is optional and depends on the user's implementation. If the user uses Writable directly, they need to pass in writev. If the Writable is used in inheritance mode, the \_writev function is implemented. Let's first look at the implementation of the write function ```js

     Writable.prototype.write = function(chunk, encoding, cb) {
       var state = this._writableState;
       // Tell the user whether to continue calling write
       var ret = false;
       // Data format var isBuf = !state.objectMode &amp;&amp; Stream._isUint8Array(chunk);
       // Do you need to convert to buffer format if (isBuf &amp;&amp; Object.getPrototypeOf(chunk) !== Buffer.prototype) {
         chunk = Stream._uint8ArrayToBuffer(chunk);
       }
       // Parameter processing, data and callback are passed, no encoding type if (typeof encoding === 'function') {
         cb = encoding;
         encoding = null;
       }
       // If it is a buffer type, set it to buffer, otherwise if it is not passed, take the default encoding if (isBuf)
         encoding = 'buffer';
       else if (!encoding)
         encoding = state.defaultEncoding;

       if (typeof cb !== 'function')
         cb = nop;
       // is executing end, then execute write, and report an error if (state.ending)
         writeAfterEnd(this, cb);
       else if (isBuf || validChunk(this, state, chunk, cb)) {
         // Add one to the number of callbacks to be executed, ie cb
         state.pendingcb++;
         // write or buffer, see the function ret = writeOrBuffer(this, state, isBuf, chunk, encoding, cb);
       }
       /// Can we continue to write return ret;
     };

`````

The write function first does some parameter processing and data conversion, and then judges whether the stream has ended. If the stream ends and then writes, an error will be reported. If the stream does not end then write or cache processing is performed. Finally, notify the user whether they can continue to call write to write data (we see that if the written data is larger than the threshold, the writable stream will still perform the write operation, but it will return false to tell the user not to write, if the caller If you continue to write, it will not continue to write, but it may cause excessive pressure on the write side). Let's first look at the logic of writeAfterEnd. Then look at writeOrBuffer.

````js
    function writeAfterEnd(stream, cb) {
      var er = new errors.Error('ERR_STREAM_WRITE_AFTER_END');
      stream.emit('error', er);
      process.nextTick(cb, er);
    }
`````

The logic of the writeAfterEnd function is relatively simple. First, the error event of the writable stream is triggered, and then the callback passed in by the user when calling write is executed at the next tick. Next we look at writeOrBuffer. The writeOrBuffer function will buffer the data or write it directly to the destination (the destination can be a file, socket, memory, depending on the user's implementation), depending on the current state of the writable stream.

`````js
    functionOr in cork mode. Cache the data if yes, otherwise perform a write operation.
Let's take a look at the logic of the cache and the resulting data structure.
When caching the first node, as shown in Figure 21-3.
![](https://img-blog.csdnimg.cn/35526566ab84442a968e30ab4d990ac4.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM659ibG0nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size)
Figure 21-3
When caching the second node, as shown in Figure 21-4.
![](https://img-blog.csdnimg.cn/6a001b770b4b4259bb1b75ae756ca5f9.png)
Figure 21-4
When caching the third node, as shown in Figure 21-5
 ![](https://img-blog.csdnimg.cn/bafdb23abb5e455aa3f8aa4f9e2ce9e1.png)
Figure 21-5
We see that the data of the function is managed in the form of a linked list, where bufferedRequest is the head node of the linked list, and lastBufferedRequest points to the tail node. Assume that the current writable stream is not in write or cork state. Let's take a look at the logic of writing.

````js
    function doWrite(stream, state, writev, len, chunk, encoding, cb) {
      // The length of the data written this time state.writelen = len;
      // Callback executed after this write is completed state.writecb = cb;
      // writing state.writing = true;
      // Assume that the user-defined _writev or _write function is a synchronous callback onwrite
      state.sync = true;
      if (writev)
        // chunk is the buffer node array to be written stream._writev(chunk, state.onwrite);
      else
        // Execute the user-defined write function, onwrite is defined by Node.js, and the function is set during initialization stream._write(chunk, encoding, state.onwrite);
      /*
        If the user is synchronously calling back onwrite, this code is meaningless,
        If it is an asynchronous callback onwrite, this code will be executed before onwrite,
        It marks that the user is in the asynchronous callback mode, and the callback mode needs to be judged in onwrite, that is, the value of sync*/
      state.sync = false;
    }
`````

The doWrite function records the context of this write, such as length, callback, and then sets the writing flag. Finally execute the write. If the current data to be written is cached data and the user implements the \_writev function, \_writev is called. Otherwise call \_write. Let's implement an example of a writable stream and string the logic here.

```js
const { Writable } = require("stream");
class DemoWritable extends Writable {
  constructor() {
    super();
    this.data = null;
  }
  _write(chunk, encoding, cb) {
    // save data this.data = this.data ? Buffer.concat([this.data, chunk]) : chunk;
    // Execute the callback to tell the writable stream that the writing is complete, false means the writing is successful, and true means the writing fails cb(null);
  }
}
```

DemoWritable defines the destination of the data flow. When the user calls write, the writable stream will execute the user-defined \_write, \_write saves the data, and then executes the callback and passes in parameters to notify the writable stream that the data writing is complete, and Write success or failure by parameter marker. This time back to the writable stream side. We see that the callback set by the writable stream is onwrite, which is set when the writable stream is initialized.

```js
this.onwrite = onwrite.bind(undefined, stream);
```

We then look at the implementation of onwrite.

```js
    function onwrite(stream, er) {
      var state = stream._writableState;
      var sync = state.sync;
      // Callback executed when this write is done var cb = state.writecb;
      // Reset the value of the internal field // After writing, reset the callback, how many units of data have not been written, after the data is written, reset the number of data to be written this time to 0
      state.writing = false;
      state.writecb = null;
      state.length -= state.writelen;
      state.writelen = 0;
      // write error if (er)
        onwriteError(stream, state, sync, er, cb);
      else {
        // Check if we're actually ready to finish, but don't emit yet
        // Whether end has been executed and the data has been written (end may be executed between the submission of the write operation and the final actual execution)
        var finished = needFinish(state);
        // It is not over, and the blocking flag is not set, the buffer is not being processed, and there is buffer data to be processed, then write if (!finished &amp;&amp;
            !state.corked &amp;&amp;
            !state.bufferProcessing &amp;&amp;
            state.bufferedRequest) {
          clearBuffer(stream, state);
        }
        // The user synchronously calls back onwrite and Node.js executes the user callback asynchronously if (sync) {
          process.nextTick(afterWrite, stream, state, finished, cb);
        } else {
          afterWrite(stream, state, finished, cb);
        }
      }
    }
```

The logic of onwrite is as follows: 1. Update the state and data of the writable stream. 2. If there is a write error, the error event will be triggered and the user callback will be executed. If the write is successful, it will be judged whether it is satisfied to continue the write operation.  
 Let's take a look at the logic of the clearBuffer function, which mainly writes the cached data to the destination.

```js
    function clearBuffer(stream, state) {
      // processing buffer
      state.bufferProcessing = true;
      // Point to the head node var entry = state.bufferedRequest;
      // If _writev is implemented and there are more than two data blocks, write in batches, that is, write all cached buffers at once if (stream._writev &amp;&amp; entry &amp;&amp; entry.next) {
        // Fast case, write everything using _writev()
        var l = state.bufferedRequestCount;
        var buffer = new Array(l);
        var holder = state.corkedRequestsFree;
        // Point to the linked list of data to be written holder.entry = entry;

        var count = 0;
        // Whether the data is all buffer format varthere may also be a value (if the user is calling onwrite asynchronously)
      */
      state.bufferedRequest = entry;
      // This round is processed (one or all of them are processed)
      state.bufferProcessing = false;
    }
```

The logic of clearBuffer seems to be very much, but the logic is not very complicated. Mainly divided into two branches.
1 If the user implements the batch write function, the cache is written to the destination at a time. First collect all the cached data (linked list), then execute the write, and set the callback to be the finish function. The corkedRequestsFree field points to a linked list with at least one node and at most two nodes, which is used to save the context of the data written in batches. Figures 21-6 and 21-7 show the data structure of batch writing (two scenarios).  
 ![](https://img-blog.csdnimg.cn/a6c4092b0ed04bc689750af241cfc508.png)  
 Figure 21-6  
 ![](https://img-blog.csdnimg.cn/1e61f07f68754c4494a85cc794ef7134.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG07nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG09nLmNzZG4ubmV0L1RIRUFOQVJLSA==)  
 Figure 21-7  
 corkedRequestsFree guarantees that there is at least one node for one batch write, and when it is used up, it will save up to two free nodes. Let's take a look at the logic of the callback function onCorkedFinish after the batch writing is successful.

```js
    function onCorkedFinish(corkReq, state, err) {
      // corkReq.entry points to the head node of the currently processed buffer list var entry = corkReq.entry;
      corkReq.entry = null;
      // Traverse and execute the callback callback passed in by the user while (entry) {
        var cb = entry.callback;
        state.pendingcb--;
        cb(err);
        entry = entry.next;
      }

      // Recycle corkReq, state.corkedRequestsFree is equal to the new corkReq at this time, pointing to the corkReq just used up, saving two state.corkedRequestsFree.next = corkReq;
    }
```

onCorkedFinish first takes the callbacks from the data context written in this batch, and then executes them one by one. Finally recycle the node. corkedRequestsFree always points to a free node, so if there are more than two nodes, the tail node will be discarded each time, as shown in Figure 21-8.  
 ![](https://img-blog.csdnimg.cn/58b8d89b2ebe4865a75f26b26fb44fef.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG09nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_1RIRUFOQVJLSA==)  
 Figure 21-8

2 Then we look at the single write scenario. When a single write is performed, the data is written to the destination one by one through doWrite, but there is one thing to note is that if the user executes the callback onwrite of the writable stream asynchronously (through the writing field, because onwrite will set writing to true. If doWrite is executed and writing is false, it means that it is an asynchronous callback), after writing a data, doWrite will not be executed for writing, but it needs to wait until the onwrite callback is executed asynchronously, and then execute the next time write, because the writable stream performs the write operation serially.
Let's talk about the role of the sync field. The sync field is used to mark whether the write function executes the write function synchronously or asynchronously when the user-defined write function is executed. Mainly used to control whether the user's callback is executed synchronously or asynchronously. And you need to ensure that the callbacks are executed in the defined order. There are two places involved in this logic, the first is when wirte. Let's take a look at the calling relationship of the function, as shown in Figure 21-9.  
 ![](https://img-blog.csdnimg.cn/248dc5856ffe47f0abd79d4d0940b386.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6FFLy9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size)  
 Figure 21-9

If the user executes onwrite synchronously, the data will be consumed in real time, and there is no cached data. At this time, Node.js executes the user callback asynchronously and in an orderly manner. If the user calls write twice in a row to write data, and executes the callback onwrite asynchronously, there will be cached data when onwrite is executed for the first time. The second write operation, similarly, the second write operation is also an asynchronous callback onwrite, so the user callback will be executed synchronously next. This ensures sequential execution of user callbacks. The second scenario is the uncork function. Let's take a look at the function diagram, shown in Figure 21-10.  
 ![](https://img-blog.csdnimg.cn/4af7646324f742059042e8e28e300009.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG9nLmNzZG4ubmV0L1RIRUFOQVJLSA)  
 Figure 21-10

In the execution process of uncork, if onwrite is called back synchronously, clearBuffer will not be called again in onwrite, because bufferProcessing is true at this time. At this time, the user's callback will be queued first, and then doWrite will be executed again to initiate the next write operation. If onwrite is executed asynchronously, in the execution of clearBuffer, after the first execution of doWrite, clearBuffer will exit, and bufferProcessing is false at this time. When onwrite is called back, execute clearBuffer again, and exit when doWrite is also executed, and wait for the asynchronous callback. At this time, the user callback is executed.
We continue to analyze the code of onwrite, onwrite will finally call the afterWrite function.

```js
    function afterWrite(stream, state, finished, cb) {
      // It's not over yet, see if you need to trigger the drain event if (!finished)
        onwriteDrain(stream, state);
      // Prepare to execute the user callback, the callback to be executed minus one state.pendingcb--;
      cb();
      finishMaybe(stream, state);
    }

    function onwriteDrain(stream, state) {
      // There is no data to write, and the stream is blocked waiting for the drain event if (state.length === 0 &amp;&amp; state.needDrain) {
        // Trigger the drain event and clear the flag state.needDrain = false;
        stream.emit('drain');
      }
    }

```

afterWrite is mainly to determine whether the drain event needs to be triggered, and then execute the user callback. Finally, determine whether the stream has ended (in the case of asynchronous callback onwrite, end may be executed before the user calls the callback). The logic of the end of the stream is analyzed separately in the following chapters.

### 21.3.4 cork and uncork

cork and uncork are similar to the negal algorithm in tcp, and are mainly used to write to the destination at one time after accumulating data. Instead of writing a block in real time. For example, in tcp, one byte is sent at a time, and the protocol header is much larger than one byte, and the proportion of valid data is very low. When using cork, it is best to provide a writev implementation at the same time, otherwise the cork in the end is meaningless, because in the end, a block of data is still needed to write. Let's look at the code for cork.

```js
Writable.prototype.cork = function () {
  var state = this._writableState;
  state.corked++;
};
```

if (typeof chunk === 'function') {  
 cb = chunk;  
 chunk = null;  
 encoding = null;  
 } else if (typeof encoding === 'function') {  
 cb = encoding;  
 encoding = null;  
 }  
 // The last chance to write, it may be written directly, or it may be cached (the writing guard is in the corked state)  
 if (chunk !== null &amp;&amp; chunk !== undefined)  
 this.write(chunk, encoding);

       // If in corked state, the above write operation will be cached, uncork and write save can perform write operation on the remaining data if (state.corked) {
         // Set to 1, in order for uncork to execute correctly, there is a chance to write the cached data state.corked = 1;
         this.uncork();
       }

       if (!state.ending)
         endWritable(this, state, cb);
     };

````

Let's look at the endWritable function ```js
    function endWritable(stream, state, cb) {
      // executing the end function state.ending = true;
      // Determine if the stream can end finishMaybe(stream, state);
      if (cb) {
        // If the finish event has been triggered, the next tick executes cb directly, otherwise wait for the finish event if (state.finished)
          process.nextTick(cb);
        else
          stream.once('finish', cb);
      }
      // stream is over, stream is not writable state.ended = true;
      stream.writable = false;
    }
````

The endWritable function marks the stream as unwritable and in the end state. But it just means that write can no longer be called to write data, and the previously cached data needs to be written before the stream can really end. Let's look at the logic of the finishMaybe function. This function is used to determine whether the stream can end.

```js
    function needFinish(state) {
      /*
        When the end function is executed, set ending=true,
        There is currently no data to write,
        There is also no cached data,
        The finish event has not been triggered yet,
        no writing in progress */
      return (state.ending &amp;&amp;
              state.length === 0 &amp;&amp;
              state.bufferedRequest === null &amp;&amp;
              !state.finished &amp;&amp;
              !state.writing);
    }

    // This function will also be called every time the writing is completed function finishMaybe(stream, state) {
      // Whether the stream can end var need = needFinish(state);
      // If yes, process the prefinish event first, otherwise leave it alone and wait for the writing to complete before calling the function if (need) {
        finish(stream, state);
        // If there is no pending callback, trigger the finish event if (state.pendingcb === 0) {
          state.finished = true;
          stream.emit('finish');
        }
      }
      return need;
    }
```

When all data and callbacks in the writable stream are executed, the stream can be terminated, and the prefinish event will be processed before the stream is terminated.

1.

```js
	 function callFinal(stream, state) {
      // Execute the user's final function stream._final((err) =&gt; {
        // The callFinal function is executed, cb minus one state.pendingcb--;
        if (err) {
          stream.emit('error', err);
        }
        // execute finish
        state.prefinished = true;
        stream.emit('prefinish');
        // Whether the finish event can be triggered finishMaybe(stream, state);
      });
    }
    function finish(stream, state) {
      // haven't triggered finish yet and didn't execute finalcall
      if (!state.prefinished &amp;&amp; !state.finalCalled) {
        // If the user passes the final function, the number of callbacks to be executed is increased by one, that is, callFinal, otherwise the prefinish is triggered directly
        if (typeof stream._final === 'function') {
          state.pendingcb++;
          state.finalCalled = true;
          process.nextTick(callFinal, stream, state);
        } else {
          state.prefinished = true;
          stream.emit('prefinish');
        }
      }
    }
```

If the user defines the \_final function, execute the function first (this will prevent the triggering of the finish event), trigger the prefinish after the execution, and then trigger the finish. If \_final is not defined, the finish event is fired directly. Finally trigger the finish event.

# 21.4 Bidirectional Streams Bidirectional streams are streams that inherit readable and writable.

```js
    util.inherits(Duplex, Readable);

    {
      // Add methods that exist in writable streams and that do not exist in both readable streams and Duplex to Duplex
      const keys = Object.keys(Writable.prototype);
      for (var v = 0; v &lt; keys. length; v++) {
        const method = keys[v];
        if (!Duplex.prototype[method])
          Duplex.prototype[method] = Writable.prototype[method];
      }
    }
```

```js
    function Duplex(options) {
      if (!(this instanceof Duplex))
        return new Duplex(options);

      Readable.call(this, options);
      Writable.call(this, options);
      // Bidirectional stream is readable by default if (options &amp;&amp; options.readable === false)
        this.readable = false;
      // Bidirectional stream is writable by default if (options &amp;&amp; options.writable === false)
        this.writable = false;
      // allow half-switches by default this.allowHalfOpen =
```
