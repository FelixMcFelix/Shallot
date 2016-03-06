# Shallot
Small-scale onion routing over WebRTC, built on top of [Conductor-Chord](https://github.com/FelixMcFelix/conductor-chord) in ES6.


## Overview

Shallot uses the chord network to allow opening of an onion route to any other node of a known ID. The idea is that this can allow for security-focused apps to be designed around Chord's File System and ownership of keys, allowing you to tie usernames in an app to node IDs if desired.

### Standard Usage

Shallot can be used either as a module for an existing Chord system, or as the basis of such a system:

```js
//Full Shallot (includes Chord)
var Shallot = require("shallot").Shallot;

//Module Only
var Module = require("shallot").ShallotModule;

window.s = new Shallot();

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

## Changelog

### 1.0.0
* Initial version.