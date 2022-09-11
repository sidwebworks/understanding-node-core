The HTTP module implements the functions of the HTTP server and client. It is the core module of Node.js and the module we use the most. In this chapter, we analyze the HTTP module, from which we can learn how an HTTP server and client are implemented, as well as some principles and optimizations of the HTTP protocol itself.

## 18.1 HTTP Parser The HTTP parser is the core of the HTTP module. Whether it is processing the request as a server or processing the response as a client, it needs to use the HTTP parser to parse the HTTP protocol. The new version of Node.js uses a new HTTP parser, llhttp. According to the official instructions, llhttp has greatly improved the performance of the old version of http_parser. In this section, we analyze the basic principles and use of llhttp. The HTTP parser is a very complex state machine. During the process of parsing data, hook functions are continuously triggered. The following are the hook functions supported by llhttp. If the user defines the corresponding hook, it will be called back during the parsing process.

```cpp
    // Start parsing HTTP protocol int llhttp__on_message_begin(llhttp_t* s, const char* p, const char* endp) {
      int err;
      CALLBACK_MAYBE(s, on_message_begin, s);
      return err;
    }

    // The callback when parsing the request url, and finally get a url
    int llhttp__on_url(llhttp_t* s, const char* p, const char* endp) {
      int err;
      CALLBACK_MAYBE(s, on_url, s, p, endp - p);
      return err;
    }

    // Callback for parsing out HTTP response status int llhttp__on_status(llhttp_t* s, const char* p, const char* endp) {
      int err;
      CALLBACK_MAYBE(s, on_status, s, p, endp - p);
      return err;
    }

    // Callback when parsing the header key int llhttp__on_header_field(llhttp_t* s, const char* p, const char* endp) {
      int err;
      CALLBACK_MAYBE(s, on_header_field, s, p, endp - p);
      return err;
    }

    // Callback when parsing the header value int llhttp__on_header_value(llhttp_t* s, const char* p, const char* endp) {
      int err;
      CALLBACK_MAYBE(s, on_header_value, s, p, endp - p);
      return err;
    }

    // Callback when parsing HTTP headers is completed int llhttp__on_headers_complete(llhttp_t* s, const char* p, const char* endp) {
      int err;
      CALLBACK_MAYBE(s, on_headers_complete, s);
      return err;
    }

    // Callback after parsing body int llhttp__on_message_complete(llhttp_t* s, const char* p, const char* endp) {
      int err;
      CALLBACK_MAYBE(s, on_message_complete, s);
      return err;
    }

    // Callback when parsing body int llhttp__on_body(llhttp_t* s, const char* p, const char* endp) {
      int err;
      CALLBACK_MAYBE(s, on_body, s, p, endp - p);
      return err;
    }

     // Callback when parsing a chunk structure header int llhttp__on_chunk_header(llhttp_t* s, const char* p, const char* endp) {
      int err;
      CALLBACK_MAYBE(s, on_chunk_header, s);
      return err;
    }

    // Callback when parsing a chunk int llhttp__on_chunk_complete(llhttp_t* s, const char* p, const char* endp) {
      int err;
      CALLBACK_MAYBE(s, on_chunk_complete, s);
      return err;
    }
```

Node.js encapsulates llhttp in node_http_parser.cc. This module exports an HTTPParser.

```cpp
    Local t=env-&gt;NewFunctionTemplate(Parser::New);
    t-&gt;InstanceTemplate()-&gt;SetInternalFieldCount(1);
    t-&gt;SetClassName(FIXED_ONE_BYTE_STRING(env-&gt;isolate(),
                      "HTTPParser"));
    target-&gt;Set(env-&gt;context(),
      FIXED_ONE_BYTE_STRING(env-&gt;isolate(), "HTTPParser"),
      t-&gt;GetFunction(env-&gt;context()).ToLocalChecked()).Check();
```

In Node.js we use HTTPParser in the following way.

```js
      const parser = new HTTPParser();

      cleanParser(parser);
      parser.onIncoming = null;
      parser[kOnHeaders] = parserOnHeaders;
      parser[kOnHeadersComplete] = parserOnHeadersComplete;
      parser[kOnBody] = parserOnBody;
      parser[kOnMessageComplete]= parserOnMessageComplete;
      // Initialize the message type processed by the HTTP parser, here is the response message parser.initialize(HTTPParser.RESPONSE,
         new HTTPClientAsyncResource('HTTPINCOMINGMESSAGE', req),
         req.maxHeaderSize || 0,
         req.insecureHTTPParser === undefined ?
         isLenient() : req.insecureHTTPParser);
      // After receiving the data, pass it to the parser for processing const ret = parser.execute(data);
    }
```

Let's take a look at the code for initialize and execute. The Initialize function is used to initialize llhttp.

```cpp
    static void Initialize(const FunctionCallbackInfo &amp; args) {
       Environment* env = Environment::GetCurrent(args);
       bool lenient = args[3]-&gt;IsTrue();

       uint64_t max_http_header_size = 0;
       // max size of header if (args.Length() &gt; 2) {
         max_http_header_size = args[2].As ()-&gt;Value();
       }
       // If not set, take the default value of Node.js if (max_http_header_size == 0) {
         max_http_header_size=env-&gt;options()-&gt;max_http_header_size;
       }
       // The parsed message type llhttp_type_t type =
           static_cast (args[0].As ()-&gt;Value());

       CHECK(type == HTTP_REQUEST || type == HTTP_RESPONSE);
       Parser* parser;
       ASSIGN_OR_RETURN_UNWRAP(&amp;parser, args.Holder());
       parser-&gt;Init(type, max_http_header_size, lenient);
     }
```

Initialize calls Init after doing some preprocessing.

```cpp
    void Init(llhttp_type_t type, uint64_t max_http_header_size, bool lenient) {
       // Initialize llhttp
       llhttp_init(&amp;parser_, type, &amp;settings);
       llhttp_set_lenient(&amp;parser_, lenient);
       header_nread_ = 0;
       url_.Reset();
       status_message_.Reset();
       num_fields_ = 0;
       num_values_ = 0;
      have_flushed_ = false;
      got_exception_ = false;
      max_http_header_size_ = max_http_header_size;
    }
```

Init initializes some fields. The most important thing is to call llhttp_init to initialize llhttp. In addition, the attribute at the beginning of kOn is a hook function, which is called by the callback in node_http_parser.cc, and node_http_parser.cc also defines the hook function, which is called by llhttp Callback, let's take a look at the definition and implementation of the hook function in node_http_parser.cc.

```cpp
    const llhttp_settings_t Parser::settings = {
      proxy ::Raw,
      proxy ::Raw,
      proxy ::Raw,
      proxy ::Raw,
      proxy ::Raw,
      proxy ::Raw,
      proxy ::Raw,
      proxy ::Raw,
     proxy ::Raw,
     proxy ::Raw,
    };
```

1 Callback to start parsing the message ````cpp
// Start parsing the message, a TCP connection may have multiple messages int on*message_begin() {  
 num_fields* = num*values* = 0;  
 url*.Reset();  
 status_message*.Reset();  
 return 0;  
 }

````

2 Callback when parsing url ```cpp
    int on_url(const char* at, size_t length) {
        int rv = TrackHeader(length);
        if (rv != 0) {
          return rv;
        }

        url_.Update(at, length);
        return 0;
      }
````

3 Callback when parsing HTTP response ````cpp
int on_status(const char\* at, size_t length) {  
 int rv = TrackHeader(length);  
 if (rv != 0) {  
 return rv;  
 }

        status_message_.Update(at, length);
        return 0;
      }

````

4 Callback ```cpp when the key of the HTTP header is parsed
    int on_header_field(const char* at, size_t length) {
        int rv = TrackHeader(length);
        if (rv != 0) {
          return rv;
        }
        // Equality means that the parsing of key pair values ​​is one-to-one correspondence if (num_fields_ == num_values_) {
          // start of new field name
          // add one to the number of keys num_fields_++;
          // If the threshold is exceeded, call back js to consume if (num_fields_ == kMaxHeaderFieldsCount) {
            // ran out of space - flush to javascript land
            Flush();
            // restart num_fields_ = 1;
            num_values_ = 0;
          }
          // Initialize fields_[num_fields_ - 1].Reset();
        }

        // save key0;

        // METHOD
        if (parser_.type == HTTP_REQUEST) {
          argv[A_METHOD] =
              Uint32::NewFromUnsigned(env()-&gt;isolate(), parser_.method);
        }

        //STATUS
        if (parser_.type == HTTP_RESPONSE) {
          argv[A_STATUS_CODE] =
              Integer::New(env()-&gt;isolate(), parser_.status_code);
          argv[A_STATUS_MESSAGE] = status_message_.ToString(env());
        }

        // VERSION
        argv[A_VERSION_MAJOR] = Integer::New(env()-&gt;isolate(), parser_.http_major);
        argv[A_VERSION_MINOR] = Integer::New(env()-&gt;isolate(), parser_.http_minor);

        bool should_keep_alive;
        // Whether the keepalive header is defined should_keep_alive = llhttp_should_keep_alive(&amp;parser_);

        argv[A_SHOULD_KEEP_ALIVE] =
            Boolean::New(env()-&gt;isolate(), should_keep_alive);
        // Is it an upgrade protocol argv[A_UPGRADE] = Boolean::New(env()-&gt;isolate(), parser_.upgrade);

        MaybeLocal head_response;
        {
          InternalCallbackScope callback_scope(
              this, InternalCallbackScope::kSkipTaskQueues);
          head_response = cb.As ()-&gt;Call(
              env()-&gt;context(), object(), arraysize(argv), argv);
        }

        int64_t val;

        if (head_response.IsEmpty() || !head_response.ToLocalChecked()
                                            -&gt;IntegerValue(env()-&gt;context())
                                            .To(&amp;val)) {
          got_exception_ = true;
          return -1;
        }

        return val;
      }
````

on_headers_complete will execute the kOnHeadersComplete hook of the JS layer.

7 Callback when parsing body ````cpp
int on_body(const char\* at, size_t length) {  
 EscapableHandleScope scope(env()-&gt;isolate());

        Local obj = object();
        Local cb = obj-&gt;Get(env()-&gt;context(), kOnBody).ToLocalChecked();

        // We came from consumed stream
        if (current_buffer_.IsEmpty()) {
          // Make sure Buffer will be in parent HandleScope
          current_buffer_ = scope.Escape(Buffer::Copy(
              env()-&gt;isolate(),
              current_buffer_data_,
              current_buffer_len_).ToLocalChecked());
        }

        Local argv[3] = {
          // The data currently being parsed current_buffer_,
          // The starting position of the body Integer::NewFromUnsigned(env()-&gt;isolate(), at - current_buffer_data_),
          // body current length Integer::NewFromUnsigned(env()-&gt;isolate(), length)
        };

        MaybeLocal r = MakeCallback(cb.As (),
                                           arraysize(argv),
                                           argv);

        return 0;
      }

`````

Node.js does not create a new HTTP parser every time an HTTP message is parsed. Node.js uses the FreeList data structure to manage the HTTP parser instance.

````js
    class FreeList {
      constructor(name, max, ctor) {
        this.name = name;
        // constructor this.ctor = ctor;
        // The maximum value of the node this.max = max;
        // Instance list this.list = [];
      }
      // allocate an instance alloc() {
        // If there is free, return directly, otherwise create a new one return this.list.length &gt; 0 ?
          this.list.pop() :
          ReflectApply(this.ctor, this, arguments);
      }
      // release the instance free(obj) {
        // If it is less than the threshold, put it on the free list, otherwise release (the caller is responsible for releasing)
        if (this.list.length &lt; this.max) {
          this.list.push(obj);
          return true;
        }
        return false;
      }
    }
`````

Let's take a look at the use of FreeList in Node.js. .

```js
    const parsers = new FreeList('parsers', 1000, function parsersCb() {
      const parser = new HTTPParser();
      // Initialize field cleanParser(parser);
      // set hook parser.onIncoming = null;
      parser[kOnHeaders] = parserOnHeaders;
      parser[kOnHeadersComplete] = parserOnHeadersComplete;
      parser[kOnBody] = parserOnBody;
     eepAlive) {
        console.log('kOnHeadersComplete', headers);
    }

    parser[kOnBody] = function(b, start, len) {
        console.log('kOnBody', b.slice(start).toString('utf-8'));
    }
    parser[kOnMessageComplete] = function() {
        console.log('kOnMessageComplete');
    }
    parser[kOnExecute] = function(a,b) {
        console.log('kOnExecute, number of bytes parsed: ',a);
    }
    // start a server net.createServer((socket) =&gt; {
      parser.consume(socket._handle);
    }).listen(80);

    // start a client setTimeout(() =&gt; {
      var socket = net.connect({port: 80});
      socket.end('GET / HTTP/1.1\r\n' +
        'Host: http://localhost\r\n' +
        'content-length: 1\r\n\r\n'+
        '1');
    }, 1000);
```

We need to call the parser.consume method and pass in a stream of isStreamBase (defined in stream_base.cc) to trigger kOnExecute. Because kOnExecute is fired when the StreamBase stream is readable.

## 18.2 HTTP Client Let's first look at an example of using Node.js as a client.

```js
    const data = querystring.stringify({
      'msg': 'hi'
    });

    const options = {
      hostname: 'your domain',
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = http.request(options, (res) =&gt; {
      res.setEncoding('utf8');
      res.on('data', (chunk) =&gt; {
        console.log(`${chunk}`);
      });
      res.on('end', () =&gt; {
        console.log('end');
      });
    });

    req.on('error', (e) =&gt; {
      console.error(`${e.message}`);
    });
    // Send the requested data req.write(data);
    // set request end req.end();
```

Let's look at the implementation of http.request.

```js
function request(url, options, cb) {
  return new ClientRequest(url, options, cb);
}
```

The HTTP client is implemented through the ClientRequest of \_http_client.js. The ClientRequest code is very large, and we only analyze the core process. Let's look at the logic of initializing a request.

```js
    function ClientRequest(input, options, cb) {
      // inherit OutgoingMessage
      OutgoingMessage.call(this);
      // Whether to use agent
      let agent = options.agent;
      // Ignore the processing of agent, refer to _http_agent.js for details, mainly used for multiplexing TCP connection this.agent = agent;
      // Timeout for establishing a connection if (options.timeout !== undefined)
        this.timeout = getTimerDuration(options.timeout, 'timeout');
      // Threshold of HTTP headers const maxHeaderSize = options.maxHeaderSize;
      this.maxHeaderSize = maxHeaderSize;
      // Listen for response events if (cb) {
        this.once('response', cb);
      }
      // Ignore the logic of setting the request line or request header of the http protocol// The callback after establishing the TCP connection const oncreate = (err, socket) =&gt; {
        if (called)
          return;
        called = true;
        if (err) {
          process.nextTick(() =&gt; this.emit('error', err));
          return;
        }
        // The connection is established successfully, and the callback is executed this.onSocket(socket);
        // Send data after successful connection this._deferToConnect(null, null, () =&gt; this._flush());
      };

      // When using the agent, the socket is provided by the agent, otherwise create the socket yourself
      if (this.agent) {
        this.agent.addRequest(this, options);
      } else {
        // If no agent is used, a socket is created each time, and the interface of the net module is used by default if (typeof options.createConnection === 'function') {
          const newSocket = options.createConnection(options,
                                                          oncreate);
          if (newSocket &amp;&amp; !called) {
            called = true;
            this.onSocket(newSocket);
          } else {
            return;
          }
        } else {
          this.onSocket(net.createConnection(options));
        }
      }
      // Send the data to be cached after the connection is successful this._deferToConnect(null, null, () =&gt; this._flush());
    }
```

After obtaining a ClientRequest instance, whether you create a TCP connection through the agent or yourself, onSocket will be executed after the connection is successful.

`````js
    // Callback when socket is available ClientRequest.prototype.onSocket = function onSocket(socket) {
      process.nextTick(onSocketNT, this, socket);
    };

    function onSocketNT(req, socket) {
      //The parsing will continuously trigger the hook function during the parsing process. Let's take a look at the logic of each hook function in the JS layer.
1 The callback executed in the process of parsing the header ````js
    function parserOnHeaders(headers, url) {
      // save the header and url
      if (this.maxHeaderPairs &lt;= 0 ||
          this._headers.length &lt; this.maxHeaderPairs) {
        this._headers = this._headers.concat(headers);
      }
      this._url += url;
    }
`````

2 After parsing the callback in the header ```js
function parserOnHeadersComplete(versionMajor,  
 versionMinor,  
 headers,  
 method,  
 url,  
 statusCode,  
 statusMessage,  
 upgrade,  
 shouldKeepAlive) {  
 const parser = this;  
 const { socket } = parser;  
 // remaining HTTP headers if (headers === undefined) {  
 headers = parser.\_headers;  
 parser.\_headers = [];  
 }

       if (url === undefined) {
         url = parser._url;
         parser._url = '';
       }

       // Parser is also used by http client
       // IncomingMessage
       const ParserIncomingMessage=(socket &amp;&amp;
                                       socket.server &amp;&amp;
                                    socket.server[kIncomingMessage]
                                       ) ||
                                       IncomingMessage;
       // Create a new IncomingMessage object const incoming = parser.incoming = new ParserIncomingMessage(socket);
       incoming.httpVersionMajor = versionMajor;
       incoming.httpVersionMinor = versionMinor;
       incoming.httpVersion = `${versionMajor}.${versionMinor}`;
       incoming.url = url;
       incoming.upgrade = upgrade;

       let n = headers.length;
       // If parser.maxHeaderPairs &lt;= 0 assume that there's no limit.
       if (parser.maxHeaderPairs &gt; 0)
         n = MathMin(n, parser.maxHeaderPairs);
       // Update to the object that holds the HTTP headers incoming._addHeaderLines(headers, n);
       // request method or response line information if (typeof method === 'number') {
         // server only
         incoming.method = methods[method];
       } else {
         // client only
         incoming.statusCode = statusCode;
         incoming.statusMessage = statusMessage;
       }
       // Execute callback return parser.onIncoming(incoming, shouldKeepAlive);
     }

`````

We see that after parsing the header, another callback onIncoming will be executed, and an instance of IncomingMessage will be passed in, which is the res we usually use. As analyzed earlier, the value set by onIncoming is parserOnIncomingClient.

````js
    function parserOnIncomingClient(res, shouldKeepAlive) {
      const socket = this.socket;
      // request object const req = socket._httpMessage;
      // The server sent multiple responses if (req.res) {
        socket.destroy();
        return 0;
      }
      req.res = res;

      if (statusIsInformational(res.statusCode)) {
        req.res = null;
        // If the expect header is set during the request, the response code is 100, and data can continue to be sent if (res.statusCode === 100) {
          req.emit('continue');
        }
        return 1;
      }

      req.res = res;
      res.req = req;

      // Wait for the response to end, and clear the timer after the response is over res.on('end', responseOnEnd);
      // The request is terminated or the response event is triggered, return false to indicate that the response event is not listened to, then discard the data if (req.aborted || !req.emit('response', res))
        res._dump();

    }
`````

From the source code, we can see that when the HTTP response header is parsed, the callback function set by http.request is executed. For example the callback in the code below.

```js
    http.request('domain', { agent }, (res) =&gt; {
        // Parse body
        res.on('data', (data) =&gt; {
          //
        });
         // End of parsing body, end of response res.on('end', (data) =&gt; {
          //
        });
    });
    // ...
```

In the callback, we can use res as a stream. After parsing the HTTP header, the HTTP parser will continue to parse the HTTP body. Let's take a look at the callbacks that the HTTP parser executes while parsing the body.

```js
    function parserOnBody(b, start, len) {
      const stream = this.incoming;
      if (len &gt; 0 &amp;&amp; !stream._dumped) {
        const slice = b. slice(start, start +this.outputData = [{
              data: header,
              encoding: 'latin1',
              callback: null
            }];
          } else {
            this.outputData.unshift({
              data: header,
              encoding: 'latin1',
              callback: null
            });
          }
          // update cache size this.outputSize += header.length;
          this._onPendingData(header.length);
        }
        // already queued for sending, cannot modify this._headerSent = true;
      }
      return this._writeRaw(data, encoding, callback);
    };
```

We continue to look at \_writeRaw

```js
    OutgoingMessage.prototype._writeRaw = function _writeRaw(data, encoding, callback) {

      // Send directly if writable (conn &amp;&amp; conn._httpMessage === this &amp;&amp; conn.writable) {
        // There might be pending data in the this.output buffer.
        // If there is cached data, send the cached data first if (this.outputData.length) {
          this._flushOutput(conn);
        }
        // Then send the current return that needs to be sent conn.write(data, encoding, callback);
      }
      // No cache this.outputData.push({ data, encoding, callback });
      this.outputSize += data.length;
      this._onPendingData(data.length);
      return this.outputSize &lt; HIGH_WATER_MARK;
    }

    OutgoingMessage.prototype._flushOutput = function _flushOutput(socket) {
      // If blocking is set before, the operation socket first accumulates data while (this[kCorked]) {
        this[kCorked]--;
        socket.cork();
      }

      const outputLength = this.outputData.length;
      if (outputLength &lt;= 0)
        return undefined;

      const outputData = this. outputData;
      socket.cork();
      // write buffered data to socket
      let ret;
      for (let i = 0; i &lt; outputLength; i++) {
        const { data, encoding, callback } = outputData[i];
        ret = socket.write(data, encoding, callback);
      }
      socket.uncork();

      this.outputData = [];
      this._onPendingData(-this.outputSize);
      this.outputSize = 0;

      return ret;
    };
```

After writing the data, we also need to execute the end function to mark the end of the HTTP request.

```js
    OutgoingMessage.prototype.end = function end(chunk, encoding, callback) {
      // not over yet // add stop if (this. socket) {
        this.socket.cork();
      }

      // Callback after stream ends if (typeof callback === 'function')
        this.once('finish', callback);
      // Callback after data is written to the bottom layer const finish = onFinish.bind(undefined, this);
      // A 0\r\n end tag needs to be sent after the chunk mode, otherwise the end tag is not needed if (this._hasBody &amp;&amp; this.chunkedEncoding) {
        this._send('0\r\n' +
                    this._trailer + '\r\n', 'latin1', finish);
      } else {
        this._send('', 'latin1', finish);
      }
      // uncork removes the plug and sends data if (this.socket) {
        // Fully uncork connection on end().
        this.socket._writableState.corked = 1;
        this.socket.uncork();
      }
      this[kCorked] = 0;
      // mark execution of end
      this.finished = true;
      // The data is sent if (this.outputData.length === 0 &amp;&amp;
          this.socket &amp;&amp;
          this.socket._httpMessage === this) {
        this._finish();
      }

      return this;
    };
```

## 18.3 HTTP Server In this section we will analyze an example of using Node.js as a server.

```js
    const http = require('http');
    http.createServer((req, res) =&gt; {
      res.write('hello');
      res.end();
    })
    .listen(3000);
```

Then we analyze the principle of Node.js as a server along the createServer.

```js
function createServer(opts, requestListener) {
  return new Server(opts, requestListener);
}
```

Let's look at the implementation of Server ```js
function Server(options, requestListener) {  
 // You can customize the object representing the request and the response object this[kIncomingMessage] = options.IncomingMessage || IncomingMessage;  
 this[kServerResponse] = options.ServerResponse || ServerResponse;  
 // Threshold of HTTP headers const maxHeaderSize = options.maxHeaderSize;  
 this.maxHeaderSize =se.bind(undefined, socket, state);  
 state.onDrain = socketOnDrain.bind(undefined, socket, state);  
 socket.on('data', state.onData);  
 socket.on('error', socketOnError);  
 socket.on('end', state.onEnd);  
 socket.on('close', state.onClose);  
 socket.on('drain', state.onDrain);  
 // Callback executed after parsing the HTTP header parser.onIncoming = parserOnIncoming.bind(undefined,  
 server,  
 socket,  
 state);  
 socket.on('resume', onSocketResume);  
 socket.on('pause', onSocketPause);

       /*
         If handle is a stream that inherits StreamBase, execute consume to consume http
         Request message, not onData above, isStreamBase of tcp module is true
       */
       if (socket._handle &amp;&amp; socket._handle.isStreamBase &amp;&amp;
           !socket._handle._consumed) {
         parser._consumed = true;
         socket._handle._consumed = true;
         parser.consume(socket._handle);
       }
       parser[kOnExecute] =
         onParserExecute.bind(undefined,
                                server,
                                socket,
                                parser,
                                state);

       socket._paused = false;
     }

`````

After executing the connectionListener, it starts to wait for the arrival of data on tcp, that is, the HTTP request message. In the above code, Node.js listens to the data event of the socket and registers the hook kOnExecute. We all know that the data event is an event that is triggered when data arrives on the stream. Let's see what socketOnData does.

````js
    function socketOnData(server, socket, parser, state, d) {
      // Give it to the HTTP parser for processing, and return the number of bytes that have been parsed const ret = parser.execute(d);
      onParserExecuteCommon(server, socket, parser, state, ret, d);
    }
`````

The processing logic of socketOnData is that when there is data on the socket, it is handed over to the HTTP parser for processing. This looks fine, so what does kOnExecute do? The value of the kOnExecute hook function is onParserExecute, which also seems to parse the data on tcp. It seems to have the same function as onSocketData. Does the data on tcp have two consumers? Let's see when kOnExecute is called back.

```cpp
    void OnStreamRead(ssize_t nread, const uv_buf_t&amp; buf) override {

        Local ret = Execute(buf.base, nread);
        Local cb =
            object()-&gt;Get(env()-&gt;context(), kOnExecute).ToLocalChecked();
        MakeCallback(cb.As (), 1, &amp;ret);
      }
```

OnStreamRead is a function implemented by node_http_parser.cc, so kOnExecute is called back in OnStreamRead in node_http_parser.cc, so when is OnStreamRead called back? In the C++ layer chapter, we have analyzed that OnStreamRead is a general function for C++ layer stream operations in Node.js, and the callback will be executed when the stream has data. And OnStreamRead will also hand over the data to the HTTP parser for parsing. Does it seem like there are really two consumers? This is very strange, why a piece of data is handed over to the HTTP parser to be processed twice?

```cpp
    if (socket._handle &amp;&amp; socket._handle.isStreamBase &amp;&amp; !socket._handle._consumed) {
      parser._consumed = true;
      socket._handle._consumed = true;
      parser.consume(socket._handle);
    }
```

Because the TCP stream inherits the StreamBase class, if is true. Let's look at the implementation of consume.

```cpp
    static void Consume(const FunctionCallbackInfo &amp; args) {
      Parser* parser;
      ASSIGN_OR_RETURN_UNWRAP(&amp;parser, args.Holder());
      CHECK(args[0]-&gt;IsObject());
      StreamBase* stream = StreamBase::FromObjject(args[0].As ());
      CHECK_NOT_NULL(stream);
      stream-&gt;PushStreamListener(parser);
    }
```

The HTTP parser registers itself as a listener for the TCP stream. This will cause the data on the TCP stream to be consumed directly by OnStreamRead of node_http_parser.cc instead of triggering the onData event. In OnStreamRead, the data will be continuously handed over to the HTTP parser for processing. During the parsing process, the corresponding hook function will be triggered continuously until parserOnIncoming is executed after parsing the HTTP header.

```js
    function parserOnIncoming(server, socket, state, req, keepAlive) {
      // Need to reset the timer resetSocketTimeout(server, socket, state);
      // If keepAlive is set, some states need to be reset after the response if (server.keepAliveTimeout &gt; 0) {
        req.on('end', resetHeadersTimeoutOnReqEnd);
      }

      // Mark header is parsed socket.parser.parsingHeadersStart = 0;

      // request enqueue (queue of pending requests)
      state.incoming.push(req);

      if (!socket._paused) {
        const ws = socket._writableState;
        // Too much data to be sent, first suspend receiving request data if (ws.needDrain ||
            state.outgoingData &gt;= socket.writableHighWaterMark) {
          socket._paused = true;
          socket.pause();
        }
      }
      //;
      request.on('end', () =&gt; {
       // end of body });
    })
```

### 18.3.1 The principle of HTTP pipelining and when implementing HTTP1.0, pipelining is not supported. When the client sends a request, it first establishes a TCP connection, then the server returns a response, and finally disconnects the TCP connection. This is the easiest way to implement, but each time a request is sent, it requires three-way handshakes, which obviously brings a certain amount of time loss. Therefore, in HTTP 1.1, pipelining is supported. Pipelining means that multiple requests can be sent on one TCP connection, so that the server can process multiple requests at the same time, but due to the limitation of HTTP1.1, the responses of multiple requests need to be returned in order. Because in HTTP1.1, there is no corresponding relationship between marked requests and responses. So the HTTP client will assume that the first response returned corresponds to the first request. This can cause problems if returned out of order, as shown in Figure 18-2.

![](https://img-blog.csdnimg.cn/e7bc0bded22c414cb3214d4022425dfb.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6y9ibG0nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size)  
 Figure 18-2  
 In HTTP 2.0, each request will be assigned an id, and the corresponding id will be returned in the response, so that the HTTP client can know the request corresponding to the response even if it is returned out of order. In the case of HTTP 1.1, the implementation of the HTTP server will become complicated. The server can process requests in a serial manner. After the response of the previous request is returned to the client, it will continue to process the next request. This implementation method It is relatively simple, but obviously, this method is relatively inefficient. Another implementation method is to process the request in parallel and return it serially, so that the request can be processed as soon as possible. For example, both requests access Database, then processing two requests in parallel will be much faster than serial, but this implementation method is relatively complex, Node.js belongs to this method, let's take a look at how it is implemented in Node.js. As previously analyzed, Node.js executes parserOnIncoming after parsing the HTTP header.

```js
    function parserOnIncoming(server, socket, state, req, keepAlive) {
      // Mark header is parsed socket.parser.parsingHeadersStart = 0;
      // Request to enter the queue state.incoming.push(req);
      // Create a new object representing the response, usually ServerResponse
      const res = new server[kServerResponse](req);
      /*
        If the socket is currently processing the response of other requests, it will be queued first.
       Otherwise mount the response object to the socket as the currently processed response */
      if (socket._httpMessage) {
        state.outgoing.push(res);
      } else {
        res.assignSocket(socket); // socket._httpMessage = res;
      }
      // After the response is processed, some processing needs to be done res.on('finish', resOnFinish.bind(undefined,
                                            req,
                                            res,
                                            socket,
                                            state,
                                            server));
      // Trigger the request event to indicate that there is a request coming server.emit('request', req, res);
      return 0;
    }
```

When Node.js finishes parsing the HTTP request header, it creates a ServerResponse object to represent the response. Then judge whether there is currently a response being processed, and if so, queue it up for processing, otherwise use the newly created ServerResponse object as the response that needs to be processed currently. Finally, the request event is triggered to notify the user layer. The user can then process the request. We see that Node.js maintains two queues, the request and response queues, as shown in Figure 18-3.  
 ![](https://img-blog.csdnimg.cn/a99cf25b0c094f07b193a7d996535ce0.png)  
 Figure 18-3  
 The currently processed request is at the head of the request queue, and the response corresponding to the request will be mounted on the \_httpMessage attribute of the socket. But we see that Node.js will trigger the request event to notify the user that a new request is coming, so in the case of pipeline, Node.js will process multiple requests in parallel (if it is a cpu-intensive request, it will actually become Serial, which is related to Node.js's single thread). So how does Node.js control the order of responses? We know that every time the request event is fired, we will execute a function. For example the code below.

```js
     http.createServer((req, res) =&gt; {
      // some network IO
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('okay');
    });
```

We see that each request is handled independently. Assuming that each request operates the database, if request 2 completes the database operation before request 1, request 2 executes res.write and res.end first. Does that mean request 2 returns first? Let's take a look at the implementation of ServerResponse and OutgoingMessage to uncover the fog. ServerResponse is a subclass of OutgoingMessage. The write function is implemented in OutgoingMessage. The call link of write is very long. We do not analyze layer by layer, but directly look at the last node.

```js
    function _writeRaw(data, encoding, callback) {
      const conn = this. socket;
      // The response corresponding to the socket is itself and writable if (conn &amp;&amp; conn._httpMessage === this &amp;&amp; conn.writable) {
        // If there is cached data, send the cached data first if (this.outputData.length) {
          this._flushOutput(conn);
        }
        // Then send the current return that needs to be sent conn.write(data, encoding, callback);
      }
      // The response object currently processed by the socket is not itself, then the data is cached first.
      this.outputData.push({ data, encoding, callback });
      this.outputSize += data.length;
      this._onPendingData(data.length);
      return this.outputSize &lt; HIGH_WATER_MARK;
    }
```

We see that when we call res.write, Node.js will first determine whether res is the response currently being processed. If so, the data will be sent, otherwise, the data will be cached first. At this point, I believe that everyone has almost understood how Node.js controls the response to be returned in order. Finally we look at when the cached data will be sent out. The previous code has been posted, and when a response ends, Node.js will do some processing.

```js
res.on("finish", resOnFinish.bind(undefined, req, res, socket, state, server));
```

Let's look at resOnFinish

`````js
    function resOnFinish(req, res,What about the last request? When unpipelined, one request one response, then the TCP connection is closed, so unpipelined the first and only request on tcp is the last request. In the case of pipelining, there is theoretically no so-called last response. But there will be some restrictions on the implementation. In the case of pipelining, each response can be set by setting the HTTP response header connection to define whether to disconnect after sending the response. Let's take a look at the implementation of Node.js.

````js
    // Whether to show that the connection header has been deleted, if yes, disconnect the connection after the response, and mark the current response as the last one if (this._removedConnection) {
       this._last = true;
       this.shouldKeepAlive = false;
     } else if (!state.connection) {
       /*
        If the connection header is not set, the default behavior 1 Node.js shouldKeepAlive is set to true by default. You can also set content-length or use chunk mode according to the connection header definition in the request message to distinguish the boundary of the response message.
          to support keepalive
       3 Using a proxy, the proxy multiplexes the TCP connection and supports keepalive
       */
       const shouldSendKeepAlive = this.shouldKeepAlive &amp;&amp;
           (state.contLen ||
             this.useChunkedEncodingByDefault ||
             this.agent);
       if (shouldSendKeepAlive) {
         header += 'Connection: keep-alive\r\n';
       } else {
         this._last = true;
         header += 'Connection: close\r\n';
       }
     }
`````

In addition, when the read end is closed, it is also considered to be the last request, after all, no more requests will be sent. Let's take a look at the logic of read-side closing.

```js
    function socketOnEnd(server, socket, parser, state) {
      const ret = parser.finish();

      if (ret instanceof Error) {
        socketOnError.call(socket, ret);
        return;
      }
      // If half switch is not allowed, the processing of the request will be terminated, no response, and the write end will be closed if (!server.httpAllowHalfOpen) {
        abortIncoming(state.incoming);
        if (socket.writable) socket.end();
      } else if (state.outgoing.length) {
        /*
          Half-switches are allowed, and there are still responses to process,
          Mark the last node of the response queue as the last response,
          Close the socket write end after processing */
        state.outgoing[state.outgoing.length - 1]._last = true;
      } else if (socket._httpMessage) {
        /*
          There are no more responses waiting to be processed, but there are still responses being processed,
          then mark as the last response */
        socket._httpMessage._last = true;
      } else if (socket. writable) {
        // Otherwise close the socket writer socket.end();
      }
    }
```

The above is the case of judging whether it is the last response in Node.js. If a response is considered to be the last response, the connection will be closed after sending the response.  
 2 The response queue is empty Let's continue to see how Node.js handles if it is not the last response. If the current pending response queue is empty, it means that the currently processed response is the last one that needs to be processed, but not the last response on the TCP connection. At this time, Node.js will set the timeout time. If there is no new request after the timeout , Node.js will close the connection.  
 3 The response queue is not empty If the current pending queue is not empty, it will continue to process the next response after processing the current request. and remove that response from the queue. Let's see how Node.js handles the next response.

```js
    // Mount the response object to the socket and mark the response currently being processed by the socket ServerResponse.prototype.assignSocket = function assignSocket(socket) {
      // Mounted on the socket, the mark is the currently processed response socket._httpMessage = this;
      socket.on('close', onServerResponseClose);
      this.socket = socket;
      this.emit('socket', socket);
      this._flush();
    };
```

We see that Node.js marks the currently processed response through \_httpMessage, and cooperates with the response queue to return the response in order. After marking, execute \_flush to send the response data (if the request has been processed at this time)

```js
    OutgoingMessage.prototype._flush = function _flush() {
      const socket = this.socket;
      if (socket &amp;&amp; socket. writable) {
        const ret = this._flushOutput(socket);
    };

    OutgoingMessage.prototype._flushOutput = function _flushOutput(socket) {
      // If blocking is set before, the operation socket first accumulates data while (this[kCorked]) {
        this[kCorked]--;
        socket.cork();
      }

      const outputLength = this.outputData.length;
      // no data to send if (outputLength &lt;= 0)
        return undefined;

      const outputData = this. outputData;
      // Plug and let the data be sent together socket.cork();
      // write buffered data to socket
      let ret;
      for (let i = 0; i &lt; outputLength; i++) {
        const { data, encoding, callback } = outputData[i];
        ret = socket.write(data, encoding, callback);
      }
      socket.uncork();

      this.outputData = [];
      this._onPendingData(-this.outputSize);
      this.outputSize = 0;

      return ret;
    }
```

The above is the implementation of pipeline in Node.js.

### 18.3.2 The principle and implementation of the HTTP Connect method Before analyzing the implementation of HTTP Connect, let's first look at why the HTTP Connect method is needed or the background of its appearance. The Connect method is mainly used for request forwarding by proxy servers. Let's take a look at how a traditional HTTP server works, as shown in Figure 18-4.

Take a look at an example from the official Node.js.

```js
    const http = require('http');
    const net = require('net');
    const { URL } = require('url');
    // Create an HTTP server as a proxy server const proxy = http.createServer((req, res) =&gt; {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('okay');
    });
    // Listen to the connect event, trigger proxy.on('connect', (req, clientSocket, head) =&gt; {
      // Get the actual server address to connect to and initiate a connection const { port, hostname } = new URL(`http://${req.url}`);
      const serverSocket = net.connect(port || 80, hostname, () =&gt; {
        // Tell the client that the connection is successful clientSocket.write('HTTP/1.1 200 Connection Established\r\n' +
                        'Proxy-agent: Node.js-Proxy\r\n' +
                        '\r\n');
        // Transparent transmission of client and server data serverSocket.write(head);
        serverSocket.pipe(clientSocket);
        clientSocket.pipe(serverSocket);
      });
    });

    proxy.listen(1337, '127.0.0.1', () =&gt; {

      const options = {
        port: 1337,
        // The connected proxy server address host: '127.0.0.1',
        method: 'CONNECT',
        // We need the server address path we really want to access: 'www.baidu.com',
      };
      // Initiate http connect request const req = http.request(options);
      req.end();
      // trigger req.on('connect', (res, socket, head) =&gt; {
        // send real request socket.write('GET / HTTP/1.1\r\n' +
                     'Host: www.baidu.com\r\n' +
                     'Connection: close\r\n' +
                     '\r\n');
        socket.on('data', (chunk) =&gt; {
          console.log(chunk.toString());
        });
        socket.on('end', () =&gt; {
          proxy.close();
        });
      });
    });
```

This example on the official website is a good illustration of the principle of Connect, as shown in Figure 18-6.  
 ![](https://img-blog.csdnimg.cn/d0485b3ab36a46a9b549efa0992406fb.png?x-oss-process=image/watermark,type_ZmFuZ3poZW5naGVpdGk,shadow_10,text_aHR0cHM6Ly9ibG09nLmNzZG4ubmV0L1RIRUFOQVJLSA==,size_1RIRUFOQVJLSA==)  
 Figure 18-6  
 Let's take a look at the implementation of Connect in Node.js. We start with an HTTP Connect request. It has been analyzed before that after the client and the Node.js server establish a TCP connection, when Node.js receives the data, it will be handed over to the HTTP parser for processing.

```js
    // There is data coming on the connection function socketOnData(server, socket, parser, state, d) {
      // Give it to the HTTP parser for processing, and return the number of bytes that have been parsed const ret = parser.execute(d);
      onParserExecuteCommon(server, socket, parser, state, ret, d);
    }
```

During the process of HTTP parsing data, the callback of Node.js will be continuously called back, and then onParserExecuteCommon will be executed. Here we only focus on executing parserOnHeadersComplete after Node.js has parsed all HTTP request headers.

```js
    function parserOnHeadersComplete(versionMajor, versionMinor, headers, method,
                                     url, statusCode, statusMessage, upgrade,
                                     shouldKeepAlive) {
      const parser = this;
      const { socket } = parser;

      // IncomingMessage
      const ParserIncomingMessage = (socket &amp;&amp; socket.server &amp;&amp;
                                     socket.server[kIncomingMessage]) ||
                                     IncomingMessage;
      // Create a new IncomingMessage object const incoming = parser.incoming = new ParserIncomingMessage(socket);
      incoming.httpVersionMajor = versionMajor;
      incoming.httpVersionMinor = versionMinor;
      incoming.httpVersion = `${versionMajor}.${versionMinor}`;
      incoming.url = url;
      // Whether it is a connect request or an upgrade request incoming.upgrade = upgrade;

      // Execute callback return parser.onIncoming(incoming, shouldKeepAlive);
    }
```

We see that after parsing the HTTP header, Node.js will create an object IncomingMessage representing the request, and then call back onIncoming.

```js
function parserOnIncoming(server, socket, state, req, keepAlive) {
  // Whether the request is connect or upgrade
  if (req.upgrade) {
    req.upgrade =
      req.method === "CONNECT" || server.listenerCount("upgrade") & gt;
    0;
    if (req.upgrade) return 2;
  }
  // ...
}
```

After Node.js parses the header and executes the response hook function, it will execute onParserExecuteCommon.

`````js
    functionA socket, then construct the HTTP Connect message yourself, and add an extra string after the HTTP line, which is two HTTP requests. When the Node.js server receives the Connect request, we pass the excess data of the Connect request to the real server in the handler of the connect event. This saves the time of sending a request.
### 18.3.3 Timeout management When parsing the HTTP protocol or supporting long connections, Node.js needs to set some timeout mechanisms, otherwise it will cause attacks or waste of resources. Let's take a look at some logic involved in timeouts in the HTTP server.
1 Timeout for parsing HTTP headers When an HTTP request message is received, it will be parsed in the order of HTTP request line, HTTP header, and HTTP body. If the user constructs a request, only part of the HTTP header is sent. Then the HTTP parser would have been waiting for subsequent data to arrive. This can lead to DDOS attacks, so Node.js sets a timeout for parsing HTTP headers, and the threshold is 60 seconds. If the HTTP header is not parsed within 60 seconds, the timeout event will be fired. Node.js automatically closes the connection if the user doesn't handle it. Let's take a look at the Node.js implementation. Node.js will set a timeout when initializing.

````js
    this.headersTimeout = 60 * 1000; // 60 seconds
    // Node.js initializes the start time of parsing HTTP headers after establishing a successful TCP connection.
    function connectionListenerInternal(server, socket) {
      parser.parsingHeadersStart = nowDate();
    }
`````

Then, every time the data is received, it is judged whether the HTTP header is parsed or not. If the parsing is not completed and the timeout is exceeded, the timeout event will be triggered.

```js
    function onParserExecute(server, socket, parser, state, ret) {
      socket._unrefTimer();
      const start = parser.parsingHeadersStart;
      // start is equal to 0, indicating that the HTTP header has been parsed, otherwise it indicates that the header is being parsed, and then judge whether the parsing time has timed out if (start !== 0 &amp;&amp; nowDate() - start &gt; server.headersTimeout) {
        // Trigger the timeout. If the timeout is not monitored, the socket will be destroyed by default, that is, the connection will be closed. const serverTimeout = server.emit('timeout', socket);

        if (!serverTimeout)
          socket.destroy();
        return;
      }

      onParserExecuteCommon(server, socket, parser, state, ret, undefined);
    }
```

If the parsing of the HTTP header is completed before the timeout, set parsingHeadersStart to 0 to indicate that the parsing is complete.

```js
    function parserOnIncoming(server, socket, state, req, keepAlive) {
      // If keepAlive is set, some states need to be reset after the response if (server.keepAliveTimeout &gt; 0) {
        req.on('end', resetHeadersTimeoutOnReqEnd);
      }

      // Mark header is parsed socket.parser.parsingHeadersStart = 0;
    }

    function resetHeadersTimeoutOnReqEnd() {
      if (parser) {
        parser.parsingHeadersStart = nowDate();
      }
    }
```

In addition, if long connections are supported, that is, multiple requests can be sent on a single TCP connection. After each response, the start time of parsing HTTP headers needs to be reinitialized. When the next request data arrives, it is judged again whether parsing the HTTP header has timed out. Here the calculation starts after the response is over. instead of when the next request comes.
2 In the case of supporting pipeline, the interval of multiple requests Node.js supports sending multiple HTTP requests on one TCP connection, so a timer needs to be set. If no new request arrives after the timeout, a timeout event will be triggered. This involves setting and resetting the timer.

```js
    // Is it the last response if (res._last) {
        // If yes, destroy the socket
        if (typeof socket.destroySoon === 'function') {
          socket.destroySoon();
        } else {
          socket.end();
        }
      } else if (state.outgoing.length === 0) {
        // If there is no pending response, reset the timeout, wait for the request to arrive, and trigger the timeout event if there is no request within a certain period of time if (server.keepAliveTimeout &amp;&amp; typeof socket.setTimeout === 'function') {
          socket.setTimeout(server.keepAliveTimeout);
          state.keepAliveTimeoutSet = true;
        }
      }
```

At the end of each response, Node.js will first determine whether the current response is the last one. For example, if the reader is unreadable, it means that there will be no more requests and no response, so there is no need to maintain this TCP connection. . If the current response is not the last one, Node.js will make the next judgment based on the value of keepAliveTimeout. If keepAliveTimeout is not empty, a timer will be set. If there is no new request within keepAliveTimeout, the timeout event will be triggered. Then if a new request comes, you need to reset this timer. Node.js resets this timer on the first request packet that receives a new request.

```js
function onParserExecuteCommon(server, socket, parser, state, ret, d) {
  resetSocketTimeout(server, socket, state);
}

function resetSocketTimeout(server, socket, state) {
  if (!state.keepAliveTimeoutSet) return;

  socket.setTimeout(server.timeout || 0);
  state.keepAliveTimeoutSet = false;
}
```

onParserExecuteCommon will be executed every time data is received, then Node.js will reset the timer to the value of server.timeout.

## 18.4 Agent

In this section, we first analyze the implementation of the Agent module. The Agent manages the pooling of TCP connections. In a simple case, before the client sends an HTTP request, it first establishes a TCP connection, and closes the TCP connection immediately after receiving the response. But we know that TCP's three-way handshake is more time-consuming. So if we can reuse TCP connections, send multiple HTTP requests and receive multiple HTTP responses on one TCP connection, then the performance will be greatly improved. The role of the Agent is to reuse the TCP connection. However, the Agent mode is to send requests and receive responses serially on a TCP connection, and does not support the HTTP PipeLine mode. Let's take a look at the specific implementation of the Agent module. See how it implements TCP connection multiplexing.

```js
function Agent(options) {
  if (!(this instanceof Agent)) return new Agent(options);
  EventEmitter.call(this);
  this.defaultPort = 80;
  this.protocol = "http:";
  this.options = { ...options };
  // The path field indicates the path used for local inter-process communication, such as the Unix domain path this.options.path = null;
  //(options) {
  let name = options.host || "localhost";
  name += ":";
  if (options.port) name += options.port;
  name += ":";
  if (options.localAddress) name += options.localAddress;
  if (options.family === 4 || options.family === 6)
    name += `:${options.family}`;
  if (options.socketPath) name += `:${options.socketPath}`;
  return name;
}
```

We see that the key is calculated from host, port, local address, address cluster type, and unix path. So different requests can reuse connections only if these factors are the same. Also we see that the Agent supports Unix domains.

### 18.4.2 Create a socket

```js
    function createSocket(req, options, cb) {
      options = { ...options, ...this.options };
      // calculate key
      const name = this.getName(options);
      options._agentKey = name;
      options.encoding = null;
      let called = false;
      // Callback executed after socket is created const oncreate = (err, s) =&gt; {
        if (called)
          return;
        called = true;
        if (err)
          return cb(err);
        if (!this.sockets[name]) {
          this.sockets[name] = [];
        }
        // Insert into the socket queue in use this.sockets[name].push(s);
         // Listen to some events of the socket to recycle the socket
        installListeners(this, s, options);
        // There is an available socket, notify the caller cb(null, s);
      };
      // Create a new socket, use net.createConnection
      const newSocket = this.createConnection(options, oncreate);
      if (newSocket)
        oncreate(null, newSocket);
    }

    function installListeners(agent, s, options) {
      /*
        The socket triggers the idle event handler to tell the agent that the socket is idle.
        The agent will recycle the socket to the idle queue */
      function onFree() {
        agent.emit('free', s, options);
      }
      /*
        Listen to the socket idle event, which is triggered after the caller finishes using the socket.
        Notify agent socket is used up */
      s.on('free', onFree);

      function onClose(err) {
        agent.removeSocket(s, options);
      }
      // If the socket is closed, the agent will delete it from the socket queue s.on('close', onClose);

      function onRemove() {
        agent.removeSocket(s, options);
        s.removeListener('close', onClose);
        s.removeListener('free', onFree);
        s.removeListener('agentRemove', onRemove);
      }
      // agent is removed s.on('agentRemove', onRemove);

    }
```

The main logic of creating a socket is as follows: 1. Call the net module to create a socket (TCP or Unix domain), then insert it into the socket queue in use, and finally notify the caller that the socket is successfully created.  
 2 Listen to the close, free events and agentRemove events of the socket, and delete the socket from the queue when triggered.

### 18.4.3 Delete socket

```js
    // remove socket from active or idle queue function removeSocket(s, options) {
      const name = this.getName(options);
      const sets = [this.sockets];
      /*
        If the socket is not writable, it may exist in an idle queue.
        So you need to traverse the idle queue, because removeSocket will only be called when the socket is used up or when the socket is closed. The former is only called when it is in a writable state, and the latter is not writable*/
      if (!s.writable)
        sets.push(this.freeSockets);
      // delete the corresponding socket from the queue
      for (const sockets of sets) {
        if (sockets[name]) {
          const index = sockets[name].indexOf(s);
          if (index !== -1) {
            sockets[name].splice(index, 1);
            // Don't leak
            if (sockets[name].length === 0)
              delete sockets[name];
          }
        }
      }
      /*
        If there is still a request waiting for socekt, create a socket to handle it,
        Because the number of sockets has been reduced by one, it means that the number of sockets has not reached the threshold, but here we should first judge whether there are any free sockets, and if there are, they can be reused.
        If not, create a new socket
      */
      if (this.requests[name] &amp;&amp; this.requests[name].length) {
        const req = this.requests[name][0];
        const socketCreationHandler = handleSocketCreation(this,
                                                                req,
                                                                false);
        this.createSocket(req, options, socketCreationHandler);
      }
    };
```

As has been analyzed above, the Agent maintains two socket queues. To delete a socket is to find the corresponding socket from these two queues and then remove it. After removing it, you need to judge whether there is still a request queue waiting for the socket, and if so, create a new socket to process it. Because a socket is removed, it means that a new socket can be added.

### 18.4.4 Set socket keepalive

And the number of sockets used has not yet reached the threshold, then continue to create \*/  
 this.createSocket(req,
options,  
 handleSocketCreation(this, req, true));  
 } else {  
 // Wait for a free socket under the key  
 if (!this.requests[name]) {  
 this.requests[name] = [];  
 }  
 this.requests[name].push(req);  
 }  
 }

````

When we need to send an HTTP request, we can host the request to the Agent through the Agent's addRequest method, and the Agent will notify us when there is an available socket. The code of addRequest is very long, mainly divided into three cases.
1 If there is an idle socket, it will be reused directly and inserted into the socket queue in use. We mainly look at the setRequestSocket function ```js
    function setRequestSocket(agent, req, socket) {
      // Notify that the request socket was created successfully req.onSocket(socket);
      const agentTimeout = agent.options.timeout || 0;
      if (req.timeout === undefined || req.timeout === agentTimeout)
      {
        return;
      }
      // Start a timer and trigger the timeout event after expiration socket.setTimeout(req.timeout);
      /*
        Listen to the response event, after the response, you need to reset the timeout period,
        Turn on the timeout calculation for the next request, otherwise it will expire in advance */
      req.once('response', (res) =&gt; {
        res.once('end', () =&gt; {
          if (socket.timeout !== agentTimeout) {
            socket.setTimeout(agentTimeout);
          }
        });
      });
    }
````

The setRequestSocket function notifies the caller that there is an available socket through req.onSocket(socket). Then if the request sets a timeout, set the socket's timeout, that is, the request's timeout. Finally, listen to the response end event and reset the timeout.
2 If there is no free socket, but the number of sockets used has not reached the threshold, a new socket is created.  
 We mainly analyze the callback handleSocketCreation after the socket is created.

```js
function handleSocketCreation(agent, request, informRequest) {
  return function handleSocketCreation_Inner(err, socket) {
    if (err) {
      process.nextTick(emitErrorNT, request, err);
      return;
    }
    /*  
         Whether it is necessary to notify the requester directly, at this time the request is not from the requests queue waiting for the socket, but from the caller, see addRequest  
        */
    if (informRequest) setRequestSocket(agent, request, socket);
    /* 
            Do not notify directly, first tell the agent that there is an idle socket, 
            The agent will judge whether there is a request waiting for the socket, and if so, process it */ else
      socket.emit("free");
  };
}
```

3 If 1 and 2 are not satisfied, insert the request into the waiting socket queue.  
 After inserting the waiting socket queue, the free event will be triggered when a socket is idle. Let's take a look at the processing logic of this event.

```js
    // Listen to socket idle event this.on('free', (socket, options) =&gt; {
       const name = this.getName(options);
       // The socket is still writable and there is a request waiting for the socket, then the socket is reused
       if (socket. writable &amp;&amp;
           this.requests[name] &amp;&amp; this.requests[name].length) {
         // Get a request waiting for a socket, and notify it that a socket is available const req = this.requests[name].shift();
         setRequestSocket(this, req, socket);
         // If there is no request waiting for socket, delete it to prevent memory leak if (this.requests[name].length === 0) {
           // don't leak
           delete this.requests[name];
         }
       } else {
         // The socket is not available for writing or there is no request waiting for the socket const req = socket._httpMessage;
         // The socket is writable and the request is set to allow the use of multiplexed sockets
         if (req &amp;&amp;
             req.shouldKeepAlive &amp;&amp;
             socket.writable &amp;&amp;
             this.keepAlive) {
           let freeSockets = this.freeSockets[name];
           // The current number of free sockets under the key const freeLen = freeSockets ? freeSockets.length : 0;
           let count = freeLen;
           // Number of sockets in use if (this.sockets[name])
             count += this.sockets[name].length;
           /*
               The number of sockets used by the key reaches the threshold or the number of idle sockets reaches the threshold.
               Then the socket is not reused, and the socket is directly destroyed.
            */
           if (count &gt; this.maxSockets ||
             freeLen &gt;= this.maxFreeSockets) {
             socket.destroy();
           } else if (this.keepSocketAlive(socket)) {
             /*
                Reset the survival time of the socket. If the setting fails, it means that the survival time cannot be reset, which means that multiplexing may not be supported.*/
             freeSockets = freeSockets || [];
             this.freeSockets[name] = freeSockets;
             socket[async_id_symbol] = -1;
             socket._httpMessage = null;
             // remove the socket from the in-use queue this.removeSocket(socket, options);
             //
```
