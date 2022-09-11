The events module is a relatively simple but very core module in Node.js. In Node.js, many modules are inherited from the events module, which is the implementation of the publish and subscribe mode. Let's first look at how to use the events module.

```js
    const { EventEmitter } = require('events');
    class Events extends EventEmitter {}
    const events = new Events();
    events.on('demo', () =&gt; {
        console.log('emit demo event');
    });
    events.emit('demo');
```

Next, let's take a look at the specific implementation of the events module.

## 22.1 Initialization When an EventEmitter or its subclass is new, it will enter the logic of EventEmitter.

```js
    function EventEmitter(opts) {
      EventEmitter.init.call(this, opts);
    }

    EventEmitter.init = function(opts) {
      // If it is uninitialized or there is no custom _events, initialize if (this._events === undefined ||
          this._events === ObjectGetPrototypeOf(this)._events) {
        this._events = ObjectCreate(null);
        this._eventsCount = 0;
      }
      // Initialize the threshold of the number of handlers this._maxListeners = this._maxListeners || undefined;

      // Whether to enable capture promise reject, default false
      if (opts &amp;&amp; opts.captureRejections) {
        this[kCapture] = Boolean(opts.captureRejections);
      } else {
        this[kCapture] = EventEmitter.prototype[kCapture];
      }
    };
```

The initialization of EventEmitter mainly initializes some data structures and properties. The only supported parameter is captureRejections, captureRejections indicates whether the EventEmitter captures the exception in the handler when the event is triggered and the handler is executed. We will explain in detail later.

## 22.2 Subscribing to events After the EventEmitter is initialized, we can start to use the functions of subscription and publishing. We can subscribe to events through addListener, prependListener, on, once. addListener and on are equivalent. The difference between prependListener is that the handler function will be inserted at the beginning of the queue, and the default is appended to the end of the queue. The handler function registered once is executed at most once. The four APIs are implemented through the \_addListener function. Let's take a look at the specific implementation.

```js
    function _addListener(target, type, listener, prepend) {
      let m;
      let events;
      let existing;
      events = target._events;
      // If _events has not been initialized yet, initialize if (events === undefined) {
        events = target._events = ObjectCreate(null);
        target._eventsCount = 0;
      } else {
        /*
          Whether the newListener event is defined, if so, trigger it first, if the newListener event is monitored,
          The newListener is fired every time another event is registered, equivalent to a hook */
        if (events.newListener !== undefined) {
          target.emit('newListener', type,
                      listener.listener ? listener.listener : listener);
          // May modify _events, here reassign events = target._events;
        }
        // Determine if there is already a handler function existing = events[type];
      }
      // If it does not exist, it is stored in the form of a function, otherwise it is an array if (existing === undefined) {
        events[type] = listener;
        ++target._eventsCount;
      } else {
        if (typeof existing === 'function') {
          existing = events[type] =
            prepend ? [listener, existing] : [existing, listener];
        } else if (prepend) {
          existing.unshift(listener);
        } else {
          existing.push(listener);
        }

        // Handling alarms, too many handling functions may be because the previous ones were not deleted, causing memory leaks m = _getMaxListeners(target);
        if (m &gt; 0 &amp;&amp; existing.length &gt; m &amp;&amp; !existing.warned) {
          existing.warned = true;
          const w = new Error('Possible EventEmitter memory leak detected. ' +
                              `${existing.length} ${String(type)} listeners ` +
     `added to ${inspect(target, { depth: -1 })}. Use ` +
                              'emitter.setMaxListeners() to increase limit');
          w.name = 'MaxListenersExceededWarning';
          w.emitter = target;
          w.type = type;
          w.count = existing.length;
          process.emitWarning(w);
        }
      }

      return target;
    }
```

Next, let's take a look at the implementation of once. Compared with other APIs, the implementation of once is relatively difficult, because we need to control the processing function to be executed at most once, so we need to stick to the user-defined function to ensure that when the event is triggered, the user is executed. While defining the function, you also need to delete the registered events.

```js
    EventEmitter.prototype.once = function once(type, listener) {
      this.on(type, _onceWrap(this, type, listener));
      return this;
    };

    function onceWrapper() {
      // haven't fired if (!this.fired) {
        // remove him this.target.removeListener(this.type, this.wrapFn);
        // fired this.fired = true;
        // execute if (arguments.length === 0)
          return this.listener.call(this.target);
        return this.listener.apply(this.target, arguments);
      }
    }
    // support once api
    function _onceWrap(target, type, listener) {
      // Whether fired has executed the handler, wrapFn wraps the listener's function const state = { fired: false, wrapFn: undefined, target, type, listener };
      // Generate a function that wraps the listener const wrapped = onceWrapper.bind(state);
      // The original function listener is also linked to the package function, for the user to actively delete before the event is triggered, see removeListener
      wrapped.listener = listener;
      // Save the wrapper function for deletion after execution, see onceWrapper
      state.wrapFn = wrapped;
      return wrapped;
    }
```

## 22.3 Triggering events After analyzing the subscription of events, let's look at the triggering of events.

```js
    EventEmitter.prototype.emit = function emit(type, ...args) {
      // Whether the triggered event is an error, the error event needs special handling let doError = (type === 'error');

      const events = this._events;
      // Defines a handler function (not necessarily a handler for type events)
      if (events !== undefined) {
        // If the triggered event is error, and the kErrorMonitor event is monitored, the kErrorMonitor event is triggered if (doError &amp;&amp; events[kErrorMonitor] !== undefined)
          this.emit(kErrorMonitor, ...args);
        // The error event is triggered but no handler function is defined doError = (doError &amp;&amp; events.error === undefined);
      } else if (!doError) // If no handler function is defined and it is not an error event, no processing is required,
        return false;

      // If there is no 'error' event listener then throw.
      // The error event is triggered, but the function to handle the error event is not defined, then an error is reported if (doError) {
        let er;
        if (args.length &gt; 0)
          er = args[0];
        // The first parameter is the instance of Error if (er instanceof Error) {
          try {
            const capture = {};
            /*
              Inject the stack property into the capture object, the value of the stack is to execute Error.captureStackTrace
              The current stack information of the statement, but does not include the part of emit */
            Error.captureStackTrace(capture, EventEmitter.prototype.emit);
            ObjectDefineProperty(er, kEnhanceStackBeforeInspector, {
              value: enhanceStackTrace.bind(this, er, capture),
              configurable: true
            });
          } catch {}
          throw er; // Unhandled 'error' event
        }

        let stringifiedEr;
        const { inspect } = require('internal/util/inspect');
        try {
          stringifiedEr = inspect(er);
        } catch {
          stringifiedEr = er;
        }
        const err = new ERR_UNHANDLED_ERROR(stringifiedEr);
        err.context = er;
        throw err; // Unhandled 'error' event
      }
      // Get the handler function corresponding to the type event const handler = events[type];
      // if not, do not handle if (handler === undefined)
        return false;
      // equal to the function specification has only one if (typeof handler === 'function') {
        // Direct execution const result = ReflectApply(handler, this, args);
        // non-null to determine whether it is a promise and whether it needs to be processed, see addCatch
        if (result !== undefined &amp;&amp; result !== null) {
          addCatch(this, result, type, args);
        }
      } else {
        // Multiple handler functions, same as above const len ​​= handler.length;
        const listeners = arrayClone(handler, len);
        for (let i = 0; i &lt;// Indicates that the removeListener event is registered, arguments.length === 0 indicates that all types of events are deleted if (arguments.length === 0) {
            // Delete one by one, except for removeListener events, where non-removeListener events are deleted for (const key of ObjectKeys(events)) {
              if (key === 'removeListener') continue;
              this.removeAllListeners(key);
            }
            // remove the removeListener event here, see the logic below this.removeAllListeners('removeListener');
            // reset the data structure this._events = ObjectCreate(null);
            this._eventsCount = 0;
            return this;
          }
          // delete a certain type of event const listeners = events[type];

          if (typeof listeners === 'function') {
            this.removeListener(type, listeners);
          } else if (listeners !== undefined) {
            // LIFO order
            for (let i = listeners.length - 1; i &gt;= 0; i--) {
              this.removeListener(type, listeners[i]);
            }
          }

          return this;
        }
```

The main logic of the removeAllListeners function has two points. The first is that the removeListener event needs special processing, which is similar to a hook. This event is triggered every time the user deletes the event handler. The second is the removeListener function. removeListener is the implementation of the actual delete event handler. removeAllListeners is the logic that encapsulates removeListener.

```js
    function removeListener(type, listener) {
       let originalListener;
       const events = this._events;
       // nothing to remove if (events === undefined)
         return this;

       const list = events[type];
       // same as above if (list === undefined)
         return this;
       // list is a function indicating that there is only one processing function, otherwise it is an array, if list.listener === listener indicates that it is once registered if (list === listener || list.listener === listener) {
         // There is only one handler of type type, and no other types of events are registered, then initialize _events
         if (--this._eventsCount === 0)
           this._events = ObjectCreate(null);
         else {
           // delete the attribute corresponding to type delete events[type];
           // If the removeListener event is registered, first register the removeListener event if (events.removeListener)
             this.emit('removeListener', type, list.listener || listener);
         }
       } else if (typeof list !== 'function') {
         // multiple handlers let position = -1;
         // Find the function to delete for (let i = list.length - 1; i &gt;= 0; i--) {
           if (list[i] === listener || list[i].listener === listener) {
             // Save the original handler, if any originalListener = list[i].listener;
             position = i;
             break;
           }
         }

         if (position &lt; 0)
           return this;
         // The first one is dequeued, otherwise delete an if (position === 0)
           list.shift();
         else {
           if (spliceOne === undefined)
             spliceOne = require('internal/util').spliceOne;
           spliceOne(list, position);
         }
         // If there is only one left, change the value to function type if (list.length === 1)
           events[type] = list[0];
         // trigger removeListener
         if (events.removeListener !== undefined)
           this.emit('removeListener', type, originalListener || listener);
       }

       return this;
     };
```

The above is the core logic of the events module, and there are some tool functions that are not analyzed one by one.
