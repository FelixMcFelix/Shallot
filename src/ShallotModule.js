"use strict";

const RemoteCallable = require("conductor-chord").RemoteCallable,
	EventEmitter2 = require("eventemitter2").EventEmitter2;

class ShallotModule extends RemoteCallable {
	constructor (chord) {
		super(chord, "shallot");

		this._rcTimeout = 666;
	    this._rcRetries = 3;
	    this._rcCacheDuration = 5000;

	    this._evts = new EventEmitter2({
	    	maxListeners: 20
	    });

		chord.registerModule(this);
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

	delegate (message) {
		if(super.delegate(message))
			return;

		switch (message.handler) {

		}
	}
}

module.exports = ShallotModule;