"use strict";

const EventEmitter2 = require("eventemitter2").EventEmitter2;

//EVENTS:
//	.on("data", data)
//	.on("close", startId)

class RecvSession {
	constructor (shallot, startId) {
		this.module = shallot;
		this.startId = startId;

		this._evts = new EventEmitter2({
			maxListeners: 20
		});

		shallot.emit("receiveConnection", this);
	}

	get emit () {
		return this._evts.emit.bind(this._evts);
	}

	get on () {
		return this._evts.on.bind(this._evts);
	}

	get off () {
		return this._evts.off.bind(this._evts);
	}

	content (data) {
		this.emit("data", data);
	}
}

module.exports = RecvSession;