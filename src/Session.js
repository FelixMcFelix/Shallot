"use strict";

class Session {
	constructor (shallot, route, aesKeys, circ) {
		this.module = shallot;
		this.route = route;
		this.aesKeys = aesKeys;
		this.circ = circ;

		this._evts = new EventEmitter2({
			maxListeners: 20
		});
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

	send (data) {
		//TODO
	}
}

module.exports = Session;