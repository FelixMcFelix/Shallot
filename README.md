# Shallot
Small-scale onion routing over WebRTC, built on top of [Conductor-Chord](https://github.com/FelixMcFelix/conductor-chord) in ES6.

***DISCLAIMER: THIS PROJECT IS A PROOF-OF-CONCEPT, AND SHOULD NOT BE USED WHERE SERIOUS SECURITY IS DESIRED!***

Full report on the system design and security is located [on my website](https://mcfelix.me/docs/shallot.pdf).

## Overview

Shallot uses the chord network to allow opening of an onion route to any other node of a known ID. The idea is that this can allow for security-focused apps to be designed around Chord's File System and ownership of keys, allowing you to tie usernames in an app to node IDs if desired.

Routes in the system are one-way; this approach is taken to minimize the risk of route failure affecting both directions of traffic flow, similarly to I2P.

### Standard Usage

Shallot can be used either as a module for an existing Chord system, or as the basis of such a system:

```js
//Full Shallot (includes Chord)
var Shallot = require("shallot-routing").Shallot;

//Module Only
var Module = require("shallot-routing").ShallotModule;

window.s = new Shallot({
  chordConfig: {
    // See Chord repo for details.
  },

  shallotConfig: {
    // Amount of nodes before endpoint.
    routeLength: 3,

    // Timeout duration for each call along the route.
    callTimeout: 1500,

    // Max attempts for each call along the route.
    maxCallRetries: 3,

    // Time to cache answered states for calls.
    rcCacheDuration: 20000
  }
});

//Join a chord network...
s.join("ws://mcfelix.me:7171")
  .then(
    () => {
      //Act on connections sent to us.
      s.on("receiveConnection", conn => {
        //Listening for messages on channels we receive.
        conn.on("data", data => console.log(`[DATA] ${conn.startId}): ${data}`))
      })

      //Opening a connection to another node.
      s.connectTo(/* id */)
        .then(
          session => session.send("Hello World!"),
          error => console.log("Error encountered while opening! " + error)
        )
    },

    error => {
      alert("Couldn't join chord server: " + error);
    }
  )
```

For a server node, using my modified [wrtc](https://github.com/FelixMcFelix/node-webrtc):

```js
var Shallot = require("shallot-routing").Shallot,
  wrtc = require("wrtc"),
  SegfaultHandler = require("segfault-handler");

SegfaultHandler.registerHandler("crash.log");

var s = new Shallot(
  {
    chordConfig:{
      conductorConfig: {
        rtc_facade: wrtc
      },

      isServer: true,

      debug: true
    }
  }
);
```

## Changelog

### 1.0.0
* Initial version.
